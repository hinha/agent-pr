const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const logger = require('../utils/logger');

/**
 * Load YAML configuration file
 */
function loadYamlConfig() {
  const configPath = path.join(process.cwd(), 'config.yml');

  if (!fs.existsSync(configPath)) {
    logger.error(`Configuration file not found: ${configPath}`);
    throw new Error(`config.yml not found at ${configPath}`);
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(raw);

    logger.info(`Loaded configuration from ${configPath}`);

    return buildInternalConfig(config);
  } catch (err) {
    logger.error(`Failed to parse config.yml: ${err.message}`);
    throw err;
  }
}

/**
 * Transform YAML structure to internal config format
 */
function buildInternalConfig(config) {
  const internalConfig = {
    app: {
      checkIntervalMs: config.app.check_interval_minutes * 60 * 1000,
      outdatedReviewCheckIntervalMs: (config.app.outdated_review_check_minutes || 10) * 60 * 1000,
      telegram: {
        botToken: config.app.telegram.bot_token,
        chatId: parseInt(config.app.telegram.chat_id, 10)
      }
    },
    instances: buildInstances(config),
    log: { level: config.log.level || 'info' },
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

  logger.info(`Built config for ${Object.keys(internalConfig.instances).length} instances`);

  return internalConfig;
}

/**
 * Extract instance configurations from YAML
 * Format: github/{org-name}
 */
function buildInstances(config) {
  const instances = {};

  for (const key of Object.keys(config)) {
    if (key.startsWith('github/')) {
      const [_, owner] = key.split('/');

      instances[key] = {
        key: key,
        owner: owner,
        mcpName: config[key].mcp_name,
        maxAgeMs: config[key].max_age_hours * 60 * 60 * 1000,
        skipDurationMs: config[key].skip_cache_duration_hours * 60 * 60 * 1000,
        agent: {
          reviewAgent: config[key].agent.review,
          summaryAgent: config[key].agent.summary,
          levels: config[key].agent.level,
          reviewTimeoutSeconds: config[key].agent.review_timeout_seconds,
          reviewTimeoutMessage: config[key].agent.review_timeot_string || '10 menit'
        },
        repos: config[key].repos
      };

      const repoCount = Object.keys(config[key].repos || {}).length;
      logger.info(`Instance ${key}: owner=${owner}, mcp=${config[key].mcp_name}, repos=${repoCount}`);
    }
  }

  return instances;
}

/**
 * Get instance configuration by owner name
 */
function getInstanceByOwner(owner) {
  const config = module.exports;
  const instanceKey = `github/${owner}`;

  if (!config.instances[instanceKey]) {
    throw new Error(`No instance found for owner: ${owner}`);
  }

  return config.instances[instanceKey];
}

/**
 * Get repository configuration within an instance
 */
function getRepoConfig(owner, repoName) {
  const instance = getInstanceByOwner(owner);

  if (!instance.repos || !instance.repos[repoName]) {
    throw new Error(`No repository configuration found for ${owner}/${repoName}`);
  }

  return {
    threadId: parseInt(instance.repos[repoName].thread_id, 10),
    instance: instance
  };
}

/**
 * Get storage path for a repository
 */
function getRepoStoragePath(owner, repoName) {
  const instance = getInstanceByOwner(owner);
  const dataDir = path.join(process.cwd(), 'data', 'instances', instance.key.replace('github/', 'github-'));
  return path.join(dataDir, repoName);
}

/**
 * Ensure repository storage directory exists
 */
function ensureRepoStorageDir(owner, repoName) {
  const repoPath = getRepoStoragePath(owner, repoName);
  if (!fs.existsSync(repoPath)) {
    fs.mkdirSync(repoPath, { recursive: true });
    logger.debug(`Created storage directory: ${repoPath}`);
  }
  return repoPath;
}

// Load and cache configuration
let cachedConfig = null;

function getConfig() {
  if (!cachedConfig) {
    cachedConfig = loadYamlConfig();
  }
  return cachedConfig;
}

module.exports = getConfig();
module.exports.loadYamlConfig = loadYamlConfig;
module.exports.getInstanceByOwner = getInstanceByOwner;
module.exports.getRepoConfig = getRepoConfig;
module.exports.getRepoStoragePath = getRepoStoragePath;
module.exports.ensureRepoStorageDir = ensureRepoStorageDir;
module.exports.getConfig = getConfig;
