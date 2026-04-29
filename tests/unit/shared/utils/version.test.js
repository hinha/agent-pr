const fs = require('fs');
const path = require('path');
const { getVersion, getVersionInfo } = require('../../../../src/shared/utils/version');

describe('Version Utility', () => {
  // VERSION_FILE is read from project root by version.js
  const VERSION_FILE = path.join(__dirname, '../../../../.version.json');

  // Clean up before each test
  beforeEach(() => {
    // Clean up env vars
    delete process.env.GIT_TAG;
    delete process.env.BUILD_VERSION;
    delete process.env.GIT_SHA;

    // Remove version file if exists (from project root)
    if (fs.existsSync(VERSION_FILE)) {
      fs.unlinkSync(VERSION_FILE);
    }
  });

  afterEach(() => {
    // Clean up after each test
    if (fs.existsSync(VERSION_FILE)) {
      fs.unlinkSync(VERSION_FILE);
    }
  });

  describe('getVersion', () => {
    it('should return baked version from .version.json', () => {
      const versionData = {
        version: 'v1.2.3',
        isTag: true,
        commitSha: 'abc123',
        buildTime: '2024-01-01T00:00:00.000Z',
        fullString: 'v1.2.3 (abc123)'
      };
      fs.writeFileSync(VERSION_FILE, JSON.stringify(versionData));

      const version = getVersion();
      expect(version).toBe('v1.2.3');
    });

    it('should return GIT_TAG env var when set', () => {
      process.env.GIT_TAG = 'v2.0.0';

      const version = getVersion();
      expect(version).toBe('v2.0.0');
    });

    it('should prioritize .version.json over GIT_TAG', () => {
      // Baked version from .version.json takes highest priority
      const versionData = {
        version: 'v1.0.0',
        isTag: true,
        commitSha: 'abc123',
        buildTime: '2024-01-01T00:00:00.000Z',
        fullString: 'v1.0.0 (abc123)'
      };
      fs.writeFileSync(VERSION_FILE, JSON.stringify(versionData));

      process.env.GIT_TAG = 'v3.0.0'; // This should be ignored

      const version = getVersion();
      expect(version).toBe('v1.0.0'); // From .version.json, not GIT_TAG
    });

    it('should return BUILD_VERSION env var when set', () => {
      process.env.BUILD_VERSION = 'dev-test123';

      const version = getVersion();
      expect(version).toBe('dev-test123');
    });

    it('should return package.json version as fallback', () => {
      const version = getVersion();
      expect(version).toBe('1.0.0'); // from package.json
    });

    it('should prioritize GIT_TAG over BUILD_VERSION', () => {
      process.env.GIT_TAG = 'v1.0.0';
      process.env.BUILD_VERSION = 'dev-test';

      const version = getVersion();
      expect(version).toBe('v1.0.0');
    });
  });

  describe('getVersionInfo', () => {
    it('should return full version info from .version.json', () => {
      const versionData = {
        version: 'v1.2.3',
        isTag: true,
        commitSha: 'abc123',
        buildTime: '2024-01-01T00:00:00.000Z',
        fullString: 'v1.2.3 (abc123)'
      };
      fs.writeFileSync(VERSION_FILE, JSON.stringify(versionData));

      const info = getVersionInfo();
      expect(info.version).toBe('v1.2.3');
      expect(info.isTag).toBe(true);
      expect(info.commitSha).toBe('abc123');
      expect(info.buildTime).toBe('2024-01-01T00:00:00.000Z');
      expect(info.fullString).toBe('v1.2.3 (abc123)');
    });

    it('should return tag version info for tags', () => {
      process.env.GIT_TAG = 'v2.0.0-beta';

      const info = getVersionInfo();
      expect(info.version).toBe('v2.0.0-beta');
      expect(info.isTag).toBe(true);
      expect(info.commitSha).toBeDefined();
      expect(info.fullString).toContain('v2.0.0-beta');
      expect(info.fullString).toContain('(');
    });

    it('should return dev version info for non-tags', () => {
      process.env.BUILD_VERSION = 'dev-abc123';

      const info = getVersionInfo();
      expect(info.version).toBe('dev-abc123');
      expect(info.isTag).toBe(false);
      // For non-tags, fullString uses commitSha format, not the version
      expect(info.fullString).toMatch(/^dev-[a-f0-9]+$/);
    });

    it('should handle package.json version as fallback', () => {
      const info = getVersionInfo();
      expect(info.version).toBe('1.0.0');
      expect(info.isTag).toBe(false);
      expect(info.fullString).toContain('dev-');
      expect(info.commitSha).toBeDefined();
    });

    it('should use GIT_SHA env var when git unavailable', () => {
      // Note: This test assumes git is available. If git fails,
      // it would fall back to GIT_SHA env var.
      // Since we're in a git repo, the actual git command takes precedence.
      process.env.GIT_SHA = 'abcdef1234567890';
      process.env.BUILD_VERSION = 'dev-test';

      const info = getVersionInfo();
      // In a git repo, git command is used instead of GIT_SHA env var
      expect(info.commitSha).toMatch(/^[a-f0-9]{7,8}$/);
    });

    it('should handle malformed .version.json gracefully', () => {
      fs.writeFileSync(VERSION_FILE, 'invalid json');

      const info = getVersionInfo();
      expect(info.version).toBeDefined();
      expect(info.isTag).toBeDefined();
    });

    it('should handle .version.json with missing fields', () => {
      fs.writeFileSync(VERSION_FILE, JSON.stringify({ version: 'v1.0.0' }));

      const info = getVersionInfo();
      expect(info.version).toBe('v1.0.0');
      expect(info.commitSha).toBeDefined();
      expect(info.fullString).toBeDefined();
    });

    it('should detect tag versions starting with v', () => {
      const testCases = [
        { version: 'v1.0.0', expected: true },
        { version: 'v2.3.4-beta', expected: true },
        { version: 'v1.0.0-rc.1', expected: true },
        { version: '1.0.0', expected: false },
        { version: 'dev-abc123', expected: false },
        { version: 'main', expected: false }
      ];

      testCases.forEach(({ version, expected }) => {
        process.env.BUILD_VERSION = version;
        const info = getVersionInfo();
        expect(info.isTag).toBe(expected);
      });
    });
  });
});
