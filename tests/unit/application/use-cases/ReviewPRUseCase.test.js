/**
 * Unit Tests: ReviewPRUseCase
 *
 * Tests for the PR review use case that orchestrates AI review workflow.
 * Focuses on the data flow: agentService → _submitReview → githubAdapter.
 */

const PRStateMachine = require('../../../../src/core/services/PRStateMachine');
const { PRState } = PRStateMachine;
const ReviewPRUseCase = require('../../../../src/application/use-cases/ReviewPRUseCase');

describe('ReviewPRUseCase', () => {
  let useCase;
  let mockAgentService;
  let mockStateMachine;
  let mockEventBus;
  let mockGithubAdapter;
  let mockLogger;

  const instance = {
    key: 'github/testorg',
    owner: 'testorg',
    mcpName: 'github-test'
  };

  const repo = { name: 'test-repo' };

  const pr = {
    number: 42,
    title: 'Test PR',
    url: 'https://github.com/testorg/test-repo/pull/42',
    headBranch: 'feature',
    baseBranch: 'main',
    headSha: 'abc123'
  };

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    mockAgentService = {
      reviewPR: jest.fn()
    };

    mockStateMachine = {
      transition: jest.fn().mockResolvedValue({ currentState: PRState.APPROVED }),
      getState: jest.fn().mockResolvedValue(PRState.PENDING),
      isTerminalState: jest.fn((state) => state === PRState.PROCESSED)
    };

    mockEventBus = {
      emitAsync: jest.fn().mockResolvedValue(undefined)
    };

    mockGithubAdapter = {
      getPRDetails: jest.fn().mockResolvedValue({
        files: [{ filename: 'src/index.js', changes: 50 }],
        totalChanges: 50
      }),
      createReviewWithComments: jest.fn().mockResolvedValue({
        id: 'review_123',
        state: 'COMMENTED',
        html_url: 'https://github.com/testorg/test-repo/pull/42#pullrequestreview-123'
      })
    };

    useCase = new ReviewPRUseCase(
      mockAgentService,
      mockStateMachine,
      mockEventBus,
      { logger: mockLogger }
    );
  });

  describe('execute', () => {
    test('should pass reviewResult directly to createReviewWithComments', async () => {
      const reviewResult = {
        success: true,
        summary: 'Code looks good',
        comments: [
          { file: 'src/index.js', line: 10, severity: 'LOW', message: 'Consider renaming' }
        ],
        agentCalledToolDirectly: false,
        agentRawOutput: '{}'
      };

      mockAgentService.reviewPR.mockResolvedValue(reviewResult);

      await useCase.execute(instance, repo, pr, 'medium', mockGithubAdapter);

      // Verify createReviewWithComments receives the FULL reviewResult directly
      expect(mockGithubAdapter.createReviewWithComments).toHaveBeenCalledWith(
        'test-repo',
        pr,
        reviewResult
      );

      // Verify it has summary (not body)
      const passedResult = mockGithubAdapter.createReviewWithComments.mock.calls[0][2];
      expect(passedResult.summary).toBe('Code looks good');
      expect(passedResult.comments).toHaveLength(1);
      expect(passedResult.comments[0].file).toBe('src/index.js');
      expect(passedResult.comments[0].severity).toBe('LOW');
    });

    test('should throw when AI review returns success: false', async () => {
      mockAgentService.reviewPR.mockResolvedValue({
        success: false,
        error: 'Failed to parse OpenClaw response: Unexpected token',
        summary: 'Review completed (parse error)',
        comments: []
      });

      const result = await useCase.execute(instance, repo, pr, 'high', mockGithubAdapter);

      expect(result.success).toBe(false);
      expect(result.error).toContain('AI review failed');
      expect(mockGithubAdapter.createReviewWithComments).not.toHaveBeenCalled();
    });

    test('should handle 0 comments successfully', async () => {
      const reviewResult = {
        success: true,
        summary: 'All clear, no issues found',
        comments: [],
        agentCalledToolDirectly: false,
        agentRawOutput: '{}'
      };

      mockAgentService.reviewPR.mockResolvedValue(reviewResult);

      const result = await useCase.execute(instance, repo, pr, 'low', mockGithubAdapter);

      expect(result.success).toBe(true);
      expect(mockGithubAdapter.createReviewWithComments).toHaveBeenCalledWith(
        'test-repo',
        pr,
        reviewResult
      );
    });

    test('should update state machine after successful review', async () => {
      mockAgentService.reviewPR.mockResolvedValue({
        success: true,
        summary: 'LGTM',
        comments: [],
        agentCalledToolDirectly: false
      });

      await useCase.execute(instance, repo, pr, 'medium', mockGithubAdapter);

      expect(mockStateMachine.transition).toHaveBeenCalledWith(
        'github/testorg',
        'test-repo',
        42,
        PRState.APPROVED,
        expect.objectContaining({ level: 'medium' })
      );
    });

    test('should skip state transition when PR is already in terminal state', async () => {
      mockAgentService.reviewPR.mockResolvedValue({
        success: true,
        summary: 'LGTM',
        comments: [],
        agentCalledToolDirectly: false
      });

      mockStateMachine.getState.mockResolvedValue(PRState.PROCESSED);

      const result = await useCase.execute(instance, repo, pr, 'medium', mockGithubAdapter);

      expect(result.success).toBe(true);
      expect(mockStateMachine.transition).not.toHaveBeenCalled();
    });

    test('should skip state transition when current state equals new state (approved -> approved)', async () => {
      mockAgentService.reviewPR.mockResolvedValue({
        success: true,
        summary: 'LGTM',
        comments: [],
        agentCalledToolDirectly: false
      });

      mockStateMachine.getState.mockResolvedValue(PRState.APPROVED);

      const result = await useCase.execute(instance, repo, pr, 'medium', mockGithubAdapter);

      expect(result.success).toBe(true);
      expect(mockStateMachine.transition).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('skipping state transition')
      );
    });

    test('should emit review.created event', async () => {
      mockAgentService.reviewPR.mockResolvedValue({
        success: true,
        summary: 'Done',
        comments: [],
        agentCalledToolDirectly: false
      });

      await useCase.execute(instance, repo, pr, 'medium', mockGithubAdapter);

      expect(mockEventBus.emitAsync).toHaveBeenCalledWith(
        'review.created',
        expect.objectContaining({
          instanceKey: 'github/testorg',
          repoName: 'test-repo',
          prNumber: 42,
          reviewId: 'review_123'
        })
      );
    });

    test('should emit error.occurred event on failure', async () => {
      mockAgentService.reviewPR.mockRejectedValue(new Error('Network error'));

      const result = await useCase.execute(instance, repo, pr, 'high', mockGithubAdapter);

      expect(result.success).toBe(false);
      expect(mockEventBus.emitAsync).toHaveBeenCalledWith(
        'error.occurred',
        expect.objectContaining({
          useCase: 'ReviewPRUseCase',
          prNumber: 42,
          error: 'Network error'
        })
      );
    });
  });

  describe('_determineNewState', () => {
    test('should return REJECTED when requiresChanges is true', () => {
      const result = useCase._determineNewState({ requiresChanges: true });
      expect(result).toBe(PRState.REJECTED);
    });

    test('should return APPROVED when requiresChanges is false', () => {
      const result = useCase._determineNewState({ requiresChanges: false });
      expect(result).toBe(PRState.APPROVED);
    });

    test('should return APPROVED when requiresChanges is undefined', () => {
      const result = useCase._determineNewState({});
      expect(result).toBe(PRState.APPROVED);
    });
  });

  describe('approve', () => {
    test('should call githubAdapter.approvePR', async () => {
      mockGithubAdapter.approvePR = jest.fn().mockResolvedValue({
        id: 'review_456'
      });

      const result = await useCase.approve(instance, repo, pr, mockGithubAdapter);

      expect(result.success).toBe(true);
      expect(mockGithubAdapter.approvePR).toHaveBeenCalledWith(
        'test-repo',
        42,
        'Approved via Telegram bot'
      );
    });
  });

  describe('skip', () => {
    test('should mark PR as skipped with given duration', async () => {
      mockStateMachine.markAsSkipped = jest.fn().mockResolvedValue({ success: true });

      const result = await useCase.skip(instance, repo, pr, 7200000);

      expect(result.success).toBe(true);
      expect(result.duration).toBe(7200000);
      expect(mockStateMachine.markAsSkipped).toHaveBeenCalledWith(
        'github/testorg',
        'test-repo',
        42,
        7200000
      );
    });
  });
});
