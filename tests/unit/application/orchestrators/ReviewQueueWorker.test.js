/**
 * ReviewQueueWorker Unit Tests
 */

jest.mock('../../../../src/config/yamlConfig', () => {
  const mockInstances = {};
  return {
    instances: mockInstances,
    app: {},
    log: { level: 'info' }
  };
});

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  openSync: jest.fn().mockReturnValue(42),
  writeSync: jest.fn(),
  closeSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  mkdirSync: jest.fn()
}));

const ReviewQueue = require('../../../../src/core/entities/ReviewQueue');
const QueueItem = require('../../../../src/core/entities/QueueItem');
const ReviewQueueWorker = require('../../../../src/application/orchestrators/ReviewQueueWorker');
const mockConfig = require('../../../../src/config/yamlConfig');

describe('ReviewQueueWorker', () => {
  let worker;
  let mockRepository;
  let mockQueueUseCase;
  let mockReviewPRUseCase;
  let mockEventBus;

  beforeEach(() => {
    // Clear mock config instances between tests
    Object.keys(mockConfig.instances).forEach(key => delete mockConfig.instances[key]);

    mockRepository = {
      getAllQueues: jest.fn(),
      loadAllQueues: jest.fn(),
      saveQueue: jest.fn()
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

      // Mock config.instances
      mockConfig.instances['github/test'] = {
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
      mockConfig.instances['github/test'] = {
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
      mockConfig.instances['github/test'] = {
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
      mockConfig.instances['github/test'] = {
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
      mockConfig.instances['github/test'] = {
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

    test('should requeue recent active items', async () => {
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
      // Verify item was requeued
      expect(queue.currentItem).toBeNull();
      expect(queue.status).toBe('idle');
      expect(queue.items[0]).toBe(item);
      expect(mockRepository.saveQueue).toHaveBeenCalledWith(queue);
    });

    test('should handle empty queues', async () => {
      mockRepository.loadAllQueues.mockResolvedValue([]);

      await worker._recoverInterruptedItems();

      expect(mockQueueUseCase.handleProcessingFailure).not.toHaveBeenCalled();
    });
  });

  describe('constructor', () => {
    test('should use default options when none provided', () => {
      const defaultWorker = new ReviewQueueWorker(
        mockRepository,
        mockQueueUseCase,
        mockReviewPRUseCase,
        mockEventBus
      );

      expect(defaultWorker.logger).toBe(console);
      expect(defaultWorker.pollInterval).toBe(5000);
      expect(defaultWorker.githubAdapterFactory).toBeUndefined();
      expect(defaultWorker.isRunning).toBe(false);
      expect(defaultWorker._isProcessing).toBe(false);
      expect(defaultWorker._workerTimer).toBeNull();
    });

    test('should use provided options', () => {
      const customLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
      const customWorker = new ReviewQueueWorker(
        mockRepository,
        mockQueueUseCase,
        mockReviewPRUseCase,
        mockEventBus,
        { logger: customLogger, pollInterval: 2000 }
      );

      expect(customWorker.logger).toBe(customLogger);
      expect(customWorker.pollInterval).toBe(2000);
    });
  });

  describe('_poll', () => {
    test('should skip queues that cannot process', async () => {
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
      queue.status = 'paused'; // paused = cannot process
      mockRepository.loadAllQueues.mockResolvedValue([queue]);
      worker.isRunning = true;

      await worker._poll();

      expect(mockQueueUseCase.dequeueForProcessing).not.toHaveBeenCalled();
      worker.isRunning = false;
    });

    test('should skip when dequeueForProcessing returns null', async () => {
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
      mockQueueUseCase.dequeueForProcessing.mockResolvedValue(null);
      worker.isRunning = true;

      await worker._poll();

      expect(mockQueueUseCase.dequeueForProcessing).toHaveBeenCalledWith('github/test');
      expect(worker._isProcessing).toBe(false);
      worker.isRunning = false;
    });

    test('should process first available queue and break', async () => {
      const queue1 = new ReviewQueue('github/org1', 2);
      const queue2 = new ReviewQueue('github/org2', 2);
      const item1 = new QueueItem({
        id: 'qi_1',
        instanceKey: 'github/org1',
        repoName: 'repo1',
        prNumber: 1,
        prTitle: 'PR 1',
        level: 'low'
      });
      const item2 = new QueueItem({
        id: 'qi_2',
        instanceKey: 'github/org2',
        repoName: 'repo2',
        prNumber: 2,
        prTitle: 'PR 2',
        level: 'high'
      });

      queue1.enqueue(item1);
      queue2.enqueue(item2);
      mockRepository.loadAllQueues.mockResolvedValue([queue1, queue2]);
      mockQueueUseCase.dequeueForProcessing.mockResolvedValue({ queue: queue1, item: item1 });
      mockReviewPRUseCase.execute.mockResolvedValue({ success: true });

      mockConfig.instances['github/org1'] = { repos: { repo1: { thread_id: 111 } } };
      mockConfig.instances['github/org2'] = { repos: { repo2: { thread_id: 222 } } };

      worker.isRunning = true;
      await worker._poll();

      // Only first queue should be dequeued (break after first)
      expect(mockQueueUseCase.dequeueForProcessing).toHaveBeenCalledTimes(1);
      expect(mockQueueUseCase.dequeueForProcessing).toHaveBeenCalledWith('github/org1');

      // Wait for async processing to finish
      await new Promise(resolve => setTimeout(resolve, 50));
      worker.isRunning = false;
      worker._isProcessing = false;
    });

    test('should handle poll error from loadAllQueues', async () => {
      mockRepository.loadAllQueues.mockRejectedValue(new Error('DB error'));
      worker.isRunning = true;

      await worker._poll();

      expect(mockQueueUseCase.dequeueForProcessing).not.toHaveBeenCalled();
      worker.isRunning = false;
    });

    test('should set _isProcessing true during processing then false after', async () => {
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

      let resolveProcessing;
      mockReviewPRUseCase.execute.mockReturnValue(new Promise(resolve => {
        resolveProcessing = resolve;
      }));

      mockConfig.instances['github/test'] = { repos: { repo: { thread_id: 123 } } };

      worker.isRunning = true;
      const pollPromise = worker._poll();

      // Wait for the async dequeue to complete and _isProcessing to be set
      await new Promise(resolve => setTimeout(resolve, 10));

      // _isProcessing should be set while processing
      expect(worker._isProcessing).toBe(true);

      // Resolve processing
      resolveProcessing({ success: true });
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(worker._isProcessing).toBe(false);
      worker.isRunning = false;
    });
  });

  describe('_processItem', () => {
    test('should create PullRequest entity with correct data', async () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        id: 'qi_test',
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 42,
        prTitle: 'My PR Title',
        level: 'high',
        prId: '999'
      });

      mockConfig.instances['github/test'] = {
        repos: { repo: { thread_id: 555 } }
      };

      const mockGithubAdapter = { name: 'mock-adapter' };
      worker.githubAdapterFactory.create.mockReturnValue(mockGithubAdapter);

      mockReviewPRUseCase.execute.mockResolvedValue({
        success: true,
        reviewResult: { comments: ['comment1'] }
      });

      await worker._processItem(queue, item);

      // Verify githubAdapterFactory was called with instanceKey
      expect(worker.githubAdapterFactory.create).toHaveBeenCalledWith('github/test');

      // Verify execute was called with correct args
      expect(mockReviewPRUseCase.execute).toHaveBeenCalledWith(
        mockConfig.instances['github/test'], // instance
        { name: 'repo', threadId: 555, instanceKey: 'github/test' }, // repo
        expect.objectContaining({ number: 42, title: 'My PR Title' }), // PullRequest entity
        'high', // level
        mockGithubAdapter // githubAdapter
      );
    });

    test('should handle missing instance config', async () => {
      const queue = new ReviewQueue('github/missing', 2);
      const item = new QueueItem({
        id: 'qi_test',
        instanceKey: 'github/missing',
        repoName: 'repo',
        prNumber: 123,
        prTitle: 'Test PR',
        level: 'medium'
      });

      // No instance config set - github/missing not in mockConfig.instances

      await worker._processItem(queue, item);

      expect(mockQueueUseCase.handleProcessingFailure).toHaveBeenCalledWith(
        'github/missing',
        'qi_test',
        expect.any(Error)
      );
      expect(mockEventBus.emitAsync).toHaveBeenCalledWith(
        'queue.item.failed',
        expect.objectContaining({
          instanceKey: 'github/missing',
          itemId: 'qi_test'
        })
      );
    });

    test('should emit started event before processing', async () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        id: 'qi_test',
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        prTitle: 'Test PR',
        level: 'medium'
      });

      mockConfig.instances['github/test'] = {
        repos: { repo: { thread_id: 123 } }
      };

      mockReviewPRUseCase.execute.mockResolvedValue({ success: true });

      await worker._processItem(queue, item);

      // started should be called before execute
      const emitCalls = mockEventBus.emitAsync.mock.calls;
      const startedCallIndex = emitCalls.findIndex(c => c[0] === 'queue.item.started');
      const completedCallIndex = emitCalls.findIndex(c => c[0] === 'queue.item.completed');
      expect(startedCallIndex).toBeLessThan(completedCallIndex);
    });

    test('should call completeProcessing with result and duration', async () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        id: 'qi_test',
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        prTitle: 'Test PR',
        level: 'medium'
      });

      mockConfig.instances['github/test'] = {
        repos: { repo: { thread_id: 123 } }
      };

      const reviewResult = { success: true, comments: ['a', 'b'] };
      mockReviewPRUseCase.execute.mockResolvedValue(reviewResult);

      await worker._processItem(queue, item);

      expect(mockQueueUseCase.completeProcessing).toHaveBeenCalledWith(
        'github/test',
        'qi_test',
        reviewResult,
        expect.any(Number)
      );

      const duration = mockQueueUseCase.completeProcessing.mock.calls[0][3];
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    test('should handle failure in completeProcessing', async () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        id: 'qi_test',
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        prTitle: 'Test PR',
        level: 'medium'
      });

      mockConfig.instances['github/test'] = {
        repos: { repo: { thread_id: 123 } }
      };

      mockReviewPRUseCase.execute.mockResolvedValue({ success: true });
      mockQueueUseCase.completeProcessing.mockRejectedValue(new Error('Complete failed'));

      await worker._processItem(queue, item);

      // Should handle the error through catch block
      expect(mockQueueUseCase.handleProcessingFailure).toHaveBeenCalledWith(
        'github/test',
        'qi_test',
        expect.any(Error)
      );
    });

    test('should handle failure in eventBus emit', async () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        id: 'qi_test',
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        prTitle: 'Test PR',
        level: 'medium'
      });

      mockConfig.instances['github/test'] = {
        repos: { repo: { thread_id: 123 } }
      };

      // Only reject for 'queue.item.started', let 'queue.item.failed' succeed
      mockEventBus.emitAsync.mockImplementation((event) => {
        if (event === 'queue.item.started') {
          return Promise.reject(new Error('Event bus error'));
        }
        return Promise.resolve();
      });

      await worker._processItem(queue, item);

      expect(mockQueueUseCase.handleProcessingFailure).toHaveBeenCalledWith(
        'github/test',
        'qi_test',
        expect.any(Error)
      );
    });

    test('should route non-success result to handleProcessingFailure', async () => {
      const queue = new ReviewQueue('github/test', 2);
      const item = new QueueItem({
        id: 'qi_test',
        instanceKey: 'github/test',
        repoName: 'repo',
        prNumber: 123,
        prTitle: 'Test PR',
        level: 'medium'
      });

      mockConfig.instances['github/test'] = {
        repos: { repo: { thread_id: 123 } }
      };

      // execute returns failure without throwing
      mockReviewPRUseCase.execute.mockResolvedValue({
        success: false,
        error: 'Agent returned error'
      });

      await worker._processItem(queue, item);

      // Should route to handleProcessingFailure (retry path)
      expect(mockQueueUseCase.handleProcessingFailure).toHaveBeenCalledWith(
        'github/test',
        'qi_test',
        expect.any(Error)
      );
      // Should NOT call completeProcessing
      expect(mockQueueUseCase.completeProcessing).not.toHaveBeenCalled();
      // Should emit failed event, not completed
      expect(mockEventBus.emitAsync).toHaveBeenCalledWith(
        'queue.item.failed',
        expect.objectContaining({
          instanceKey: 'github/test',
          itemId: 'qi_test',
          error: 'Agent returned error'
        })
      );
      expect(mockEventBus.emitAsync).not.toHaveBeenCalledWith(
        'queue.item.completed',
        expect.anything()
      );
    });
  });

  describe('_recoverInterruptedItems', () => {
    test('should handle multiple queues with mixed states', async () => {
      const queue1 = new ReviewQueue('github/org1', 2);
      const item1 = new QueueItem({
        id: 'qi_timedout',
        instanceKey: 'github/org1',
        repoName: 'repo1',
        prNumber: 1,
        prTitle: 'Timed out PR',
        level: 'low'
      });
      item1.startedAt = new Date(Date.now() - 45 * 60 * 1000).toISOString();
      queue1.currentItem = item1;

      const queue2 = new ReviewQueue('github/org2', 2);
      const item2 = new QueueItem({
        id: 'qi_active',
        instanceKey: 'github/org2',
        repoName: 'repo2',
        prNumber: 2,
        prTitle: 'Active PR',
        level: 'medium'
      });
      item2.startedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      queue2.currentItem = item2;

      const queue3 = new ReviewQueue('github/org3', 2);
      // No currentItem

      mockRepository.loadAllQueues.mockResolvedValue([queue1, queue2, queue3]);

      await worker._recoverInterruptedItems();

      // Only timed out item should trigger handleProcessingFailure
      expect(mockQueueUseCase.handleProcessingFailure).toHaveBeenCalledTimes(1);
      expect(mockQueueUseCase.handleProcessingFailure).toHaveBeenCalledWith(
        'github/org1',
        'qi_timedout',
        expect.any(Error)
      );

      // Active item should be requeued, not failed
      expect(queue2.currentItem).toBeNull();
      expect(queue2.status).toBe('idle');
      expect(queue2.items[0]).toBe(item2);
    });

    test('should handle error from loadAllQueues', async () => {
      mockRepository.loadAllQueues.mockRejectedValue(new Error('Load failed'));

      await expect(worker._recoverInterruptedItems()).rejects.toThrow('Load failed');
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
      mockConfig.instances['github/test'] = {
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

  describe('singleton lock', () => {
    const fs = require('fs');

    beforeEach(() => {
      fs.openSync.mockReturnValue(42);
      fs.writeSync.mockReturnValue();
      fs.closeSync.mockReturnValue();
      fs.existsSync.mockReturnValue(false);
      fs.readFileSync.mockReturnValue('');
      fs.unlinkSync.mockReturnValue();
      fs.mkdirSync.mockReturnValue();
    });

    test('should acquire lock and start worker', async () => {
      mockRepository.loadAllQueues.mockResolvedValue([]);

      await worker.start();

      expect(worker.isRunning).toBe(true);
      expect(fs.openSync).toHaveBeenCalled();
      expect(worker.isWorkerOwner).toBe(true);
    });

    test('should not start when lock is held by another process', async () => {
      const err = new Error('EEXIST');
      err.code = 'EEXIST';
      fs.openSync.mockImplementationOnce(() => { throw err; });
      // PID is alive
      fs.readFileSync.mockReturnValueOnce(String(process.pid));
      // process.kill(pid, 0) succeeds for current process

      await worker.start();

      expect(worker.isRunning).toBe(false);
    });

    test('should clean stale lock and acquire', async () => {
      const err = new Error('EEXIST');
      err.code = 'EEXIST';
      fs.openSync
        .mockImplementationOnce(() => { throw err; })  // first attempt fails
        .mockReturnValue(42);  // retry after cleanup succeeds
      fs.readFileSync.mockReturnValueOnce('999999'); // stale PID
      // process.kill(999999, 0) will throw ESRCH in jest

      mockRepository.loadAllQueues.mockResolvedValue([]);

      await worker.start();

      expect(worker.isRunning).toBe(true);
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    test('should release lock on stop', async () => {
      mockRepository.loadAllQueues.mockResolvedValue([]);

      await worker.start();

      // Lock file exists when stop checks
      fs.existsSync.mockReturnValue(true);

      await worker.stop();

      expect(fs.closeSync).toHaveBeenCalled();
      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(worker.isWorkerOwner).toBe(false);
    });
  });
});
