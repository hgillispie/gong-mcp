#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import axios from 'axios';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { createServer } from 'node:http';

const originalConsole = { ...console };
console.log = (...args) => originalConsole.error(...args);
console.info = (...args) => originalConsole.error(...args);
console.warn = (...args) => originalConsole.error(...args);

dotenv.config();

const GONG_API_URL = 'https://api.gong.io/v2';
const GONG_ACCESS_KEY = process.env.GONG_ACCESS_KEY;
const GONG_ACCESS_SECRET = process.env.GONG_ACCESS_SECRET;

if (!GONG_ACCESS_KEY || !GONG_ACCESS_SECRET) {
  console.error("Error: GONG_ACCESS_KEY and GONG_ACCESS_SECRET environment variables are required");
  process.exit(1);
}

// OAuth Client Credentials
const clientCredentials = new Map<string, string>();
if (process.env.MCP_CLIENT_ID && process.env.MCP_CLIENT_SECRET) {
  clientCredentials.set(process.env.MCP_CLIENT_ID, process.env.MCP_CLIENT_SECRET);
}

const TOKEN_TTL_SECONDS = 3600;
const activeTokens = new Map<string, { clientId: string; expiresAt: number }>();

function issueToken(clientId: string): { access_token: string; token_type: string; expires_in: number } {
  const token = crypto.randomBytes(32).toString('hex');
  activeTokens.set(token, { clientId, expiresAt: Date.now() + TOKEN_TTL_SECONDS * 1000 });
  return { access_token: token, token_type: 'Bearer', expires_in: TOKEN_TTL_SECONDS };
}

function validateToken(token: string): boolean {
  const entry = activeTokens.get(token);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    activeTokens.delete(token);
    return false;
  }
  return true;
}

function authenticateClient(clientId: string, clientSecret: string): boolean {
  const stored = clientCredentials.get(clientId);
  return stored !== undefined && stored === clientSecret;
}

function parseFormBody(body: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of body.split('&')) {
    const [key, val] = pair.split('=').map(decodeURIComponent);
    if (key) params[key] = val ?? '';
  }
  return params;
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Gong API Client
interface GongCallSummary {
  id: string;
  title: string;
  started?: string;
  duration?: number;
  direction?: string;
  system?: string;
  scope?: string;
  url?: string;
  [key: string]: unknown;
}

interface GongUser {
  id: string;
  firstName?: string;
  lastName?: string;
  emailAddress?: string;
  [key: string]: unknown;
}

const MAX_SEARCH_PAGES = 30;

class GongClient {
  private accessKey: string;
  private accessSecret: string;

  constructor(accessKey: string, accessSecret: string) {
    this.accessKey = accessKey;
    this.accessSecret = accessSecret;
  }

  private get authHeader(): string {
    return `Basic ${Buffer.from(`${this.accessKey}:${this.accessSecret}`).toString('base64')}`;
  }

