/**
 * ReviewQueueUseCase Unit Tests
 */

const ReviewQueue = require('../../../../src/core/entities/ReviewQueue');
const QueueItem = require('../../../../src/core/entities/QueueItem');
const ReviewQueueUseCase = require('../../../../src/application/use-cases/ReviewQueueUseCase');

describe('ReviewQueueUseCase', () => {
  let useCase;
  let mockRepository;
  let mockEventBus;

  beforeEach(() => {
    mockRepository = {
      getQueue: jest.fn(),
      saveQueue: jest.fn(),
      getAllQueues: jest.fn(),
      loadAllQueues: jest.fn(),
      deleteQueue: jest.fn(),
      // withInstanceLock delegates to getQueue for the callback,
      // matching the real implementation's behavior of reading fresh + saving
      withInstanceLock: jest.fn(async (instanceKey, fn) => {
        const queue = await mockRepository.getQueue(instanceKey);
        const result = await fn(queue);

        // Mimic real withInstanceLock save behavior
        const ReviewQueue = require('../../../../src/core/entities/ReviewQueue');
        let toSave = null;
        if (result instanceof ReviewQueue) toSave = result;
        else if (result?.save instanceof ReviewQueue) toSave = result.save;
        if (toSave) await mockRepository.saveQueue(toSave);

        return result;
      })
    };
    mockEventBus = {
      emitAsync: jest.fn()
    };

    useCase = new ReviewQueueUseCase(
      mockRepository,
      mockEventBus,
      { logger: console, config: {} }
    );
  });

  describe('enqueueReview', () => {
    test('should create new queue if not exists', async () => {
      const instance = { key: 'github/test', queue: { max_size: 2 } };
      const repo = { name: 'repo' };
      const pr = { id: '123', number: 123, title: 'Test PR' };

      mockRepository.getQueue.mockResolvedValue(null);

      await useCase.enqueueReview(instance, repo, pr, 'medium');

      expect(mockRepository.saveQueue).toHaveBeenCalled();
      const savedQueue = mockRepository.saveQueue.mock.calls[0][0];
      expect(savedQueue.instanceKey).toBe('github/test');
      expect(savedQueue.maxSize).toBe(2);
    });

    test('should use default max size when not configured', async () => {
      const instance = { key: 'github/test' };
      const repo = { name: 'repo' };
      const pr = { id: '123', number: 123, title: 'Test PR' };

      mockRepository.getQueue.mockResolvedValue(null);

      await useCase.enqueueReview(instance, repo, pr, 'medium');

      const savedQueue = mockRepository.saveQueue.mock.calls[0][0];
      expect(savedQueue.maxSize).toBe(2); // Default
    });

    test('should enqueue review successfully', async () => {
      const queue = new ReviewQueue('github/test', 2);
      mockRepository.getQueue.mockResolvedValue(queue);

      const instance = { key: 'github/test', queue: { max_size: 2 } };
      const repo = { name: 'repo' };
      const pr = { id: '123', number: 123, title: 'Test PR' };

      const result = await useCase.enqueueReview(instance, repo, pr, 'medium');

      expect(result.success).toBe(true);
      expect(result.position).toBe(1);
      expect(mockRepository.saveQueue).toHaveBeenCalled();
      expect(mockEventBus.emitAsync).toHaveBeenCalledWith(
        'queue.item.enqueued',
        expect.objectContaining({
          instanceKey: 'github/test',
          position: 1
        })
      );
    });

    test('should return estimated wait time when available', async () => {
      const queue = new ReviewQueue('github/test', 2);
      queue.stats.averageProcessingTime = 60000; // 1 minute
      queue.enqueue(new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 100,
        level: 'low'
      }));

      mockRepository.getQueue.mockResolvedValue(queue);

      const instance = { key: 'github/test', queue: { max_size: 2 } };
      const repo = { name: 'repo' };
      const pr = { id: '123', number: 123, title: 'Test PR' };

      const result = await useCase.enqueueReview(instance, repo, pr, 'medium');

      expect(result.estimatedWaitTime).toBe(120000); // 2 items * 1 minute
    });

    test('should reject when queue is full', async () => {
      const queue = new ReviewQueue('github/test', 1);
      queue.enqueue(new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 100,
        level: 'low'
      }));

      mockRepository.getQueue.mockResolvedValue(queue);

      const instance = { key: 'github/test', queue: { max_size: 1 } };
      const repo = { name: 'repo' };
      const pr = { id: '123', number: 123, title: 'Test PR' };

      const result = await useCase.enqueueReview(instance, repo, pr, 'medium');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Queue is full');
      expect(result.maxSize).toBe(1);
      expect(result.currentSize).toBe(1);
      expect(mockRepository.saveQueue).not.toHaveBeenCalled();
    });

    test('should include queue size in result', async () => {
      const queue = new ReviewQueue('github/test', 5);
      queue.enqueue(new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 100,
        level: 'low'
      }));

      mockRepository.getQueue.mockResolvedValue(queue);

      const instance = { key: 'github/test', queue: { max_size: 5 } };
      const repo = { name: 'repo' };
      const pr = { id: '123', number: 123, title: 'Test PR' };

      const result = await useCase.enqueueReview(instance, repo, pr, 'medium');

      expect(result.queueSize).toBe(2); // 1 existing + 1 new
    });
  });

  describe('getQueueStatus', () => {
    test('should return exists false for non-existent queue', async () => {
      mockRepository.getQueue.mockResolvedValue(null);

      const status = await useCase.getQueueStatus('github/test');

      expect(status.exists).toBe(false);
    });

    test('should return queue status', async () => {
      const queue = new ReviewQueue('github/test', 3);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.enqueue(item);
      mockRepository.getQueue.mockResolvedValue(queue);

      const status = await useCase.getQueueStatus('github/test');

      expect(status.exists).toBe(true);
      expect(status.instanceKey).toBe('github/test');
      expect(status.size).toBe(1);
      expect(status.maxSize).toBe(3);
      expect(status.isFull).toBe(false);
      expect(status.isEmpty).toBe(false);
      expect(status.items.length).toBe(1);
      expect(status.items[0].prNumber).toBe(123);
    });

    test('should include stats in status', async () => {
      const queue = new ReviewQueue('github/test', 2);
      queue.stats.totalProcessed = 10;
      queue.stats.totalFailed = 2;
      queue.stats.averageProcessingTime = 75000;

      mockRepository.getQueue.mockResolvedValue(queue);

      const status = await useCase.getQueueStatus('github/test');

      expect(status.stats.totalProcessed).toBe(10);
      expect(status.stats.totalFailed).toBe(2);
      expect(status.stats.averageProcessingTime).toBe(75000);
    });
  });

  describe('cancelQueueItem', () => {
    test('should return error for non-existent queue', async () => {
      mockRepository.getQueue.mockResolvedValue(null);

      const result = await useCase.cancelQueueItem('github/test', 'item-id');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Queue not found');
    });

    test('should return error for non-existent item', async () => {
      const queue = new ReviewQueue('github/test', 2);
      mockRepository.getQueue.mockResolvedValue(queue);

      const result = await useCase.cancelQueueItem('github/test', 'non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Item not found');
    });

    test('should cancel queued item', async () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.enqueue(item);
      mockRepository.getQueue.mockResolvedValue(queue);

      const result = await useCase.cancelQueueItem('github/test', item.id);

      expect(result.success).toBe(true);
      expect(result.item).toBe(item);
      expect(mockRepository.saveQueue).toHaveBeenCalled();
      expect(mockEventBus.emitAsync).toHaveBeenCalledWith(
        'queue.item.cancelled',
        {
          instanceKey: 'github/test',
          itemId: item.id
        }
      );
    });
  });

  describe('pauseQueue', () => {
    test('should pause queue', async () => {
      const queue = new ReviewQueue('github/test', 2);
      mockRepository.getQueue.mockResolvedValue(queue);

      const result = await useCase.pauseQueue('github/test');

      expect(result.success).toBe(true);
      expect(mockRepository.saveQueue).toHaveBeenCalled();
      expect(queue.status).toBe('paused');
      expect(mockEventBus.emitAsync).toHaveBeenCalledWith(
        'queue.paused',
        { instanceKey: 'github/test' }
      );
    });

    test('should return error when queue not found', async () => {
      mockRepository.getQueue.mockResolvedValue(null);

      const result = await useCase.pauseQueue('github/test');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Queue not found');
      expect(mockRepository.saveQueue).not.toHaveBeenCalled();
    });
  });

  describe('resumeQueue', () => {
    test('should resume queue', async () => {
      const queue = new ReviewQueue('github/test', 2);
      queue.pause();
      mockRepository.getQueue.mockResolvedValue(queue);

      const result = await useCase.resumeQueue('github/test');

      expect(result.success).toBe(true);
      expect(mockRepository.saveQueue).toHaveBeenCalled();
      expect(queue.status).toBe('idle');
      expect(mockEventBus.emitAsync).toHaveBeenCalledWith(
        'queue.resumed',
        { instanceKey: 'github/test' }
      );
    });

    test('should return error when queue not found', async () => {
      mockRepository.getQueue.mockResolvedValue(null);

      const result = await useCase.resumeQueue('github/test');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Queue not found');
      expect(mockRepository.saveQueue).not.toHaveBeenCalled();
    });
  });

  describe('dequeueForProcessing', () => {
    test('should return null for non-existent queue', async () => {
      mockRepository.getQueue.mockResolvedValue(null);

      const result = await useCase.dequeueForProcessing('github/test');

      expect(result).toBeNull();
    });

    test('should return null when queue cannot process', async () => {
      const queue = new ReviewQueue('github/test', 2);
      mockRepository.getQueue.mockResolvedValue(queue);

      const result = await useCase.dequeueForProcessing('github/test');

      expect(result).toBeNull();
    });

    test('should return null when dequeue returns null despite canProcess being true', async () => {
      // Edge case: queue.canProcess() returns true but queue.dequeue() returns null
      // This simulates an inconsistent state where items get cleared between checks
      const mockQueue = {
        canProcess: jest.fn().mockReturnValue(true),
        dequeue: jest.fn().mockReturnValue(null)
      };
      mockRepository.getQueue.mockResolvedValue(mockQueue);

      const result = await useCase.dequeueForProcessing('github/test');

      expect(result).toBeNull();
      expect(mockRepository.saveQueue).not.toHaveBeenCalled();
    });

    test('should dequeue and mark as processing', async () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.enqueue(item);
      mockRepository.getQueue.mockResolvedValue(queue);

      const result = await useCase.dequeueForProcessing('github/test');

      expect(result).not.toBeNull();
      expect(result.queue).toBe(queue);
      expect(result.item).toBe(item);
      expect(item.status).toBe('processing');
      expect(item.startedAt).toBeDefined();
      expect(queue.currentItem).toBe(item);
      expect(mockRepository.saveQueue).toHaveBeenCalled();
    });
  });

  describe('completeProcessing', () => {
    test('should complete processing successfully', async () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.startProcessing(item);
      mockRepository.getQueue.mockResolvedValue(queue);

      const result = await useCase.completeProcessing(
        'github/test',
        item.id,
        { success: true },
        60000
      );

      expect(result.success).toBe(true);
      expect(item.status).toBe('completed');
      expect(queue.currentItem).toBeNull();
      expect(queue.stats.totalProcessed).toBe(1);
      expect(queue.stats.averageProcessingTime).toBe(60000);
      expect(mockRepository.saveQueue).toHaveBeenCalled();
    });

    test('should return error for non-existent queue', async () => {
      mockRepository.getQueue.mockResolvedValue(null);

      const result = await useCase.completeProcessing(
        'github/test',
        'item-id',
        { success: true },
        60000
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Queue not found');
    });

    test('should return error when item not current', async () => {
      const queue = new ReviewQueue('github/test', 2);
      mockRepository.getQueue.mockResolvedValue(queue);

      const result = await useCase.completeProcessing(
        'github/test',
        'wrong-item-id',
        { success: true },
        60000
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Item not found as current');
    });
  });

  describe('handleProcessingFailure', () => {
    test('should requeue transient errors', async () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.startProcessing(item);

      // Configure for retries
      useCase.config = { app: { review_queue: { max_retries: 2 } } };

      mockRepository.getQueue.mockResolvedValue(queue);

      const result = await useCase.handleProcessingFailure(
        'github/test',
        item.id,
        new Error('ETIMEDOUT - Connection timeout')
      );

      expect(result.success).toBe(true);
      expect(result.requeued).toBe(true);
      expect(item.retryCount).toBe(1);
      expect(queue.currentItem).toBeNull();
      expect(queue.status).toBe('idle');
      expect(queue.items[0]).toBe(item); // Should be at front of queue
    });

    test('should mark as failed after max retries', async () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.startProcessing(item);
      item.retryCount = 2; // Already at max

      useCase.config = { app: { review_queue: { max_retries: 2 } } };

      mockRepository.getQueue.mockResolvedValue(queue);

      const result = await useCase.handleProcessingFailure(
        'github/test',
        item.id,
        new Error('ETIMEDOUT')
      );

      expect(result.success).toBe(true);
      expect(result.requeued).toBe(false);
      expect(item.status).toBe('failed');
      expect(queue.currentItem).toBeNull();
    });

    test('should mark permanent errors as failed immediately', async () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.startProcessing(item);

      useCase.config = { app: { review_queue: { max_retries: 2 } } };

      mockRepository.getQueue.mockResolvedValue(queue);

      const result = await useCase.handleProcessingFailure(
        'github/test',
        item.id,
        new Error('Permission denied')
      );

      expect(result.success).toBe(true);
      expect(result.requeued).toBe(false);
      expect(item.status).toBe('failed');
      expect(item.error).toBe('Permission denied');
    });

    test('should return success false when queue not found', async () => {
      mockRepository.getQueue.mockResolvedValue(null);

      const result = await useCase.handleProcessingFailure(
        'github/test',
        'item-id',
        new Error('Some error')
      );

      expect(result.success).toBe(false);
      expect(mockRepository.saveQueue).not.toHaveBeenCalled();
    });

    test('should return success false when item is not current', async () => {
      const queue = new ReviewQueue('github/test', 2);
      // No currentItem set, so it's null
      mockRepository.getQueue.mockResolvedValue(queue);

      const result = await useCase.handleProcessingFailure(
        'github/test',
        'non-existent-item-id',
        new Error('Some error')
      );

      expect(result.success).toBe(false);
      expect(mockRepository.saveQueue).not.toHaveBeenCalled();
    });

    test('should return success false when current item id does not match', async () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        level: 'medium'
      });

      queue.startProcessing(item);
      mockRepository.getQueue.mockResolvedValue(queue);

      const result = await useCase.handleProcessingFailure(
        'github/test',
        'wrong-item-id',
        new Error('Some error')
      );

      expect(result.success).toBe(false);
      expect(mockRepository.saveQueue).not.toHaveBeenCalled();
    });
  });

  describe('getAllQueueStatuses', () => {
    test('should return statuses for all queues', async () => {
      const queue1 = new ReviewQueue('github/org1', 2);
      const queue2 = new ReviewQueue('github/org2', 3);

      mockRepository.loadAllQueues.mockResolvedValue([queue1, queue2]);

      const statuses = await useCase.getAllQueueStatuses();

      expect(statuses.length).toBe(2);
      expect(statuses[0].instanceKey).toBe('github/org1');
      expect(statuses[1].instanceKey).toBe('github/org2');
    });
  });

  describe('clearAllQueues', () => {
    test('should clear all queues', async () => {
      const queue1 = new ReviewQueue('github/org1', 2);
      const queue2 = new ReviewQueue('github/org2', 3);

      mockRepository.loadAllQueues.mockResolvedValue([queue1, queue2]);
      mockRepository.deleteQueue.mockResolvedValue(true);

      await useCase.clearAllQueues();

      expect(mockRepository.deleteQueue).toHaveBeenCalledTimes(2);
      expect(mockRepository.deleteQueue).toHaveBeenCalledWith('github/org1');
      expect(mockRepository.deleteQueue).toHaveBeenCalledWith('github/org2');
    });
  });
});
