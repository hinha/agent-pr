# MCP-based PR Monitor Daemon

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![PM2](https://img.shields.io/badge/pm2-compatible-orange)](https://pm2.keymetrics.io)

A production-grade Node.js daemon that monitors GitHub Pull Requests using OpenClaw MCP (Model Context Protocol) tools, provides AI-powered code reviews with configurable intensity levels, and delivers real-time notifications via Telegram bot.

## Overview

This daemon is designed for teams that want automated PR monitoring with intelligent code review capabilities without managing complex infrastructure. It polls GitHub for open PRs, tracks notification history, and provides actionable insights through Telegram notifications with inline action buttons.

### Key Features

- **MCP-First Architecture**: All GitHub operations use OpenClaw MCP tools - no direct GitHub REST API calls
- **AI-Powered Reviews**: Three configurable review levels (Low/Medium/High) with different focus areas
- **Smart Notifications**: Each PR notified up to 3 times with 3-hour skip option
- **Telegram Integration**: Interactive bot with inline buttons for Review, Approve, Reject, Close, and Skip
- **State Persistence**: All tracking data persisted to disk - survives restarts without duplicates
- **Production-Ready**: Built-in retry logic, error isolation, graceful shutdown, and comprehensive logging
- **PM2 Optimized**: Includes PM2 ecosystem configuration for easy process management

### Use Cases

- Automated PR monitoring for development teams
- AI-assisted code review workflow
- Notification system for GitHub activity
- Integration with existing MCP/OpenClaw infrastructure
- Lightweight alternative to webhook-based systems

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Scheduler Daemon (7-min)                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 1. Fetch open PRs via MCP                                  │  │
│  │ 2. Filter by age (<24h) and processing status             │  │
│  │ 3. Send Telegram notifications                             │  │
│  │ 4. Handle user actions via inline buttons                  │  │
│  │ 5. Trigger AI reviews when requested                       │  │
│  │ 6. Update state (notification counts, skip cache)          │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                ┌─────────────┼─────────────┐
                ▼             ▼             ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │   MCP    │  │ Telegram │  │  State   │
        │  GitHub  │  │    Bot   │  │ Manager  │
        │ Service  │  │ Service  │  │          │
        └──────────┘  └──────────┘  └──────────┘
                            │
                    ┌───────┴────────┐
                    ▼                ▼
            ┌──────────┐      ┌──────────┐
            │ OpenClaw │      │   Skip   │
            │   Agent  │      │ Manager  │
            │ Service  │      │          │
            └──────────┘      └──────────┘
```

### Core Services

| Service | Responsibility |
|---------|---------------|
| `schedulerDaemon.js` | Main orchestration, 7-min polling cycle, PR workflow |
| `mcpGithubService.js` | All GitHub interactions via MCP with retry logic |
| `telegramService.js` | Bot polling, PR notifications, inline button handlers |
| `openclawAgentService.js` | AI code review with configurable levels |
| `prStateManager.js` | Persistent PR tracking (notification counts, status) |
| `skipManager.js` | 3-hour skip cache to suppress notifications |

## Prerequisites

- **Node.js** >= 18.0.0
- **npm** or **yarn** package manager
- **OpenClaw MCP** installed and configured
- **mcporter** CLI tool for MCP server management
- **Telegram Bot** created via [@BotFather](https://t.me/botfather)
- **PM2** (recommended for production)

### Setting Up Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot` command and follow instructions
3. Copy the bot token (format: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
4. Get your chat ID:
   - Message your bot
   - Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
   - Find your `chat_id` in the response

### Setting Up OpenClaw MCP

1. Install OpenClaw CLI (refer to OpenClaw documentation)
2. Configure mcporter with GitHub MCP server
3. Create or configure agents for summary and review

## Installation

### Option 1: Install from Source

Clone the repository and install dependencies:

```bash
# Clone the repository
git clone <repository-url>
cd agent-pr

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
nano .env
```

### Option 2: Install from Binary/npm Package

```bash
# Install globally via npm (if published)
npm install -g agent-pr-monitor

# Or install from binary
# Download the latest binary release
# Extract and configure
```

## Configuration

### Environment Variables

Create a `.env` file in the project root with the following variables:

```bash
# Telegram Configuration
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=0000000001
TELEGRAM_THREAD_ID=              # Optional: for threaded conversations

# MCP Configuration
MCP_CONFIG_PATH=/path/to/mcporter.json
MCP_SERVER_NAME=github-work

# OpenClaw Agent Configuration
OPENCLAW_AGENT_SUMMARY=pr-summary-agent
OPENCLAW_AGENT_REVIEW=pr-review-agent
OPENCLAW_REVIEW_MODEL=openai/claude-sonnet-4.6

# GitHub Repository Details
GITHUB_OWNER=your-organization
GITHUB_REPO=your-repository

# Scheduling Configuration
CHECK_INTERVAL_MINUTES=7          # Default: 7 minutes
SKIP_CACHE_DURATION_HOURS=3       # Default: 3 hours
MAX_PR_AGE_HOURS=24              # Default: 24 hours

# Logging
LOG_LEVEL=info                   # Options: error, warn, info, debug
```

### Review Levels

The daemon supports three review levels with different characteristics:

| Level | Focus Areas | Comment Limit | Use Case |
|-------|-------------|---------------|----------|
| **Low** | Basic syntax, style, obvious bugs | 5 comments | Quick PR checks, style enforcement |
| **Medium** | Logic, patterns, security, performance | 15 comments | Standard code review |
| **High** | Architecture, edge cases, optimizations | 30 comments | Critical systems, deep analysis |

## Running the Application

### Development Mode

For development with auto-restart on file changes:

```bash
npm run dev
```

This uses `nodemon` to watch for file changes and automatically restart the daemon.

### Production with PM2 (Recommended)

PM2 is the recommended way to run this daemon in production.

#### First Time Setup

```bash
# Install PM2 globally (if not installed)
npm install -g pm2

# Start the daemon with ecosystem configuration
pm2 start ecosystem.config.js

# Save the PM2 process list
pm2 save

# Setup PM2 to start on system boot
pm2 startup
# Follow the instructions displayed by the command
```

#### PM2 Management Commands

```bash
# View process status
pm2 status

# View real-time logs
pm2 logs pr-monitor-daemon

# View error logs only
pm2 logs pr-monitor-daemon --err

# View last 100 lines
pm2 logs pr-monitor-daemon --lines 100

# Restart the daemon
pm2 restart pr-monitor-daemon

# Stop the daemon
pm2 stop pr-monitor-daemon

# Delete from PM2 list
pm2 delete pr-monitor-daemon

# Monitor CPU and memory usage
pm2 monit

# Reset restart count
pm2 reset pr-monitor-daemon

# Reload with zero-downtime (not applicable for single instance)
pm2 reload pr-monitor-daemon
```

#### Updating the Application

```bash
# Pull latest changes
git pull

# Install new dependencies
npm install

# Restart with PM2
pm2 restart pr-monitor-daemon

# Or use graceful reload (if using cluster mode)
pm2 reload pr-monitor-daemon
```

### Alternative: Running as Background Daemon (nohup)

If you prefer not to use PM2:

```bash
# Start in background with nohup
nohup node index.js > logs/daemon.out 2>&1 < /dev/null &
echo $! > daemon.pid

# Stop the daemon
kill $(cat daemon.pid)

# View logs
tail -f logs/daemon.out
```

## Usage

### How It Works

1. **Automatic Polling**: The daemon checks for open GitHub PRs every 7 minutes (configurable)

2. **Smart Filtering**:
   - Only PRs younger than 24 hours are processed
   - Already processed PRs are skipped
   - Each PR gets notified up to 3 times before being marked as fully processed

3. **Telegram Notifications**: Each notification includes:
   - PR title and number
   - Author name
   - PR status (open/closed/draft)
   - Creation time
   - Direct action buttons

4. **Action Buttons**: Each notification includes inline buttons:
   - **Review Now** - Triggers AI review with level selection (Low/Medium/High)
   - **Visit PR** - Opens the PR page in browser
   - **Approve** - Submits an APPROVE review via GitHub MCP
   - **Reject** - Submits a REQUEST_CHANGES review via GitHub MCP
   - **Close PR** - Closes the PR via GitHub MCP
   - **Skip (3h)** - Suppresses notifications for this PR for 3 hours

### State Management

All state is persisted to the `data/` directory:

```
data/
├── processed_prs.json       # Fully processed PRs (after 3 notifications or approval)
├── notification_counts.json # How many times each PR has been notified
└── skip_cache.json          # Temporary skips with expiry timestamps
```

This state survives restarts - no duplicate notifications will be sent.

## Monitoring & Logs

### Log Files

The daemon uses Winston for structured logging with two log files:

- **`logs/combined.log`** - All application logs (info, warn, error)
- **`logs/error.log`** - Error logs only

When using PM2, additional logs are created:

- **`logs/pm2-out.log`** - PM2 stdout
- **`logs/pm2-error.log`** - PM2 stderr

### Viewing Logs

```bash
# View all logs in real-time (native logging)
tail -f logs/combined.log

# View errors only
tail -f logs/error.log

# View PM2 logs
pm2 logs pr-monitor-daemon

# View last 100 lines
pm2 logs pr-monitor-daemon --lines 100 --nostream
```

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Daemon not starting | Check `.env` file exists and all required variables are set |
| No Telegram notifications | Verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are correct |
| MCP connection failed | Check `MCP_CONFIG_PATH` and ensure mcporter is configured |
| PRs not being processed | Check GitHub repository details and MCP server status |
| High memory usage | Restart with `pm2 restart pr-monitor-daemon` |
| Duplicate notifications | Check `data/notification_counts.json` and clear if needed |

## Architecture Deep Dive

### MCP Integration Design

All GitHub interactions **exclusively use the MCP server**, maintaining security boundaries:

- `list_pull_requests` - Fetch open PRs
- `get_pull_request_files` - Get changed file metadata
- `create_pull_request_review` - Submit reviews with line comments
- `update_pull_request` - Close PRs

**Benefits:**
- No direct GitHub REST API calls
- Centralized credential management via OpenClaw
- Consistent security policies
- Easier auditing and compliance

### Failure Scenario Handling

| Failure Type | Mitigation |
|--------------|------------|
| MCP tool failure | 3 retries with 2s/4s/8s backoff; permanent failure logs to error.log |
| Telegram API failure | 3 retries with 3s/6s/12s backoff; failed notifications leave PR unprocessed to retry next cycle |
| OpenClaw agent timeout | 2 retries with 10s/20s backoff; partial failure recovery triggers one additional retry after 30s |
| Daemon crash | Persistent disk storage preserves processed PR/skip cache; no duplicate notifications after restart |
| Concurrent PR events | In-memory active process tracking prevents duplicate processing of the same PR |

### Scaling Strategy

To monitor multiple repositories:

1. Add repository list to configuration
2. Initialize separate `mcpGithubService` instances per repository
3. Maintain separate data storage directories per repo
4. Deploy as Kubernetes deployment with Redis shared cache for distributed deployments
5. Scale horizontally to monitor 100+ repositories with minimal resource usage

**Current Limitation:** Single repository per daemon instance. Run multiple instances for multiple repos.

### GitHub Webhook Migration Design

Current polling architecture can be migrated to event-driven webhooks:

1. Add Express.js endpoint to receive GitHub `pull_request` webhook events
2. Replace 7-minute polling with event-driven PR processing
3. Reuse all existing core services (MCP, agents, Telegram)
4. Add webhook signature verification for security
5. Reduce GitHub API usage by ~95% by only processing events instead of polling

### AI Cost Optimization Strategy

- Only run summary agent for PRs <1 hour old
- Only trigger full expensive review agent when explicitly requested via "Review Now" button
- Summary agent uses minimal input payload to reduce token consumption
- All agent calls include retries to avoid wasted API calls from transient failures
- PRs are only processed once, eliminating duplicate AI inference costs
- Configurable review levels allow cost control based on PR importance

## Development

### Project Structure

```
agent-pr/
├── src/
│   ├── config/
│   │   └── index.js              # Environment configuration
│   ├── services/                 # Core modular services
│   │   ├── mcpGithubService.js   # GitHub via MCP
│   │   ├── openclawAgentService.js  # AI reviews
│   │   ├── telegramService.js    # Telegram bot
│   │   ├── skipManager.js        # Skip cache logic
│   │   ├── prStateManager.js     # PR tracking
│   │   └── schedulerDaemon.js    # Main orchestration
│   └── utils/
│       └── logger.js             # Winston logging
├── data/                         # Persistent storage (runtime)
├── logs/                         # Application logs (runtime)
├── .env.example                  # Environment template
├── package.json                  # Dependencies
├── ecosystem.config.js           # PM2 configuration
├── index.js                      # Entry point
└── CLAUDE.md                     # Claude Code instructions
```

### Adding Features

1. **New Telegram Actions**: Add buttons in `telegramService.js`
2. **New Review Levels**: Configure in `src/config/index.js`
3. **Custom Filters**: Modify `schedulerDaemon.js` filtering logic
4. **Additional State**: Extend `prStateManager.js`

### Testing

```bash
# Run in development mode
npm run dev

# Test Telegram bot
# Send /start to your bot

# Test MCP connection
# Check logs for successful PR fetching

# Test with PM2
pm2 start ecosystem.config.js --env development
```

## License

MIT License - see LICENSE file for details

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues and questions:
- Open an issue on GitHub
- Check the troubleshooting section above
- Review logs in `logs/` directory
