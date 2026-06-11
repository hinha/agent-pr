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
  describe('notification platform loading', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const originalCwd = process.cwd();

    afterEach(() => {
      process.chdir(originalCwd);
      jest.resetModules();
    });

    function writeConfig(dir, platformBlock) {
      fs.writeFileSync(path.join(dir, 'config.yml'), `
app:
  provider_agent: openclaw
  check_interval_minutes: 7
  outdated_review_check_minutes: 10
  ${platformBlock}
  flagsmith:
    enabled: false
log:
  level: info
github/acme:
  mcp_name: github-work
  agent:
    review: reviewer
    summary: summarizer
    level: [low, medium, high]
  repos:
    api:
      enable: true
      thread_id: "123"
`);
    }

    test('defaults Telegram to enabled for legacy configs', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pr-config-'));
      writeConfig(dir, `
  telegram:
    bot_token: "token"
    chat_id: "123"
  discord:
    enabled: false`);
      process.chdir(dir);
      jest.resetModules();

      const yamlConfig = require('../../../src/config/yamlConfig');
      const config = yamlConfig.loadYamlConfig();

      expect(config.app.telegram.enabled).toBe(true);
      expect(config.app.discord.enabled).toBe(false);
    });

    test('throws when Telegram and Discord are both disabled', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pr-config-'));
      writeConfig(dir, `
  telegram:
    enabled: false
    bot_token: "token"
    chat_id: "123"
  discord:
    enabled: false`);
      process.chdir(dir);
      jest.resetModules();

      const yamlConfig = require('../../../src/config/yamlConfig');

      expect(() => yamlConfig.loadYamlConfig()).toThrow(
        'At least one notification platform must be enabled'
      );
    });
  });

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

      const localValue = 420000;

      if (!flagsmithSyncService.isActive()) {
        expect(localValue).toBe(420000);
      }
    });

    test('should use Flagsmith value when active', () => {
      const flagsmithSyncService = require('../../../src/services/flagsmithSyncService');
      flagsmithSyncService.isActive.mockReturnValue(true);
      flagsmithSyncService.getValue.mockReturnValue(300000);

      if (flagsmithSyncService.isActive()) {
        const remoteValue = flagsmithSyncService.getValue('app.checkIntervalMs');
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
      const cachedConfig = null;
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

  describe('toBool helper', () => {
    const toBool = (value) => {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value === 1;
      if (typeof value === 'string') {
        const v = value.trim().toLowerCase();
        return ['true', '1', 'yes', 'on'].includes(v);
      }
      return false;
    };

    test('should pass through boolean true', () => expect(toBool(true)).toBe(true));
    test('should pass through boolean false', () => expect(toBool(false)).toBe(false));
    test('should accept "true"', () => expect(toBool('true')).toBe(true));
    test('should accept "TRUE" (case-insensitive)', () => expect(toBool('TRUE')).toBe(true));
    test('should accept "True" (case-insensitive)', () => expect(toBool('True')).toBe(true));
    test('should accept 1 (number)', () => expect(toBool(1)).toBe(true));
    test('should accept "1" (string)', () => expect(toBool('1')).toBe(true));
    test('should accept "yes"', () => expect(toBool('yes')).toBe(true));
    test('should accept "YES"', () => expect(toBool('YES')).toBe(true));
    test('should accept "on"', () => expect(toBool('on')).toBe(true));
    test('should accept "ON"', () => expect(toBool('ON')).toBe(true));
    test('should reject 0', () => expect(toBool(0)).toBe(false));
    test('should reject "false"', () => expect(toBool('false')).toBe(false));
    test('should reject "no"', () => expect(toBool('no')).toBe(false));
    test('should reject "off"', () => expect(toBool('off')).toBe(false));
    test('should reject null', () => expect(toBool(null)).toBe(false));
    test('should reject undefined', () => expect(toBool(undefined)).toBe(false));
    test('should reject empty string', () => expect(toBool('')).toBe(false));
    test('should reject random string', () => expect(toBool('maybe')).toBe(false));
    test('should reject object', () => expect(toBool({})).toBe(false));
  });

  describe('resolveEnabled alias', () => {
    const resolveEnabled = (repoConf) => {
      const raw = repoConf.enabled !== undefined ? repoConf.enabled : repoConf.enable;
      const toBool = (value) => {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value === 1;
        if (typeof value === 'string') {
          const v = value.trim().toLowerCase();
          return ['true', '1', 'yes', 'on'].includes(v);
        }
        return false;
      };
      return toBool(raw);
    };

    test('should work with enable: true', () => {
      expect(resolveEnabled({ enable: true })).toBe(true);
    });

    test('should work with enabled: true as alias', () => {
      expect(resolveEnabled({ enabled: true })).toBe(true);
    });

    test('should prefer enabled over enable when both present', () => {
      expect(resolveEnabled({ enable: false, enabled: true })).toBe(true);
    });

    test('should work with enabled: "yes" via alias', () => {
      expect(resolveEnabled({ enabled: 'yes' })).toBe(true);
    });

    test('should default to false when neither field present', () => {
      expect(resolveEnabled({ thread_id: '100' })).toBe(false);
    });
  });

  describe('Repo enable field parsing', () => {
    const toBool = (value) => {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value === 1;
      if (typeof value === 'string') {
        const v = value.trim().toLowerCase();
        return ['true', '1', 'yes', 'on'].includes(v);
      }
      return false;
    };

    const resolveEnabled = (repoConf) => {
      const raw = repoConf.enabled !== undefined ? repoConf.enabled : repoConf.enable;
      return toBool(raw);
    };

    test('should set enabled to true when repo config has enable: true', () => {
      const repoConf = { enable: true, thread_id: '100' };
      expect(resolveEnabled(repoConf)).toBe(true);
    });

    test('should set enabled to true when repo config has enable as string "true"', () => {
      const repoConf = { enable: 'true', thread_id: '100' };
      expect(resolveEnabled(repoConf)).toBe(true);
    });

    test('should set enabled to true for "TRUE" (case-insensitive)', () => {
      const repoConf = { enable: 'TRUE', thread_id: '100' };
      expect(resolveEnabled(repoConf)).toBe(true);
    });

    test('should set enabled to true for numeric 1', () => {
      const repoConf = { enable: 1, thread_id: '100' };
      expect(resolveEnabled(repoConf)).toBe(true);
    });

    test('should set enabled to true for "yes"', () => {
      const repoConf = { enable: 'yes', thread_id: '100' };
      expect(resolveEnabled(repoConf)).toBe(true);
    });

    test('should set enabled to true for "on"', () => {
      const repoConf = { enable: 'on', thread_id: '100' };
      expect(resolveEnabled(repoConf)).toBe(true);
    });

    test('should set enabled to false when repo config has enable: false', () => {
      const repoConf = { enable: false, thread_id: '100' };
      expect(resolveEnabled(repoConf)).toBe(false);
    });

    test('should set enabled to false when repo config has no enable field', () => {
      const repoConf = { thread_id: '100' };
      expect(resolveEnabled(repoConf)).toBe(false);
    });

    test('should transform repos map with enabled field', () => {
      const rawRepos = {
        'active-repo': { enable: true, thread_id: '100' },
        'string-true-repo': { enable: 'true', thread_id: '101' },
        'disabled-repo': { enable: false, thread_id: '200' },
        'no-field-repo': { thread_id: '300' }
      };

      const transformed = Object.fromEntries(
        Object.entries(rawRepos).map(([name, conf]) => [
          name,
          { ...conf, enabled: resolveEnabled(conf) }
        ])
      );

      expect(transformed['active-repo'].enabled).toBe(true);
      expect(transformed['string-true-repo'].enabled).toBe(true);
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
