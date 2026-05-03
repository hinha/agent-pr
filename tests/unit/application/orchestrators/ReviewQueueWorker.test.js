/**
 * ReviewQueueWorker Unit Tests
 */

const ReviewQueue = require('../../../../src/core/entities/ReviewQueue');
const QueueItem = require('../../../../src/core/entities/QueueItem');
const ReviewQueueWorker = require('../../../../src/application/orchestrators/ReviewQueueWorker');

describe('ReviewQueueWorker', () => {
  let worker;
  let mockRepository;
  let mockQueueUseCase;
  let mockReviewPRUseCase;
  let mockEventBus;
  let mockConfig;

  beforeEach(() => {
    mockRepository = {
      getAllQueues: jest.fn(),
      loadAllQueues: jest.fn()
    };
    mockQueueUseCase = {
      dequeueForProcessing: jest.fn(),
      completeProcessing: jest.fn(),
      handleProcessingFailure: jest.fn()
    };
    mockReviewPRUseCase = {
      execute: jest.fn()
    };
    mockEventBus = {
      emitAsync: jest.fn()
    };
    mockConfig = require('../../../../src/config/yamlConfig');

    worker = new ReviewQueueWorker(
      mockRepository,
      mockQueueUseCase,
      mockReviewPRUseCase,
      mockEventBus,
      {
        logger: console,
        pollInterval: 100,
        githubAdapterFactory: { create: jest.fn() }
      }
    );
  });

  afterEach(async () => {
    if (worker.isRunning) {
      await worker.stop();
    }
  });

  describe('start', () => {
    test('should start the worker', async () => {
      mockRepository.loadAllQueues.mockResolvedValue([]);

      await worker.start();

      expect(worker.isRunning).toBe(true);
      expect(worker._workerTimer).not.toBeNull();
    });

    test('should warn if already running', async () => {
      mockRepository.loadAllQueues.mockResolvedValue([]);

      await worker.start();
      await worker.start(); // Start again

      expect(worker.isRunning).toBe(true);
    });
  });

  describe('stop', () => {
    test('should stop the worker', async () => {
      mockRepository.loadAllQueues.mockResolvedValue([]);

      await worker.start();
      await worker.stop();

      expect(worker.isRunning).toBe(false);
      expect(worker._workerTimer).toBeNull();
    });

    test('should do nothing if not running', async () => {
      await worker.stop();

      expect(worker.isRunning).toBe(false);
    });

    test('should wait for current processing to finish', async () => {
      mockRepository.loadAllQueues.mockResolvedValue([]);

      await worker.start();

      // Simulate processing in progress
      worker._isProcessing = true;

      const stopPromise = worker.stop();

      // Processing should finish
      setTimeout(() => {
        worker._isProcessing = false;
      }, 50);

      await stopPromise;

      expect(worker.isRunning).toBe(false);
    });
  });

  describe('getStatus', () => {
    test('should return worker status', () => {
      const status = worker.getStatus();

      expect(status.isRunning).toBe(false);
      expect(status.isProcessing).toBe(false);
      expect(status.pollInterval).toBe(100);
    });

    test('should reflect running state', async () => {
      mockRepository.loadAllQueues.mockResolvedValue([]);

      await worker.start();

      const status = worker.getStatus();

      expect(status.isRunning).toBe(true);
      expect(status.isProcessing).toBe(false);

      await worker.stop();
    });
  });

  describe('_poll', () => {
    test('should process queue items', async () => {
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
      mockRepository.loadAllQueues.mockResolvedValue([queue]);
      mockQueueUseCase.dequeueForProcessing.mockResolvedValue({ queue, item });
      mockReviewPRUseCase.execute.mockResolvedValue({
        success: true,
        reviewResult: { comments: [] }
      });

      // Mock config.instances to prevent loading actual config
      const instances = mockConfig.instances;
      instances['github/test'] = {
        repos: {
          repo: { thread_id: 123 }
        }
      };

      await worker.start();

      // Wait for poll to run
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(mockQueueUseCase.dequeueForProcessing).toHaveBeenCalledWith('github/test');

      await worker.stop();
    });

    test('should not poll when already processing', async () => {
      mockRepository.loadAllQueues.mockResolvedValue([]);

      await worker.start();

      worker._isProcessing = true;

      // Wait for poll cycle
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(mockQueueUseCase.dequeueForProcessing).not.toHaveBeenCalled();

      worker._isProcessing = false;
      await worker.stop();
    });

    test('should not poll when not running', async () => {
      mockRepository.loadAllQueues.mockResolvedValue([]);

      // Don't start the worker, just call _poll directly
      await worker._poll();

      expect(mockQueueUseCase.dequeueForProcessing).not.toHaveBeenCalled();
    });

    test('should handle poll errors gracefully', async () => {
      // First call during start should succeed
      mockRepository.loadAllQueues
        .mockResolvedValueOnce([])
        // Second call during poll should throw
        .mockImplementationOnce(() => {
          throw new Error('Test error');
        });

      await worker.start();

      // Wait for poll cycle (should not throw)
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(worker.isRunning).toBe(true);

      await worker.stop();
    });
  });

  describe('_processItem', () => {
    test('should process item successfully', async () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        id: 'qi_test',
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        prTitle: 'Test PR',
        level: 'medium'
      });

      // Mock config.instances
      const instances = mockConfig.instances;
      instances['github/test'] = {
        repos: {
          repo: { thread_id: 123 }
        }
      };

      mockReviewPRUseCase.execute.mockResolvedValue({
        success: true,
        reviewResult: { comments: [] }
      });

      await worker._processItem(queue, item);

      expect(mockReviewPRUseCase.execute).toHaveBeenCalled();
      expect(mockEventBus.emitAsync).toHaveBeenCalledWith(
        'queue.item.started',
        expect.objectContaining({
          instanceKey: 'github/test',
          itemId: 'qi_test'
        })
      );
      expect(mockEventBus.emitAsync).toHaveBeenCalledWith(
        'queue.item.completed',
        expect.objectContaining({
          instanceKey: 'github/test',
          itemId: 'qi_test'
        })
      );
    });

    test('should handle processing failure', async () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        id: 'qi_test',
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        prTitle: 'Test PR',
        level: 'medium'
      });

      // Mock config.instances
      const instances = mockConfig.instances;
      instances['github/test'] = {
        repos: {
          repo: { thread_id: 123 }
        }
      };

      const error = new Error('Processing failed');
      mockReviewPRUseCase.execute.mockRejectedValue(error);

      await worker._processItem(queue, item);

      expect(mockQueueUseCase.handleProcessingFailure).toHaveBeenCalledWith(
        'github/test',
        'qi_test',
        error
      );
      expect(mockEventBus.emitAsync).toHaveBeenCalledWith(
        'queue.item.failed',
        expect.objectContaining({
          instanceKey: 'github/test',
          itemId: 'qi_test',
          error: 'Processing failed'
        })
      );
    });

    test('should handle missing repo config', async () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        id: 'qi_test',
        instanceKey: 'github/test',
        repoName: 'nonexistent',
        prNumber: 123,
        prTitle: 'Test PR',
        level: 'medium'
      });

      // Mock config.instances with missing repo
      const instances = mockConfig.instances;
      instances['github/test'] = {
        repos: {}
      };

      // The error should be handled and logged, not thrown
      await worker._processItem(queue, item);

      // Should call handleProcessingFailure
      expect(mockQueueUseCase.handleProcessingFailure).toHaveBeenCalled();
    });

    test('should call completeProcessing with duration', async () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        id: 'qi_test',
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        prTitle: 'Test PR',
        level: 'medium'
      });

      // Mock config.instances
      const instances = mockConfig.instances;
      instances['github/test'] = {
        repos: {
          repo: { thread_id: 123 }
        }
      };

      mockReviewPRUseCase.execute.mockResolvedValue({
        success: true,
        reviewResult: { comments: [] }
      });

      await worker._processItem(queue, item);

      expect(mockQueueUseCase.completeProcessing).toHaveBeenCalledWith(
        'github/test',
        'qi_test',
        expect.any(Object),
        expect.any(Number) // duration
      );
    });
  });

  describe('_recoverInterruptedItems', () => {
    test('should recover timed out items', async () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        id: 'qi_test',
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        prTitle: 'Test PR',
        level: 'medium'
      });

      // Set startedAt to 31 minutes ago
      item.startedAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
      queue.currentItem = item;

      mockRepository.loadAllQueues.mockResolvedValue([queue]);

      await worker._recoverInterruptedItems();

      expect(mockQueueUseCase.handleProcessingFailure).toHaveBeenCalledWith(
        'github/test',
        'qi_test',
        expect.any(Error)
      );
    });

    test('should keep recent items as active', async () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        id: 'qi_test',
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        prTitle: 'Test PR',
        level: 'medium'
      });

      // Set startedAt to 5 minutes ago
      item.startedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      queue.currentItem = item;

      mockRepository.loadAllQueues.mockResolvedValue([queue]);

      await worker._recoverInterruptedItems();

      expect(mockQueueUseCase.handleProcessingFailure).not.toHaveBeenCalled();
    });

    test('should handle empty queues', async () => {
      mockRepository.loadAllQueues.mockResolvedValue([]);

      await worker._recoverInterruptedItems();

      expect(mockQueueUseCase.handleProcessingFailure).not.toHaveBeenCalled();
    });
  });

  describe('integration', () => {
    test('should process item and complete', async () => {
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
      mockRepository.loadAllQueues.mockResolvedValue([queue]);
      mockQueueUseCase.dequeueForProcessing.mockResolvedValue({ queue, item });

      // Mock config.instances
      const instances = mockConfig.instances;
      instances['github/test'] = {
        repos: {
          repo: { thread_id: 123 }
        }
      };

      mockReviewPRUseCase.execute.mockResolvedValue({
        success: true,
        reviewResult: { comments: [] }
      });

      await worker.start();

      // Wait for processing to complete
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(mockQueueUseCase.dequeueForProcessing).toHaveBeenCalled();
      expect(mockReviewPRUseCase.execute).toHaveBeenCalled();
      expect(mockQueueUseCase.completeProcessing).toHaveBeenCalled();

      await worker.stop();
    });
  });
});