  private async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const response = await axios.get(`${GONG_API_URL}${path}`, {
      params,
      headers: { 'Authorization': this.authHeader },
    });
    return response.data as T;
  }

  private async post<T>(path: string, data?: Record<string, unknown>): Promise<T> {
    const response = await axios.post(`${GONG_API_URL}${path}`, data, {
      headers: { 'Content-Type': 'application/json', 'Authorization': this.authHeader },
    });
    return response.data as T;
  }

  private termsMatch(text: string, terms: string[]): boolean {
    const lower = text.toLowerCase();
    return terms.every(t => lower.includes(t));
  }

  async searchCalls(opts: {
    query?: string;
    fromDateTime?: string;
    toDateTime?: string;
    maxResults?: number;
  }): Promise<{ matches: unknown[]; totalMatches: number; totalScanned: number; truncated: boolean }> {
    const maxResults = opts.maxResults ?? 20;
    const terms = (opts.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const from = opts.fromDateTime ?? new Date(Date.now() - 90 * 86400000).toISOString();
    const to = opts.toDateTime ?? new Date().toISOString();

    const titleMatches: GongCallSummary[] = [];
    const allCalls: GongCallSummary[] = [];
    let cursor: string | undefined;
    let totalScanned = 0;

    for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
      const params: Record<string, string> = { fromDateTime: from, toDateTime: to };
      if (cursor) params.cursor = cursor;

      const data = await this.get<{ calls: GongCallSummary[]; records: { cursor?: string } }>('/calls', params);
      totalScanned += data.calls.length;
      allCalls.push(...data.calls);

      if (terms.length > 0) {
        for (const call of data.calls) {
          if (this.termsMatch(call.title ?? '', terms)) {
            titleMatches.push(call);
          }
        }
      } else {
        titleMatches.push(...data.calls);
      }

      if (titleMatches.length >= maxResults || !data.records.cursor) break;
      cursor = data.records.cursor;
    }

    titleMatches.sort((a, b) => (b.started ?? '').localeCompare(a.started ?? ''));

    if (terms.length > 0 && titleMatches.length === 0) {
      // Deep search: check parties/companies. Sort newest-first so we find
      // recent matches before hitting the batch limit.
      allCalls.sort((a, b) => (b.started ?? '').localeCompare(a.started ?? ''));
      const idsToSearch = allCalls.map(c => c.id);

      const partyMatches: GongCallSummary[] = [];
      for (let i = 0; i < idsToSearch.length && partyMatches.length < maxResults; i += 50) {
        const batch = idsToSearch.slice(i, i + 50);
        const details = await this.post<{ calls: Array<{ metaData: GongCallSummary; parties?: Array<{ name?: string; emailAddress?: string; company?: string }> }> }>('/calls/extensive', {
          filter: { callIds: batch },
          contentSelector: { exposedFields: { parties: true } },
        });
        for (const call of details.calls) {
          const parties = call.parties ?? [];
          const searchable = [
            call.metaData.title ?? '',
            ...parties.map(p => `${p.name ?? ''} ${p.emailAddress ?? ''} ${p.company ?? ''}`),
          ].join(' ');
          if (this.termsMatch(searchable, terms)) {
            partyMatches.push(call.metaData);
          }
        }
      }

      partyMatches.sort((a, b) => (b.started ?? '').localeCompare(a.started ?? ''));
      const totalPartyMatches = partyMatches.length;
      const enriched = await this.enrichSearchResults(partyMatches.slice(0, maxResults), totalScanned);
      return { ...enriched, totalMatches: totalPartyMatches, truncated: totalPartyMatches > maxResults };
    }

    const totalTitleMatches = titleMatches.length;
    const enriched = await this.enrichSearchResults(titleMatches.slice(0, maxResults), totalScanned);
    return { ...enriched, totalMatches: totalTitleMatches, truncated: totalTitleMatches > maxResults };
  }

  private async enrichSearchResults(
    calls: GongCallSummary[],
    totalScanned: number,
  ): Promise<{ matches: unknown[]; totalScanned: number }> {
    if (calls.length === 0) return { matches: [], totalScanned };

    const ids = calls.map(c => c.id);
    const details = await this.post<{
      calls: Array<{
        metaData: GongCallSummary;
        parties?: Array<{ name?: string; emailAddress?: string; company?: string; affiliation?: string; title?: string }>;
        content?: { brief?: string };
      }>;
    }>('/calls/extensive', {
      filter: { callIds: ids },
      contentSelector: {
        exposedFields: {
          content: { brief: true },
          parties: true,
        },
      },
    });

    const detailMap = new Map<string, { parties: unknown[]; brief: string }>();
    for (const call of details.calls) {
      const parties = (call.parties ?? []).map(p => ({
        name: p.name,
        email: p.emailAddress,
        company: p.company,
        affiliation: p.affiliation,
        title: p.title,
      }));
      detailMap.set(call.metaData.id, {
        parties,
        brief: call.content?.brief ?? '',
      });
    }

    const enriched = calls.map(call => {
      const extra = detailMap.get(call.id);
      return {
        id: call.id,
        title: call.title,
        started: call.started,
        duration: call.duration,
        url: call.url,
        direction: call.direction,
        scope: call.scope,
        participants: extra?.parties ?? [],
        brief: extra?.brief ?? '',
      };
    });

    return { matches: enriched, totalScanned };
  }

  async getCallDetails(callIds: string[]) {
    return this.post('/calls/extensive', {
      filter: { callIds },
      contentSelector: {
        exposedFields: {
          content: {
            structure: true, topics: true, trackers: true,
            pointsOfInterest: true, brief: true, outline: true,
            callOutcome: true, keyPoints: true, actionItems: true,
          },
          collaboration: { publicComments: true },
          parties: true,
          interaction: { interactionStats: true, video: true, speakers: true, questions: true },
          media: true,
        },
      },
    });
  }

  async retrieveTranscripts(callIds: string[]) {
    return this.post('/calls/transcript', { filter: { callIds } });
  }

  async searchUsers(query?: string): Promise<GongUser[]> {
    const allUsers: GongUser[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < 20; page++) {
      const params: Record<string, string> = {};
      if (cursor) params.cursor = cursor;
      const data = await this.get<{ users: GongUser[]; records: { cursor?: string } }>('/users', params);
      allUsers.push(...data.users);
      if (!data.records?.cursor) break;
      cursor = data.records.cursor;
    }

    if (!query) return allUsers;

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return allUsers.filter(u => {
      const searchable = `${u.firstName ?? ''} ${u.lastName ?? ''} ${u.emailAddress ?? ''}`.toLowerCase();
      return terms.every(t => searchable.includes(t));
    });
  }

  async getUser(userId: string) {
    return this.get(`/users/${userId}`);
  }

  async getScorecardDefinitions() {
    return this.get('/settings/scorecards');
  }

  async getAnsweredScorecards(filter: {
    callFromDate?: string; callToDate?: string;
    scorecardIds?: string[]; reviewedUserIds?: string[];
  }) {
    return this.post('/stats/activity/scorecards', { filter });
  }

  async getInteractionStats(filter: { fromDate: string; toDate: string; userIds?: string[] }) {
    return this.post('/stats/interaction', { filter });
  }

  async getAggregateActivity(filter: { fromDate: string; toDate: string; userIds?: string[] }) {
    return this.post('/stats/activity/aggregate', { filter });
  }
}

