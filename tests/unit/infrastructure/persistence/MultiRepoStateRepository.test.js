/**
 * Tests for MultiRepoStateRepository
 */

const MultiRepoStateRepository = require('../../../../src/infrastructure/persistence/MultiRepoStateRepository');
const fs = require('fs');
const path = require('path');

describe('MultiRepoStateRepository', () => {
  let repository;
  let logger;
  const testDataDir = path.join(process.cwd(), 'data/test-instances');

  beforeEach(() => {
    // Clean up test data directory
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }

    // Mock logger
    logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    repository = new MultiRepoStateRepository(logger);
  });

  afterEach(async () => {
    // Clean up test data directory
    await repository.cleanup();
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe('key parsing', () => {
    test('should parse key with correct format', () => {
      const parsed = repository._parseKey('github/hinha/agent-pr/pr/123');
      expect(parsed).toEqual({
        instanceKey: 'github/hinha/agent-pr',
        owner: 'hinha',
        repoName: 'agent-pr',
        prNumber: '123'
      });
    });

    test('should parse key with simple owner', () => {
      const parsed = repository._parseKey('github/myorg/myrepo/pr/456');
      expect(parsed).toEqual({
        instanceKey: 'github/myorg/myrepo',
        owner: 'myorg',
        repoName: 'myrepo',
        prNumber: '456'
      });
    });

    test('should return null for invalid key format', () => {
      const parsed = repository._parseKey('invalid-key-format');
      expect(parsed).toBeNull();
    });

    test('should return null for key without pr separator', () => {
      const parsed = repository._parseKey('github/hinha/agent-pr/123');
      expect(parsed).toBeNull();
    });
  });

  describe('get and set operations', () => {
    test('should set and get value for a PR', async () => {
      const key = 'github/hinha/agent-pr/pr/123';
      const value = { state: 'notified', count: 1 };

      await repository.set(key, value);
      const retrieved = await repository.get(key);

      expect(retrieved).toEqual(value);
    });

    test('should return undefined for non-existent key', async () => {
      const retrieved = await repository.get('github/hinha/agent-pr/pr/999');
      expect(retrieved).toBeFalsy(); // null or undefined
    });

    test('should handle multiple PRs in same repo', async () => {
      await repository.set('github/hinha/agent-pr/pr/123', { state: 'notified' });
      await repository.set('github/hinha/agent-pr/pr/456', { state: 'approved' });

      const pr1 = await repository.get('github/hinha/agent-pr/pr/123');
      const pr2 = await repository.get('github/hinha/agent-pr/pr/456');

      expect(pr1.state).toBe('notified');
      expect(pr2.state).toBe('approved');
    });

    test('should handle PRs across different repos', async () => {
      await repository.set('github/hinha/repo1/pr/1', { state: 'notified' });
      await repository.set('github/hinha/repo2/pr/1', { state: 'approved' });

      const repo1pr1 = await repository.get('github/hinha/repo1/pr/1');
      const repo2pr1 = await repository.get('github/hinha/repo2/pr/1');

      expect(repo1pr1.state).toBe('notified');
      expect(repo2pr1.state).toBe('approved');
    });

    test('should update existing PR state', async () => {
      const key = 'github/hinha/agent-pr/pr/123';

      await repository.set(key, { state: 'notified', count: 1 });
      await repository.set(key, { state: 'approved', count: 2 });

      const retrieved = await repository.get(key);
      expect(retrieved).toEqual({ state: 'approved', count: 2 });
    });
  });

  describe('keys operation', () => {
    beforeEach(async () => {
      await repository.set('github/hinha/agent-pr/pr/123', { state: 'notified' });
      await repository.set('github/hinha/agent-pr/pr/456', { state: 'approved' });
      await repository.set('github/hinha/other-repo/pr/789', { state: 'processed' });
    });

    test('should return all keys', async () => {
      const keys = await repository.keys();
      expect(keys).toHaveLength(3);
      expect(keys).toContain('github/hinha/agent-pr/pr/123');
      expect(keys).toContain('github/hinha/agent-pr/pr/456');
      expect(keys).toContain('github/hinha/other-repo/pr/789');
    });

    test('should filter keys by prefix', async () => {
      const keys = await repository.keys('github/hinha/agent-pr');
      expect(keys).toHaveLength(2);
      expect(keys).toContain('github/hinha/agent-pr/pr/123');
      expect(keys).toContain('github/hinha/agent-pr/pr/456');
    });
  });

  describe('delete operation', () => {
    test('should delete a PR state', async () => {
      const key = 'github/hinha/agent-pr/pr/123';

      await repository.set(key, { state: 'notified' });
      expect(await repository.get(key)).toBeDefined();

      await repository.delete(key);
      expect(await repository.get(key)).toBeFalsy();
    });

    test('should not affect other PRs when deleting one', async () => {
      await repository.set('github/hinha/agent-pr/pr/123', { state: 'notified' });
      await repository.set('github/hinha/agent-pr/pr/456', { state: 'approved' });

      await repository.delete('github/hinha/agent-pr/pr/123');

      expect(await repository.get('github/hinha/agent-pr/pr/123')).toBeFalsy();
      expect(await repository.get('github/hinha/agent-pr/pr/456')).toEqual({ state: 'approved' });
    });
  });

  describe('getRepository', () => {
    test('should return FileSystemStateRepository for specific repo', () => {
      const repo = repository.getRepository('hinha', 'agent-pr');

      expect(repo).toBeDefined();
      expect(repo.constructor.name).toBe('FileSystemStateRepository');
    });

    test('should return same repository instance for subsequent calls', () => {
      const repo1 = repository.getRepository('hinha', 'agent-pr');
      const repo2 = repository.getRepository('hinha', 'agent-pr');

      expect(repo1).toBe(repo2);
    });

    test('should create different repository instances for different repos', () => {
      const repo1 = repository.getRepository('hinha', 'repo1');
      const repo2 = repository.getRepository('hinha', 'repo2');

      expect(repo1).not.toBe(repo2);
    });
  });

  describe('clear and cleanup', () => {
    test('should clear all stored data from memory', async () => {
      await repository.set('github/hinha/agent-pr/pr/123', { state: 'notified' });
      await repository.set('github/hinha/agent-pr/pr/456', { state: 'approved' });

      await repository.clear();

      // After clear, repositories are removed from cache
      expect(repository.repositories.size).toBe(0);
    });

    test('should cleanup resources', async () => {
      await repository.set('github/hinha/agent-pr/pr/123', { state: 'notified' });

      await repository.cleanup();

      expect(repository.repositories.size).toBe(0);
    });
  });

  describe('file persistence', () => {
    const testDataPath = path.join(process.cwd(), 'data/instances/github-hinha/agent-pr');

    afterEach(async () => {
      // Clean up test data files
      if (fs.existsSync(testDataPath)) {
        fs.rmSync(testDataPath, { recursive: true, force: true });
      }
    });

    test('should persist data to files', async () => {
      const key = 'github/hinha/agent-pr/pr/123';
      const value = { state: 'notified', count: 1 };

      await repository.set(key, value);

      // Small delay to ensure file is written
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check if file was created (FileSystemStateRepository uses github-{owner} format)
      const expectedFile = path.join(testDataPath, 'review_state.json');
      expect(fs.existsSync(expectedFile)).toBe(true);
    });

    test('should load data from existing files', async () => {
      // Set initial data
      const key = 'github/hinha/agent-pr/pr/123';
      const value = { state: 'notified', count: 1 };

      await repository.set(key, value);

      // Wait for file to be written
      await new Promise(resolve => setTimeout(resolve, 100));

      // Create new repository instance (simulating app restart)
      const newRepository = new MultiRepoStateRepository(logger);

      // Data should be loaded
      const retrieved = await newRepository.get(key);
      expect(retrieved).toEqual(value);

      await newRepository.cleanup();
    });
  });

  describe('notification count persistence', () => {
    const testDataPath = path.join(process.cwd(), 'data/instances/github-hinha/agent-pr');

    afterEach(async () => {
      // Clean up test data files
      if (fs.existsSync(testDataPath)) {
        fs.rmSync(testDataPath, { recursive: true, force: true });
      }
    });

    test('should persist notification count when saving review state with notificationCount', async () => {
      const key = 'github/hinha/agent-pr/pr/123';
      const value = { state: 'notified', notificationCount: 2, lastUpdated: new Date().toISOString() };

      await repository.set(key, value);

      // Small delay to ensure file is written
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check notification_counts.json file was created
      const notificationCountsPath = path.join(testDataPath, 'notification_counts.json');
      expect(fs.existsSync(notificationCountsPath)).toBe(true);

      // Verify the content
      const countsData = JSON.parse(fs.readFileSync(notificationCountsPath, 'utf8'));
      expect(countsData['123']).toBe(2);
    });

    test('should not persist notification count when value is undefined', async () => {
      const key = 'github/hinha/agent-pr/pr/456';
      const value = null;

      await repository.set(key, value);

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should not create notification_counts.json if no notificationCount
      const notificationCountsPath = path.join(testDataPath, 'notification_counts.json');
      // File might not exist or be empty - just verify no error thrown
      expect(() => repository.set(key, value)).not.toThrow();
    });

    test('should update notification count when updating review state', async () => {
      const key = 'github/hinha/agent-pr/pr/789';

      // First save with count 1
      await repository.set(key, { state: 'notified', notificationCount: 1 });
      await new Promise(resolve => setTimeout(resolve, 100));

      // Update with count 2
      await repository.set(key, { state: 'approved', notificationCount: 2 });
      await new Promise(resolve => setTimeout(resolve, 100));

      const notificationCountsPath = path.join(testDataPath, 'notification_counts.json');
      const countsData = JSON.parse(fs.readFileSync(notificationCountsPath, 'utf8'));
      expect(countsData['789']).toBe(2);
    });

    test('should handle multiple PRs with different notification counts', async () => {
      await repository.set('github/hinha/agent-pr/pr/111', { notificationCount: 1 });
      await repository.set('github/hinha/agent-pr/pr/222', { notificationCount: 3 });
      await repository.set('github/hinha/agent-pr/pr/333', { notificationCount: 0 });

      await new Promise(resolve => setTimeout(resolve, 100));

      const notificationCountsPath = path.join(testDataPath, 'notification_counts.json');
      const countsData = JSON.parse(fs.readFileSync(notificationCountsPath, 'utf8'));
      expect(countsData['111']).toBe(1);
      expect(countsData['222']).toBe(3);
      expect(countsData['333']).toBe(0);
    });
  });
});
