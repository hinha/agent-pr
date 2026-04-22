# Multi-Instance PR Monitor Daemon

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![PM2](https://img.shields.io/badge/pm2-compatible-orange)](https://pm2.keymetrics.io)

A production-grade Node.js daemon that monitors GitHub Pull Requests across multiple instances and repositories using OpenClaw MCP (Model Context Protocol) tools, provides AI-powered code reviews with configurable intensity levels, and delivers real-time notifications via Telegram bot.

## Overview

This daemon is designed for teams that want automated PR monitoring with intelligent code review capabilities without managing complex infrastructure. It polls GitHub for open PRs, tracks notification history, and provides actionable insights through Telegram notifications with inline action buttons.

### Key Features

- **Multi-Instance Support**: Monitor multiple GitHub organizations/users with different MCP servers
- **Multi-Repository**: Track multiple repositories per instance with independent state management
- **Per-Repo Telegram Threads**: Each repository can have its own Telegram thread for organized notifications
- **MCP-First Architecture**: All GitHub operations use OpenClaw MCP tools - no direct GitHub REST API calls
- **AI-Powered Reviews**: Three configurable review levels (Low/Medium/High) with different focus areas
- **Smart Notifications**: Each PR notified up to 3 times with 3-hour skip option per repository
- **Telegram Integration**: Interactive bot with inline buttons for Review, Approve, Reject, Close, and Skip
- **Repository-Scoped State**: All tracking data persisted per repository - survives restarts without duplicates
- **Production-Ready**: Built-in retry logic, error isolation, graceful shutdown, and comprehensive logging
- **PM2 Optimized**: Includes PM2 ecosystem configuration for easy process management

### Use Cases

- Monitor multiple repositories across different GitHub organizations
- AI-assisted code review workflow for teams
- Organized notification system with per-repo Telegram threads
- Integration with existing MCP/OpenClaw infrastructure
- Lightweight alternative to webhook-based multi-repo monitoring

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

### Install from Source

Clone the repository and install dependencies:

```bash
# Clone the repository
git clone <repository-url>
cd agent-pr

# Install dependencies
npm install

# Create configuration file
cp config.yml.example config.yml

# Edit config.yml with your settings
nano config.yml
```

## Configuration

### YAML Configuration

The daemon uses `config.yml` for configuration. Copy `config.yml.example` to create your configuration:

```bash
cp config.yml.example config.yml
nano config.yml
```

**Configuration Structure:**

```yaml
app:
  check_interval_minutes: 7
  telegram:
    bot_token: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
    chat_id: 0000000001

github/your-organization:
  mcp_name: github-work
  max_age_hours: 48
  skip_cache_duration_hours: 3
  agent:
    review: main
    summary: main
    level: [low, medium, high]
    review_timeout_seconds: 1200
    review_timeot_string: "20 menit"
  repos:
    repo-name-1:
      thread_id: 12345
    repo-name-2:
      thread_id: 12346

github/another-organization:
  mcp_name: github-personal
  max_age_hours: 48
  skip_cache_duration_hours: 3
  agent:
    review: main
    level: [low, medium, high]
    review_timeout_seconds: 1200
  repos:
    personal-repo:
      thread_id: 12347
```

**Configuration Options:**

| Setting | Description | Default |
|---------|-------------|---------|
| `app.check_interval_minutes` | Polling frequency in minutes | 7 |
| `app.telegram.bot_token` | Telegram bot token from @BotFather | Required |
| `app.telegram.chat_id` | Main Telegram chat ID | Required |
| `{instance}.mcp_name` | MCP server name for this instance | Required |
| `{instance}.max_age_hours` | Maximum PR age to process | 48 |
| `{instance}.skip_cache_duration_hours` | Skip cache duration | 3 |
| `{instance}.agent.review` | OpenClaw agent for reviews | main |
| `{instance}.agent.level` | Available review levels | [low, medium, high] |
| `{repos}.{repo}.thread_id` | Telegram thread ID for this repo | Required |

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

1. **Multi-Instance Polling**: The daemon checks all configured instances and repositories every 7 minutes

2. **Smart Filtering**:
   - Only PRs younger than configured max age (default: 48 hours) are processed
   - Already processed PRs (per repository) are skipped
   - Each PR gets notified up to 3 times before being marked as fully processed
   - Repository-scoped skip cache prevents duplicate processing

3. **Telegram Notifications**: Each notification is sent to a repository-specific thread:
   - PR title and number with repository context
   - Author name
   - AI-generated PR summary
   - Direct action buttons

4. **Action Buttons**: Each notification includes inline buttons:
   - **Review Now** - Shows level selection (Low/Medium/High)
   - **Visit PR** - Opens the PR page in browser
   - **Approve** - Submits an APPROVE review via GitHub MCP
   - **Reject** - Submits a REQUEST_CHANGES review via GitHub MCP
   - **Close PR** - Closes the PR via GitHub MCP
   - **Skip (3h)** - Suppresses notifications for this PR for 3 hours

### State Management

All state is persisted per repository to the `data/` directory:

```
data/
└── instances/
    ├── github-organization-name/
    │   ├── repo-name-1/
    │   │   ├── processed_prs.json       # Fully processed PRs
    │   │   ├── notification_counts.json # Notification counts
    │   │   ├── skip_cache.json          # Temporary skips
    │   │   └── processed_timestamps.json # Processing timestamps
    │   └── repo-name-2/
    │       └── ...
    └── github-other-org/
        └── ...
```

This repository-scoped state survives restarts - no duplicate notifications will be sent, and PRs from different repositories won't collide.

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
| Daemon not starting | Check `config.yml` exists and is valid YAML |
| No Telegram notifications | Verify `bot_token` and `chat_id` in config.yml |
| MCP connection failed | Check MCP server name is correct and mcporter is configured |
| Agent not found | Run `openclaw agents list` and use correct agent name in config.yml |
| Buttons not working | Check callback data format (uses compact indices) |
| PRs not being processed | Check instance/repo configuration in config.yml |
| High memory usage | Restart with `pm2 restart` |
| Duplicate notifications | Check per-repo state in `data/instances/` |

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

**Built-in Multi-Instance Support:**
- Single daemon monitors multiple GitHub instances and repositories
- Repository-scoped state management prevents PR ID collisions
- Per-repo Telegram thread routing for organized notifications

**To add more repositories:**
1. Add instance configuration to `config.yml`
2. Specify MCP server name for each instance
3. Configure thread_id for each repository
4. Restart daemon - no code changes needed

**Horizontal Scaling:**
- Deploy multiple daemon instances for high-volume scenarios
- Each instance can monitor the same or different repositories
- Use distributed locking (Redis) for coordinated deployments if needed

**Capacity:**
- Single daemon: 50+ repositories with 7-min polling
- With optimized intervals: 200+ repositories per daemon

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
│   │   └── yamlConfig.js         # YAML configuration loader
│   ├── services/                 # Core modular services
│   │   ├── mcpGithubService.js   # MCP GitHub service factory
│   │   ├── repositoryStateManager.js # Per-repo state management
│   │   ├── openclawAgentService.js  # AI reviews with owner/repo context
│   │   ├── telegramService.js    # Telegram bot with thread routing
│   │   ├── skipManager.js        # Per-repo skip cache
│   │   └── schedulerDaemon.js    # Multi-instance orchestration
│   └── utils/
│       ├── logger.js             # Winston logging
│       ├── memoryMonitor.js      # Memory monitoring
│       └── timeoutManager.js     # Timeout management
├── data/                         # Persistent storage (runtime)
│   └── instances/                # Per-instance/repo state
├── logs/                         # Application logs (runtime)
├── prompts/                      # AI prompt templates
│   └── review.txt                # PR review prompt
├── scripts/                      # Utility scripts
│   └── migrateState.js           # State migration tool
├── config.yml.example            # Configuration template
├── package.json                  # Dependencies
├── ecosystem.config.js           # PM2 configuration
├── index.js                      # Entry point
├── CLAUDE.md                     # Claude Code instructions
└── README.md                     # This file
```

### Adding Features

1. **New Telegram Actions**: Add buttons in `telegramService.js` with compact callback format
2. **New Review Levels**: Configure in `src/config/yamlConfig.js`
3. **New Instances**: Add to `config.yml` with instance/repo configuration
4. **Custom Filters**: Modify `schedulerDaemon.js` filtering logic
5. **Additional State**: Extend `repositoryStateManager.js`

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
