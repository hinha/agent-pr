/**
 * Unit Tests: CallbackHandler
 *
 * Tests for the callback handler that processes Telegram bot button callbacks.
 */

const CallbackHandler = require('../../../../src/infrastructure/telegram/CallbackHandler');

describe('CallbackHandler', () => {
  let handler;
  let mockReviewPRUseCase;
  let mockStateMachine;
  let mockEventBus;
  let mockGitHubAdapter;
  let mockConfig;
  let mockLogger;
  let mockConfirmationManager;

  beforeEach(() => {
    mockReviewPRUseCase = {
      approve: jest.fn().mockResolvedValue({ success: true }),
      reject: jest.fn().mockResolvedValue({ success: true }),
      close: jest.fn().mockResolvedValue({ success: true }),
      skip: jest.fn().mockResolvedValue({ success: true }),
      execute: jest.fn().mockResolvedValue({
        success: true,
        reviewResult: { comments: [] }
      })
    };

    mockStateMachine = jest.fn();

    mockEventBus = {
      emitAsync: jest.fn().mockResolvedValue()
    };

    // Mock PRs that can be resolved by node ID
    const mockOpenPRs = [
      { id: 12345, number: 42, title: 'Test PR 42', author: 'testuser', owner: 'testorg', repo: 'test-repo', url: 'https://github.com/testorg/test-repo/pull/42', headBranch: 'feature', baseBranch: 'main', headSha: 'abc123' },
      { id: 67890, number: 99, title: 'Test PR 99', author: 'testuser', owner: 'testorg', repo: 'test-repo', url: 'https://github.com/testorg/test-repo/pull/99', headBranch: 'fix', baseBranch: 'main', headSha: 'def456' },
      { id: 11111, number: 100, title: 'Test PR 100', author: 'testuser', owner: 'testorg', repo: 'test-repo', url: 'https://github.com/testorg/test-repo/pull/100', headBranch: 'feat', baseBranch: 'main', headSha: 'ghi789' },
      { id: 22222, number: 101, title: 'Test PR 101', author: 'testuser', owner: 'testorg', repo: 'test-repo', url: 'https://github.com/testorg/test-repo/pull/101', headBranch: 'chore', baseBranch: 'main', headSha: 'jkl012' },
      { id: 33333, number: 102, title: 'Test PR 102', author: 'testuser', owner: 'testorg', repo: 'test-repo', url: 'https://github.com/testorg/test-repo/pull/102', headBranch: 'dev', baseBranch: 'main', headSha: 'mno345' },
      { id: 44444, number: 103, title: 'Test PR 103', author: 'testuser', owner: 'testorg', repo: 'test-repo', url: 'https://github.com/testorg/test-repo/pull/103', headBranch: 'bugfix', baseBranch: 'main', headSha: 'pqr678' },
      { id: 55555, number: 104, title: 'Test PR 104', author: 'testuser', owner: 'testorg', repo: 'test-repo', url: 'https://github.com/testorg/test-repo/pull/104', headBranch: 'hotfix', baseBranch: 'main', headSha: 'stu901' }
    ];

    mockGitHubAdapter = {
      create: jest.fn().mockReturnValue({
        createPullRequestReview: jest.fn(),
        updatePullRequest: jest.fn(),
        getOpenPRs: jest.fn().mockResolvedValue(mockOpenPRs)
      })
    };

    mockConfig = {
      instances: {
        'github/testorg': {
          key: 'github/testorg',
          owner: 'testorg',
          mcpName: 'github-work',
          agent: {
            review_timeot_string: '20 menit'
          },
          repos: {
            'test-repo': { name: 'test-repo', thread_id: 456 }
          }
        },
        'github/otherorg': {
          key: 'github/otherorg',
          owner: 'otherorg',
          mcpName: 'github-other',
          agent: {
            review_timeot_string: '20 menit'
          },
          repos: {
            'another-repo': { name: 'another-repo', thread_id: 789 }
          }
        }
      }
    };

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    mockConfirmationManager = {
      add: jest.fn(),
      consume: jest.fn().mockReturnValue(null),
      clearAll: jest.fn(),
      getTimeoutMs: jest.fn().mockReturnValue(10 * 60 * 1000),
      getPendingCount: jest.fn().mockReturnValue(0)
    };

    handler = new CallbackHandler(
      mockReviewPRUseCase,
      mockStateMachine,
      mockEventBus,
      {
        logger: mockLogger,
        githubAdapter: mockGitHubAdapter,
        config: mockConfig,
        confirmationManager: mockConfirmationManager
      }
    );
  });

  describe('_parseCallbackData', () => {
    test('should parse standard action callback', () => {
      const data = 'action:0:0:12345';
      const result = handler._parseCallbackData(data);

      expect(result).toEqual({
        action: 'action',
        instanceIdx: 0,
        repoIdx: 0,
        prId: '12345'
      });
    });

    test('should parse approve callback', () => {
      const data = 'approve:0:0:67890';
      const result = handler._parseCallbackData(data);

      expect(result).toEqual({
        action: 'approve',
        instanceIdx: 0,
        repoIdx: 0,
        prId: '67890'
      });
    });

    test('should parse reject callback', () => {
      const data = 'reject:1:0:another-repo-789';
      const result = handler._parseCallbackData(data);

      expect(result).toEqual({
        action: 'reject',
        instanceIdx: 1,
        repoIdx: 0,
        prId: 'another-repo-789'
      });
    });

    test('should parse close callback', () => {
      const data = 'close:0:0:11111';
      const result = handler._parseCallbackData(data);

      expect(result).toEqual({
        action: 'close',
        instanceIdx: 0,
        repoIdx: 0,
        prId: '11111'
      });
    });

    test('should parse skip callback', () => {
      const data = 'skip:0:0:22222';
      const result = handler._parseCallbackData(data);

      expect(result).toEqual({
        action: 'skip',
        instanceIdx: 0,
        repoIdx: 0,
        prId: '22222'
      });
    });

    test('should parse review_level callback with level', () => {
      const data = 'review_level:0:0:33333:low';
      const result = handler._parseCallbackData(data);

      expect(result).toEqual({
        action: 'review_level',
        instanceIdx: 0,
        repoIdx: 0,
        prId: '33333',
        level: 'low'
      });
    });

    test('should parse review_level callback with medium level', () => {
      const data = 'review_level:1:0:another-repo-333:medium';
      const result = handler._parseCallbackData(data);

      expect(result).toEqual({
        action: 'review_level',
        instanceIdx: 1,
        repoIdx: 0,
        prId: 'another-repo-333',
        level: 'medium'
      });
    });

    test('should parse review_level callback with high level', () => {
      const data = 'review_level:0:0:44444:high';
      const result = handler._parseCallbackData(data);

      expect(result).toEqual({
        action: 'review_level',
        instanceIdx: 0,
        repoIdx: 0,
        prId: '44444',
        level: 'high'
      });
    });

    test('should parse dismiss_outdated callback with reviewId', () => {
      const data = 'dismiss_outdated:0:0:12345:review-789';
      const result = handler._parseCallbackData(data);

      expect(result).toEqual({
        action: 'dismiss_outdated',
        instanceIdx: 0,
        repoIdx: 0,
        prId: '12345',
        reviewId: 'review-789'
      });
    });

    test('should parse cfm_y callback (confirm yes)', () => {
      const data = 'cfm_y:0:0:67890';
      const result = handler._parseCallbackData(data);

      expect(result).toEqual({
        action: 'cfm_y',
        instanceIdx: 0,
        repoIdx: 0,
        prId: '67890'
      });
    });

    test('should parse cfm_n callback (confirm no)', () => {
      const data = 'cfm_n:0:0:67890';
      const result = handler._parseCallbackData(data);

      expect(result).toEqual({
        action: 'cfm_n',
        instanceIdx: 0,
        repoIdx: 0,
        prId: '67890'
      });
    });

    test('should parse cfm_y callback with reviewId (outdated)', () => {
      const data = 'cfm_y:0:0:12345:review-789';
      const result = handler._parseCallbackData(data);

      expect(result).toEqual({
        action: 'cfm_y',
        instanceIdx: 0,
        repoIdx: 0,
        prId: '12345',
        reviewId: 'review-789'
      });
    });

    test('should parse cfm_n callback with reviewId (outdated)', () => {
      const data = 'cfm_n:0:0:12345:review-789';
      const result = handler._parseCallbackData(data);

      expect(result).toEqual({
        action: 'cfm_n',
        instanceIdx: 0,
        repoIdx: 0,
        prId: '12345',
        reviewId: 'review-789'
      });
    });

    test('should return null for invalid format (too few parts)', () => {
      const data = 'action:0:0';
      const result = handler._parseCallbackData(data);

      expect(result).toBeNull();
    });

    test('should return null for empty string', () => {
      const result = handler._parseCallbackData('');

      expect(result).toBeNull();
    });
  });

  describe('handleCallbackQuery - review_now (review level selection)', () => {
    test('should handle review_now callback successfully', async () => {
      const mockQuery = {
        data: 'review_now:0:0:12345',
        answer: jest.fn().mockResolvedValue(),
        message: { message_id: 999 }
      };

      // Mock bot.sendMessage
      handler.bot = {
        sendMessage: jest.fn().mockResolvedValue({ message_id: 1000 })
      };
      handler.chatId = 123;

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(result.action).toBe('show_levels');
      expect(mockQuery.answer).toHaveBeenCalledWith();
      expect(handler.bot.sendMessage).toHaveBeenCalled();
      expect(mockEventBus.emitAsync).toHaveBeenCalledWith('callback.handled', expect.any(Object));
    });

    test('should build keyboard with default levels', async () => {
      const mockQuery = {
        data: 'review_now:0:0:12345',
        answer: jest.fn().mockResolvedValue(),
        message: { message_id: 999 }
      };

      // Mock bot.sendMessage
      handler.bot = {
        sendMessage: jest.fn().mockResolvedValue({ message_id: 1000 })
      };
      handler.chatId = 123;

      await handler.handleCallbackQuery(mockQuery, mockConfig);

      const keyboard = handler.bot.sendMessage.mock.calls[0][2].reply_markup.inline_keyboard;
      expect(keyboard).toHaveLength(4); // low, medium, high + cancel
      expect(keyboard[0][0].text).toContain('LOW');
      expect(keyboard[1][0].text).toContain('MEDIUM');
      expect(keyboard[2][0].text).toContain('HIGH');
      expect(keyboard[3][0].text).toBe('❌ Batal');
    });

    test('should build keyboard with custom levels from config', async () => {
      const customConfig = {
        instances: {
          'github/testorg': {
            key: 'github/testorg',
            owner: 'testorg',
            agent: {
              level: ['low', 'high']
            },
            repos: {
              'test-repo': { name: 'test-repo', thread_id: 456 }
            }
          }
        }
      };

      const mockQuery = {
        data: 'review_now:0:0:12345',
        answer: jest.fn().mockResolvedValue(),
        message: { message_id: 999 }
      };

      // Mock bot.sendMessage
      handler.bot = {
        sendMessage: jest.fn().mockResolvedValue({ message_id: 1000 })
      };
      handler.chatId = 123;

      await handler.handleCallbackQuery(mockQuery, customConfig);

      const keyboard = handler.bot.sendMessage.mock.calls[0][2].reply_markup.inline_keyboard;
      expect(keyboard).toHaveLength(3); // low, high + cancel
      expect(keyboard[0][0].text).toContain('LOW');
      expect(keyboard[1][0].text).toContain('HIGH');
      expect(keyboard[2][0].text).toBe('❌ Batal');
    });
  });

  describe('handleCallbackQuery - approve', () => {
    test('should show confirmation keyboard on approve', async () => {
      const originalKeyboard = [[{ text: 'Approve', callback_data: 'approve:0:0:67890' }]];
      const mockQuery = {
        data: 'approve:0:0:67890',
        answer: jest.fn().mockResolvedValue(),
        editMessageReplyMarkup: jest.fn().mockResolvedValue(),
        message: {
          message_id: 500,
          chat: { id: 123 },
          reply_markup: { inline_keyboard: originalKeyboard }
        }
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(result.action).toBe('confirm_pending');
      expect(mockQuery.answer).toHaveBeenCalledWith('Konfirmasi approve...');
      expect(mockConfirmationManager.add).toHaveBeenCalledWith(
        123, 500, originalKeyboard, 'approve', {}
      );
      expect(mockQuery.editMessageReplyMarkup).toHaveBeenCalledWith({
        inline_keyboard: [
          [
            { text: '✅ Yes, Approve', callback_data: 'cfm_y:0:0:67890' },
            { text: '❌ No', callback_data: 'cfm_n:0:0:67890' }
          ]
        ]
      });
    });

    test('should fall back to direct approve when no confirmationManager', async () => {
      handler.confirmationManager = null;

      const mockQuery = {
        data: 'approve:0:0:67890',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(mockQuery.answer).toHaveBeenCalledWith('Approving PR...');
      expect(mockQuery.editMessageText).toHaveBeenCalledWith('✅ PR #99 approved');
      expect(mockReviewPRUseCase.approve).toHaveBeenCalled();
    });

    test('should fall back to direct approve when no messageId', async () => {
      handler.confirmationManager = null;

      const mockQuery = {
        data: 'approve:0:0:67890',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue(),
        message: {}
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(mockReviewPRUseCase.approve).toHaveBeenCalled();
    });
  });

  describe('handleCallbackQuery - cfm_y (confirm yes)', () => {
    test('should execute approve on confirm yes', async () => {
      const confirmation = {
        originalKeyboard: [[{ text: 'Approve', callback_data: 'approve:0:0:67890' }]],
        actionType: 'approve',
        extraData: {}
      };
      mockConfirmationManager.consume.mockReturnValue(confirmation);

      const mockQuery = {
        data: 'cfm_y:0:0:67890',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue(),
        message: { message_id: 500, chat: { id: 123 } }
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(mockConfirmationManager.consume).toHaveBeenCalledWith(123, 500);
      expect(mockQuery.answer).toHaveBeenCalledWith('Approving PR...');
      expect(mockQuery.editMessageText).toHaveBeenCalledWith('✅ PR #99 approved');
      expect(mockReviewPRUseCase.approve).toHaveBeenCalled();
    });

    test('should execute approve_outdated on confirm yes with reviewId', async () => {
      const confirmation = {
        originalKeyboard: [],
        actionType: 'approve_outdated',
        extraData: { reviewId: 'review-789' }
      };
      mockConfirmationManager.consume.mockReturnValue(confirmation);

      const mockStateRepo = {
        clearReviewState: jest.fn().mockResolvedValue(),
        markProcessed: jest.fn().mockResolvedValue()
      };
      handler.stateRepositoryFactory = {
        create: jest.fn().mockReturnValue(mockStateRepo)
      };

      const mockQuery = {
        data: 'cfm_y:0:0:12345:review-789',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue(),
        message: { message_id: 500, chat: { id: 123 } }
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(mockConfirmationManager.consume).toHaveBeenCalledWith(123, 500);
      expect(mockQuery.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('approved!')
      );
      expect(mockStateRepo.clearReviewState).toHaveBeenCalled();
    });

    test('should handle expired confirmation on confirm yes', async () => {
      mockConfirmationManager.consume.mockReturnValue(null);

      const mockQuery = {
        data: 'cfm_y:0:0:67890',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue(),
        message: { message_id: 500, chat: { id: 123 } }
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(false);
      expect(result.action).toBe('expired');
      expect(mockQuery.answer).toHaveBeenCalledWith('Confirmation expired', true);
      expect(mockReviewPRUseCase.approve).not.toHaveBeenCalled();
    });
  });

  describe('handleCallbackQuery - cfm_n (confirm no)', () => {
    test('should restore original keyboard on confirm no', async () => {
      const originalKeyboard = [[{ text: 'Approve', callback_data: 'approve:0:0:67890' }]];
      const confirmation = {
        originalKeyboard,
        actionType: 'approve',
        extraData: {}
      };
      mockConfirmationManager.consume.mockReturnValue(confirmation);

      const mockQuery = {
        data: 'cfm_n:0:0:67890',
        answer: jest.fn().mockResolvedValue(),
        editMessageReplyMarkup: jest.fn().mockResolvedValue(),
        message: { message_id: 500, chat: { id: 123 } }
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(result.action).toBe('confirm_cancelled');
      expect(mockQuery.answer).toHaveBeenCalledWith('Approval cancelled');
      expect(mockQuery.editMessageReplyMarkup).toHaveBeenCalledWith({
        inline_keyboard: originalKeyboard
      });
    });

    test('should handle expired confirmation on confirm no', async () => {
      mockConfirmationManager.consume.mockReturnValue(null);

      const mockQuery = {
        data: 'cfm_n:0:0:67890',
        answer: jest.fn().mockResolvedValue(),
        message: { message_id: 500, chat: { id: 123 } }
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(false);
      expect(result.action).toBe('expired');
      expect(mockQuery.answer).toHaveBeenCalledWith('Confirmation expired', true);
    });
  });

  describe('handleCallbackQuery - reject', () => {
    test('should handle reject callback successfully', async () => {
      const mockQuery = {
        data: 'reject:0:0:55555',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(mockQuery.answer).toHaveBeenCalledWith('Requesting changes...');
      expect(mockQuery.editMessageText).toHaveBeenCalledWith('❌ Changes requested for PR #104');
      expect(mockReviewPRUseCase.reject).toHaveBeenCalled();
      expect(mockEventBus.emitAsync).toHaveBeenCalledWith('callback.handled', expect.any(Object));
    });

    test('should handle reject failure', async () => {
      mockReviewPRUseCase.reject.mockResolvedValue({
        success: false,
        error: 'Reject failed'
      });

      const mockQuery = {
        data: 'reject:0:0:55555',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(false);
      expect(mockQuery.answer).toHaveBeenCalledWith('Failed to reject: Reject failed', true);
    });
  });

  describe('handleCallbackQuery - close', () => {
    test('should handle close callback successfully', async () => {
      const mockQuery = {
        data: 'close:0:0:11111',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(mockQuery.answer).toHaveBeenCalledWith('Closing PR...');
      expect(mockQuery.editMessageText).toHaveBeenCalledWith('🔒 PR #100 closed');
      expect(mockReviewPRUseCase.close).toHaveBeenCalled();
      expect(mockEventBus.emitAsync).toHaveBeenCalledWith('callback.handled', expect.any(Object));
    });

    test('should handle close failure', async () => {
      mockReviewPRUseCase.close.mockResolvedValue({
        success: false,
        error: 'Close failed'
      });

      const mockQuery = {
        data: 'close:0:0:11111',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(false);
      expect(mockQuery.answer).toHaveBeenCalledWith('Failed to close: Close failed', true);
    });
  });

  describe('handleCallbackQuery - skip', () => {
    test('should handle skip callback successfully', async () => {
      const mockQuery = {
        data: 'skip:0:0:22222',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(mockQuery.answer).toHaveBeenCalledWith('Skipping...');
      expect(mockQuery.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('Notifications skipped until')
      );
      expect(mockReviewPRUseCase.skip).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
        3 * 60 * 60 * 1000 // 3 hours
      );
      expect(mockEventBus.emitAsync).toHaveBeenCalledWith('callback.handled', expect.any(Object));
    });

    test('should handle skip failure', async () => {
      mockReviewPRUseCase.skip.mockResolvedValue({
        success: false,
        error: 'Skip failed'
      });

      const mockQuery = {
        data: 'skip:0:0:22222',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(false);
      expect(mockQuery.answer).toHaveBeenCalledWith('Failed to skip: Skip failed', true);
    });
  });

  describe('handleCallbackQuery - review_level', () => {
    test('should handle review_level with low level', async () => {
      const mockQuery = {
        data: 'review_level:0:0:33333:low',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(mockQuery.answer).toHaveBeenCalledWith('🚀 Running low review...');
      expect(mockQuery.editMessageText).toHaveBeenCalledTimes(2);
      expect(mockQuery.editMessageText).toHaveBeenNthCalledWith(1,
        expect.stringContaining('LOW Review sedang berjalan'),
        expect.objectContaining({
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] }
        })
      );
      expect(mockQuery.editMessageText).toHaveBeenNthCalledWith(2,
        expect.stringContaining('LOW review completed')
      );
      expect(mockReviewPRUseCase.execute).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
        'low',
        expect.any(Object)
      );
      expect(mockEventBus.emitAsync).toHaveBeenCalledWith('callback.handled', expect.any(Object));
    });

    test('should handle review_level with medium level', async () => {
      const mockQuery = {
        data: 'review_level:1:0:another-repo-333:medium',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(mockQuery.answer).toHaveBeenCalledWith('🚀 Running medium review...');
      expect(mockQuery.editMessageText).toHaveBeenCalledTimes(2);
      expect(mockReviewPRUseCase.execute).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
        'medium',
        expect.any(Object)
      );
    });

    test('should handle review_level with high level', async () => {
      const mockQuery = {
        data: 'review_level:0:0:44444:high',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(mockQuery.answer).toHaveBeenCalledWith('🚀 Running high review...');
      expect(mockQuery.editMessageText).toHaveBeenCalledTimes(2);
      expect(mockReviewPRUseCase.execute).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
        'high',
        expect.any(Object)
      );
    });

    test('should handle review_level failure', async () => {
      mockReviewPRUseCase.execute.mockResolvedValue({
        success: false,
        error: 'Review failed'
      });

      const mockQuery = {
        data: 'review_level:0:0:33333:low',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(false);
      expect(mockQuery.editMessageText).toHaveBeenCalledTimes(2);
      expect(mockQuery.editMessageText).toHaveBeenNthCalledWith(2, '❌ Review failed: Review failed');
    });

    test('should show comment count in final editMessageText', async () => {
      mockReviewPRUseCase.execute.mockResolvedValue({
        success: true,
        reviewResult: {
          comments: [
            { id: 1, body: 'Comment 1' },
            { id: 2, body: 'Comment 2' },
            { id: 3, body: 'Comment 3' }
          ]
        }
      });

      const mockQuery = {
        data: 'review_level:0:0:33333:medium',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(mockQuery.editMessageText).toHaveBeenNthCalledWith(2,
        '✅ MEDIUM review completed\n3 comments added'
      );
    });

    test('should show processing confirmation with empty keyboard before review', async () => {
      const mockQuery = {
        data: 'review_level:0:0:33333:high',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      await handler.handleCallbackQuery(mockQuery, mockConfig);

      const firstCall = mockQuery.editMessageText.mock.calls[0];
      expect(firstCall[0]).toContain('HIGH Review sedang berjalan');
      expect(firstCall[0]).toContain('Estimasi waktu: ~20 menit');
      expect(firstCall[1]).toEqual(
        expect.objectContaining({
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] }
        })
      );
    });

    test('should use custom timeout string from config', async () => {
      const customConfig = {
        instances: {
          'github/testorg': {
            key: 'github/testorg',
            owner: 'testorg',
            agent: {
              review_timeot_string: '30 menit'
            },
            repos: {
              'test-repo': { name: 'test-repo', thread_id: 456 }
            }
          }
        }
      };

      const mockQuery = {
        data: 'review_level:0:0:33333:low',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      await handler.handleCallbackQuery(mockQuery, customConfig);

      const firstCall = mockQuery.editMessageText.mock.calls[0];
      expect(firstCall[0]).toContain('Estimasi waktu: ~30 menit');
    });

    test('should use default timeout string when not configured', async () => {
      const noAgentConfig = {
        instances: {
          'github/testorg': {
            key: 'github/testorg',
            owner: 'testorg',
            repos: {
              'test-repo': { name: 'test-repo', thread_id: 456 }
            }
          }
        }
      };

      const mockQuery = {
        data: 'review_level:0:0:33333:low',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      await handler.handleCallbackQuery(mockQuery, noAgentConfig);

      const firstCall = mockQuery.editMessageText.mock.calls[0];
      expect(firstCall[0]).toContain('Estimasi waktu: ~20 menit');
    });
  });

  describe('handleCallbackQuery - dismiss', () => {
    test('should handle dismiss_outdated callback for outdated reviews', async () => {
      const mockQuery = {
        data: 'dismiss_outdated:0:0:12345:review-789',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      // Mock checkOutdatedReviewsUseCase
      handler.checkOutdatedReviewsUseCase = {
        dismissOutdatedReview: jest.fn().mockResolvedValue({ success: true })
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(mockQuery.answer).toHaveBeenCalledWith('Dismissing...');
      expect(mockQuery.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('Dismissed outdated review notification')
      );
      expect(mockEventBus.emitAsync).toHaveBeenCalledWith('callback.handled', expect.any(Object));
    });
  });

  describe('handleCallbackQuery - error handling', () => {
    test('should handle invalid callback data format', async () => {
      const mockQuery = {
        data: 'invalid-format',
        answer: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid callback data format');
      expect(mockEventBus.emitAsync).toHaveBeenCalledWith('callback.error', expect.any(Object));
    });

    test('should handle unknown action', async () => {
      const mockQuery = {
        data: 'unknown:0:0:pr_123',
        answer: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown callback action: unknown');
    });

    test('should handle exception during callback processing', async () => {
      const mockQuery = {
        data: 'approve:99:99:pr_999',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(false);
      expect(mockEventBus.emitAsync).toHaveBeenCalledWith('callback.error', expect.any(Object));
    });
  });

  describe('_getInstance', () => {
    test('should return instance at index 0', () => {
      const instance = handler._getInstance(mockConfig, 0);

      expect(instance).toEqual({
        ...mockConfig.instances['github/testorg'],
        instanceIdx: 0
      });
      expect(instance.key).toBe('github/testorg');
    });

    test('should return instance at index 1', () => {
      const instance = handler._getInstance(mockConfig, 1);

      expect(instance).toEqual({
        ...mockConfig.instances['github/otherorg'],
        instanceIdx: 1
      });
      expect(instance.key).toBe('github/otherorg');
    });

    test('should throw error for invalid index', () => {
      expect(() => handler._getInstance(mockConfig, 99)).toThrow('Instance not found at index 99');
    });
  });

  describe('_getRepo', () => {
    const mockInstance = {
      key: 'github/testorg',
      repos: {
        'test-repo': { name: 'test-repo', thread_id: 456 },
        'another-repo': { name: 'another-repo', thread_id: 789 }
      }
    };

    test('should return repo at index 0', () => {
      const repo = handler._getRepo(mockInstance, 0);

      expect(repo).toEqual({
        name: 'test-repo',
        threadId: 456,
        instanceKey: 'github/testorg',
        repoIdx: 0
      });
    });

    test('should return repo at index 1', () => {
      const repo = handler._getRepo(mockInstance, 1);

      expect(repo).toEqual({
        name: 'another-repo',
        threadId: 789,
        instanceKey: 'github/testorg',
        repoIdx: 1
      });
    });

    test('should throw error for invalid index', () => {
      expect(() => handler._getRepo(mockInstance, 99)).toThrow('Repository not found at index 99');
    });
  });

  describe('_buildPREntity', () => {
    test('should build placeholder PR entity with node ID', () => {
      const callback = {
        instanceIdx: 0,
        repoIdx: 0,
        prId: '12345'
      };

      const repo = {
        name: 'test-repo',
        instanceKey: 'github/testorg'
      };

      const pr = handler._buildPREntity(callback, repo);

      expect(pr).toHaveProperty('id', 12345);
      expect(pr).toHaveProperty('number', 0); // Placeholder - resolved later via _resolveFreshPR
      expect(pr).toHaveProperty('owner', 'testorg');
      expect(pr).toHaveProperty('repo', 'test-repo');
    });

    test('should store node ID as id field', () => {
      const callback = {
        instanceIdx: 0,
        repoIdx: 0,
        prId: '67890'
      };

      const repo = {
        name: 'test-repo',
        instanceKey: 'github/testorg'
      };

      const pr = handler._buildPREntity(callback, repo);
      expect(pr.id).toBe(67890);
      expect(pr.number).toBe(0);
    });
  });

  describe('_escapeHtml', () => {
    test('should escape HTML special characters', () => {
      const input = '<script>alert("test")</script>';
      const output = handler._escapeHtml(input);

      expect(output).toBe('&lt;script&gt;alert(&quot;test&quot;)&lt;/script&gt;');
    });

    test('should escape ampersand first', () => {
      const input = 'a & b < c';
      const output = handler._escapeHtml(input);

      expect(output).toBe('a &amp; b &lt; c');
    });

    test('should handle empty string', () => {
      expect(handler._escapeHtml('')).toBe('');
    });

    test('should handle null/undefined', () => {
      expect(handler._escapeHtml(null)).toBe('');
      expect(handler._escapeHtml(undefined)).toBe('');
    });
  });

  describe('_buildLevelKeyboard', () => {
    test('should build keyboard with all levels', () => {
      const instance = {
        key: 'github/testorg',
        agent: {
          level: ['low', 'medium', 'high']
        },
        repos: {
          'test-repo': { name: 'test-repo' }
        }
      };

      const repo = {
        name: 'test-repo'
      };

      const pr = { id: '42', number: 123, title: 'Test PR' };

      const keyboard = handler._buildLevelKeyboard(instance, repo, pr);

      expect(keyboard).toHaveLength(3);
      expect(keyboard[0][0]).toEqual({
        text: 'LOW',
        callback_data: expect.stringContaining('review_level:')
      });
    });
  });

  describe('handleCallbackQuery - review_level_outdated', () => {
    test('should show processing confirmation with empty keyboard before re-review', async () => {
      const mockQuery = {
        data: 'review_level_outdated:0:0:12345:review-789:high',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      handler.stateRepositoryFactory = {
        create: jest.fn().mockReturnValue({
          clearReviewState: jest.fn().mockResolvedValue()
        })
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(mockQuery.editMessageText).toHaveBeenCalledTimes(2);

      const firstCall = mockQuery.editMessageText.mock.calls[0];
      expect(firstCall[0]).toContain('HIGH Re-review sedang berjalan');
      expect(firstCall[0]).toContain('Estimasi waktu: ~20 menit');
      expect(firstCall[1]).toEqual(
        expect.objectContaining({
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] }
        })
      );

      const secondCall = mockQuery.editMessageText.mock.calls[1];
      expect(secondCall[0]).toContain('HIGH re-review completed');
    });

    test('should handle review_level_outdated failure', async () => {
      mockReviewPRUseCase.execute.mockResolvedValue({
        success: false,
        error: 'Re-review failed'
      });

      const mockQuery = {
        data: 'review_level_outdated:0:0:12345:review-789:medium',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      handler.stateRepositoryFactory = {
        create: jest.fn().mockReturnValue({
          clearReviewState: jest.fn().mockResolvedValue()
        })
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(false);
      expect(mockQuery.editMessageText).toHaveBeenCalledTimes(2);
      expect(mockQuery.editMessageText).toHaveBeenNthCalledWith(2, '❌ Review failed: Re-review failed');
    });

    test('should clear review state after successful outdated re-review', async () => {
      const mockClearReviewState = jest.fn().mockResolvedValue();
      handler.stateRepositoryFactory = {
        create: jest.fn().mockReturnValue({
          clearReviewState: mockClearReviewState
        })
      };

      const mockQuery = {
        data: 'review_level_outdated:0:0:12345:review-789:low',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(handler.stateRepositoryFactory.create).toHaveBeenCalledWith('testorg', 'test-repo');
      expect(mockClearReviewState).toHaveBeenCalled();
    });

    test('should use custom timeout string for outdated re-review', async () => {
      const customConfig = {
        instances: {
          'github/testorg': {
            key: 'github/testorg',
            owner: 'testorg',
            agent: {
              review_timeot_string: '30 menit'
            },
            repos: {
              'test-repo': { name: 'test-repo', thread_id: 456 }
            }
          }
        }
      };

      const mockQuery = {
        data: 'review_level_outdated:0:0:12345:review-789:low',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      handler.stateRepositoryFactory = {
        create: jest.fn().mockReturnValue({
          clearReviewState: jest.fn().mockResolvedValue()
        })
      };

      await handler.handleCallbackQuery(mockQuery, customConfig);

      const firstCall = mockQuery.editMessageText.mock.calls[0];
      expect(firstCall[0]).toContain('Estimasi waktu: ~30 menit');
    });
  });
});
