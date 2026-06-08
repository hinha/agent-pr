const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const logger = require('../utils/logger');

/**
 * Normalize a value to boolean.
 * Accepts: true, "true", "TRUE", 1, "1", "yes", "on" (case-insensitive)
 * @param {*} value - Value to test
 * @returns {boolean}
 */
function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return ['true', '1', 'yes', 'on'].includes(v);
  }
  return false;
}

/**
 * Resolve enabled status from repo config, supporting both `enable` and `enabled` keys.
 * `enabled` takes precedence when both are present.
 * @param {Object} repoConf - Repo config object
 * @returns {boolean}
 */
function resolveEnabled(repoConf) {
  const raw = repoConf.enabled !== undefined ? repoConf.enabled : repoConf.enable;
  return toBool(raw);
}

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
      mcpClient: config.app.mcp_client || 'mcporter',
      mcpOutputFlag: config.app.mcp_output_flag || '--output json',
      checkIntervalMs: config.app.check_interval_minutes * 60 * 1000,
      outdatedReviewCheckIntervalMs: (config.app.outdated_review_check_minutes || 10) * 60 * 1000,
      snoozeTime: {
        enabled: config.app.snooze_time?.enabled || false,
        startHour: config.app.snooze_time?.start_hour || 20,
        endHour: config.app.snooze_time?.end_hour || 6,
        skipWeekends: config.app.snooze_time?.skip_weekends || false,
        dayNames: config.app.snooze_time?.day_names || ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat']
      },
      telegram: {
        botToken: config.app.telegram.bot_token,
        chatId: parseInt(config.app.telegram.chat_id, 10)
      },
      flagsmith: {
        enabled: config.app.flagsmith?.enabled || false,
        environmentId: config.app.flagsmith?.environment_id || process.env.FLAGSMITH_ENVIRONMENT_ID,
        identity: config.app.flagsmith?.identity || process.env.FLAGSMITH_IDENTITY || null,
        syncIntervalMs: (config.app.flagsmith?.sync_interval_minutes || 5) * 60 * 1000
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
      const [, owner] = key.split('/');

      const maxAgeHours = config[key].max_age_hours || 48;
      const skipCacheHours = config[key].skip_cache_duration_hours || 3;
      const queueMaxSize = config[key].queue?.max_size || 2;

      instances[key] = {
        key: key,
        owner: owner,
        mcpName: config[key].mcp_name,
        maxAgeMs: maxAgeHours * 60 * 60 * 1000,
        skipDurationMs: skipCacheHours * 60 * 60 * 1000,
        queue: {
          maxSize: queueMaxSize
        },
        agent: {
          reviewAgent: config[key].agent.review,
          summaryAgent: config[key].agent.summary,
          levels: config[key].agent.level,
          reviewTimeoutSeconds: config[key].agent.review_timeout_seconds,
          reviewTimeoutMessage: config[key].agent.review_timeot_string || '10 menit'
        },
        repos: Object.fromEntries(
          Object.entries(config[key].repos || {}).map(([repoName, repoConf]) => [
            repoName,
            { ...repoConf, enabled: resolveEnabled(repoConf) }
          ])
        )
      };

      const repos = Object.entries(config[key].repos || {});
      const enabledCount = repos.filter(([, r]) => resolveEnabled(r)).length;
      const repoCount = repos.length;
      logger.info(`Instance ${key}: owner=${owner}, mcp=${config[key].mcp_name}, queue_max=${queueMaxSize}, repos=${enabledCount}/${repoCount} active`);
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

/**
 * Reload configuration from file (called after Flagsmith sync)
 */
function reloadConfig() {
  cachedConfig = null;
  const newConfig = getConfig();
  logger.info('Configuration reloaded after Flagsmith sync');
  return newConfig;
}

/**
 * Get dynamic config value with Flagsmith override
 * @param {string} path - Dot-notation path (e.g., 'app.checkIntervalMs')
 * @param {*} localValue - Local config value to use as fallback
 * @returns {*} Flagsmith value if available, otherwise local value
 */
function getDynamicConfigValue(path, localValue) {
  try {
    const flagsmithSyncService = require('../services/flagsmithSyncService');
    if (flagsmithSyncService.isActive()) {
      // Convert camelCase path to snake_case for Flagsmith lookup
      // e.g., 'app.checkIntervalMs' -> 'app.check_interval_ms'
      const flagsmithPath = path.replace(/([A-Z])/g, '_$1').toLowerCase();
      const flagsmithValue = flagsmithSyncService.getValue(flagsmithPath);

      if (flagsmithValue !== undefined) {
        logger.debug(`Using Flagsmith value for ${path}: ${flagsmithValue}`);
        return flagsmithValue;
      }
    }
  } catch (err) {
    logger.debug(`Error getting dynamic config for ${path}: ${err.message}`);
  }
  return localValue;
}

/**
 * Get config with dynamic overrides from Flagsmith
 * @returns {Object} Configuration object with Flagsmith overrides applied
 */
function getDynamicConfig() {
  const baseConfig = getConfig();

  return {
    ...baseConfig,
    app: {
      ...baseConfig.app,
      checkIntervalMs: getDynamicConfigValue('app.check_interval_ms', baseConfig.app.checkIntervalMs / 60000) * 60 * 1000,
      outdatedReviewCheckIntervalMs: getDynamicConfigValue('app.outdated_review_check_ms', baseConfig.app.outdatedReviewCheckIntervalMs / 60000) * 60 * 1000
    }
  };
}

// Create a Proxy for backward compatibility - accessing any property returns the current config value
const configProxy = new Proxy({}, {
  get(target, prop) {
    // First check if it's a function (module exports)
    const functions = {
      loadYamlConfig,
      reloadConfig,
      getInstanceByOwner,
      getRepoConfig,
      getRepoStoragePath,
      ensureRepoStorageDir,
      getConfig,
      getDynamicConfig
    };

    if (prop in functions) {
      return functions[prop];
    }

    // Otherwise, get from current config
    const currentConfig = getConfig();
    return currentConfig[prop];
  },
  set(target, prop, value) {
    const currentConfig = getConfig();
    currentConfig[prop] = value;
    return true;
  },
  has(target, prop) {
    const functions = {
      loadYamlConfig,
      reloadConfig,
      getInstanceByOwner,
      getRepoConfig,
      getRepoStoragePath,
      ensureRepoStorageDir,
      getConfig,
      getDynamicConfig
    };

    if (prop in functions) {
      return true;
    }

    const currentConfig = getConfig();
    return prop in currentConfig;
  },
  ownKeys(_target) {
    const functions = {
      loadYamlConfig,
      reloadConfig,
      getInstanceByOwner,
      getRepoConfig,
      getRepoStoragePath,
      ensureRepoStorageDir,
      getConfig,
      getDynamicConfig
    };

    const configKeys = Object.getOwnPropertyNames(getConfig());
    const functionKeys = Object.keys(functions);
    return [...new Set([...functionKeys, ...configKeys])];
  },
  getOwnPropertyDescriptor(target, prop) {
    const functions = {
      loadYamlConfig,
      reloadConfig,
      getInstanceByOwner,
      getRepoConfig,
      getRepoStoragePath,
      ensureRepoStorageDir,
      getConfig,
      getDynamicConfig
    };

    if (prop in functions) {
      return {
        value: functions[prop],
        writable: false,
        enumerable: true,
        configurable: true
      };
    }

    const currentConfig = getConfig();
    const descriptor = Object.getOwnPropertyDescriptor(currentConfig, prop);
    if (descriptor) {
      descriptor.enumerable = true;
    }
    return descriptor;
  }
});

// Export the proxy as the main module
module.exports = configProxy;
