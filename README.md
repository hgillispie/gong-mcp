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
4. Railway auto-sets `PORT` and deploys using the Dockerfile
5. Your server will be at `https://<your-app>.railway.app`

### Authentication

The server uses OAuth 2.0 Client Credentials. Clients first exchange their credentials for a short-lived access token (1 hour TTL), then use that token for MCP requests.

**1. Get an access token:**

```bash
curl -X POST https://<your-app>.railway.app/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=<ID>&client_secret=<SECRET>"
```

Response:
```json
{
  "access_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**2. Use the token with MCP requests:**

Share the Railway URL and client credentials with your team. MCP clients that support OAuth will handle the token exchange automatically. For manual config:

```json
{
  "mcpServers": {
    "gong": {
      "type": "streamable-http",
      "url": "https://<your-app>.railway.app/mcp",
      "headers": {
        "Authorization": "Bearer <access_token>"
      }
    }
  }
}
```

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
