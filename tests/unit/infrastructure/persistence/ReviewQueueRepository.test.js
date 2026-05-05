/**
 * ReviewQueueRepository Unit Tests
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const ReviewQueue = require('../../../../src/core/entities/ReviewQueue');
const QueueItem = require('../../../../src/core/entities/QueueItem');
const ReviewQueueRepository = require('../../../../src/infrastructure/persistence/ReviewQueueRepository');

describe('ReviewQueueRepository', () => {
  let repository;
  let tempDir;

  beforeEach(async () => {
    // Create a temporary directory for test data
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-test-'));
    repository = new ReviewQueueRepository({ logger: console });
    repository.dataDir = tempDir;
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
    if (repository) {
      repository.clearAllCaches();
    }
  });

  describe('getQueue', () => {
    test('should return null for non-existent queue', async () => {
      const queue = await repository.getQueue('github/nonexistent');

      expect(queue).toBeNull();
    });

    test('should save and load queue', async () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.enqueue(item);
      await repository.saveQueue(queue);

      const loaded = await repository.getQueue('github/test');

      expect(loaded).toBeDefined();
      expect(loaded.instanceKey).toBe('github/test');
      expect(loaded.maxSize).toBe(2);
      expect(loaded.items.length).toBe(1);
      expect(loaded.items[0].prNumber).toBe(123);
      expect(loaded.items[0].level).toBe('medium');
    });

    test('should return cached queue on subsequent calls', async () => {
      const queue = new ReviewQueue('github/test', 2);
      await repository.saveQueue(queue);

      const firstLoad = await repository.getQueue('github/test');
      firstLoad.items.push(new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 456,
        level: 'high'
      }));

      const secondLoad = await repository.getQueue('github/test');

      expect(secondLoad.items.length).toBe(1);
      expect(secondLoad.items[0].prNumber).toBe(456);
    });

    test('should reload from disk after cache clear', async () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.enqueue(item);
      await repository.saveQueue(queue);

      // Modify cached version
      const cached = await repository.getQueue('github/test');
      cached.items.push(new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 789,
        level: 'high'
      }));

      // Clear cache and reload
      repository.clearCache('github/test');
      const reloaded = await repository.getQueue('github/test');

      // Should have original data from disk
      expect(reloaded.items.length).toBe(1);
      expect(reloaded.items[0].prNumber).toBe(123);
    });

    test('should re-throw non-ENOENT errors', async () => {
      const readSpy = jest.spyOn(fs, 'readFile').mockRejectedValue(
        Object.assign(new Error('Permission denied'), { code: 'EACCES' })
      );

      await expect(repository.getQueue('github/test')).rejects.toThrow('Permission denied');
      expect(readSpy).toHaveBeenCalled();
      readSpy.mockRestore();
    });
  });

  describe('saveQueue', () => {
    test('should create directory if not exists', async () => {
      const queue = new ReviewQueue('github/neworg', 2);
      const orgDir = path.join(tempDir, 'github-neworg');

      expect(fsSync.existsSync(orgDir)).toBe(false);

      await repository.saveQueue(queue);

      expect(fsSync.existsSync(orgDir)).toBe(true);
    });

    test('should write queue to file', async () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.enqueue(item);
      await repository.saveQueue(queue);

      const filePath = repository._getQueuePath('github/test');
      const data = await fs.readFile(filePath, 'utf8');
      const json = JSON.parse(data);

      expect(json.instanceKey).toBe('github/test');
      expect(json.items.length).toBe(1);
      expect(json.items[0].prNumber).toBe(123);
    });

    test('should use atomic write (temp file + rename)', async () => {
      const queue = new ReviewQueue('github/test', 2);

      await repository.saveQueue(queue);

      const filePath = repository._getQueuePath('github/test');
      const tempPath = `${filePath}.tmp`;

      // Temp file should be cleaned up after rename
      expect(fsSync.existsSync(tempPath)).toBe(false);
      expect(fsSync.existsSync(filePath)).toBe(true);
    });

    test('should update cache on save', async () => {
      const queue = new ReviewQueue('github/test', 2);

      await repository.saveQueue(queue);

      expect(repository.queues.has('github/test')).toBe(true);
      expect(repository.queues.get('github/test')).toBe(queue);
    });
  });

  describe('getAllQueues', () => {
    test('should return empty array when no queues cached', () => {
      const queues = repository.getAllQueues();

      expect(queues).toEqual([]);
    });

    test('should return all cached queues', async () => {
      const queue1 = new ReviewQueue('github/org1', 2);
      const queue2 = new ReviewQueue('github/org2', 3);

      await repository.saveQueue(queue1);
      await repository.saveQueue(queue2);

      const queues = repository.getAllQueues();

      expect(queues.length).toBe(2);
      expect(queues.some(q => q.instanceKey === 'github/org1')).toBe(true);
      expect(queues.some(q => q.instanceKey === 'github/org2')).toBe(true);
    });
  });

  describe('loadAllQueues', () => {
    test('should load all queues from disk', async () => {
      const queue1 = new ReviewQueue('github/org1', 2);
      const queue2 = new ReviewQueue('github/org2', 3);
      const item = new QueueItem({
        instanceKey: 'github/org1',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue1.enqueue(item);
      await repository.saveQueue(queue1);
      await repository.saveQueue(queue2);

      // Clear cache
      repository.clearAllCaches();

      const queues = await repository.loadAllQueues();

      expect(queues.length).toBe(2);
      expect(queues.some(q => q.instanceKey === 'github/org1')).toBe(true);
      expect(queues.some(q => q.instanceKey === 'github/org2')).toBe(true);
    });

    test('should cache loaded queues', async () => {
      const queue = new ReviewQueue('github/test', 2);
      await repository.saveQueue(queue);

      // Clear cache
      repository.clearAllCaches();

      await repository.loadAllQueues();

      expect(repository.queues.has('github/test')).toBe(true);
    });

    test('should handle missing queue files gracefully', async () => {
      // Create a queue directory without queue file
      const orgDir = path.join(tempDir, 'github-test');
      await fs.mkdir(orgDir, { recursive: true });

      const queues = await repository.loadAllQueues();

      expect(queues).toEqual([]);
    });

    test('should log warning for non-ENOENT file read errors', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const orgDir = path.join(tempDir, 'github-test');
      await fs.mkdir(orgDir, { recursive: true });

      // Write invalid JSON to trigger a parse error (non-ENOENT)
      const queuePath = path.join(orgDir, 'review_queue.json');
      await fs.writeFile(queuePath, 'not valid json', 'utf8');

      const queues = await repository.loadAllQueues();

      expect(queues).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ReviewQueueRepository] Failed to load queue'),
        expect.any(String)
      );
      warnSpy.mockRestore();
    });

    test('should handle errors when reading dataDir', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Point dataDir to a non-existent path to trigger readdir error
      repository.dataDir = path.join(tempDir, 'does-not-exist');

      const queues = await repository.loadAllQueues();

      expect(queues).toEqual([]);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][0]).toContain('[ReviewQueueRepository] Error reading queue directory');
      expect(errorSpy.mock.calls[0][1].message).toContain('ENOENT');
      errorSpy.mockRestore();
    });
  });

  describe('deleteQueue', () => {
    test('should delete queue file', async () => {
      const queue = new ReviewQueue('github/test', 2);
      await repository.saveQueue(queue);

      const filePath = repository._getQueuePath('github/test');
      expect(fsSync.existsSync(filePath)).toBe(true);

      const deleted = await repository.deleteQueue('github/test');

      expect(deleted).toBe(true);
      expect(fsSync.existsSync(filePath)).toBe(false);
    });

    test('should remove from cache', async () => {
      const queue = new ReviewQueue('github/test', 2);
      await repository.saveQueue(queue);

      await repository.deleteQueue('github/test');

      expect(repository.queues.has('github/test')).toBe(false);
    });

    test('should return false when queue does not exist', async () => {
      const deleted = await repository.deleteQueue('github/nonexistent');

      expect(deleted).toBe(false);
    });

    test('should re-throw non-ENOENT errors', async () => {
      const unlinkSpy = jest.spyOn(fs, 'unlink').mockRejectedValue(
        Object.assign(new Error('Permission denied'), { code: 'EACCES' })
      );

      await expect(repository.deleteQueue('github/test')).rejects.toThrow('Permission denied');
      expect(unlinkSpy).toHaveBeenCalled();
      unlinkSpy.mockRestore();
    });
  });

  describe('clearCache', () => {
    test('should clear specific queue from cache', async () => {
      const queue = new ReviewQueue('github/test', 2);
      await repository.saveQueue(queue);

      expect(repository.queues.has('github/test')).toBe(true);

      repository.clearCache('github/test');

      expect(repository.queues.has('github/test')).toBe(false);
    });
  });

  describe('clearAllCaches', () => {
    test('should clear all cached queues', async () => {
      const queue1 = new ReviewQueue('github/org1', 2);
      const queue2 = new ReviewQueue('github/org2', 3);

      await repository.saveQueue(queue1);
      await repository.saveQueue(queue2);

      expect(repository.queues.size).toBe(2);

      repository.clearAllCaches();

      expect(repository.queues.size).toBe(0);
    });
  });

  describe('_getQueuePath', () => {
    test('should convert instance key to file path', () => {
      const filePath = repository._getQueuePath('github/myorg');

      expect(filePath).toContain('github-myorg');
      expect(filePath).toContain('review_queue.json');
    });

    test('should handle nested org names', () => {
      const filePath = repository._getQueuePath('github/org/suborg');

      expect(filePath).toContain('github-org');
      expect(filePath).toContain('review_queue.json');
    });
  });

  describe('withInstanceLock', () => {
    test('should read fresh from disk and save returned queue', async () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });
      queue.enqueue(item);
      await repository.saveQueue(queue);

      const result = await repository.withInstanceLock(
        'github/test',
        async (freshQueue) => {
          // Should have read from disk, not cache
          expect(freshQueue).toBeDefined();
          expect(freshQueue.items.length).toBe(1);
          freshQueue.enqueue(new QueueItem({
            instanceKey: 'github/test',
            repoName: 'repo',
            prNumber: 456,
            level: 'high'
          }));
          return freshQueue;
        }
      );

      expect(result.items.length).toBe(2);

      // Verify saved to disk
      repository.clearCache('github/test');
      const reloaded = await repository.getQueue('github/test');
      expect(reloaded.items.length).toBe(2);
    });

    test('should pass null when queue does not exist on disk', async () => {
      let receivedQueue = 'not-null';
      await repository.withInstanceLock(
        'github/nonexistent',
        async (queue) => {
          receivedQueue = queue;
          return null;
        }
      );

      expect(receivedQueue).toBeNull();
    });

    test('should save queue when callback returns { save: queue }', async () => {
      const result = await repository.withInstanceLock(
        'github/test',
        async (queue) => {
          const newQueue = new ReviewQueue('github/test', 2);
          newQueue.enqueue(new QueueItem({
            instanceKey: 'github/test',
            repoName: 'repo',
            prNumber: 100,
            level: 'low'
          }));
          return { save: newQueue, extraData: 'test' };
        }
      );

      expect(result.extraData).toBe('test');

      // Verify saved
      const loaded = await repository.getQueue('github/test');
      expect(loaded.items.length).toBe(1);
    });

    test('should not save when callback returns non-queue value', async () => {
      const result = await repository.withInstanceLock(
        'github/test',
        async () => {
          return { success: false, error: 'something' };
        }
      );

      expect(result.success).toBe(false);

      // File may exist as a placeholder for proper-lockfile but should not contain queue data
      const filePath = repository._getQueuePath('github/test');
      const data = await fs.readFile(filePath, 'utf8');
      expect(data).toBe('null');
    });

    test('should release lock even when callback throws', async () => {
      await expect(
        repository.withInstanceLock('github/test', async () => {
          throw new Error('callback error');
        })
      ).rejects.toThrow('callback error');

      // Should be able to acquire lock again
      await repository.withInstanceLock('github/test', async () => null);
    });

    test('should serialize concurrent callers', async () => {
      const queue = new ReviewQueue('github/test', 10);
      await repository.saveQueue(queue);

      const concurrentCalls = 5;
      const order = [];

      const promises = Array.from({ length: concurrentCalls }, (_, i) =>
        repository.withInstanceLock('github/test', async (freshQueue) => {
          order.push(`start-${i}`);
          freshQueue.enqueue(new QueueItem({
            instanceKey: 'github/test',
            repoName: 'repo',
            prNumber: i,
            level: 'low'
          }));
          // Small delay to encourage interleaving
          await new Promise(r => setTimeout(r, 10));
          order.push(`end-${i}`);
          return freshQueue;
        })
      );

      await Promise.all(promises);

      // Verify all items were saved (no lost updates)
      repository.clearCache('github/test');
      const finalQueue = await repository.getQueue('github/test');
      expect(finalQueue.items.length).toBe(concurrentCalls);

      // Verify serialization: no start should appear between another start and end
      // (each operation should complete before the next begins)
      for (let i = 0; i < order.length - 1; i += 2) {
        const startMatch = order[i].match(/^start-(\d+)$/);
        const endMatch = order[i + 1].match(/^end-(\d+)$/);
        if (startMatch && endMatch) {
          expect(startMatch[1]).toBe(endMatch[1]);
        }
      }
    });
  });
});