const gongClient = new GongClient(GONG_ACCESS_KEY, GONG_ACCESS_SECRET);

// Tool definitions

const TOOLS: Tool[] = [
  {
    name: "search_calls",
    description: "Search Gong calls by keyword. Returns results with participants, brief summary, and metadata — enough to triage which calls matter. Matches titles first, then falls back to participant names/emails/companies. Sorted newest-first. Defaults to last 90 days. For full key points, outlines, and questions, pass call IDs to get_call_details. For meeting prep, search the account name and review all returned calls.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search terms — matches against call titles, participant names, emails, and company names (e.g. 'Edmunds', 'Sarah demo', 'Acme Corp')",
        },
        fromDateTime: {
          type: "string",
          description: "Start of date range in ISO format (e.g. 2024-01-01T00:00:00Z). Defaults to 90 days ago.",
        },
        toDateTime: {
          type: "string",
          description: "End of date range in ISO format. Defaults to now.",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of calls to return (default 20, max 50)",
        },
      },
    },
  },
  {
    name: "get_call_details",
    description: "Get rich details for one or more calls by ID: participants, key points, briefs, outlines (section-by-section breakdown), topics, trackers, questions asked (with text), and comments. Use search_calls first to find call IDs. For meeting prep, pass ALL call IDs from search_calls to get the full picture across meetings — key points and outlines contain specific discussion details, participant concerns, and decisions.",
    inputSchema: {
      type: "object",
      properties: {
        callIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of Gong call IDs (from search_calls results)",
        },
      },
      required: ["callIds"],
    },
  },
  {
    name: "retrieve_transcripts",
    description: "Get the full word-for-word transcript of calls. Returns timestamped sentences with speaker IDs. Token-heavy — only use when the user needs exact quotes, specific phrasing, or full conversation flow. Prefer get_call_details for summaries and key points.",
    inputSchema: {
      type: "object",
      properties: {
        callIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of Gong call IDs",
        },
      },
      required: ["callIds"],
    },
  },
  {
    name: "search_users",
    description: "Find Gong users by name or email. Returns user IDs, names, emails, and titles. Use this to look up a rep before pulling their stats or scorecard reviews. With no query, returns all users. Note: most users do not have a job title set — if the user asks about a team or role (e.g. 'the SE team', 'all AEs'), ask them to name specific people rather than trying to infer roles from data.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Name or email to search for (e.g. 'Sarah', 'john@company.com'). Omit to list all users.",
        },
      },
    },
  },
  {
    name: "get_scorecard_definitions",
    description: "List all scorecard templates configured in Gong — names, questions, and scoring criteria. Call this first to understand what scorecards exist before pulling completed reviews.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_answered_scorecards",
    description: "Get completed scorecard reviews with scores and answers. Use search_users first to get user IDs for filtering by rep. Combine with get_scorecard_definitions to map scorecard IDs to names.",
    inputSchema: {
      type: "object",
      properties: {
        callFromDate: {
          type: "string",
          description: "Filter by calls from this date (ISO format)",
        },
        callToDate: {
          type: "string",
          description: "Filter by calls up to this date (ISO format)",
        },
        scorecardIds: {
          type: "array",
          items: { type: "string" },
          description: "Filter by specific scorecard IDs (from get_scorecard_definitions)",
        },
        reviewedUserIds: {
          type: "array",
          items: { type: "string" },
          description: "Filter by reviewed user IDs (from search_users)",
        },
      },
    },
  },
  {
    name: "get_interaction_stats",
    description: "Get per-rep interaction metrics over a date range: talk ratio, longest monologue, interactivity, patience, and engagement. Use search_users first to get user IDs for filtering by specific reps.",
    inputSchema: {
      type: "object",
      properties: {
        fromDate: {
          type: "string",
          description: "Start date in ISO format",
        },
        toDate: {
          type: "string",
          description: "End date in ISO format",
        },
        userIds: {
          type: "array",
          items: { type: "string" },
          description: "User IDs to filter by (from search_users). Omit for all users.",
        },
      },
      required: ["fromDate", "toDate"],
    },
  },
  {
    name: "get_aggregate_activity",
    description: "Get aggregated activity counts over a date range: total calls, emails, meetings, feedback given/received, listening hours. Use search_users first to get user IDs for filtering by specific reps.",
    inputSchema: {
      type: "object",
      properties: {
        fromDate: {
          type: "string",
          description: "Start date in ISO format",
        },
        toDate: {
          type: "string",
          description: "End date in ISO format",
        },
        userIds: {
          type: "array",
          items: { type: "string" },
          description: "User IDs to filter by (from search_users). Omit for all users.",
        },
      },
      required: ["fromDate", "toDate"],
    },
  },
];

