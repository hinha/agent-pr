require('dotenv').config();
const path = require('path');
const fs = require('fs');

// Initialize persistent storage directories
// Use process.cwd() for pkg compatibility (writable directory in both dev and production)
const DATA_DIR = path.join(process.cwd(), 'data');
const LOGS_DIR = path.join(process.cwd(), 'logs');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

module.exports = {
  mcp: {
    configPath: process.env.MCP_CONFIG_PATH,
    serverName: process.env.MCP_SERVER_NAME || 'github-work',
    baseCommand: 'openclaw mcp'
  },
  openclaw: {
    summaryAgent: process.env.OPENCLAW_AGENT_SUMMARY,
    reviewAgent: process.env.OPENCLAW_AGENT_REVIEW,
    reviewModel: process.env.OPENCLAW_REVIEW_MODEL || 'github-copilot/claude-sonnet-4.6',
    reviewTimeoutSeconds: parseInt(process.env.OPENCLAW_REVIEW_TIMEOUT_SECONDS) || 600,
    reviewTimeoutMessage: process.env.OPENCLAW_REVIEW_TIMEOUT_MESSAGE || '10 menit'
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
    maxAgeMs: (parseInt(process.env.MAX_AGE_HOURS) || 24) * 60 * 60 * 1000 // Only process PRs < MAX_AGE_HOURS old (default: 24)
  },
  storage: {
    processedPrsPath: path.join(DATA_DIR, 'processed_prs.json'),
    skipCachePath: path.join(DATA_DIR, 'skip_cache.json'),
    notificationCountsPath: path.join(DATA_DIR, 'notification_counts.json'),
    processedTimestampsPath: path.join(DATA_DIR, 'processed_timestamps.json')
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  },
  retries: {
    mcpRetries: 3,
    telegramRetries: 3,
    agentRetries: 2,
    backoffFactor: 2
  },
  reviewLevels: {
    low: {
      description: 'Basic code quality checks',
      focusAreas: ['syntax', 'basic best practices'],
      maxCommentsPerFile: 3
    },
    medium: {
      description: 'Standard code review',
      focusAreas: ['syntax', 'best practices', 'security'],
      maxCommentsPerFile: 10
    },
    high: {
      description: 'Comprehensive security and quality analysis',
      focusAreas: ['syntax', 'best practices', 'security', 'performance', 'maintainability'],
      maxCommentsPerFile: 50
    }
  }
};
