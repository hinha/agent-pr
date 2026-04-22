# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Production-grade Node.js daemon that monitors GitHub PRs across multiple instances and repositories using the OpenClaw MCP (Model Context Protocol) tools and provides AI-powered code reviews with Telegram notifications.

## Development Commands

```bash
# Install dependencies
npm install

# Run in development mode (auto-restart on changes)
npm run dev

# Run in production
npm start

# Build for production (pkg)
npm run build

# View logs in real-time
tail -f logs/combined.log  # All logs
tail -f logs/error.log     # Errors only
```

## Architecture

### Multi-Instance Design
Supports multiple GitHub instances (organizations/users) with multiple repositories per instance:
- Each instance has its own MCP server configuration
- Each repository has its own Telegram thread for organized notifications
- Repository-scoped state management prevents PR ID collisions

### Configuration
Uses YAML-based configuration in `config.yml`:

```yaml
app:
  check_interval_minutes: 7
  telegram:
    bot_token: xxx
    chat_id: xxx

github/organization-name:
  mcp_name: github-work
  max_age_hours: 48
  agent:
    review: main
    level: [low, medium, high]
  repos:
    repo-name:
      thread_id: 12345
```

### MCP-First Design
All GitHub operations use MCP tools via `mcporter` CLI - no direct GitHub REST API calls. This maintains OpenClaw security boundaries:
- `list_pull_requests` - Fetch open PRs
- `get_pull_request_files` - Get changed file metadata
- `create_pull_request_review` - Submit reviews with line comments
- `update_pull_request` - Close PRs

### Core Services (`src/services/`)

| Service | Responsibility |
|---------|---------------|
| `mcpGithubService.js` | Factory pattern for per-instance MCP GitHub services |
| `telegramService.js` | Telegram bot with repo-based thread routing, compact callback format |
| `openclawAgentService.js` | AI code review using OpenClaw CLI with owner/repo context |
| `schedulerDaemon.js` | Multi-instance orchestration, polling all instances/repos |
| `repositoryStateManager.js` | Repository-scoped PR tracking (notification counts, processed status) |
| `skipManager.js` | Repository-scoped skip cache to suppress notifications |

### Callback Data Format
Uses compact format to stay within Telegram's 64-byte limit:
- Standard: `action:instanceIdx:repoIdx:prId` (4 parts)
- Review level: `review_level:instanceIdx:repoIdx:prId:level` (5 parts)

### Retry Pattern
All external operations use custom `retryOperation()` with exponential backoff:
- MCP calls: 3 retries, 2s base, 2x multiplier
- Telegram: 3 retries, 3s base, 2x multiplier
- AI agents: 2 retries, 10s base, 2x multiplier

### State Management
Repository-scoped state persisted to `data/instances/{org}/{repo}/`:
- `processed_prs.json` - Fully processed PRs (after 3 notifications or approval)
- `notification_counts.json` - How many times each PR was notified (max 3)
- `skip_cache.json` - Temporary skips with expiry timestamps
- `processed_timestamps.json` - When PRs were marked as processed

## Telegram Bot Actions

Inline buttons trigger workflows in `telegramService.js`:
- **Review Now** → Shows level selection (Low/Medium/High)
- **Approve** → Submits APPROVE review via MCP, marks PR as processed
- **Reject** → Submits REQUEST_CHANGES review
- **Close PR** → Closes PR via MCP
- **Skip (3h)** → Suppresses notifications for 3 hours

## Error Isolation

Process continues on uncaught exceptions to prevent restart loops. Each PR processing is isolated - failures don't block other PRs. Partial failure recovery triggers one retry after 30 seconds.

## Configuration Reference

**Global Settings (`app`):**
- `check_interval_minutes`: Polling frequency (default: 7)
- `telegram.bot_token`: Telegram bot token from @BotFather
- `telegram.chat_id`: Main Telegram chat ID

**Per-Instance Settings (`github/{org}`):**
- `mcp_name`: MCP server name for this instance
- `max_age_hours`: Maximum PR age to process (default: 48)
- `skip_cache_duration_hours`: Skip cache duration (default: 3)
- `agent.review`: OpenClaw agent name for reviews
- `agent.level`: Available review levels

**Per-Repository Settings:**
- `thread_id`: Telegram thread ID for this repo's notifications

## Time Zone

Logs use Asia/Jakarta (GMT+7) timestamp format.