function createMcpServer(): Server {
  const server = new Server(
    { name: "gong-mcp", version: "0.2.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request: { params: { name: string; arguments?: unknown } }) => {
    try {
      const { name, arguments: args } = request.params;
      const a = (args ?? {}) as Record<string, unknown>;

      let response: unknown;

      switch (name) {
        case "search_calls":
          response = await gongClient.searchCalls({
            query: a.query as string | undefined,
            fromDateTime: a.fromDateTime as string | undefined,
            toDateTime: a.toDateTime as string | undefined,
            maxResults: Math.min((a.maxResults as number) ?? 20, 50),
          });
          break;

        case "get_call_details":
          if (!Array.isArray(a.callIds)) throw new Error("callIds must be an array of strings");
          response = await gongClient.getCallDetails(a.callIds as string[]);
          break;

        case "retrieve_transcripts":
          if (!Array.isArray(a.callIds)) throw new Error("callIds must be an array of strings");
          response = await gongClient.retrieveTranscripts(a.callIds as string[]);
          break;

        case "search_users":
          response = await gongClient.searchUsers(a.query as string | undefined);
          break;

        case "get_scorecard_definitions":
          response = await gongClient.getScorecardDefinitions();
          break;

        case "get_answered_scorecards":
          response = await gongClient.getAnsweredScorecards({
            callFromDate: a.callFromDate as string | undefined,
            callToDate: a.callToDate as string | undefined,
            scorecardIds: a.scorecardIds as string[] | undefined,
            reviewedUserIds: a.reviewedUserIds as string[] | undefined,
          });
          break;

        case "get_interaction_stats":
          if (typeof a.fromDate !== "string" || typeof a.toDate !== "string")
            throw new Error("fromDate and toDate are required");
          response = await gongClient.getInteractionStats({
            fromDate: a.fromDate,
            toDate: a.toDate,
            userIds: a.userIds as string[] | undefined,
          });
          break;

        case "get_aggregate_activity":
          if (typeof a.fromDate !== "string" || typeof a.toDate !== "string")
            throw new Error("fromDate and toDate are required");
          response = await gongClient.getAggregateActivity({
            fromDate: a.fromDate,
            toDate: a.toDate,
            userIds: a.userIds as string[] | undefined,
          });
          break;

        default:
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        isError: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// Session management for HTTP mode
const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: Server }>();

async function handleMcpRequest(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  const sessionId = (req.headers['mcp-session-id'] as string | undefined)?.trim();

  if (sessionId && sessions.has(sessionId)) {
    await sessions.get(sessionId)!.transport.handleRequest(req, res);
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
  const server = createMcpServer();
  await server.connect(transport);

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) sessions.delete(sid);
  };

  await transport.handleRequest(req, res);

  if (transport.sessionId) {
    sessions.set(transport.sessionId, { transport, server });
  }
}

async function runServer() {
  const port = process.env.PORT;

  if (port) {
    if (clientCredentials.size === 0) {
      console.error("Error: MCP_CLIENT_ID and MCP_CLIENT_SECRET are required when running in HTTP mode");
      process.exit(1);
    }

    const serverUrl = process.env.SERVER_URL || `http://localhost:${port}`;

    const httpServer = createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`);
      const json = (status: number, body: unknown, headers?: Record<string, string>) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
        res.end(JSON.stringify(body));
      };

      if (url.pathname === '/health') {
        json(200, { status: 'ok' });
        return;
      }

      if (url.pathname === '/.well-known/oauth-protected-resource') {
        json(200, {
          resource: `${serverUrl}/mcp`,
          authorization_servers: [serverUrl],
          bearer_methods_supported: ['header'],
        });
        return;
      }

      if (url.pathname === '/.well-known/oauth-authorization-server') {
        json(200, {
          issuer: serverUrl,
          token_endpoint: `${serverUrl}/oauth/token`,
          grant_types_supported: ['client_credentials'],
          token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
          response_types_supported: [],
        });
        return;
      }

      if (url.pathname === '/oauth/token' && req.method === 'POST') {
        const body = await readBody(req);
        const params = parseFormBody(body);

        if (params.grant_type !== 'client_credentials') {
          json(400, { error: 'unsupported_grant_type' });
          return;
        }

        let clientId: string | undefined;
        let clientSecret: string | undefined;

        const authHeader = req.headers['authorization'] ?? '';
        if (authHeader.startsWith('Basic ')) {
          const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
          const colonIndex = decoded.indexOf(':');
          if (colonIndex > 0) {
            clientId = decoded.slice(0, colonIndex);
            clientSecret = decoded.slice(colonIndex + 1);
          }
        }

        if (!clientId) {
          clientId = params.client_id;
          clientSecret = params.client_secret;
        }

        if (!clientId || !clientSecret || !authenticateClient(clientId, clientSecret)) {
          json(401, { error: 'invalid_client' });
          return;
        }

        json(200, issueToken(clientId), { 'Cache-Control': 'no-store' });
        return;
      }

      if (url.pathname === '/mcp') {
        const auth = req.headers['authorization'] ?? '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        if (!validateToken(token)) {
          res.writeHead(401, {
            'Content-Type': 'application/json',
            'WWW-Authenticate': `Bearer resource_metadata="${serverUrl}/.well-known/oauth-protected-resource"`,
          });
          res.end(JSON.stringify({ error: 'invalid_token' }));
          return;
        }

        await handleMcpRequest(req, res);
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    httpServer.listen(Number(port), () => {
      console.error(`Gong MCP server running on http://0.0.0.0:${port}/mcp`);
    });
  } else {
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
