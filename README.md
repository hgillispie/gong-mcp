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

### list_calls
List Gong calls with optional date range filtering.
- `fromDateTime` (string, optional) — Start date/time in ISO format
- `toDateTime` (string, optional) — End date/time in ISO format

### get_call_details
Get rich call data including participants, action items, key points, topics, trackers, talk ratios, and questions. Use this over `retrieve_transcripts` when you need structured insights rather than raw text.
- `callIds` (string[], required)

### retrieve_transcripts
Retrieve full timestamped transcripts with speaker IDs. Token-heavy — prefer `get_call_details` for summaries.
- `callIds` (string[], required)

### list_users
List all users in the Gong workspace with IDs, names, emails, and roles.

### get_user
Get details for a specific user.
- `userId` (string, required)

### get_scorecard_definitions
Retrieve all scorecard definitions (names, questions, scoring criteria).

### get_answered_scorecards
Retrieve completed scorecard reviews with scores and answers.
- `callFromDate` (string, optional)
- `callToDate` (string, optional)
- `scorecardIds` (string[], optional)
- `reviewedUserIds` (string[], optional)

### get_interaction_stats
Get interaction metrics: talk ratios, longest monologues, interactivity, patience.
- `fromDate` (string, required)
- `toDate` (string, required)
- `userIds` (string[], optional)

### get_aggregate_activity
Get aggregated activity: call counts, feedback given/received, listening stats.
- `fromDate` (string, required)
- `toDate` (string, required)
- `userIds` (string[], optional)

## License

MIT License - see LICENSE file for details
