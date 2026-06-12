const NotificationRouter = require('../../../../src/application/services/NotificationRouter');

describe('NotificationRouter', () => {
  const notification = { owner: 'acme', repo: 'api', pr: { number: 1 }, summary: {} };

  test('routes Telegram-only notifications', async () => {
    const telegramAdapter = {
      sendPRNotification: jest.fn().mockResolvedValue({ message_id: 10 })
    };
    const router = new NotificationRouter({
      telegramAdapter,
      config: { app: { telegram: { enabled: true, botToken: 'telegram-token' }, discord: { enabled: false } } }
    });

    const result = await router.sendPRNotification(notification);

    expect(result.success).toBe(true);
    expect(result.message_id).toBe(10);
    expect(telegramAdapter.sendPRNotification).toHaveBeenCalledWith(notification);
  });

  test('routes Discord-only notifications', async () => {
    const discordAdapter = {
      sendPRNotification: jest.fn().mockResolvedValue({ id: 'd1' })
    };
    const router = new NotificationRouter({
      discordAdapter,
      config: { app: { telegram: { enabled: false }, discord: { enabled: true } } }
    });

    const result = await router.sendPRNotification(notification);

    expect(result.success).toBe(true);
    expect(result.message_id).toBe('d1');
    expect(discordAdapter.sendPRNotification).toHaveBeenCalledWith(notification);
  });

  test('aggregates dual-platform failures without throwing', async () => {
    const telegramAdapter = {
      sendPRNotification: jest.fn().mockRejectedValue(new Error('telegram down'))
    };
    const discordAdapter = {
      sendPRNotification: jest.fn().mockResolvedValue({ id: 'd1' })
    };
    const router = new NotificationRouter({
      telegramAdapter,
      discordAdapter,
      logger: { error: jest.fn() },
      config: { app: { telegram: { enabled: true, botToken: 'telegram-token' }, discord: { enabled: true } } }
    });

    const result = await router.sendPRNotification(notification);

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results.find(r => r.platform === 'telegram').success).toBe(false);
    expect(result.results.find(r => r.platform === 'discord').success).toBe(true);
  });

  test('returns failure when no target is configured', async () => {
    const router = new NotificationRouter({
      config: { app: { telegram: { enabled: false }, discord: { enabled: false } } }
    });

    const result = await router.sendPRNotification(notification);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No notification targets');
  });

  test('uses queue notification fallback for Telegram adapters', async () => {
    const telegramAdapter = {
      sendToThread: jest.fn().mockResolvedValue({ message_id: 1 })
    };
    const router = new NotificationRouter({
      telegramAdapter,
      config: { app: { telegram: { enabled: true, botToken: 'telegram-token' }, discord: { enabled: false } } }
    });

    const result = await router.sendQueueFailedNotification({
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 7,
      prTitle: 'Add API',
      level: 'high',
      threadId: 10,
      error: 'boom'
    });

    expect(result.success).toBe(true);
    expect(telegramAdapter.sendToThread).toHaveBeenCalledWith(10, expect.stringContaining('Review Failed'));
  });

  test('uses queue completed fallback and escapes HTML', async () => {
    const telegramAdapter = {
      sendToThread: jest.fn().mockResolvedValue({ message_id: 11 })
    };
    const router = new NotificationRouter({
      telegramAdapter,
      config: { app: { telegram: { enabled: true }, discord: { enabled: false } } }
    });

    const result = await router.sendQueueCompletedNotification({
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 9,
      prTitle: 'Add <API> & auth',
      level: 'high',
      threadId: 10,
      duration: 61000,
      reviewUrl: 'https://example.com/review'
    });

    expect(result.success).toBe(true);
    expect(telegramAdapter.sendToThread).toHaveBeenCalledWith(10, expect.stringContaining('Add &lt;API&gt; &amp; auth'));
  });

  test('routes sendToThread only through telegram when supported', async () => {
    const telegramAdapter = {
      sendToThread: jest.fn().mockResolvedValue({ message_id: 99 })
    };
    const discordAdapter = {
      sendToThread: jest.fn()
    };
    const router = new NotificationRouter({
      telegramAdapter,
      discordAdapter,
      config: { app: { telegram: { enabled: true }, discord: { enabled: true } } }
    });

    const result = await router.sendToThread(33, 'hello');

    expect(result.success).toBe(true);
    expect(result.message_id).toBe(99);
    expect(telegramAdapter.sendToThread).toHaveBeenCalledWith(33, 'hello');
    expect(discordAdapter.sendToThread).not.toHaveBeenCalled();
  });

  test('returns aggregated error when all enabled targets fail', async () => {
    const router = new NotificationRouter({
      telegramAdapter: {
        sendPRNotification: jest.fn().mockRejectedValue(new Error('telegram broken'))
      },
      discordAdapter: {
        sendPRNotification: jest.fn().mockResolvedValue({ success: false, error: 'discord broken' })
      },
      logger: { error: jest.fn() },
      config: { app: { telegram: { enabled: true }, discord: { enabled: true } } }
    });

    const result = await router.sendPRNotification(notification);

    expect(result.success).toBe(false);
    expect(result.error).toContain('telegram: telegram broken');
    expect(result.error).toContain('discord: discord broken');
  });

  test('routes outdated review notifications to Discord-only target', async () => {
    const discordAdapter = {
      sendOutdatedReviewNotification: jest.fn().mockResolvedValue({ id: 'd-outdated' })
    };
    const router = new NotificationRouter({
      discordAdapter,
      config: { app: { telegram: { enabled: false }, discord: { enabled: true } } }
    });

    const result = await router.sendOutdatedReviewNotification(notification);

    expect(result).toEqual(expect.objectContaining({
      success: true,
      message_id: 'd-outdated'
    }));
  });
});
