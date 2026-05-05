/**
 * ReviewQueue Unit Tests
 */

const ReviewQueue = require('../../../../src/core/entities/ReviewQueue');
const QueueItem = require('../../../../src/core/entities/QueueItem');

describe('ReviewQueue', () => {
  describe('constructor', () => {
    test('should create queue with instance key and max size', () => {
      const queue = new ReviewQueue('github/test', 3);

      expect(queue.instanceKey).toBe('github/test');
      expect(queue.maxSize).toBe(3);
      expect(queue.status).toBe('idle');
      expect(queue.currentItem).toBeNull();
      expect(queue.items).toEqual([]);
      expect(queue.stats.totalProcessed).toBe(0);
      expect(queue.stats.totalFailed).toBe(0);
      expect(queue.stats.averageProcessingTime).toBe(0);
    });

    test('should use default max size of 2', () => {
      const queue = new ReviewQueue('github/test');

      expect(queue.maxSize).toBe(2);
    });
  });

  describe('enqueue', () => {
    test('should add item to queue', () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.enqueue(item);

      expect(queue.items.length).toBe(1);
      expect(queue.items[0]).toBe(item);
    });

    test('should throw error when queue is full', () => {
      const queue = new ReviewQueue('github/test', 1);
      const item1 = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });
      const item2 = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 124,
        level: 'medium'
      });

      queue.enqueue(item1);

      expect(() => queue.enqueue(item2)).toThrow('Queue is full (max: 1)');
    });

    test('should update updatedAt timestamp', async () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      const before = Date.now();
      await new Promise(resolve => setTimeout(resolve, 1)); // Small delay
      queue.enqueue(item);
      const after = Date.now();

      const updatedAtTime = new Date(queue.updatedAt).getTime();
      expect(updatedAtTime).toBeGreaterThanOrEqual(before);
      expect(updatedAtTime).toBeLessThanOrEqual(after);
    });
  });

  describe('dequeue', () => {
    test('should remove and return first item', () => {
      const queue = new ReviewQueue('github/test', 2);
      const item1 = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });
      const item2 = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 124,
        level: 'medium'
      });

      queue.enqueue(item1);
      queue.enqueue(item2);

      const dequeued = queue.dequeue();

      expect(dequeued).toBe(item1);
      expect(queue.items.length).toBe(1);
      expect(queue.items[0]).toBe(item2);
    });

    test('should return null when queue is empty', () => {
      const queue = new ReviewQueue('github/test', 2);

      const dequeued = queue.dequeue();

      expect(dequeued).toBeNull();
    });
  });

  describe('peek', () => {
    test('should return first item without removing it', () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.enqueue(item);

      const peeked = queue.peek();

      expect(peeked).toBe(item);
      expect(queue.items.length).toBe(1);
    });

    test('should return null when queue is empty', () => {
      const queue = new ReviewQueue('github/test', 2);

      const peeked = queue.peek();

      expect(peeked).toBeNull();
    });
  });

  describe('getPosition', () => {
    test('should return 1-indexed position of item', () => {
      const queue = new ReviewQueue('github/test', 3);
      const item1 = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });
      const item2 = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 124,
        level: 'medium'
      });

      queue.enqueue(item1);
      queue.enqueue(item2);

      expect(queue.getPosition(item1.id)).toBe(1);
      expect(queue.getPosition(item2.id)).toBe(2);
    });

    test('should return 0 when item not found', () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.enqueue(item);

      expect(queue.getPosition('non-existent-id')).toBe(0);
    });
  });

  describe('isFull', () => {
    test('should return false when empty', () => {
      const queue = new ReviewQueue('github/test', 2);

      expect(queue.isFull()).toBe(false);
    });

    test('should return false when not at capacity', () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.enqueue(item);

      expect(queue.isFull()).toBe(false);
    });

    test('should return true when at capacity', () => {
      const queue = new ReviewQueue('github/test', 1);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.enqueue(item);

      expect(queue.isFull()).toBe(true);
    });
  });

  describe('isEmpty', () => {
    test('should return true when empty', () => {
      const queue = new ReviewQueue('github/test', 2);

      expect(queue.isEmpty()).toBe(true);
    });

    test('should return false when has items', () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.enqueue(item);

      expect(queue.isEmpty()).toBe(false);
    });

    test('should return false when processing current item', () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.startProcessing(item);

      expect(queue.isEmpty()).toBe(false);
    });
  });

  describe('canProcess', () => {
    test('should return true when items available and not processing', () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.enqueue(item);

      expect(queue.canProcess()).toBe(true);
    });

    test('should return false when no items', () => {
      const queue = new ReviewQueue('github/test', 2);

      expect(queue.canProcess()).toBe(false);
    });

    test('should return false when already processing', () => {
      const queue = new ReviewQueue('github/test', 2);
      const item1 = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });
      const item2 = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 124,
        level: 'medium'
      });

      queue.enqueue(item2);
      queue.startProcessing(item1);

      expect(queue.canProcess()).toBe(false);
    });

    test('should return false when paused', () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.enqueue(item);
      queue.pause();

      expect(queue.canProcess()).toBe(false);
    });
  });

  describe('getEstimatedWaitTime', () => {
    test('should return null when queue is empty', () => {
      const queue = new ReviewQueue('github/test', 2);

      expect(queue.getEstimatedWaitTime()).toBeNull();
    });

    test('should return null when no average time', () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.enqueue(item);

      expect(queue.getEstimatedWaitTime()).toBeNull();
    });

    test('should calculate based on items and current item', () => {
      const queue = new ReviewQueue('github/test', 3);
      queue.stats.averageProcessingTime = 60000; // 1 minute

      const item1 = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });
      const item2 = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 124,
        level: 'medium'
      });

      queue.enqueue(item1);
      queue.enqueue(item2);

      expect(queue.getEstimatedWaitTime()).toBe(120000); // 2 items * 1 minute
    });

    test('should include current item in calculation', () => {
      const queue = new ReviewQueue('github/test', 3);
      queue.stats.averageProcessingTime = 60000; // 1 minute

      const currentItem = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });
      const queuedItem = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 124,
        level: 'medium'
      });

      queue.startProcessing(currentItem);
      queue.enqueue(queuedItem);

      expect(queue.getEstimatedWaitTime()).toBe(120000); // 2 items * 1 minute
    });
  });

  describe('startProcessing', () => {
    test('should set current item and status', () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.startProcessing(item);

      expect(queue.currentItem).toBe(item);
      expect(queue.status).toBe('processing');
      expect(item.status).toBe('processing');
      expect(item.startedAt).toBeDefined();
    });
  });

  describe('completeProcessing', () => {
    test('should clear current item and mark as completed', () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.startProcessing(item);
      queue.completeProcessing(item, true);

      expect(queue.currentItem).toBeNull();
      expect(queue.status).toBe('idle');
      expect(item.status).toBe('completed');
      expect(item.completedAt).toBeDefined();
      expect(queue.stats.totalProcessed).toBe(1);
    });

    test('should mark as failed when success is false', () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.startProcessing(item);
      item.error = 'Test error';
      queue.completeProcessing(item, false);

      expect(item.status).toBe('failed');
      expect(queue.stats.totalFailed).toBe(1);
      expect(queue.stats.totalProcessed).toBe(0);
    });
  });

  describe('updateAverageProcessingTime', () => {
    test('should set average on first completion', () => {
      const queue = new ReviewQueue('github/test', 2);

      queue.updateAverageProcessingTime(60000);

      expect(queue.stats.averageProcessingTime).toBe(60000);
    });

    test('should calculate running average', () => {
      const queue = new ReviewQueue('github/test', 2);
      queue.stats.totalProcessed = 1;

      queue.updateAverageProcessingTime(60000);

      expect(queue.stats.averageProcessingTime).toBe(60000);

      queue.stats.totalProcessed = 2;
      queue.updateAverageProcessingTime(120000);

      expect(queue.stats.averageProcessingTime).toBe(90000); // (60000 + 120000) / 2
    });
  });

  describe('pause/resume', () => {
    test('should pause queue', () => {
      const queue = new ReviewQueue('github/test', 2);

      queue.pause();

      expect(queue.status).toBe('paused');
    });

    test('should resume queue', () => {
      const queue = new ReviewQueue('github/test', 2);

      queue.pause();
      queue.resume();

      expect(queue.status).toBe('idle');
    });
  });

  describe('getAllItems', () => {
    test('should return empty array when no items', () => {
      const queue = new ReviewQueue('github/test', 2);

      expect(queue.getAllItems()).toEqual([]);
    });

    test('should return only queued items when no current item', () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.enqueue(item);

      expect(queue.getAllItems()).toEqual([item]);
    });

    test('should return current item plus queued items', () => {
      const queue = new ReviewQueue('github/test', 2);
      const item1 = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });
      const item2 = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 124,
        level: 'medium'
      });

      queue.enqueue(item2);
      queue.startProcessing(item1);

      expect(queue.getAllItems()).toEqual([item1, item2]);
    });
  });

  describe('clear', () => {
    test('should clear items but keep stats', () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.enqueue(item);
      queue.stats.totalProcessed = 5;

      queue.clear();

      expect(queue.items).toEqual([]);
      expect(queue.currentItem).toBeNull();
      expect(queue.status).toBe('idle');
      expect(queue.stats.totalProcessed).toBe(5);
    });
  });

  describe('toJSON', () => {
    test('should serialize queue to JSON', () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        id: 'qi_test',
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        prTitle: 'Test PR',
        level: 'medium'
      });

      queue.enqueue(item);

      const json = queue.toJSON();

      expect(json).toEqual({
        instanceKey: 'github/test',
        maxSize: 2,
        status: 'idle',
        currentItem: null,
        items: [item.toJSON()],
        stats: {
          totalProcessed: 0,
          totalFailed: 0,
          averageProcessingTime: 0
        },
        updatedAt: queue.updatedAt
      });
    });
  });

  describe('fromJSON', () => {
    test('should deserialize queue from JSON', () => {
      const json = {
        instanceKey: 'github/test',
        maxSize: 3,
        status: 'idle',
        currentItem: null,
        items: [
          {
            id: 'qi_test1',
            instanceKey: 'github/test',
            repoName: 'repo',
            prNumber: 123,
            prTitle: 'Test PR',
            level: 'medium',
            status: 'queued',
            requestedAt: '2026-05-03T10:00:00.000Z',
            startedAt: null,
            completedAt: null,
            error: null,
            retryCount: 0
          }
        ],
        stats: {
          totalProcessed: 10,
          totalFailed: 2,
          averageProcessingTime: 60000
        },
        updatedAt: '2026-05-03T11:00:00.000Z'
      };

      const queue = ReviewQueue.fromJSON(json);

      expect(queue.instanceKey).toBe('github/test');
      expect(queue.maxSize).toBe(3);
      expect(queue.status).toBe('idle');
      expect(queue.items.length).toBe(1);
      expect(queue.items[0].prNumber).toBe(123);
      expect(queue.stats.totalProcessed).toBe(10);
      expect(queue.stats.totalFailed).toBe(2);
      expect(queue.stats.averageProcessingTime).toBe(60000);
    });

    test('should handle current item', () => {
      const json = {
        instanceKey: 'github/test',
        maxSize: 2,
        status: 'processing',
        currentItem: {
          id: 'qi_current',
          instanceKey: 'github/test',
          repoName: 'repo',
          prNumber: 456,
          level: 'high',
          status: 'processing',
          requestedAt: '2026-05-03T10:00:00.000Z',
          startedAt: '2026-05-03T10:05:00.000Z',
          completedAt: null,
          error: null,
          retryCount: 0
        },
        items: [],
        stats: {
          totalProcessed: 5,
          totalFailed: 1,
          averageProcessingTime: 90000
        },
        updatedAt: '2026-05-03T11:00:00.000Z'
      };

      const queue = ReviewQueue.fromJSON(json);

      expect(queue.currentItem).toBeDefined();
      expect(queue.currentItem.prNumber).toBe(456);
      expect(queue.currentItem.status).toBe('processing');
      expect(queue.status).toBe('processing');
    });
  });

  describe('serialization round-trip', () => {
    test('should survive toJSON -> fromJSON round-trip', () => {
      const original = new ReviewQueue('github/test', 3);
      const item1 = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });
      const item2 = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 124,
        level: 'high'
      });

      original.enqueue(item1);
      original.enqueue(item2);
      original.stats.totalProcessed = 7;
      original.stats.averageProcessingTime = 75000;

      const json = original.toJSON();
      const restored = ReviewQueue.fromJSON(json);

      expect(restored.instanceKey).toBe(original.instanceKey);
      expect(restored.maxSize).toBe(original.maxSize);
      expect(restored.status).toBe(original.status);
      expect(restored.items.length).toBe(2);
      expect(restored.items[0].prNumber).toBe(123);
      expect(restored.items[1].prNumber).toBe(124);
      expect(restored.stats.totalProcessed).toBe(7);
      expect(restored.stats.averageProcessingTime).toBe(75000);
    });
  });
});
