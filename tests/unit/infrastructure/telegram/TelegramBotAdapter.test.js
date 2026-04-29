/**
 * Unit Tests: TelegramBotAdapter
 *
 * Tests for the Telegram bot adapter that handles notifications and callbacks.
 */

const TelegramBotAdapter = require('../../../../src/infrastructure/telegram/TelegramBotAdapter');

// Mock node-telegram-bot-api module
jest.mock('node-telegram-bot-api', () => {
  const MockBot = jest.fn(() => ({
    sendMessage: jest.fn().mockResolvedValue({ message_id: 789 }),
    answerCallbackQuery: jest.fn().mockResolvedValue(true),
    on: jest.fn(),
    stopPolling: jest.fn(),
    deleteWebhook: jest.fn().mockResolvedValue(true)
  }));
  MockBot.prototype.on = jest.fn();
  MockBot.prototype.sendMessage = jest.fn().mockResolvedValue({ message_id: 789 });
  MockBot.prototype.stopPolling = jest.fn();
  MockBot.prototype.deleteWebhook = jest.fn().mockResolvedValue(true);
  return MockBot;
});

describe('TelegramBotAdapter', () => {
  let adapter;
  let mockLogger;
  let mockRetryHelper;
  let mockConfig;

  beforeEach(() => {
    jest.clearAllMocks();

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    mockRetryHelper = {
      retry: jest.fn((fn) => fn())
    };

    mockConfig = {
      app: {
        telegram: {
          bot_token: 'test-token',
          chatId: 123
        }
      },
      instances: {
        'github/testorg': {
          key: 'github/testorg',
          owner: 'testorg',
          mcpName: 'github-work',
          repos: {
            'test-repo': { thread_id: 456 }
          }
        },
        'github/otherorg': {
          key: 'github/otherorg',
          owner: 'otherorg',
          mcpName: 'github-other',
          repos: {
            'another-repo': { thread_id: 789 }
          }
        }
      }
    };

    adapter = new TelegramBotAdapter(
      mockConfig.app.telegram.bot_token,
      { logger: mockLogger, retryHelper: mockRetryHelper, config: mockConfig }
    );
  });

  describe('constructor', () => {
    test('should initialize with bot token', () => {
      expect(adapter.botToken).toBe('test-token');
      expect(adapter.config).toBe(mockConfig);
      expect(adapter.bot).toBeNull();
      expect(adapter.chatId).toBe(123);
    });

    test('should build instance and repo mappings', () => {
      expect(adapter.instanceMap.size).toBe(2);
      expect(adapter.repoMap.size).toBe(2);

      const testRepoInfo = adapter.repoMap.get('0:0');
      expect(testRepoInfo).toEqual({
        owner: 'testorg',
        repo: 'test-repo',
        instanceKey: 'github/testorg',
        instance: mockConfig.instances['github/testorg']
      });
    });

    test('should log initialization', () => {
      expect(mockLogger.info).toHaveBeenCalledWith('TelegramBotAdapter initialized');
    });
  });

  describe('start', () => {
    test('should create Telegram bot with polling', async () => {
      await adapter.start();

      const TelegramBot = require('node-telegram-bot-api');
      expect(TelegramBot).toHaveBeenCalledWith('test-token', { polling: true });
      expect(adapter.bot).toBeTruthy();
    });

    test('should setup event handlers', async () => {
      await adapter.start();

      expect(adapter.bot.on).toHaveBeenCalledWith('polling_error', expect.any(Function));
      expect(adapter.bot.on).toHaveBeenCalledWith('callback_query', expect.any(Function));
    });

    test('should log successful start', async () => {
      await adapter.start();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('started with active polling')
      );
    });

    test('should not start if already started', async () => {
      await adapter.start();

      const bot1 = adapter.bot;
      await adapter.start();

      const bot2 = adapter.bot;
      expect(bot1).toBe(bot2);

      const TelegramBot = require('node-telegram-bot-api');
      expect(TelegramBot).toHaveBeenCalledTimes(1);
    });
  });

  describe('stop', () => {
    test('should stop Telegram bot polling', async () => {
      await adapter.start();
      const bot = adapter.bot;
      await adapter.stop();

      expect(bot.stopPolling).toHaveBeenCalled();
      expect(adapter.bot).toBeNull();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('stopped')
      );
    });

    test('should handle stop when bot is null', async () => {
      await adapter.stop();

      expect(adapter.bot).toBeNull();
    });
  });

  describe('sendPRNotification', () => {
    beforeEach(async () => {
      await adapter.start();
    });

    test('should send PR notification with correct parameters', async () => {
      const notification = {
        owner: 'testorg',
        repo: 'test-repo',
        pr: {
          id: 'pr_123',
          number: 456,
          title: 'Test PR',
          author: 'testuser',
          baseBranch: 'main',
          createdAt: new Date().toISOString()
        },
        summary: {
          riskLevel: 'MEDIUM',
          impactArea: 'API',
          purpose: 'Add new feature',
          filesChanged: 5,
          diffSize: '200 lines'
        },
        threadId: 456
      };

      await adapter.sendPRNotification(notification);

      expect(adapter.bot.sendMessage).toHaveBeenCalledWith(
        123,
        expect.stringContaining('Test PR'),
        expect.objectContaining({
          reply_markup: expect.objectContaining({
            inline_keyboard: expect.any(Array)
          }),
          message_thread_id: 456,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        })
      );
    });

    test('should use retry helper for sending', async () => {
      const notification = {
        owner: 'testorg',
        repo: 'test-repo',
        pr: {
          id: 'pr_123',
          number: 456,
          title: 'Test PR',
          author: 'testuser',
          baseBranch: 'main'
        },
        summary: {
          riskLevel: 'LOW',
          impactArea: 'Docs',
          purpose: 'Update docs',
          filesChanged: 1,
          diffSize: '10 lines'
        },
        threadId: 456
      };

      await adapter.sendPRNotification(notification);

      expect(mockRetryHelper.retry).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          retries: 3,
          minTimeout: 1000,
          factor: 2
        })
      );
    });

    test('should throw error for unknown repo', async () => {
      const notification = {
        owner: 'unknown',
        repo: 'unknown',
        pr: {
          id: 'pr_123',
          number: 456,
          title: 'Test PR'
        },
        summary: {
          riskLevel: 'LOW',
          impactArea: 'Unknown',
          purpose: 'Test',
          filesChanged: 1,
          diffSize: '10 lines'
        },
        threadId: 456
      };

      await expect(adapter.sendPRNotification(notification)).rejects.toThrow();
    });
  });

  describe('sendOutdatedReviewNotification', () => {
    beforeEach(async () => {
      await adapter.start();
    });

    test('should send outdated review notification', async () => {
      const notification = {
        owner: 'testorg',
        repo: 'test-repo',
        pr: {
          id: 'pr_123',
          number: 456,
          title: 'Test PR',
          author: 'testuser'
        },
        reviewState: {
          reviewId: 'review_1',
          commitsAtReview: ['abc123'],
          currentCommits: ['abc123', 'def456']
        },
        threadId: 456
      };

      await adapter.sendOutdatedReviewNotification(notification);

      expect(adapter.bot.sendMessage).toHaveBeenCalledWith(
        123,
        expect.stringContaining('Outdated Review Detected'),
        expect.objectContaining({
          reply_markup: expect.objectContaining({
            inline_keyboard: expect.any(Array)
          })
        })
      );
    });
  });

  describe('callback_query forwarding', () => {
    test('should register callback_query handler on bot start', async () => {
      await adapter.start();

      const bot = adapter.getBot();
      expect(bot.on).toHaveBeenCalledWith('callback_query', expect.any(Function));
    });
  });

  describe('getBot', () => {
    test('should return bot instance after start', async () => {
      await adapter.start();

      const bot = adapter.getBot();
      expect(bot).toBeTruthy();
    });
  });

  describe('EventEmitter functionality', () => {
    test('should allow subscribing to events', () => {
      const handler = jest.fn();
      const result = adapter.on('test_event', handler);

      // EventEmitter.on returns the emitter instance
      expect(result).toBe(adapter);
    });

    test('should emit events', () => {
      const handler = jest.fn();
      adapter.on('test_event', handler);
      adapter.emit('test_event', { data: 'test' });

      expect(handler).toHaveBeenCalled();
    });

    test('should unsubscribe from events', () => {
      const handler = jest.fn();
      adapter.on('test_event', handler);
      adapter.off('test_event', handler);
      adapter.emit('test_event', { data: 'test' });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('_getRepoInfo', () => {
    test('should return correct repo info for valid indices', () => {
      const repoInfo = adapter._getRepoInfo(0, 0);

      expect(repoInfo).toEqual({
        owner: 'testorg',
        repo: 'test-repo',
        instanceKey: 'github/testorg',
        instance: mockConfig.instances['github/testorg']
      });
    });

    test('should return undefined for invalid indices', () => {
      const repoInfo = adapter._getRepoInfo(99, 99);

      expect(repoInfo).toBeUndefined();
    });
  });

  describe('_getRepoIndices', () => {
    test('should return correct indices for known repo', () => {
      const indices = adapter._getRepoIndices('testorg', 'test-repo');

      expect(indices).toEqual({ instanceIdx: 0, repoIdx: 0 });
    });

    test('should return correct indices for other org repo', () => {
      const indices = adapter._getRepoIndices('otherorg', 'another-repo');

      expect(indices).toEqual({ instanceIdx: 1, repoIdx: 0 });
    });

    test('should return null for unknown repo', () => {
      const indices = adapter._getRepoIndices('unknown', 'unknown');

      expect(indices).toBeNull();
    });
  });

  describe('_escapeHtml', () => {
    test('should escape HTML special characters', () => {
      const input = '<script>alert("test")</script>';
      const output = adapter._escapeHtml(input);

      expect(output).toBe('&lt;script&gt;alert(&quot;test&quot;)&lt;/script&gt;');
    });

    test('should escape ampersand first', () => {
      const input = 'a & b < c';
      const output = adapter._escapeHtml(input);

      expect(output).toBe('a &amp; b &lt; c');
    });

    test('should handle empty string', () => {
      expect(adapter._escapeHtml('')).toBe('');
    });

    test('should handle null/undefined', () => {
      expect(adapter._escapeHtml(null)).toBe('');
      expect(adapter._escapeHtml(undefined)).toBe('');
    });
  });

  describe('_buildPRMessage', () => {
    test('should build PR message with risk emoji', () => {
      const pr = {
        title: 'Test PR',
        author: 'testuser',
        baseBranch: 'main'
      };

      const summary = {
        riskLevel: 'HIGH',
        impactArea: 'API',
        purpose: 'Add feature',
        filesChanged: 5,
        diffSize: '200 lines'
      };

      const instance = mockConfig.instances['github/testorg'];

      const message = adapter._buildPRMessage(pr, summary, instance);

      expect(message).toContain('Test PR');
      expect(message).toContain('🔴'); // HIGH risk emoji
      expect(message).toContain('HIGH');
      expect(message).toContain('API');
    });
  });

  describe('_buildPRKeyboard', () => {
    test('should build keyboard with all actions', () => {
      const keyboard = adapter._buildPRKeyboard(0, 0, { id: 'pr_123' });

      expect(keyboard).toHaveLength(3);
      expect(keyboard[0]).toHaveLength(2);
      expect(keyboard[0][0]).toEqual({
        text: '🔍 Review Now',
        callback_data: 'action:0:0:pr_123'
      });
      expect(keyboard[0][1]).toEqual({
        text: '✅ Approve',
        callback_data: 'approve:0:0:pr_123'
      });
    });
  });
});
