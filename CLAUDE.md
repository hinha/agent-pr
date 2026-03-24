# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Production-grade Node.js daemon that monitors GitHub PRs using the OpenClaw MCP (Model Context Protocol) tools and provides AI-powered code reviews with Telegram notifications.

## Development Commands

```bash
# Install dependencies
npm install

# Run in development mode (auto-restart on changes)
npm run dev

# Run in production
npm start

# Run as background daemon
nohup node index.js > logs/daemon.out 2>&1 < /dev/null &
echo $! > daemon.pid

# Stop daemon
kill $(cat daemon.pid)

# View logs in real-time
tail -f logs/combined.log  # All logs
tail -f logs/error.log     # Errors only
```

## Architecture

### MCP-First Design
All GitHub operations use MCP tools via `mcporter` CLI - no direct GitHub REST API calls. This maintains OpenClaw security boundaries:
- `list_pull_requests` - Fetch open PRs
- `get_pull_request_files` - Get changed file metadata
- `create_pull_request_review` - Submit reviews with line comments
- `update_pull_request` - Close PRs

### Core Services (`src/services/`)

| Service | Responsibility |
|---------|---------------|
| `mcpGithubService.js` | All GitHub interactions via MCP with exponential backoff retries |
| `telegramService.js` | Telegram bot polling, PR notifications, inline button handlers |
| `openclawAgentService.js` | AI code review using OpenClaw CLI with configurable levels (low/medium/high) |
| `schedulerDaemon.js` | Main orchestration, 7-min polling cycle, PR workflow orchestration |
| `prStateManager.js` | Persistent PR tracking (notification counts, processed status) |
| `skipManager.js` | 3-hour skip cache to suppress notifications |

### Retry Pattern
All external operations use custom `retryOperation()` with exponential backoff:
- MCP calls: 3 retries, 2s base, 2x multiplier
- Telegram: 3 retries, 3s base, 2x multiplier
- AI agents: 2 retries, 10s base, 2x multiplier

### State Management
All state persisted to `data/` directory as JSON:
- `processed_prs.json` - Fully processed PRs (after 3 notifications or approval)
- `notification_counts.json` - How many times each PR was notified (max 3)
- `skip_cache.json` - Temporary skips with expiry timestamps

### Configuration
All config in `src/config/index.js` loaded from environment variables. Key settings:
- `checkIntervalMs`: Polling frequency (7 minutes)
- `maxAgeMs`: PR age limit (24 hours)
- `reviewLevels`: Three review tiers with different focus areas and comment limits

## Telegram Bot Actions

Inline buttons trigger workflows in `telegramService.js`:
- **Review Now** → Triggers AI review with level selection (Low/Medium/High)
- **Approve** → Submits APPROVE review via MCP, marks PR as processed
- **Reject** → Submits REQUEST_CHANGES review
- **Close PR** → Closes PR via MCP
- **Skip (3h)** → Suppresses notifications for 3 hours

## Error Isolation

Process continues on uncaught exceptions to prevent restart loops. Each PR processing is isolated - failures don't block other PRs. Partial failure recovery triggers one retry after 30 seconds.

## Environment Variables

Required in `.env`:
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_THREAD_ID`
- `MCP_CONFIG_PATH`, `MCP_SERVER_NAME` (default: `github-work`)
- `OPENCLAW_REVIEW_MODEL` (default: `github-copilot/claude-sonnet-4.6`)
- `GITHUB_OWNER`, `GITHUB_REPO`

## Time Zone

Logs use Asia/Jakarta (GMT+7) timestamp format.
