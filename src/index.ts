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
      headers: {
        'Authorization': this.authHeader,
      },
    });
    return response.data as T;
  }

  private async post<T>(path: string, data?: Record<string, unknown>): Promise<T> {
    const response = await axios.post(`${GONG_API_URL}${path}`, data, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.authHeader,
      },
    });
    return response.data as T;
  }

  async listCalls(fromDateTime?: string, toDateTime?: string) {
    const params: Record<string, string> = {};
    if (fromDateTime) params.fromDateTime = fromDateTime;
    if (toDateTime) params.toDateTime = toDateTime;
    return this.get('/calls', params);
  }

  async getCallDetails(callIds: string[]) {
    return this.post('/calls/extensive', {
      filter: { callIds },
      contentSelector: {
        exposedFields: {
          content: {
            structure: true,
            topics: true,
            trackers: true,
            pointsOfInterest: true,
            brief: true,
            outline: true,
            callOutcome: true,
            keyPoints: true,
            actionItems: true,
          },
          collaboration: {
            publicComments: true,
          },
          parties: true,
          interaction: {
            interactionStats: true,
            video: true,
            questions: true,
            speakers: true,
          },
          media: true,
        },
      },
    });
  }

  async retrieveTranscripts(callIds: string[]) {
    return this.post('/calls/transcript', {
      filter: { callIds },
    });
  }

  async listUsers() {
    return this.get('/users');
  }

  async getUser(userId: string) {
    return this.get(`/users/${userId}`);
  }

  async getScorecardDefinitions() {
    return this.get('/settings/scorecards');
  }

  async getAnsweredScorecards(filter: {
    callFromDate?: string;
    callToDate?: string;
    scorecardIds?: string[];
    reviewedUserIds?: string[];
  }) {
    return this.post('/stats/activity/scorecards', { filter });
  }

  async getInteractionStats(filter: {
    fromDate: string;
    toDate: string;
    userIds?: string[];
  }) {
    return this.post('/stats/interaction', { filter });
  }

  async getAggregateActivity(filter: {
    fromDate: string;
    toDate: string;
    userIds?: string[];
  }) {
    return this.post('/stats/activity/aggregate', { filter });
  }
}

const gongClient = new GongClient(GONG_ACCESS_KEY, GONG_ACCESS_SECRET);

// Tool definitions

const TOOLS: Tool[] = [
  {
    name: "list_calls",
    description: "List Gong calls with optional date range filtering. Returns call metadata including ID, title, scheduled/start times, duration, direction, system, and URL.",
    inputSchema: {
      type: "object",
      properties: {
        fromDateTime: {
          type: "string",
          description: "Start date/time in ISO format (e.g. 2024-03-01T00:00:00Z)",
        },
        toDateTime: {
          type: "string",
          description: "End date/time in ISO format (e.g. 2024-03-31T23:59:59Z)",
        },
      },
    },
  },
  {
    name: "get_call_details",
    description: "Get detailed information for specific calls including participants, action items, key points, topics, trackers, talk ratios, questions asked, and collaboration comments. This is the richest call data endpoint — use it when you need more than basic metadata.",
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
    name: "retrieve_transcripts",
    description: "Retrieve full transcripts for specified calls. Returns timestamped sentences with speaker IDs. Use get_call_details first if you just need key points or action items — transcripts are large and token-heavy.",
    inputSchema: {
      type: "object",
      properties: {
        callIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of Gong call IDs to retrieve transcripts for",
        },
      },
      required: ["callIds"],
    },
  },
  {
    name: "list_users",
    description: "List all users in the Gong workspace. Returns user IDs, names, emails, and roles. Useful for mapping speaker/user IDs from calls to real people.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_user",
    description: "Get details for a specific user by their Gong user ID.",
    inputSchema: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "The Gong user ID",
        },
      },
      required: ["userId"],
    },
  },
  {
    name: "get_scorecard_definitions",
    description: "Retrieve all scorecard definitions configured in Gong. Returns scorecard names, questions, and scoring criteria. Use this to understand what scorecards exist before querying answered scorecards.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_answered_scorecards",
    description: "Retrieve completed scorecard reviews for calls. Returns scores, answers, reviewer info, and timestamps. Filter by date range, specific scorecards, or reviewed users.",
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
          description: "Filter by specific scorecard IDs",
        },
        reviewedUserIds: {
          type: "array",
          items: { type: "string" },
          description: "Filter by reviewed user IDs",
        },
      },
    },
  },
  {
    name: "get_interaction_stats",
    description: "Retrieve interaction statistics for users — talk ratios, longest monologues, interactivity, patience, and engagement metrics. Requires a date range.",
    inputSchema: {
      type: "object",
      properties: {
        fromDate: {
          type: "string",
          description: "Start date in ISO format (e.g. 2024-03-01T00:00:00Z)",
        },
        toDate: {
          type: "string",
          description: "End date in ISO format (e.g. 2024-03-31T23:59:59Z)",
        },
        userIds: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of user IDs to filter by",
        },
      },
      required: ["fromDate", "toDate"],
    },
  },
  {
    name: "get_aggregate_activity",
    description: "Retrieve aggregated activity stats for users — number of calls, emails, meetings, and other engagement metrics over a date range.",
    inputSchema: {
      type: "object",
      properties: {
        fromDate: {
          type: "string",
          description: "Start date in ISO format (e.g. 2024-03-01T00:00:00Z)",
        },
        toDate: {
          type: "string",
          description: "End date in ISO format (e.g. 2024-03-31T23:59:59Z)",
        },
        userIds: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of user IDs to filter by",
        },
      },
      required: ["fromDate", "toDate"],
    },
  },
];

// Server implementation
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
      case "list_calls":
        response = await gongClient.listCalls(
          a.fromDateTime as string | undefined,
          a.toDateTime as string | undefined,
        );
        break;

      case "get_call_details":
        if (!Array.isArray(a.callIds)) throw new Error("callIds must be an array of strings");
        response = await gongClient.getCallDetails(a.callIds as string[]);
        break;

      case "retrieve_transcripts":
        if (!Array.isArray(a.callIds)) throw new Error("callIds must be an array of strings");
        response = await gongClient.retrieveTranscripts(a.callIds as string[]);
        break;

      case "list_users":
        response = await gongClient.listUsers();
        break;

      case "get_user":
        if (typeof a.userId !== "string") throw new Error("userId is required");
        response = await gongClient.getUser(a.userId);
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

async function runServer() {
  const port = process.env.PORT;

  if (port) {
    if (clientCredentials.size === 0) {
      console.error("Error: MCP_CLIENT_ID and MCP_CLIENT_SECRET are required when running in HTTP mode");
      process.exit(1);
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    const httpServer = createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`);

      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      if (url.pathname === '/oauth/token' && req.method === 'POST') {
        const body = await readBody(req);
        const params = parseFormBody(body);

        if (params.grant_type !== 'client_credentials') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unsupported_grant_type' }));
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
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_client' }));
          return;
        }

        const tokenResponse = issueToken(clientId);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(tokenResponse));
        return;
      }

      if (url.pathname === '/mcp') {
        const auth = req.headers['authorization'] ?? '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        if (!validateToken(token)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_token' }));
          return;
        }
        await transport.handleRequest(req, res);
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    await server.connect(transport);
    httpServer.listen(Number(port), () => {
      console.error(`Gong MCP server running on http://0.0.0.0:${port}/mcp`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
