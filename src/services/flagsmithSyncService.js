const flagsmith = require('@flagsmith/flagsmith').default;
const logger = require('../utils/logger');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

/**
 * Flagsmith Remote Configuration Sync Service
 *
 * Syncs configuration from Flagsmith to local config file.
 * Supports periodic sync, retry logic, and graceful degradation.
 */
class FlagsmithSyncService {
  constructor() {
    this.syncInterval = null;
    this.isEnabled = false;
    this.environmentId = null;
    this.identity = null;
    this.lastSyncTime = null;
    this.lastSyncSuccessTime = null;
    this.consecutiveErrors = 0;
    this.remoteOverrides = {}; // Cache for Flagsmith values
    this.configPath = path.join(process.cwd(), 'config.yml');
    this.backupConfigPath = path.join(process.cwd(), 'config.yml.backup');
    this.maxConsecutiveErrors = 5; // After this many errors, increase sync interval
    this.baseSyncIntervalMs = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Initialize Flagsmith sync service
   */
  async init(config) {
    this.isEnabled = config.app?.flagsmith?.enabled || false;
    this.environmentId = config.app?.flagsmith?.environmentId;
    this.identity = config.app?.flagsmith?.identity;

    if (!this.isEnabled || !this.environmentId) {
      logger.info('Flagsmith sync disabled');
      return;
    }

    try {
      await flagsmith.init({
        environmentID: this.environmentId,
        fetch: globalThis.fetch
      });

      // Set identity if provided (for user-specific flags)
      if (this.identity) {
        flagsmith.identify(this.identity);
        logger.info(`✓ Flagsmith initialized with identity: ${this.identity}`);
      } else {
        logger.info(`✓ Flagsmith initialized (env: ${this.environmentId})`);
      }

      // Initial sync
      await this.syncConfig();
    } catch (err) {
      logger.error(`Failed to initialize Flagsmith: ${err.message}`);
      throw err;
    }
  }

  /**
   * Sync configuration from Flagsmith with retry and error handling
   */
  async syncConfig() {
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.debug(`Flagsmith sync attempt ${attempt}/${maxRetries}`);

        // Get YAML config from Flagsmith
        const hasConfig = flagsmith.hasFeature('config');
        if (!hasConfig) {
          logger.debug('Flagsmith config feature not found');
          this._handleSyncSuccess();
          return;
        }

        const configValue = flagsmith.getValue('config');
        if (!configValue) {
          logger.debug('Flagsmith config feature exists but has no value');
          this._handleSyncSuccess();
          return;
        }

        // Parse YAML from Flagsmith
        const remoteConfig = yaml.load(configValue);
        if (!remoteConfig || typeof remoteConfig !== 'object') {
          throw new Error('Invalid YAML format received from Flagsmith');
        }

        // Merge with local config, keeping sensitive data local
        const mergedConfig = await this._mergeWithLocalConfig(remoteConfig);

        // Write to local config file
        await this._writeConfigToFile(mergedConfig);

        // Update cache
        this.remoteOverrides = remoteConfig;
        this._handleSyncSuccess();
        logger.info(`✓ Synced ${Object.keys(remoteConfig).length} config keys from Flagsmith and wrote to config.yml`);
        return;

      } catch (err) {
        lastError = err;
        const errorType = this._classifyError(err);
        logger.warn(`Flagsmith sync attempt ${attempt}/${maxRetries} failed: ${errorType} - ${err.message}`);

        // Don't retry on certain errors
        if (errorType === 'INVALID_DATA' || errorType === 'FILE_SYSTEM') {
          logger.error(`Non-retryable error (${errorType}), aborting sync`);
          this._handleSyncError(err);
          return;
        }

        // Wait before retry (exponential backoff)
        if (attempt < maxRetries) {
          const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          logger.debug(`Retrying in ${waitTime}ms...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    // All retries failed
    this._handleSyncError(lastError);
    logger.error(`Flagsmith sync failed after ${maxRetries} attempts: ${lastError.message}`);
  }

  /**
   * Classify error type for appropriate handling
   */
  _classifyError(err) {
    const message = err.message?.toLowerCase() || '';
    const name = err.name?.toLowerCase() || '';

    // Network/Gateway errors
    if (message.includes('fetch') || message.includes('network') || message.includes('econnrefused') ||
        message.includes('enotfound') || message.includes('etimedout') || message.includes('gateway') ||
        message.includes('502') || message.includes('503') || message.includes('504')) {
      return 'NETWORK_GATEWAY';
    }

    // Timeout errors
    if (message.includes('timeout') || name.includes('timeout')) {
      return 'TIMEOUT';
    }

    // YAML parsing errors
    if (message.includes('yaml') || message.includes('parse') || err instanceof yaml.YAMLException) {
      return 'INVALID_DATA';
    }

    // File system errors
    if (message.includes('enoent') || message.includes('eacces') || message.includes('permission')) {
      return 'FILE_SYSTEM';
    }

    // Unknown errors
    return 'UNKNOWN';
  }

  /**
   * Handle successful sync
   */
  _handleSyncSuccess() {
    this.lastSyncTime = new Date();
    this.lastSyncSuccessTime = new Date();
    this.consecutiveErrors = 0;

    // Reload cached config in yamlConfig to pick up changes from config.yml
    try {
      const yamlConfig = require('../config/yamlConfig');
      if (typeof yamlConfig.reloadConfig === 'function') {
        yamlConfig.reloadConfig();
      }
    } catch (err) {
      logger.error(`Failed to reload config after sync: ${err.message}`);
    }

    // Reset sync interval to normal after errors
    if (this.syncInterval && this.consecutiveErrors === 0 && this.currentSyncIntervalMs !== this.baseSyncIntervalMs) {
      this._resetSyncInterval();
    }
  }

  /**
   * Handle sync error with adaptive backoff
   */
  _handleSyncError(err) {
    this.consecutiveErrors++;
    this.lastSyncTime = new Date();

    // Increase sync interval after many consecutive errors
    if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
      logger.warn(`${this.consecutiveErrors} consecutive sync errors, increasing sync interval`);
      this._increaseSyncInterval();
    }

    // Continue with cached values - don't crash the app
    logger.info(`Continuing with cached config values (${Object.keys(this.remoteOverrides).length} keys)`);
  }

  /**
   * Merge remote config with local config, preserving sensitive data
   */
  async _mergeWithLocalConfig(remoteConfig) {
    try {
      // Read current local config
      const localConfigRaw = fs.readFileSync(this.configPath, 'utf8');
      const localConfig = yaml.load(localConfigRaw);

      // Deep merge, but preserve sensitive fields
      const merged = this._deepMerge(localConfig, remoteConfig, {
        preserveKeys: ['telegram.bot_token', 'telegram.chat_id', 'app.flagsmith.environment_id']
      });

      return merged;
    } catch (err) {
      logger.error(`Failed to merge with local config: ${err.message}`);
      // Return remote config if merge fails
      return remoteConfig;
    }
  }

  /**
   * Deep merge objects with selective key preservation
   */
  _deepMerge(local, remote, options = {}) {
    const result = { ...local };

    for (const key of Object.keys(remote)) {
      const path = `${result._parentPath || ''}.${key}`.replace(/^\./, '');

      // Skip preserved keys
      if (options.preserveKeys?.includes(path)) {
        continue;
      }

      if (typeof remote[key] === 'object' && remote[key] !== null && !Array.isArray(remote[key])) {
        remote[key]._parentPath = path;
        result[key] = this._deepMerge(local[key] || {}, remote[key], options);
        delete remote[key]._parentPath;
      } else {
        result[key] = remote[key];
      }
    }

    return result;
  }

  /**
   * Write config to file with backup
   */
  async _writeConfigToFile(config) {
    try {
      // Create backup of current config
      if (fs.existsSync(this.configPath)) {
        fs.copyFileSync(this.configPath, this.backupConfigPath);
      }

      // Write new config
      const yamlString = yaml.dump(config, {
        indent: 2,
        lineWidth: -1,
        noRefs: true
      });
      fs.writeFileSync(this.configPath, yamlString, 'utf8');

      logger.debug(`Config written to ${this.configPath}`);
    } catch (err) {
      // Restore from backup if write failed
      if (fs.existsSync(this.backupConfigPath)) {
        try {
          fs.copyFileSync(this.backupConfigPath, this.configPath);
          logger.info('Restored config from backup after write failure');
        } catch (restoreErr) {
          logger.error(`Failed to restore backup: ${restoreErr.message}`);
        }
      }
      throw err;
    }
  }

  /**
   * Increase sync interval after errors (adaptive backoff)
   */
  _increaseSyncInterval() {
    const newInterval = Math.min(this.baseSyncIntervalMs * Math.pow(2, this.consecutiveErrors - this.maxConsecutiveErrors + 1), 30 * 60 * 1000); // Max 30 min
    this.currentSyncIntervalMs = newInterval;

    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = setInterval(() => this.syncConfig(), newInterval);
      if (typeof this.syncInterval.unref === 'function') {
        this.syncInterval.unref();
      }
    }
    logger.warn(`Sync interval increased to ${newInterval / 60000} minutes due to errors`);
  }

  /**
   * Reset sync interval to normal
   */
  _resetSyncInterval() {
    this.currentSyncIntervalMs = this.baseSyncIntervalMs;
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = setInterval(() => this.syncConfig(), this.baseSyncIntervalMs);
      if (typeof this.syncInterval.unref === 'function') {
        this.syncInterval.unref();
      }
    }
    logger.info(`Sync interval reset to ${this.baseSyncIntervalMs / 60000} minutes`);
  }

  /**
   * Get a value from remote overrides with path support
   * @param {string} path - Dot-notation path (e.g., 'app.check_interval_minutes')
   * @param {*} fallback - Fallback value if not found
   * @returns {*} The value from Flagsmith or fallback
   */
  getValue(path, fallback) {
    const keys = path.split('.');
    let value = this.remoteOverrides;
    for (const key of keys) {
      value = value?.[key];
      if (value === undefined) return fallback;
    }
    return value !== undefined ? value : fallback;
  }

  /**
   * Check if a feature flag is enabled in Flagsmith
   * @param {string} featureName - Name of the feature
   * @returns {boolean} True if feature is enabled
   */
  hasFeature(featureName) {
    if (!this.isEnabled) return false;
    try {
      return flagsmith.hasFeature(featureName);
    } catch (err) {
      logger.debug(`Error checking feature ${featureName}: ${err.message}`);
      return false;
    }
  }

  /**
   * Get the last sync time
   * @returns {Date|null} Last sync timestamp
   */
  getLastSyncTime() {
    return this.lastSyncTime;
  }

  /**
   * Start periodic sync
   * @param {number} syncIntervalMs - Sync interval in milliseconds
   */
  start(syncIntervalMs) {
    if (!this.isEnabled) return;

    this.currentSyncIntervalMs = syncIntervalMs || this.baseSyncIntervalMs;
    this.syncInterval = setInterval(() => this.syncConfig(), this.currentSyncIntervalMs);
    if (typeof this.syncInterval.unref === 'function') {
      this.syncInterval.unref();
    }
    logger.info(`⏰ Flagsmith sync scheduled every ${this.currentSyncIntervalMs / 60000} minutes`);
  }

  /**
   * Get sync health status
   * @returns {Object} Health status
   */
  getHealthStatus() {
    return {
      isEnabled: this.isEnabled,
      isActive: this.isActive(),
      lastSyncTime: this.lastSyncTime,
      lastSyncSuccessTime: this.lastSyncSuccessTime,
      consecutiveErrors: this.consecutiveErrors,
      currentSyncIntervalMinutes: (this.currentSyncIntervalMs || this.baseSyncIntervalMs) / 60000,
      isHealthy: this.consecutiveErrors < this.maxConsecutiveErrors
    };
  }

  /**
   * Restore config from backup
   */
  restoreFromBackup() {
    try {
      if (fs.existsSync(this.backupConfigPath)) {
        fs.copyFileSync(this.backupConfigPath, this.configPath);
        logger.info(`Config restored from ${this.backupConfigPath}`);
        return true;
      }
      logger.warn(`No backup file found at ${this.backupConfigPath}`);
      return false;
    } catch (err) {
      logger.error(`Failed to restore from backup: ${err.message}`);
      return false;
    }
  }

  /**
   * Stop periodic sync
   */
  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /**
   * Check if service is enabled
   * @returns {boolean} True if enabled
   */
  isActive() {
    return this.isEnabled && this.environmentId;
  }
}

module.exports = new FlagsmithSyncService();
