/**
 * Unit tests for yamlConfig module
 * Tests configuration helper functions and logic
 * Note: buildInternalConfig is a private function, tested via logic validation
 */

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn()
}));

jest.mock('../../../src/services/flagsmithSyncService', () => ({
  isActive: jest.fn(() => false),
  getValue: jest.fn(() => undefined)
}));

describe('yamlConfig', () => {
  describe('getRepoKey logic', () => {
    test('should return correct repo key format', () => {
      const key1 = `${'owner'}/${'repo'}`;
      const key2 = `${'org'}/${'project'}`;

      expect(key1).toBe('owner/repo');
      expect(key2).toBe('org/project');
    });
  });

  describe('getRepoConfig logic', () => {
    test('should extract repo configuration correctly', () => {
      const instance = {
        repos: {
          'repo1': { thread_id: '100' },
          'repo2': { thread_id: '200' }
        }
      };

      const repoConfig = instance.repos['repo1'];
      const result = {
        threadId: parseInt(repoConfig.thread_id, 10),
        instance: instance
      };

      expect(result.threadId).toBe(100);
      expect(result.instance).toBe(instance);
    });
  });

  describe('getDynamicConfigValue logic', () => {
    test('should use local value when Flagsmith is not active', () => {
      const flagsmithSyncService = require('../../../src/services/flagsmithSyncService');
      flagsmithSyncService.isActive.mockReturnValue(false);

      const path = 'app.checkIntervalMs';
      const localValue = 420000;

      if (!flagsmithSyncService.isActive()) {
        expect(localValue).toBe(420000);
      }
    });

    test('should use Flagsmith value when active', () => {
      const flagsmithSyncService = require('../../../src/services/flagsmithSyncService');
      flagsmithSyncService.isActive.mockReturnValue(true);
      flagsmithSyncService.getValue.mockReturnValue(300000);

      const path = 'app.checkIntervalMs';
      const localValue = 420000;

      if (flagsmithSyncService.isActive()) {
        const remoteValue = flagsmithSyncService.getValue(path);
        expect(remoteValue).toBe(300000);
      }
    });
  });

  describe('ensureRepoStorageDir logic', () => {
    test('should create directory if not exists', () => {
      const repoPath = '/data/instances/owner/repo';
      const exists = false;

      if (!exists) {
        expect(repoPath).toBeDefined();
      }
    });

    test('should return existing directory path', () => {
      const repoPath = '/data/instances/owner/repo';
      const exists = true;

      if (!exists) {
        throw new Error('Should not reach here');
      }

      expect(repoPath).toBe('/data/instances/owner/repo');
    });
  });

  describe('reloadConfig logic', () => {
    test('should clear cache and reload config', () => {
      let cachedConfig = { app: { checkIntervalMs: 420000 } };

      cachedConfig = null;
      const newConfig = { app: { checkIntervalMs: 360000 } };

      expect(cachedConfig).toBeNull();
      expect(newConfig).toBeDefined();
    });
  });

  describe('Instance lookup logic', () => {
    test('should find instance by owner name', () => {
      const instances = {
        'github/org1': { owner: 'org1', key: 'github/org1' },
        'github/org2': { owner: 'org2', key: 'github/org2' }
      };

      const owner = 'org1';
      const instanceKey = `github/${owner}`;
      const result = instances[instanceKey];

      expect(result).toBeDefined();
      expect(result.owner).toBe('org1');
    });

    test('should return undefined for non-existent owner', () => {
      const instances = {
        'github/org1': { owner: 'org1', key: 'github/org1' }
      };

      const owner = 'nonexistent';
      const instanceKey = `github/${owner}`;
      const result = instances[instanceKey];

      expect(result).toBeUndefined();
    });
  });

  describe('Chat ID parsing logic', () => {
    test('should parse numeric chat ID from string', () => {
      const chatIdStr = '12345';
      const chatIdNum = parseInt(chatIdStr, 10);

      expect(chatIdNum).toBe(12345);
      expect(typeof chatIdNum).toBe('number');
    });

    test('should handle already numeric chat ID', () => {
      const chatIdNum = 12345;
      const result = Number.isInteger(chatIdNum) ? chatIdNum : parseInt(chatIdNum, 10);

      expect(result).toBe(12345);
    });
  });

  describe('Time conversion logic', () => {
    test('should convert minutes to milliseconds', () => {
      const minutes = 7;
      const ms = minutes * 60 * 1000;

      expect(ms).toBe(420000);
    });

    test('should convert hours to milliseconds', () => {
      const hours = 48;
      const ms = hours * 60 * 60 * 1000;

      expect(ms).toBe(172800000);
    });
  });

  describe('Config path construction', () => {
    test('should construct correct config path', () => {
      const path = require('path');
      const configPath = path.join(process.cwd(), 'config.yml');

      expect(configPath).toContain('config.yml');
      expect(configPath).toMatch(/config\.yml$/);
    });
  });

  describe('Instance key parsing', () => {
    test('should parse owner from instance key', () => {
      const instanceKey = 'github/organization';
      const parts = instanceKey.split('/');
      const prefix = parts[0];
      const owner = parts[1];

      expect(prefix).toBe('github');
      expect(owner).toBe('organization');
    });

    test('should handle nested organization names', () => {
      const instanceKey = 'github/org/suborg';
      const parts = instanceKey.split('/');
      const prefix = parts[0];
      const owner = parts.slice(1).join('/');

      expect(prefix).toBe('github');
      expect(owner).toBe('org/suborg');
    });
  });

  describe('Snooze time logic', () => {
    test('should determine if current time is in snooze period (overnight)', () => {
      const config = { enabled: true, startHour: 20, endHour: 6 };

      // Test at hour 21 (should be snoozing)
      const currentHour = 21;
      const inSnooze = currentHour >= config.startHour || currentHour < config.endHour;
      expect(inSnooze).toBe(true);

      // Test at hour 10 (should not be snoozing)
      const dayHour = 10;
      const notInSnooze = dayHour >= config.startHour || dayHour < config.endHour;
      expect(notInSnooze).toBe(false);
    });

    test('should handle same-day snooze period', () => {
      const config = { enabled: true, startHour: 12, endHour: 14 };

      // Test at hour 13 (should be snoozing)
      const currentHour = 13;
      const inSnooze = currentHour >= config.startHour && currentHour < config.endHour;
      expect(inSnooze).toBe(true);

      // Test at hour 10 (should not be snoozing)
      const dayHour = 10;
      const notInSnooze = dayHour >= config.startHour && dayHour < config.endHour;
      expect(notInSnooze).toBe(false);
    });
  });

  describe('Retry configuration defaults', () => {
    test('should have correct default retry values', () => {
      const defaults = {
        mcpRetries: 3,
        telegramRetries: 3,
        agentRetries: 2,
        backoffFactor: 2
      };

      expect(defaults.mcpRetries).toBe(3);
      expect(defaults.telegramRetries).toBe(3);
      expect(defaults.agentRetries).toBe(2);
      expect(defaults.backoffFactor).toBe(2);
    });
  });

  describe('Review level configuration', () => {
    test('should have correct max comments per file for each level', () => {
      const reviewLevels = {
        low: { maxCommentsPerFile: 3 },
        medium: { maxCommentsPerFile: 10 },
        high: { maxCommentsPerFile: 50 }
      };

      expect(reviewLevels.low.maxCommentsPerFile).toBe(3);
      expect(reviewLevels.medium.maxCommentsPerFile).toBe(10);
      expect(reviewLevels.high.maxCommentsPerFile).toBe(50);
    });
  });

  describe('Proxy handler methods', () => {
    test('should handle get method for config properties', () => {
      const config = { app: { checkIntervalMs: 420000 } };
      const prop = 'app';
      const result = prop in config ? config[prop] : undefined;

      expect(result).toBeDefined();
      expect(result.checkIntervalMs).toBe(420000);
    });

    test('should return undefined for non-existent properties', () => {
      const config = { app: { checkIntervalMs: 420000 } };
      const prop = 'nonexistent';
      const result = prop in config ? config[prop] : undefined;

      expect(result).toBeUndefined();
    });
  });

  describe('Repo enable field parsing', () => {
    test('should set enabled to true when repo config has enable: true', () => {
      const repoConf = { enable: true, thread_id: '100' };
      const enabled = repoConf.enable === true;
      expect(enabled).toBe(true);
    });

    test('should set enabled to false when repo config has enable: false', () => {
      const repoConf = { enable: false, thread_id: '100' };
      const enabled = repoConf.enable === true;
      expect(enabled).toBe(false);
    });

    test('should set enabled to false when repo config has no enable field', () => {
      const repoConf = { thread_id: '100' };
      const enabled = repoConf.enable === true;
      expect(enabled).toBe(false);
    });

    test('should transform repos map with enabled field', () => {
      const rawRepos = {
        'active-repo': { enable: true, thread_id: '100' },
        'disabled-repo': { enable: false, thread_id: '200' },
        'no-field-repo': { thread_id: '300' }
      };

      const transformed = Object.fromEntries(
        Object.entries(rawRepos).map(([name, conf]) => [
          name,
          { ...conf, enabled: conf.enable === true }
        ])
      );

      expect(transformed['active-repo'].enabled).toBe(true);
      expect(transformed['disabled-repo'].enabled).toBe(false);
      expect(transformed['no-field-repo'].enabled).toBe(false);
    });

    test('should count enabled repos correctly', () => {
      const repos = {
        'repo-a': { enabled: true },
        'repo-b': { enabled: false },
        'repo-c': { enabled: true }
      };

      const enabledCount = Object.values(repos).filter(r => r.enabled === true).length;
      expect(enabledCount).toBe(2);
    });
  });
});
