# Gong MCP Server

An MCP server that provides access to Gong's API for retrieving call recordings and transcripts.

## Features

- List Gong calls with optional date range filtering
- Retrieve detailed transcripts for specific calls
- Runs locally (stdio) or as a remote HTTP server (Railway, Docker, etc.)
- Bearer token authentication for remote deployments

## Prerequisites

- Node.js 18+
- Gong API credentials (Access Key and Secret)

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GONG_ACCESS_KEY` | Yes | Gong API access key |
| `GONG_ACCESS_SECRET` | Yes | Gong API access secret |
| `MCP_API_KEY` | Yes (HTTP mode) | Shared secret for authenticating MCP clients. All requests to `/mcp` must include `Authorization: Bearer <key>`. |
| `PORT` | No | When set, starts an HTTP server instead of stdio. Railway sets this automatically. |

## Setup

```bash
npm install
npm run build
```

## Running Locally (stdio)

For use with Claude Desktop or Claude Code as a local MCP server:

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
   - `MCP_API_KEY` — a shared secret for client auth (generate one with `openssl rand -hex 32`)
4. Railway auto-sets `PORT` and deploys using the Dockerfile
5. Your MCP endpoint will be at `https://<your-app>.railway.app/mcp`

### Connecting to the Remote Server

Share the Railway URL and `MCP_API_KEY` with your team. Each person adds this to their MCP client config:

```json
{
  "mcpServers": {
    "gong": {
      "type": "streamable-http",
      "url": "https://<your-app>.railway.app/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_API_KEY>"
      }
    }
  }
}
```

## Available Tools

### list_calls

List Gong calls with optional date range filtering. Returns call details including ID, title, start/end times, participants, and duration.

**Parameters:**
- `fromDateTime` (string, optional) — Start date/time in ISO format (e.g. `2024-03-01T00:00:00Z`)
- `toDateTime` (string, optional) — End date/time in ISO format (e.g. `2024-03-31T23:59:59Z`)

### retrieve_transcripts

Retrieve transcripts for specified call IDs. Returns detailed transcripts including speaker IDs, topics, and timestamped sentences.

**Parameters:**
- `callIds` (string[], required) — Array of Gong call IDs to retrieve transcripts for

## License

MIT License - see LICENSE file for details
