/**
 * Unit tests for Repository entity
 */

const Repository = require('../../../../src/core/entities/Repository');

describe('Repository Entity', () => {
  describe('constructor', () => {
    it('should create Repository with all fields', () => {
      const repo = new Repository({
        owner: 'myorg',
        name: 'my-repo',
        threadId: 12345,
        instanceKey: 'github/myorg',
        config: { review: true }
      });

      expect(repo.owner).toBe('myorg');
      expect(repo.name).toBe('my-repo');
      expect(repo.threadId).toBe(12345);
      expect(repo.instanceKey).toBe('github/myorg');
      expect(repo.config).toEqual({ review: true });
    });

    it('should default config to empty object', () => {
      const repo = new Repository({
        owner: 'myorg',
        name: 'my-repo',
        threadId: 12345,
        instanceKey: 'github/myorg'
      });

      expect(repo.config).toEqual({});
    });
  });

  describe('getIdentifier', () => {
    it('should return owner/name', () => {
      const repo = new Repository({
        owner: 'myorg',
        name: 'my-repo',
        threadId: 12345,
        instanceKey: 'github/myorg'
      });

      expect(repo.getIdentifier()).toBe('myorg/my-repo');
    });
  });

  describe('getStoragePath', () => {
    it('should replace github/ with github- in instanceKey', () => {
      const repo = new Repository({
        owner: 'myorg',
        name: 'my-repo',
        threadId: 12345,
        instanceKey: 'github/myorg'
      });

      expect(repo.getStoragePath()).toBe('github-myorg/my-repo');
    });
  });

  describe('hasConfig', () => {
    it('should return true when config key exists', () => {
      const repo = new Repository({
        owner: 'myorg',
        name: 'my-repo',
        threadId: 12345,
        instanceKey: 'github/myorg',
        config: { review: true, level: 'high' }
      });

      expect(repo.hasConfig('review')).toBe(true);
    });

    it('should return false when config key does not exist', () => {
      const repo = new Repository({
        owner: 'myorg',
        name: 'my-repo',
        threadId: 12345,
        instanceKey: 'github/myorg'
      });

      expect(repo.hasConfig('review')).toBe(false);
    });
  });

  describe('getConfig', () => {
    it('should return config value when key exists', () => {
      const repo = new Repository({
        owner: 'myorg',
        name: 'my-repo',
        threadId: 12345,
        instanceKey: 'github/myorg',
        config: { level: 'high' }
      });

      expect(repo.getConfig('level')).toBe('high');
    });

    it('should return default value when key does not exist', () => {
      const repo = new Repository({
        owner: 'myorg',
        name: 'my-repo',
        threadId: 12345,
        instanceKey: 'github/myorg'
      });

      expect(repo.getConfig('level', 'low')).toBe('low');
    });

    it('should return null as default when no default provided', () => {
      const repo = new Repository({
        owner: 'myorg',
        name: 'my-repo',
        threadId: 12345,
        instanceKey: 'github/myorg'
      });

      expect(repo.getConfig('missing')).toBeNull();
    });
  });

  describe('toJSON', () => {
    it('should return plain object with all fields', () => {
      const repo = new Repository({
        owner: 'myorg',
        name: 'my-repo',
        threadId: 12345,
        instanceKey: 'github/myorg',
        config: { review: true }
      });

      const json = repo.toJSON();

      expect(json).toEqual({
        owner: 'myorg',
        name: 'my-repo',
        threadId: 12345,
        instanceKey: 'github/myorg',
        config: { review: true }
      });
    });
  });
});
