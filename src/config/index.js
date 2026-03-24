require('dotenv').config();
const path = require('path');
const fs = require('fs');

// Initialize persistent storage directories
const DATA_DIR = path.join(__dirname, '../../data');
const LOGS_DIR = path.join(__dirname, '../../logs');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

module.exports = {
  mcp: {
    configPath: process.env.MCP_CONFIG_PATH,
    serverName: process.env.MCP_SERVER_NAME || 'github-work',
    baseCommand: 'mcporter'
  },
  openclaw: {
    summaryAgent: process.env.OPENCLAW_AGENT_SUMMARY,
    reviewAgent: process.env.OPENCLAW_AGENT_REVIEW,
    reviewModel: process.env.OPENCLAW_REVIEW_MODEL || 'github-copilot/claude-sonnet-4.6'
  },
  github: {
    owner: process.env.GITHUB_OWNER || 'git_owner',
    repo: process.env.GITHUB_REPO || 'git_repo'
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: parseInt(process.env.TELEGRAM_CHAT_ID),
    threadId: parseInt(process.env.TELEGRAM_THREAD_ID)
  },
  scheduler: {
    checkIntervalMs: 7 * 60 * 1000, // Hardcode to 7 minutes as requested
    skipDurationMs: (parseInt(process.env.SKIP_CACHE_DURATION_HOURS) || 3) * 60 * 60 * 1000,
    maxAgeMs: 24 * 60 * 60 * 1000 // Only process PRs <24 hours old
  },
  storage: {
    processedPrsPath: path.join(DATA_DIR, 'processed_prs.json'),
    skipCachePath: path.join(DATA_DIR, 'skip_cache.json')
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  },
  retries: {
    mcpRetries: 3,
    telegramRetries: 3,
    agentRetries: 2,
    backoffFactor: 2
  }
};
