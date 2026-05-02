/**
 * Unit Tests: ConfirmationManager
 */

const ConfirmationManager = require('../../../../src/infrastructure/telegram/ConfirmationManager');

describe('ConfirmationManager', () => {
  let manager;
  let mockLogger;
  let mockTimeoutManager;
  let mockConfig;

  beforeEach(() => {
    jest.useFakeTimers();

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    mockTimeoutManager = {
      setTimeout: jest.fn((fn, delay) => {
        const id = setTimeout(fn, delay);
        return id;
      }),
      clearTimeout: jest.fn((id) => {
        clearTimeout(id);
      })
    };

    mockConfig = {
      app: {
        approve_confirmation_timeout_minutes: '10'
      }
    };

    manager = new ConfirmationManager(mockLogger, mockTimeoutManager, mockConfig);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    test('should initialize with empty pending confirmations', () => {
      expect(manager.pendingConfirmations.size).toBe(0);
      expect(manager.getPendingCount()).toBe(0);
    });
  });

  describe('getTimeoutMs', () => {
    test('should return configured timeout in milliseconds', () => {
      expect(manager.getTimeoutMs()).toBe(10 * 60 * 1000);
    });

    test('should default to 10 minutes when config is missing', () => {
      const mgr = new ConfirmationManager(mockLogger, mockTimeoutManager, {});
      expect(mgr.getTimeoutMs()).toBe(10 * 60 * 1000);
    });

    test('should default to 10 minutes when config value is NaN', () => {
      const mgr = new ConfirmationManager(mockLogger, mockTimeoutManager, {
        app: { approve_confirmation_timeout_minutes: 'abc' }
      });
      expect(mgr.getTimeoutMs()).toBe(10 * 60 * 1000);
    });

    test('should use custom timeout from config', () => {
      mockConfig.app.approve_confirmation_timeout_minutes = '5';
      expect(manager.getTimeoutMs()).toBe(5 * 60 * 1000);
    });
  });

  describe('add', () => {
    test('should store a pending confirmation', () => {
      const keyboard = [[{ text: 'Approve', callback_data: 'approve:0:0:1' }]];
      manager.add(123, 456, keyboard, 'approve');

      expect(manager.pendingConfirmations.size).toBe(1);
      expect(manager.pendingConfirmations.has('123:456')).toBe(true);
    });

    test('should start a tracked timeout', () => {
      const keyboard = [[{ text: 'Approve', callback_data: 'approve:0:0:1' }]];
      manager.add(123, 456, keyboard, 'approve');

      expect(mockTimeoutManager.setTimeout).toHaveBeenCalledTimes(1);
      expect(mockTimeoutManager.setTimeout).toHaveBeenCalledWith(
        expect.any(Function),
        10 * 60 * 1000
      );
    });

    test('should replace existing confirmation for same message', () => {
      const keyboard1 = [[{ text: 'A', callback_data: 'a' }]];
      const keyboard2 = [[{ text: 'B', callback_data: 'b' }]];

      manager.add(123, 456, keyboard1, 'approve');
      manager.add(123, 456, keyboard2, 'approve');

      expect(manager.pendingConfirmations.size).toBe(1);
      expect(mockTimeoutManager.clearTimeout).toHaveBeenCalledTimes(1);
      expect(manager.pendingConfirmations.get('123:456').originalKeyboard).toBe(keyboard2);
    });

    test('should store actionType and extraData', () => {
      const keyboard = [[{ text: 'A', callback_data: 'a' }]];
      manager.add(123, 456, keyboard, 'approve_outdated', { reviewId: 'rev-789' });

      const entry = manager.pendingConfirmations.get('123:456');
      expect(entry.actionType).toBe('approve_outdated');
      expect(entry.extraData).toEqual({ reviewId: 'rev-789' });
    });
  });

  describe('consume', () => {
    test('should return and remove a pending confirmation', () => {
      const keyboard = [[{ text: 'A', callback_data: 'a' }]];
      manager.add(123, 456, keyboard, 'approve', {});

      const result = manager.consume(123, 456);

      expect(result).toEqual({
        originalKeyboard: keyboard,
        actionType: 'approve',
        extraData: {}
      });
      expect(manager.pendingConfirmations.size).toBe(0);
    });

    test('should clear the timeout when consuming', () => {
      const keyboard = [[{ text: 'A', callback_data: 'a' }]];
      manager.add(123, 456, keyboard, 'approve');

      manager.consume(123, 456);

      expect(mockTimeoutManager.clearTimeout).toHaveBeenCalledTimes(1);
    });

    test('should return null for unknown key', () => {
      const result = manager.consume(999, 888);
      expect(result).toBeNull();
    });

    test('should return null for already consumed confirmation', () => {
      const keyboard = [[{ text: 'A', callback_data: 'a' }]];
      manager.add(123, 456, keyboard, 'approve');

      manager.consume(123, 456);
      const result = manager.consume(123, 456);

      expect(result).toBeNull();
    });
  });

  describe('timeout', () => {
    test('should restore original keyboard on timeout', async () => {
      const mockBot = {
        editMessageReplyMarkup: jest.fn().mockResolvedValue({})
      };
      manager.setBot(mockBot);

      const keyboard = [[{ text: 'Approve', callback_data: 'approve:0:0:1' }]];
      manager.add(123, 456, keyboard, 'approve');

      jest.advanceTimersByTime(10 * 60 * 1000);

      // Wait for async _onTimeout to complete
      await Promise.resolve();

      expect(mockBot.editMessageReplyMarkup).toHaveBeenCalledWith(
        { inline_keyboard: keyboard },
        { chat_id: 123, message_id: 456 }
      );
      expect(manager.pendingConfirmations.size).toBe(0);
    });

    test('should not restore keyboard if bot is not set', () => {
      const keyboard = [[{ text: 'A', callback_data: 'a' }]];
      manager.add(123, 456, keyboard, 'approve');

      jest.advanceTimersByTime(10 * 60 * 1000);

      expect(manager.pendingConfirmations.size).toBe(0);
    });

    test('should handle edit error gracefully', async () => {
      const mockBot = {
        editMessageReplyMarkup: jest.fn().mockRejectedValue(new Error('message is not modified'))
      };
      manager.setBot(mockBot);

      const keyboard = [[{ text: 'A', callback_data: 'a' }]];
      manager.add(123, 456, keyboard, 'approve');

      jest.advanceTimersByTime(10 * 60 * 1000);

      // Should not throw
      await Promise.resolve();
      expect(manager.pendingConfirmations.size).toBe(0);
    });

    test('should log warning on non-"not modified" errors', async () => {
      const mockBot = {
        editMessageReplyMarkup: jest.fn().mockRejectedValue(new Error('Internal server error'))
      };
      manager.setBot(mockBot);

      const keyboard = [[{ text: 'A', callback_data: 'a' }]];
      manager.add(123, 456, keyboard, 'approve');

      jest.advanceTimersByTime(10 * 60 * 1000);

      await Promise.resolve();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to restore keyboard')
      );
    });
  });

  describe('clearAll', () => {
    test('should clear all pending confirmations', () => {
      manager.add(1, 1, [], 'approve');
      manager.add(2, 2, [], 'approve');
      manager.add(3, 3, [], 'approve');

      manager.clearAll();

      expect(manager.pendingConfirmations.size).toBe(0);
      expect(mockTimeoutManager.clearTimeout).toHaveBeenCalledTimes(3);
    });

    test('should handle clearAll with no pending confirmations', () => {
      manager.clearAll();
      expect(manager.pendingConfirmations.size).toBe(0);
    });
  });
});
