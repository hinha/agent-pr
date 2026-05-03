/**
 * Unit Tests: CommandHandler
 *
 * Tests for the Telegram bot text command handler.
 * Focuses on command parsing, routing, and execution.
 */

const CommandHandler = require('../../../../src/infrastructure/telegram/CommandHandler');
const PRStateMachine = require('../../../../src/core/services/PRStateMachine');
const { PRState } = PRStateMachine;

describe('CommandHandler', () => {
  let commandHandler;
  let mockStateMachine;
  let mockStateRepositoryFactory;
  let mockBot;
  let mockConfig;
  let mockLogger;

  const testConfig = {
    instances: {
      'github/testorg': {
        owner: 'testorg',
        mcpName: 'github-test',
        repos: {
          'test-repo': {
            thread_id: 12345
          },
          'other-repo': {
            thread_id: 67890
          }
        }
      }
    }
  };

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    mockStateMachine = {
      reset: jest.fn().mockResolvedValue(undefined),
      getState: jest.fn().mockResolvedValue(PRState.NOTIFIED),
      getNotificationCount: jest.fn().mockResolvedValue(1),
      isTerminalState: jest.fn().mockReturnValue(false),
      eventBus: {
        emitAsync: jest.fn().mockResolvedValue(undefined)
      },
      maxNotifications: 3
    };

    mockStateRepositoryFactory = {
      create: jest.fn().mockReturnValue({
        _persistNotificationCount: jest.fn().mockResolvedValue(undefined),
        clearProcessed: jest.fn().mockResolvedValue(undefined),
        clearReviewState: jest.fn().mockResolvedValue(undefined)
      })
    };

    mockBot = {
      sendMessage: jest.fn().mockResolvedValue(undefined)
    };

    commandHandler = new CommandHandler(
      mockStateMachine,
      mockStateRepositoryFactory,
      {
        logger: mockLogger,
        config: testConfig,
        bot: mockBot,
        chatId: 99999
      }
    );
  });

  describe('/reset command', () => {
    test('should reset PR state', async () => {
      const message = {
        text: '/reset 9',
        message_thread_id: 12345
      };

      const result = await commandHandler.handleCommand(message, testConfig);

      expect(result.success).toBe(true);
      expect(result.action).toBe('reset');
      expect(result.prNumber).toBe(9);
      expect(mockStateMachine.reset).toHaveBeenCalledWith('github/testorg', 'test-repo', 9);
    });

    test('should clear notification count', async () => {
      const message = {
        text: '/reset 9',
        message_thread_id: 12345
      };

      await commandHandler.handleCommand(message, testConfig);

      const repo = mockStateRepositoryFactory.create('testorg', 'test-repo');
      expect(repo._persistNotificationCount).toHaveBeenCalledWith(9, 0);
    });

    test('should clear processed flag', async () => {
      const message = {
        text: '/reset 9',
        message_thread_id: 12345
      };

      await commandHandler.handleCommand(message, testConfig);

      const repo = mockStateRepositoryFactory.create('testorg', 'test-repo');
      expect(repo.clearProcessed).toHaveBeenCalledWith('testorg', 'test-repo', 9);
    });

    test('should clear review state', async () => {
      const message = {
        text: '/reset 9',
        message_thread_id: 12345
      };

      await commandHandler.handleCommand(message, testConfig);

      const repo = mockStateRepositoryFactory.create('testorg', 'test-repo');
      expect(repo.clearReviewState).toHaveBeenCalledWith(9);
    });

    test('should show error for missing argument', async () => {
      const message = {
        text: '/reset',
        message_thread_id: 12345
      };

      const result = await commandHandler.handleCommand(message, testConfig);

      expect(result.success).toBe(false);
      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        99999,
        '❌ Usage: /reset <pr_number>\nExample: /reset 9',
        expect.objectContaining({
          message_thread_id: 12345,
          reply_to_message_id: message.message_id
        })
      );
    });

    test('should show error for invalid PR number', async () => {
      const message = {
        text: '/reset abc',
        message_thread_id: 12345
      };

      const result = await commandHandler.handleCommand(message, testConfig);

      expect(result.success).toBe(false);
      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        99999,
        '❌ Invalid PR number. Usage: /reset <pr_number>',
        expect.objectContaining({
          message_thread_id: 12345,
          reply_to_message_id: message.message_id
        })
      );
    });
  });

  describe('/status command', () => {
    test('should show PR status', async () => {
      const message = {
        text: '/status 9',
        message_thread_id: 12345
      };

      const result = await commandHandler.handleCommand(message, testConfig);

      expect(result.success).toBe(true);
      expect(result.action).toBe('status');
      expect(result.prNumber).toBe(9);
      expect(result.state).toBe(PRState.NOTIFIED);
      expect(result.count).toBe(1);
      expect(result.isProcessed).toBe(false);
    });

    test('should show error for missing argument', async () => {
      const message = {
        text: '/status',
        message_thread_id: 12345
      };

      const result = await commandHandler.handleCommand(message, testConfig);

      expect(result.success).toBe(false);
      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        99999,
        '❌ Usage: /status <pr_number>\nExample: /status 9',
        expect.objectContaining({
          message_thread_id: 12345,
          reply_to_message_id: message.message_id
        })
      );
    });

    test('should show error for invalid PR number', async () => {
      const message = {
        text: '/status abc',
        message_thread_id: 12345
      };

      const result = await commandHandler.handleCommand(message, testConfig);

      expect(result.success).toBe(false);
    });
  });

  describe('/help command', () => {
    test('should show available commands', async () => {
      const message = {
        text: '/help',
        message_thread_id: 12345
      };

      const result = await commandHandler.handleCommand(message, testConfig);

      expect(result.success).toBe(true);
      expect(result.action).toBe('help');
      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        99999,
        expect.stringContaining('📖 <b>Available Commands</b>'),
        expect.objectContaining({
          message_thread_id: 12345,
          reply_to_message_id: message.message_id
        })
      );
    });
  });

  describe('thread_id scoping', () => {
    test('should find correct repo by thread_id', async () => {
      const message = {
        text: '/reset 9',
        message_thread_id: 12345
      };

      await commandHandler.handleCommand(message, testConfig);

      expect(mockStateMachine.reset).toHaveBeenCalledWith('github/testorg', 'test-repo', 9);
    });

    test('should fail for unknown thread_id', async () => {
      const message = {
        text: '/reset 9',
        message_thread_id: 99999 // Unknown thread_id
      };

      const result = await commandHandler.handleCommand(message, testConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Thread not associated with any repo');
      expect(mockStateMachine.reset).not.toHaveBeenCalled();
    });
  });

  describe('unknown commands', () => {
    test('should show error for unknown command', async () => {
      const message = {
        text: '/unknown command',
        message_thread_id: 12345
      };

      const result = await commandHandler.handleCommand(message, testConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown command');
      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        99999,
        expect.stringContaining('Unknown command'),
        expect.objectContaining({
          message_thread_id: 12345,
          reply_to_message_id: message.message_id
        })
      );
    });

    test('should ignore non-command messages', async () => {
      const message = {
        text: 'Hello world',
        message_thread_id: 12345
      };

      const result = await commandHandler.handleCommand(message, testConfig);

      expect(result.success).toBe(true);
      expect(result.action).toBe('ignored');
    });
  });

  describe('error handling', () => {
    test('should handle missing thread_id gracefully', async () => {
      const message = {
        text: '/reset 9'
        // No message_thread_id
      };

      const result = await commandHandler.handleCommand(message, testConfig);

      expect(result.success).toBe(false);
      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        99999,
        '⚠️ Invalid command in this thread.',
        expect.objectContaining({
          reply_to_message_id: message.message_id
        })
      );
    });

    test('should handle reset command errors', async () => {
      const message = {
        text: '/reset 9',
        message_thread_id: 12345,
        message_id: 999
      };

      mockStateMachine.reset.mockRejectedValue(new Error('Reset failed'));

      const result = await commandHandler.handleCommand(message, testConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Reset failed');
      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        99999,
        expect.stringContaining('Failed to reset PR'),
        expect.objectContaining({
          message_thread_id: 12345,
          reply_to_message_id: 999
        })
      );
    });

    test('should handle status command errors', async () => {
      const message = {
        text: '/status 9',
        message_thread_id: 12345,
        message_id: 999
      };

      mockStateMachine.getState.mockRejectedValue(new Error('State error'));

      const result = await commandHandler.handleCommand(message, testConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('State error');
      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        99999,
        expect.stringContaining('Failed to get status'),
        expect.objectContaining({
          message_thread_id: 12345,
          reply_to_message_id: 999
        })
      );
    });

    test('should handle missing bot or chatId gracefully', async () => {
      const handlerWithoutBot = new CommandHandler(
        mockStateMachine,
        mockStateRepositoryFactory,
        {
          logger: mockLogger,
          config: testConfig
          // No bot or chatId
        }
      );

      const message = {
        text: '/reset 9',
        message_thread_id: 12345
      };

      await handlerWithoutBot.handleCommand(message, testConfig);

      // Should not throw error, just log warning
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Cannot reply')
      );
    });
  });

  describe('_replyMessage error handling', () => {
    test('should handle sendMessage errors gracefully', async () => {
      mockBot.sendMessage.mockRejectedValue(new Error('Network error'));

      const message = {
        text: '/unknown',
        message_thread_id: 12345
      };

      await commandHandler.handleCommand(message, testConfig);

      // Should not throw, just log error
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send reply')
      );
    });
  });
});
