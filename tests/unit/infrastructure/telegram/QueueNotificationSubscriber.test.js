const QueueNotificationSubscriber = require('../../../../src/infrastructure/telegram/QueueNotificationSubscriber');

describe('QueueNotificationSubscriber', () => {
  let eventBus;
  let router;
  let subscriber;

  beforeEach(() => {
    eventBus = {
      on: jest.fn()
    };
    router = {
      sendQueueCompletedNotification: jest.fn().mockResolvedValue({ success: true }),
      sendQueueFailedNotification: jest.fn().mockResolvedValue({ success: true }),
      sendToThread: jest.fn().mockResolvedValue({ success: true })
    };
    subscriber = new QueueNotificationSubscriber(router, eventBus, {
      logger: { info: jest.fn(), error: jest.fn() }
    });
  });

  test('subscribes to queue events', () => {
    subscriber.subscribe();

    expect(eventBus.on).toHaveBeenCalledWith('queue.item.completed', expect.any(Function));
    expect(eventBus.on).toHaveBeenCalledWith('queue.item.failed', expect.any(Function));
  });

  test('delegates completed event to notification router', async () => {
    const data = {
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 7,
      prTitle: 'Add API',
      level: 'medium',
      threadId: 10,
      duration: 120000
    };

    await subscriber._onCompleted(data);

    expect(router.sendQueueCompletedNotification).toHaveBeenCalledWith(data);
  });

  test('delegates failed event to notification router', async () => {
    const data = {
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 7,
      prTitle: 'Add API',
      level: 'medium',
      threadId: 10,
      error: 'boom'
    };

    await subscriber._onFailed(data);

    expect(router.sendQueueFailedNotification).toHaveBeenCalledWith(data);
  });

  test('falls back to sendToThread when queue-specific router methods are absent', async () => {
    const fallbackRouter = {
      sendToThread: jest.fn().mockResolvedValue({ success: true })
    };
    const fallbackSubscriber = new QueueNotificationSubscriber(fallbackRouter, eventBus, {
      logger: { info: jest.fn(), error: jest.fn() }
    });

    await fallbackSubscriber._onCompleted({
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 7,
      prTitle: 'Add <API>',
      level: 'high',
      threadId: 10,
      duration: 60000,
      reviewUrl: 'https://example.com'
    });

    expect(fallbackRouter.sendToThread).toHaveBeenCalledWith(
      10,
      expect.stringContaining('Review Completed')
    );
    expect(fallbackRouter.sendToThread.mock.calls[0][1]).toContain('Add &lt;API&gt;');
  });

  test('falls back to failed message and logs router errors', async () => {
    const logger = { info: jest.fn(), error: jest.fn() };
    const fallbackRouter = {
      sendToThread: jest.fn().mockRejectedValue(new Error('down'))
    };
    const fallbackSubscriber = new QueueNotificationSubscriber(fallbackRouter, eventBus, { logger });

    await fallbackSubscriber._onFailed({
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 7,
      prTitle: 'Add & API',
      level: 'high',
      threadId: 10,
      error: 'bad <state>'
    });

    expect(fallbackRouter.sendToThread).toHaveBeenCalledWith(
      10,
      expect.stringContaining('Review Failed')
    );
    expect(fallbackRouter.sendToThread.mock.calls[0][1]).toContain('bad &lt;state&gt;');
    expect(logger.error).toHaveBeenCalledWith('[QueueNotificationSubscriber] Failed to send failure notification: down');
  });
});
