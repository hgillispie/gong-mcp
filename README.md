# Gong MCP Server

An MCP server that provides access to Gong's API for call data, transcripts, user info, scorecards, and activity stats.

## Features

- List and search Gong calls with date filtering
- Get rich call details: participants, action items, key points, topics, talk ratios
- Retrieve full call transcripts
- Look up users and map speaker IDs to names
- Pull scorecard definitions and completed reviews
- Get interaction stats and aggregate activity metrics
- Runs locally (stdio) or as a remote HTTP server (Railway, Docker, etc.)
- OAuth 2.0 Client Credentials authentication for remote deployments

## Prerequisites

- Node.js 18+
- Gong API credentials (Access Key and Secret)

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GONG_ACCESS_KEY` | Yes | Gong API access key |
| `GONG_ACCESS_SECRET` | Yes | Gong API access secret |
| `MCP_CLIENT_ID` | Yes (HTTP mode) | OAuth client ID for MCP client authentication |
| `MCP_CLIENT_SECRET` | Yes (HTTP mode) | OAuth client secret for MCP client authentication |
| `SERVER_URL` | Yes (HTTP mode) | Public URL of the server (e.g. `https://your-app.railway.app`). Used in OAuth discovery metadata. |
| `PORT` | No | When set, starts an HTTP server instead of stdio. Railway sets this automatically. |

## Setup

```bash
npm install
npm run build
```

## Running Locally (stdio)

For use as a local MCP server:

```json
{
  "mcpServers": {
    "gong": {
      "command": "node",
      "args": ["/path/to/gong-mcp/dist/index.js"],
      "env": {
        "GONG_ACCESS_KEY": "your_access_key",
        "GONG_ACCESS_SECRET": "your_access_secret"
      }
    }
  }
}
```

## Deploying to Railway

1. Push this repo to GitHub
2. Create a new project in Railway and connect the repo
3. Add these environment variables in Railway's dashboard under **Variables**:
   - `GONG_ACCESS_KEY` — your Gong API key
   - `GONG_ACCESS_SECRET` — your Gong API secret
   - `MCP_CLIENT_ID` — OAuth client ID (generate with `openssl rand -hex 16`)
   - `MCP_CLIENT_SECRET` — OAuth client secret (generate with `openssl rand -hex 32`)
   - `SERVER_URL` — your Railway public URL (e.g. `https://builderio-gong-mcp.up.railway.app`)
4. Railway auto-sets `PORT` and deploys using the Dockerfile
5. Your server will be at `https://<your-app>.railway.app`

### Connecting from Claude

The server implements the MCP OAuth spec (RFC 9728 + RFC 8414), so Claude handles the token exchange automatically. When adding this as a remote MCP server in Claude, provide:

- **Server URL:** `https://<your-app>.railway.app/mcp`
- **Client ID:** your `MCP_CLIENT_ID` value
- **Client Secret:** your `MCP_CLIENT_SECRET` value

Claude will discover the OAuth endpoints automatically via `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`.

### OAuth Endpoints

| Endpoint | Purpose |
|---|---|
| `/.well-known/oauth-protected-resource` | Protected Resource Metadata (RFC 9728) |
| `/.well-known/oauth-authorization-server` | Authorization Server Metadata (RFC 8414) |
| `/oauth/token` | Token endpoint (Client Credentials grant) |
| `/mcp` | MCP endpoint (requires Bearer token) |
| `/health` | Health check (no auth) |

## Available Tools

### search_calls
Search Gong calls by keyword — matches titles, participant names, emails, and company names. Returns results sorted newest-first. Defaults to last 90 days.
- `query` (string, optional) — Search terms (e.g. "Edmunds", "Sarah demo", "Acme Corp")
- `fromDateTime` (string, optional) — Start of date range in ISO format
- `toDateTime` (string, optional) — End of date range in ISO format
- `maxResults` (number, optional) — Max results to return (default 10, max 50)

### get_call_details
Get rich call data: participants, action items, key points, topics, trackers, talk ratios, questions, and comments. Use `search_calls` first to find call IDs.
- `callIds` (string[], required)

### retrieve_transcripts
Get full word-for-word transcripts with timestamps and speaker IDs. Token-heavy — prefer `get_call_details` for summaries.
- `callIds` (string[], required)

### search_users
Find Gong users by name or email. Returns IDs, names, emails, and roles. Omit query to list all users.
- `query` (string, optional) — Name or email to search for

### get_scorecard_definitions
List all scorecard templates — names, questions, and scoring criteria.

### get_answered_scorecards
Get completed scorecard reviews with scores and answers.
- `callFromDate` (string, optional)
- `callToDate` (string, optional)
- `scorecardIds` (string[], optional)
- `reviewedUserIds` (string[], optional)

### get_interaction_stats
Get per-rep interaction metrics: talk ratios, longest monologues, interactivity, patience.
- `fromDate` (string, required)
- `toDate` (string, required)
- `userIds` (string[], optional)

### get_aggregate_activity
Get aggregated activity counts: calls, emails, meetings, feedback, listening hours.
- `fromDate` (string, required)
- `toDate` (string, required)
- `userIds` (string[], optional)

## License

MIT License - see LICENSE file for details
