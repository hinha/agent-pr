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
    mockStateMachine.getState = jest.fn().mockResolvedValue('notified');
    mockStateMachine.isTerminalState = jest.fn().mockReturnValue(false);
    mockStateMachine.markAsSkipped = jest.fn().mockResolvedValue({
      success: true,
      currentState: 'skipped'
    });
    mockStateMachine.transition = jest.fn().mockResolvedValue({
      currentState: 'skipped',
      notificationCount: 1
    });

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
            review_timeot_string: '20 minutes'
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
            review_timeot_string: '20 minutes'
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

    test('should parse silent callback', () => {
      const data = 'silent:0:0:22222';
      const result = handler._parseCallbackData(data);

      expect(result).toEqual({
        action: 'silent',
        instanceIdx: 0,
        repoIdx: 0,
        prId: '22222'
      });
    });

    test('should parse silent_dur callback with hours', () => {
      const data = 'silent_dur:0:0:22222:8';
      const result = handler._parseCallbackData(data);

      expect(result).toEqual({
        action: 'silent_dur',
        instanceIdx: 0,
        repoIdx: 0,
        prId: '22222',
        hours: 8
      });
    });

    test('should parse silent_dur callback with 48 hours (2 days)', () => {
      const data = 'silent_dur:0:0:22222:48';
      const result = handler._parseCallbackData(data);

      expect(result).toEqual({
        action: 'silent_dur',
        instanceIdx: 0,
        repoIdx: 0,
        prId: '22222',
        hours: 48
      });
    });

    test('should parse silent_custom callback', () => {
      const data = 'silent_custom:0:0:22222';
      const result = handler._parseCallbackData(data);

      expect(result).toEqual({
        action: 'silent_custom',
        instanceIdx: 0,
        repoIdx: 0,
        prId: '22222'
      });
    });

    test('should reject silent_dur with invalid hours (not in whitelist)', () => {
      const data = 'silent_dur:0:0:22222:5';
      const result = handler._parseCallbackData(data);

      expect(result).toBeNull();
    });

    test('should reject silent_dur with negative hours', () => {
      const data = 'silent_dur:0:0:22222:-1';
      const result = handler._parseCallbackData(data);

      expect(result).toBeNull();
    });

    test('should reject silent_dur with NaN hours', () => {
      const data = 'silent_dur:0:0:22222:abc';
      const result = handler._parseCallbackData(data);

      expect(result).toBeNull();
    });

    test('should reject silent_dur with zero hours', () => {
      const data = 'silent_dur:0:0:22222:0';
      const result = handler._parseCallbackData(data);

      expect(result).toBeNull();
    });

    test('should reject silent_dur with hours exceeding max', () => {
      const data = 'silent_dur:0:0:22222:100';
      const result = handler._parseCallbackData(data);

      expect(result).toBeNull();
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
      expect(keyboard[3][0].text).toBe('❌ Cancel');
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
      expect(keyboard[2][0].text).toBe('❌ Cancel');
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
      expect(mockQuery.answer).toHaveBeenCalledWith('Confirming approval...');
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

  describe('handleCallbackQuery - silent', () => {
    test('should show duration selection keyboard', async () => {
      const mockQuery = {
        data: 'silent:0:0:12345',
        answer: jest.fn().mockResolvedValue(),
        message: { message_id: 999 }
      };

      handler.bot = {
        sendMessage: jest.fn().mockResolvedValue({ message_id: 1000 })
      };
      handler.chatId = 123;

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(result.action).toBe('show_silent_options');
      expect(mockQuery.answer).toHaveBeenCalledWith();
      expect(handler.bot.sendMessage).toHaveBeenCalled();

      const sendMessageCall = handler.bot.sendMessage.mock.calls[0];
      expect(sendMessageCall[0]).toBe(123); // chatId
      expect(sendMessageCall[1]).toContain('Silent Mode');
      expect(sendMessageCall[2].message_thread_id).toBe(456); // threadId

      const keyboard = sendMessageCall[2].reply_markup.inline_keyboard;
      expect(keyboard).toHaveLength(3);
      expect(keyboard[0][0].text).toBe('🔇 3 Hours');
      expect(keyboard[0][1].text).toBe('🔇 6 Hours');
      expect(keyboard[1][0].text).toBe('🔇 8 Hours');
      expect(keyboard[1][1].text).toBe('✏️ Custom');
      expect(keyboard[2][0].text).toBe('❌ Cancel');
    });
  });

  describe('handleCallbackQuery - silent_dur', () => {
    test('should execute silent with 3 hours', async () => {
      const mockQuery = {
        data: 'silent_dur:0:0:12345:3',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(mockQuery.answer).toHaveBeenCalledWith('Silencing...');
      expect(mockReviewPRUseCase.skip).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
        3 * 60 * 60 * 1000
      );
      expect(mockQuery.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('silenced for 3 hours'),
        { parse_mode: 'HTML' }
      );
    });

    test('should execute silent with 8 hours', async () => {
      const mockQuery = {
        data: 'silent_dur:0:0:12345:8',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(mockReviewPRUseCase.skip).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
        8 * 60 * 60 * 1000
      );
    });

    test('should execute silent with 48 hours (2 days)', async () => {
      const mockQuery = {
        data: 'silent_dur:0:0:12345:48',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(mockReviewPRUseCase.skip).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
        48 * 60 * 60 * 1000
      );
      expect(mockQuery.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('silenced for 48 hours'),
        { parse_mode: 'HTML' }
      );
    });

    test('should handle silent_dur failure', async () => {
      mockReviewPRUseCase.skip.mockResolvedValue({
        success: false,
        error: 'Silent failed'
      });

      const mockQuery = {
        data: 'silent_dur:0:0:12345:6',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(false);
      expect(mockQuery.answer).toHaveBeenCalledWith('Failed to silent: Silent failed', true);
    });

    test('should inform user when PR is already approved (no silent needed)', async () => {
      const mockQuery = {
        data: 'silent_dur:0:0:12345:6',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      // PR is in approved state
      handler.stateMachine.getState = jest.fn().mockResolvedValue('approved');

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(result.alreadyFinal).toBe(true);
      expect(result.currentState).toBe('approved');
      expect(mockQuery.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('has been approved'),
        { parse_mode: 'HTML' }
      );
      expect(mockReviewPRUseCase.skip).not.toHaveBeenCalled();
    });

    test('should inform user when PR is closed (no silent needed)', async () => {
      const mockQuery = {
        data: 'silent_dur:0:0:12345:3',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      handler.stateMachine.getState = jest.fn().mockResolvedValue('closed');

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(result.alreadyFinal).toBe(true);
      expect(mockQuery.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('has been closed'),
        { parse_mode: 'HTML' }
      );
    });

    test('should inform user when PR is processed (no silent needed)', async () => {
      const mockQuery = {
        data: 'silent_dur:0:0:12345:8',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      handler.stateMachine.getState = jest.fn().mockResolvedValue('processed');

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(result.alreadyFinal).toBe(true);
      expect(mockQuery.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('has been fully processed'),
        { parse_mode: 'HTML' }
      );
    });

    test('should inform user when PR is rejected (no silent needed)', async () => {
      const mockQuery = {
        data: 'silent_dur:0:0:12345:3',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      handler.stateMachine.getState = jest.fn().mockResolvedValue('rejected');

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(result.alreadyFinal).toBe(true);
      expect(mockQuery.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('Changes were requested for this PR'),
        { parse_mode: 'HTML' }
      );
    });
  });

  describe('handleCallbackQuery - silent_custom', () => {
    test('should show secondary keyboard with more durations', async () => {
      const mockQuery = {
        data: 'silent_custom:0:0:12345',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(result.action).toBe('show_custom_silent_options');
      expect(mockQuery.answer).toHaveBeenCalledWith();
      expect(mockQuery.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('Custom Duration'),
        expect.objectContaining({
          parse_mode: 'HTML',
          reply_markup: expect.any(Object)
        })
      );

      const keyboard = mockQuery.editMessageText.mock.calls[0][1].reply_markup.inline_keyboard;
      expect(keyboard).toHaveLength(4);
      expect(keyboard[0][0].text).toBe('🔇 1 Hour');
      expect(keyboard[0][1].text).toBe('🔇 2 Hours');
      expect(keyboard[1][0].text).toBe('🔇 4 Hours');
      expect(keyboard[1][1].text).toBe('🔇 12 Hours');
      expect(keyboard[2][0].text).toBe('🔇 24 Hours');
      expect(keyboard[2][1].text).toBe('🔇 2 Days');
      expect(keyboard[3][0].text).toBe('❌ Cancel');
    });

    test('should use silent_dur callback format for custom durations', async () => {
      const mockQuery = {
        data: 'silent_custom:0:0:12345',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      await handler.handleCallbackQuery(mockQuery, mockConfig);

      const keyboard = mockQuery.editMessageText.mock.calls[0][1].reply_markup.inline_keyboard;

      // Verify all duration buttons use silent_dur format
      expect(keyboard[0][0].callback_data).toBe('silent_dur:0:0:12345:1');
      expect(keyboard[0][1].callback_data).toBe('silent_dur:0:0:12345:2');
      expect(keyboard[1][0].callback_data).toBe('silent_dur:0:0:12345:4');
      expect(keyboard[1][1].callback_data).toBe('silent_dur:0:0:12345:12');
      expect(keyboard[2][0].callback_data).toBe('silent_dur:0:0:12345:24');
      expect(keyboard[2][1].callback_data).toBe('silent_dur:0:0:12345:48');
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
      expect(mockQuery.answer).toHaveBeenCalledWith(expect.stringContaining('queue'));
      expect(mockQuery.editMessageText).toHaveBeenCalledTimes(2);
      expect(mockQuery.editMessageText).toHaveBeenNthCalledWith(1,
        expect.stringContaining('LOW Review in progress'),
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
      expect(mockQuery.answer).toHaveBeenCalledWith(expect.stringContaining('queue'));
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
      expect(mockQuery.answer).toHaveBeenCalledWith(expect.stringContaining('queue'));
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
      expect(firstCall[0]).toContain('HIGH Review in progress');
      expect(firstCall[0]).toContain('Estimated time: ~20 minutes');
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
              review_timeot_string: '30 minutes'
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
      expect(firstCall[0]).toContain('Estimated time: ~30 minutes');
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
      expect(firstCall[0]).toContain('Estimated time: ~20 minutes');
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
      expect(firstCall[0]).toContain('HIGH Re-review in progress');
      expect(firstCall[0]).toContain('Estimated time: ~20 minutes');
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
              review_timeot_string: '30 minutes'
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
      expect(firstCall[0]).toContain('Estimated time: ~30 minutes');
    });
  });

  describe('handleCallbackQuery - visit', () => {
    test('should handle visit callback successfully', async () => {
      const mockQuery = {
        data: 'visit:0:0:12345',
        answer: jest.fn().mockResolvedValue(),
        message: { message_id: 999 }
      };

      const mockFreshPR = {
        id: 12345,
        number: 42,
        url: 'https://github.com/testorg/test-repo/pull/42'
      };

      const mockGithubAdapter = {
        getOpenPRs: jest.fn().mockResolvedValue([mockFreshPR])
      };

      handler.githubAdapter = {
        create: jest.fn().mockReturnValue(mockGithubAdapter)
      };

      handler.bot = {
        sendMessage: jest.fn().mockResolvedValue({ message_id: 1000 })
      };
      handler.chatId = 123;

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(result.action).toBe('visit');
      expect(mockQuery.answer).toHaveBeenCalledWith('🔗 Opening PR page...');
      expect(mockGithubAdapter.getOpenPRs).toHaveBeenCalled();
      expect(handler.bot.sendMessage).toHaveBeenCalledWith(
        123,
        expect.stringContaining('PR URL'),
        expect.objectContaining({
          message_thread_id: 456
        })
      );
    });
  });

  describe('handleCallbackQuery - review_cancel', () => {
    test('should handle review_cancel callback successfully', async () => {
      const mockQuery = {
        data: 'review_cancel:0:0:12345',
        answer: jest.fn().mockResolvedValue(),
        deleteMessage: jest.fn().mockResolvedValue(),
        message: { message_id: 999 }
      };

      handler.bot = {
        deleteMessage: jest.fn().mockResolvedValue()
      };
      handler.chatId = 123;

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(result.action).toBe('cancelled');
      expect(mockQuery.answer).toHaveBeenCalledWith('❌ Review cancelled');
      expect(handler.bot.deleteMessage).toHaveBeenCalledWith(123, 999);
    });
  });

  describe('handleCallbackQuery - approve_outdated', () => {
    test('should show confirmation keyboard on approve_outdated', async () => {
      const originalKeyboard = [[{ text: 'Approve Outdated', callback_data: 'approve_outdated:0:0:12345:review-789' }]];
      const mockQuery = {
        data: 'approve_outdated:0:0:12345:review-789',
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
      expect(mockQuery.answer).toHaveBeenCalledWith('Confirming approval...');
      expect(mockConfirmationManager.add).toHaveBeenCalledWith(
        123, 500, originalKeyboard, 'approve_outdated', { reviewId: 'review-789' }
      );
      expect(mockQuery.editMessageReplyMarkup).toHaveBeenCalledWith({
        inline_keyboard: [
          [
            { text: '✅ Yes, Approve', callback_data: 'cfm_y:0:0:12345:review-789' },
            { text: '❌ No', callback_data: 'cfm_n:0:0:12345:review-789' }
          ]
        ]
      });
    });

    test('should fall back to direct execute when no confirmationManager', async () => {
      handler.confirmationManager = null;

      const mockStateRepo = {
        clearReviewState: jest.fn().mockResolvedValue(),
        markProcessed: jest.fn().mockResolvedValue()
      };
      handler.stateRepositoryFactory = {
        create: jest.fn().mockReturnValue(mockStateRepo)
      };

      const mockQuery = {
        data: 'approve_outdated:0:0:12345:review-789',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(mockQuery.answer).toHaveBeenCalledWith('Approving PR...');
      expect(mockQuery.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('approved!')
      );
      expect(mockStateRepo.clearReviewState).toHaveBeenCalled();
      expect(mockStateRepo.markProcessed).toHaveBeenCalled();
    });

    test('should fall back to direct execute when no messageId', async () => {
      handler.confirmationManager = null;

      const mockQuery = {
        data: 'approve_outdated:0:0:12345:review-789',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue(),
        message: {}
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(mockReviewPRUseCase.approve).toHaveBeenCalled();
    });

    test('should handle approve_outdated failure', async () => {
      handler.confirmationManager = null;
      mockReviewPRUseCase.approve.mockResolvedValue({
        success: false,
        error: 'Approve outdated failed'
      });

      const mockQuery = {
        data: 'approve_outdated:0:0:12345:review-789',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(false);
      expect(mockQuery.answer).toHaveBeenCalledWith('Failed to approve: Approve outdated failed', true);
    });
  });

  describe('handleCallbackQuery - re_review', () => {
    test('should show level selection keyboard for re-review', async () => {
      const mockQuery = {
        data: 're_review:0:0:12345:review-789',
        answer: jest.fn().mockResolvedValue(),
        editMessageReplyMarkup: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(result.action).toBe('show_re_review_levels');
      expect(mockQuery.answer).toHaveBeenCalledWith();
      expect(mockQuery.editMessageReplyMarkup).toHaveBeenCalledWith({
        inline_keyboard: expect.any(Array)
      });

      const keyboard = mockQuery.editMessageReplyMarkup.mock.calls[0][0].inline_keyboard;
      // Default levels: low, medium, high + cancel = 4 rows
      expect(keyboard).toHaveLength(4);
      expect(keyboard[0][0].text).toContain('LOW');
      expect(keyboard[0][0].callback_data).toBe('review_level_outdated:0:0:12345:review-789:low');
      expect(keyboard[1][0].text).toContain('MEDIUM');
      expect(keyboard[1][0].callback_data).toBe('review_level_outdated:0:0:12345:review-789:medium');
      expect(keyboard[2][0].text).toContain('HIGH');
      expect(keyboard[2][0].callback_data).toBe('review_level_outdated:0:0:12345:review-789:high');
      expect(keyboard[3][0].text).toBe('❌ Cancel');
      expect(keyboard[3][0].callback_data).toBe('review_cancel:0:0:12345');
    });

    test('should build keyboard with custom levels from config for re-review', async () => {
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
        data: 're_review:0:0:12345:review-abc',
        answer: jest.fn().mockResolvedValue(),
        editMessageReplyMarkup: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, customConfig);

      expect(result.success).toBe(true);
      const keyboard = mockQuery.editMessageReplyMarkup.mock.calls[0][0].inline_keyboard;
      expect(keyboard).toHaveLength(3); // low, high + cancel
      expect(keyboard[0][0].callback_data).toBe('review_level_outdated:0:0:12345:review-abc:low');
      expect(keyboard[1][0].callback_data).toBe('review_level_outdated:0:0:12345:review-abc:high');
    });
  });

  describe('_executeApprove - failure path', () => {
    test('should answer with error alert when approve fails', async () => {
      mockReviewPRUseCase.approve.mockResolvedValue({
        success: false,
        error: 'Approve failed'
      });

      handler.confirmationManager = null;

      const mockQuery = {
        data: 'approve:0:0:67890',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Approve failed');
      expect(mockQuery.answer).toHaveBeenCalledWith('Failed to approve: Approve failed', true);
    });
  });

  describe('_handleReviewLevel - queue integration', () => {
    test('should show queue full error when reviewQueueUseCase returns failure', async () => {
      handler.reviewQueueUseCase = {
        enqueueReview: jest.fn().mockResolvedValue({
          success: false,
          error: 'Queue is full',
          currentSize: 5,
          maxSize: 5
        })
      };

      const mockQuery = {
        data: 'review_level:0:0:12345:low',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Queue is full');
      expect(mockQuery.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('Queue Full'),
        { parse_mode: 'HTML' }
      );
      expect(mockQuery.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('5/5'),
        { parse_mode: 'HTML' }
      );
    });

    test('should show queue status on successful enqueue', async () => {
      handler.reviewQueueUseCase = {
        enqueueReview: jest.fn().mockResolvedValue({
          success: true,
          position: 2,
          estimatedWaitTime: 10 * 60 * 1000 // 10 minutes
        })
      };

      const mockQuery = {
        data: 'review_level:0:0:12345:low',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(result.action).toBe('queued');
      expect(result.position).toBe(2);
      expect(mockQuery.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('Review Queued'),
        { parse_mode: 'HTML' }
      );
      expect(mockQuery.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('LOW'),
        { parse_mode: 'HTML' }
      );
      expect(mockQuery.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('#2'),
        { parse_mode: 'HTML' }
      );
      expect(mockQuery.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('~10 minutes'),
        { parse_mode: 'HTML' }
      );
    });

    test('should omit wait time when estimatedWaitTime is not provided', async () => {
      handler.reviewQueueUseCase = {
        enqueueReview: jest.fn().mockResolvedValue({
          success: true,
          position: 1
        })
      };

      const mockQuery = {
        data: 'review_level:0:0:12345:medium',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(result.action).toBe('queued');
      expect(mockQuery.editMessageText).toHaveBeenCalledWith(
        expect.not.stringContaining('Estimated wait'),
        { parse_mode: 'HTML' }
      );
    });
  });

  describe('_handleDismissOutdated - fallback', () => {
    test('should show dismissed message when checkOutdatedReviewsUseCase is null', async () => {
      handler.checkOutdatedReviewsUseCase = null;

      const mockQuery = {
        data: 'dismiss_outdated:0:0:12345:review-789',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      const result = await handler.handleCallbackQuery(mockQuery, mockConfig);

      expect(result.success).toBe(true);
      expect(mockQuery.answer).toHaveBeenCalledWith('Dismissing...');
      expect(mockQuery.editMessageText).toHaveBeenCalledWith('✅ Notification dismissed');
    });
  });

  describe('_handleReviewLevel - fallback double answer', () => {
    test('should not call answer() twice when queue is unavailable', async () => {
      // No queue use case → falls back to _executeReviewDirectly
      handler.reviewQueueUseCase = null;

      const mockQuery = {
        data: 'review_level:0:0:12345:low',
        answer: jest.fn().mockResolvedValue(),
        editMessageText: jest.fn().mockResolvedValue()
      };

      await handler.handleCallbackQuery(mockQuery, mockConfig);

      // answer() should only be called once (from _handleReviewLevel, not _executeReviewDirectly)
      expect(mockQuery.answer).toHaveBeenCalledTimes(1);
      expect(mockQuery.answer).toHaveBeenCalledWith(expect.stringContaining('queue'));
    });
  });
});
