/**
 * Unit tests for SimpleKeyMapStateRepository
 */

const SimpleKeyMapStateRepository = require('../../../../src/infrastructure/persistence/SimpleKeyMapStateRepository');

describe('SimpleKeyMapStateRepository', () => {
  let repo;

  beforeEach(() => {
    repo = new SimpleKeyMapStateRepository();
  });

  describe('set and get', () => {
    it('should store and retrieve a value', async () => {
      await repo.set('key1', { data: 'value1' });
      const result = await repo.get('key1');

      expect(result).toEqual({ data: 'value1' });
    });

    it('should return undefined for non-existent key', async () => {
      const result = await repo.get('missing');
      expect(result).toBeUndefined();
    });

    it('should overwrite existing value', async () => {
      await repo.set('key1', 'old');
      await repo.set('key1', 'new');

      expect(await repo.get('key1')).toBe('new');
    });
  });

  describe('keys', () => {
    it('should return all keys when no prefix given', async () => {
      await repo.set('github/org1:repo1:123', {});
      await repo.set('github/org1:repo2:456', {});
      await repo.set('github/org2:repo1:789', {});

      const keys = await repo.keys();

      expect(keys).toHaveLength(3);
      expect(keys).toContain('github/org1:repo1:123');
    });

    it('should filter keys by prefix', async () => {
      await repo.set('github/org1:repo1:123', {});
      await repo.set('github/org1:repo2:456', {});
      await repo.set('github/org2:repo1:789', {});

      const keys = await repo.keys('github/org1:repo1');

      expect(keys).toHaveLength(1);
      expect(keys).toContain('github/org1:repo1:123');
    });

    it('should return empty array when no keys match prefix', async () => {
      await repo.set('github/org1:repo1:123', {});

      const keys = await repo.keys('github/org9');

      expect(keys).toEqual([]);
    });

    it('should return empty array when store is empty', async () => {
      const keys = await repo.keys();
      expect(keys).toEqual([]);
    });
  });

  describe('delete', () => {
    it('should remove a key', async () => {
      await repo.set('key1', 'value1');
      await repo.delete('key1');

      expect(await repo.get('key1')).toBeUndefined();
    });

    it('should not throw for non-existent key', async () => {
      await expect(repo.delete('missing')).resolves.not.toThrow();
    });
  });

  describe('clear', () => {
    it('should remove all keys', async () => {
      await repo.set('key1', 'a');
      await repo.set('key2', 'b');
      await repo.clear();

      expect(await repo.get('key1')).toBeUndefined();
      expect(await repo.get('key2')).toBeUndefined();
      expect(await repo.size()).toBe(0);
    });
  });

  describe('size', () => {
    it('should return 0 for empty store', async () => {
      expect(await repo.size()).toBe(0);
    });

    it('should return correct count after additions', async () => {
      await repo.set('key1', 'a');
      await repo.set('key2', 'b');

      expect(await repo.size()).toBe(2);
    });

    it('should update after deletion', async () => {
      await repo.set('key1', 'a');
      await repo.set('key2', 'b');
      await repo.delete('key1');

      expect(await repo.size()).toBe(1);
    });
  });

  describe('cleanup', () => {
    it('should clear all data', async () => {
      await repo.set('key1', 'a');
      await repo.set('key2', 'b');
      await repo.cleanup();

      expect(await repo.size()).toBe(0);
    });
  });
});
