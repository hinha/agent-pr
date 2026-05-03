/**
 * QueueItem Unit Tests
 */

const QueueItem = require('../../../../src/core/entities/QueueItem');

describe('QueueItem', () => {
  describe('constructor', () => {
    test('should create item with auto-generated ID', () => {
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      expect(item.id).toBeDefined();
      expect(item.id).toMatch(/^qi_\d+_[a-z0-9]+$/);
    });

    test('should create item with provided ID', () => {
      const item = new QueueItem({
        id: 'custom-id',
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      expect(item.id).toBe('custom-id');
    });

    test('should set default status to queued', () => {
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      expect(item.status).toBe('queued');
    });

    test('should set requestedAt timestamp by default', () => {
      const before = Date.now();
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });
      const after = Date.now();

      expect(item.requestedAt).toBeDefined();
      expect(new Date(item.requestedAt).getTime()).toBeGreaterThanOrEqual(before);
      expect(new Date(item.requestedAt).getTime()).toBeLessThanOrEqual(after);
    });
  });

  describe('markAsProcessing', () => {
    test('should mark item as processing with timestamp', () => {
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      const before = Date.now();
      item.markAsProcessing();
      const after = Date.now();

      expect(item.status).toBe('processing');
      expect(item.startedAt).toBeDefined();
      expect(new Date(item.startedAt).getTime()).toBeGreaterThanOrEqual(before);
      expect(new Date(item.startedAt).getTime()).toBeLessThanOrEqual(after);
    });
  });

  describe('markAsCompleted', () => {
    test('should mark item as completed with timestamp', () => {
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      item.markAsProcessing();
      const before = Date.now();
      item.markAsCompleted();
      const after = Date.now();

      expect(item.status).toBe('completed');
      expect(item.completedAt).toBeDefined();
      expect(new Date(item.completedAt).getTime()).toBeGreaterThanOrEqual(before);
      expect(new Date(item.completedAt).getTime()).toBeLessThanOrEqual(after);
    });
  });

  describe('markAsFailed', () => {
    test('should mark item as failed with error message', () => {
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      const errorMessage = 'Test error message';
      item.markAsProcessing();
      item.markAsFailed(errorMessage);

      expect(item.status).toBe('failed');
      expect(item.error).toBe(errorMessage);
      expect(item.completedAt).toBeDefined();
    });
  });

  describe('getDuration', () => {
    test('should return null if not completed', () => {
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      expect(item.getDuration()).toBeNull();
    });

    test('should return null if started but not completed', () => {
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      item.markAsProcessing();
      expect(item.getDuration()).toBeNull();
    });

    test('should return duration in milliseconds when completed', async () => {
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      item.markAsProcessing();
      await new Promise(resolve => setTimeout(resolve, 10));
      item.markAsCompleted();

      const duration = item.getDuration();
      expect(duration).toBeGreaterThanOrEqual(10);
      expect(duration).toBeLessThan(100);
    });
  });

  describe('isTerminal', () => {
    test('should return false for queued status', () => {
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      expect(item.isTerminal()).toBe(false);
    });

    test('should return false for processing status', () => {
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      item.markAsProcessing();
      expect(item.isTerminal()).toBe(false);
    });

    test('should return true for completed status', () => {
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      item.markAsProcessing();
      item.markAsCompleted();
      expect(item.isTerminal()).toBe(true);
    });

    test('should return true for failed status', () => {
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      item.markAsProcessing();
      item.markAsFailed('Test error');
      expect(item.isTerminal()).toBe(true);
    });
  });

  describe('toJSON', () => {
    test('should serialize all properties', () => {
      const item = new QueueItem({
        id: 'test-id',
        instanceKey: 'github/test',
        repoName: 'repo',
        prId: 'pr-123',
        prNumber: 123,
        prTitle: 'Test PR',
        level: 'medium'
      });

      const json = item.toJSON();

      expect(json).toEqual({
        id: 'test-id',
        instanceKey: 'github/test',
        repoName: 'repo',
        prId: 'pr-123',
        prNumber: 123,
        prTitle: 'Test PR',
        level: 'medium',
        status: 'queued',
        requestedAt: item.requestedAt,
        startedAt: null,
        completedAt: null,
        error: null,
        retryCount: 0
      });
    });
  });

  describe('fromJSON', () => {
    test('should deserialize from JSON', () => {
      const json = {
        id: 'qi_test',
        instanceKey: 'github/test',
        repoName: 'repo',
        prId: 'pr-123',
        prNumber: 123,
        prTitle: 'Test PR',
        level: 'medium',
        status: 'queued',
        requestedAt: '2026-05-03T10:00:00.000Z',
        startedAt: null,
        completedAt: null,
        error: null,
        retryCount: 0
      };

      const item = QueueItem.fromJSON(json);

      expect(item.id).toBe('qi_test');
      expect(item.instanceKey).toBe('github/test');
      expect(item.repoName).toBe('repo');
      expect(item.prId).toBe('pr-123');
      expect(item.prNumber).toBe(123);
      expect(item.prTitle).toBe('Test PR');
      expect(item.level).toBe('medium');
      expect(item.status).toBe('queued');
      expect(item.requestedAt).toBe('2026-05-03T10:00:00.000Z');
      expect(item.retryCount).toBe(0);
    });

    test('should handle missing optional fields', () => {
      const json = {
        id: 'qi_test',
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium',
        status: 'queued',
        requestedAt: '2026-05-03T10:00:00.000Z',
        prId: undefined,
        prTitle: undefined
      };

      const item = QueueItem.fromJSON(json);

      expect(item.prId).toBeUndefined();
      expect(item.prTitle).toBe('');
      expect(item.startedAt).toBeNull();
      expect(item.completedAt).toBeNull();
      expect(item.error).toBeNull();
      expect(item.retryCount).toBe(0);
    });
  });

  describe('serialization round-trip', () => {
    test('should survive toJSON -> fromJSON round-trip', () => {
      const original = new QueueItem({
        id: 'test-id',
        instanceKey: 'github/test',
        repoName: 'repo',
        prId: 'pr-123',
        prNumber: 123,
        prTitle: 'Test PR',
        level: 'high'
      });

      original.markAsProcessing();
      original.markAsFailed('Network error');

      const json = original.toJSON();
      const restored = QueueItem.fromJSON(json);

      expect(restored.id).toBe(original.id);
      expect(restored.instanceKey).toBe(original.instanceKey);
      expect(restored.repoName).toBe(original.repoName);
      expect(restored.prNumber).toBe(original.prNumber);
      expect(restored.level).toBe(original.level);
      expect(restored.status).toBe(original.status);
      expect(restored.error).toBe(original.error);
      expect(restored.startedAt).toBe(original.startedAt);
      expect(restored.completedAt).toBe(original.completedAt);
    });
  });
});
