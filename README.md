# MCP-based PR Monitor Daemon
Production-grade Node.js daemon for monitoring repo GitHub PRs using OpenClaw MCP tools, AI agents, and Telegram notifications.

## Full Project Structure
```
simasfin-pr-monitor/
├── src/
│   ├── config/              # Environment configuration
│   │   └── index.js
│   ├── services/            # Core modular services
│   │   ├── mcpGithubService.js      # All GitHub interactions via MCP github-work
│   │   ├── openclawAgentService.js  # OpenClaw summary/review agent integration
│   │   ├── telegramService.js       # Telegram bot and notifications
│   │   ├── skipManager.js           # 3-hour skip cache logic
│   │   ├── prStateManager.js        # Processed PR tracking to avoid duplicates
│   │   └── schedulerDaemon.js       # Main scheduling and workflow orchestration
│   └── utils/
│       └── logger.js         # Winston production logging
├── data/                     # Persistent storage (processed PRs, skip cache)
├── logs/                     # Application logs (error, combined)
├── .env.example              # Environment variable template
├── package.json              # Project dependencies
├── index.js                  # Application entry point
└── daemon.pid                # PID file for background process (created at runtime)
```

## How to Run as Background Daemon (nohup)
1. Install dependencies:
```bash
cd /home/ubuntu/.openclaw/workspace/simasfin-pr-monitor
npm install
```
2. Configure environment variables:
```bash
cp .env.example .env
nano .env # Fill in TELEGRAM_BOT_TOKEN, MCP_CONFIG_PATH, and agent IDs
```
3. Start daemon with nohup:
```bash
nohup node index.js > logs/daemon.out 2>&1 < /dev/null &
echo $! > daemon.pid
```
4. Stop the daemon:
```bash
kill $(cat daemon.pid)
```

---

## Core Architecture Explanations
### 1. MCP Integration Design
All GitHub interactions **exclusively use the `github-work` MCP server**, no direct REST API calls:
- `list_pull_requests` to fetch open PRs
- `get_pull_request_files` to fetch changed file metadata
- All MCP calls include 3 retries with exponential backoff for transient failures
- MCP command output is parsed and normalized to avoid raw API dependencies
- This maintains OpenClaw MCP security boundaries and credential management

### 2. Failure Scenario Handling
| Failure Type | Mitigation |
|--------------|------------|
| MCP tool failure | 3 retries with 2s/4s/8s backoff; permanent failure logs to error.log |
| Telegram API failure | 3 retries; failed notifications leave PR unprocessed to retry next cycle |
| OpenClaw agent timeout | 2 retries; partial failure recovery triggers one additional retry after 30s |
| Daemon crash | Persistent disk storage preserves processed PR/skip cache; no duplicate notifications after restart |
| Concurrent PR events | In-memory active process tracking prevents duplicate processing of the same PR |

### 3. Scaling Strategy
To monitor multiple repositories:
1. Add a repository list to config
2. Initialize separate `mcpGithubService` instances per repository
3. Maintain separate data storage directories per repo
4. Deploy as Kubernetes deployment with Redis shared cache for distributed deployments
5. Scale horizontally to monitor 100+ repositories with minimal resource usage

### 4. GitHub Webhook Migration Design
Current polling architecture can be migrated to event-driven webhooks:
1. Add Express.js endpoint to receive GitHub `pull_request` webhook events
2. Replace 30-minute polling with event-driven PR processing
3. Reuse all existing core services (MCP, agents, Telegram)
4. Add webhook signature verification for security
5. Reduce GitHub API usage by ~95% by only processing events instead of polling

### 5. AI Cost Optimization Strategy
- Only run summary agent for PRs <1 hour old
- Only trigger full expensive review agent when explicitly requested via "Review Now" button
- Summary agent uses minimal input payload to reduce token consumption
- All agent calls include retries to avoid wasted API calls from transient failures
- PRs are only processed once, eliminating duplicate AI inference costs
- Gemini model is optimized for low token usage, with structured output requirements to reduce unnecessary text generation
