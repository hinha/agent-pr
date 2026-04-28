/**
 * Integration tests for PR processing workflow
 *
 * These tests verify that the ProcessPRUseCase correctly orchestrates
 * the entire PR processing workflow from analysis to notification.
 */

const PRStateMachine = require('../../../src/core/services/PRStateMachine');
const { PRState } = PRStateMachine;
const ProcessPRUseCase = require('../../../src/application/use-cases/ProcessPRUseCase');
const PullRequest = require('../../../src/core/entities/PullRequest');

// Mock implementations
class MockStateMachine {
  constructor() {
    this.states = new Map();
    this.transitions = new Map();
  }

  async getState(instanceKey, repoName, prNumber) {
    const key = `${instanceKey}/${repoName}/${prNumber}`;
    return this.states.get(key) || PRState.PENDING;
  }

  async getNotificationCount(instanceKey, repoName, prNumber) {
    const key = `${instanceKey}/${repoName}/${prNumber}`;
    const stateData = this.transitions.get(key);
    return stateData ? stateData.filter(t => t.to === PRState.NOTIFIED).length : 0;
  }

  async shouldNotify(instanceKey, repoName, prNumber, currentState) {
    if (currentState === PRState.PROCESSED) return false;
    const count = await this.getNotificationCount(instanceKey, repoName, prNumber);
    return count < 3;
  }

  async isSkipped(instanceKey, repoName, prNumber) {
    const key = `${instanceKey}/${repoName}/${prNumber}`;
    return this.states.get(key) === PRState.SKIPPED;
  }

  async transition(instanceKey, repoName, prNumber, newState, metadata) {
    const key = `${instanceKey}/${repoName}/${prNumber}`;
    const currentState = await this.getState(instanceKey, repoName, prNumber);

    this.states.set(key, newState);

    if (!this.transitions.has(key)) {
      this.transitions.set(key, []);
    }

    this.transitions.get(key).push({
      from: currentState,
      to: newState,
      timestamp: new Date().toISOString(),
      metadata
    });

    return {
      currentState: newState,
      previousState: currentState,
      notificationCount: await this.getNotificationCount(instanceKey, repoName, prNumber)
    };
  }

  isTerminalState(state) {
    return state === PRState.PROCESSED;
  }

  async markAsSkipped(instanceKey, repoName, prNumber, duration) {
    const key = `${instanceKey}/${repoName}/${prNumber}`;
    this.states.set(key, PRState.SKIPPED);
    return { success: true };
  }
}

class MockAnalyzer {
  analyze(pr, prDetails) {
    return {
      riskLevel: 'medium',
      impactArea: 'api',
      recommendedReview: 'requires attention',
      suspiciousPatterns: [],
      dominantArchitecture: null,
      riskScore: 50
    };
  }
}

class MockNotificationService {
  constructor() {
    this.sentNotifications = [];
  }

  async sendPRNotification(instance, repo, pr, prDetails, analysis) {
    this.sentNotifications.push({
      instance: instance.key,
      repo: repo.name,
      prNumber: pr.number,
      analysis
    });

    return {
      success: true,
      message_id: 12345
    };
  }
}

describe('PR Processing Workflow Integration', () => {
  let processPRUseCase;
  let mockStateMachine;
  let mockAnalyzer;
  let mockNotificationService;
  let eventBus;

  const instance = {
    key: 'github/testorg',
    owner: 'testorg',
    mcpName: 'github-test',
    maxAgeHours: 48,
    instanceIdx: 0,
    repos: {}
  };

  const repo = {
    name: 'test-repo',
    threadId: 12345,
    instanceKey: 'github/testorg',
    repoIdx: 0
  };

  beforeEach(() => {
    mockStateMachine = new MockStateMachine();
    mockAnalyzer = new MockAnalyzer();
    mockNotificationService = new MockNotificationService();
    eventBus = new EventBus({ enableLogging: false });

    processPRUseCase = new ProcessPRUseCase(
      mockStateMachine,
      mockAnalyzer,
      mockNotificationService,
      eventBus,
      { logger: console }
    );
  });

  afterEach(() => {
    eventBus.clear();
  });

  describe('ProcessPRUseCase.execute', () => {
    it('should process a new PR successfully', async () => {
      const pr = PullRequest.fromGitHubAPI(
        {
          id: 123,
          number: 456,
          title: 'Test PR',
          user: { login: 'testuser' },
          head: { ref: 'feature', sha: 'abc123' },
          base: { ref: 'main' },
          html_url: 'https://github.com/testorg/test-repo/pull/456',
          created_at: '2024-01-01T00:00:00Z'
        },
        'testorg',
        'test-repo'
      );

      const prDetails = {
        files: [
          { filename: 'src/test.js', changes: 50 }
        ],
        filesChanged: 1,
        totalChanges: 50
      };

      const eventSpy = jest.fn();
      eventBus.on('pr.processed', eventSpy);

      const result = await processPRUseCase.execute(instance, repo, pr, prDetails);

      expect(result.status).toBe('processed');
      expect(result.currentState).toBe('notified');
      expect(result.notificationSent).toBe(true);
      expect(result.notificationCount).toBe(1);

      expect(mockNotificationService.sentNotifications).toHaveLength(1);
      expect(mockNotificationService.sentNotifications[0].prNumber).toBe(456);

      // Event is emitted asynchronously, so we need to check if it was called
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(eventSpy).toHaveBeenCalled();
      const eventData = eventSpy.mock.calls[0][0];
      expect(eventData).toMatchObject({
        instanceKey: 'github/testorg',
        repoName: 'test-repo',
        prNumber: 456
      });
    });

    it('should not notify if already at max notifications', async () => {
      const pr = PullRequest.fromGitHubAPI(
        {
          id: 123,
          number: 456,
          title: 'Test PR',
          user: { login: 'testuser' },
          head: { ref: 'feature', sha: 'abc123' },
          base: { ref: 'main' },
          created_at: '2024-01-01T00:00:00Z'
        },
        'testorg',
        'test-repo'
      );

      const prDetails = {
        files: [{ filename: 'src/test.js', changes: 50 }],
        filesChanged: 1,
        totalChanges: 50
      };

      // Simulate 3 prior notifications
      for (let i = 0; i < 3; i++) {
        await mockStateMachine.transition('github/testorg', 'test-repo', 456, PRState.NOTIFIED);
      }

      const result = await processPRUseCase.execute(instance, repo, pr, prDetails);

      expect(result.status).toBe('already_processed');
      expect(result.reason).toBe('Max notifications reached or terminal state');

      expect(mockNotificationService.sentNotifications).toHaveLength(0);
    });

    it('should not process if PR is skipped', async () => {
      const pr = PullRequest.fromGitHubAPI(
        {
          id: 123,
          number: 456,
          title: 'Test PR',
          user: { login: 'testuser' },
          head: { ref: 'feature', sha: 'abc123' },
          base: { ref: 'main' },
          created_at: '2024-01-01T00:00:00Z'
        },
        'testorg',
        'test-repo'
      );

      const prDetails = {
        files: [{ filename: 'src/test.js', changes: 50 }],
        filesChanged: 1,
        totalChanges: 50
      };

      await mockStateMachine.markAsSkipped('github/testorg', 'test-repo', 456, 3600000);

      const result = await processPRUseCase.execute(instance, repo, pr, prDetails);

      expect(result.status).toBe('skipped');
      expect(result.reason).toBe('Skip period active');

      expect(mockNotificationService.sentNotifications).toHaveLength(0);
    });
  });

  describe('ProcessPRUseCase.shouldProcess', () => {
    it('should return true for processable PR', async () => {
      const pr = PullRequest.fromGitHubAPI(
        {
          id: 123,
          number: 456,
          title: 'Feature: Add new functionality',
          user: { login: 'testuser' },
          head: { ref: 'feature', sha: 'abc123' },
          base: { ref: 'main' },
          created_at: new Date(Date.now() - 3600000).toISOString() // 1 hour ago
        },
        'testorg',
        'test-repo'
      );

      const result = await processPRUseCase.shouldProcess(
        instance,
        repo,
        pr,
        instance
      );

      expect(result.shouldProcess).toBe(true);
    });

    it('should return false for old PR', async () => {
      const pr = PullRequest.fromGitHubAPI(
        {
          id: 123,
          number: 456,
          title: 'Feature: Old PR',
          user: { login: 'testuser' },
          head: { ref: 'feature', sha: 'abc123' },
          base: { ref: 'main' },
          created_at: new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString() // 50 hours ago
        },
        'testorg',
        'test-repo'
      );

      const result = await processPRUseCase.shouldProcess(
        instance,
        repo,
        pr,
        instance
      );

      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toBe('PR too old');
    });

    it('should return false for draft PR', async () => {
      const pr = PullRequest.fromGitHubAPI(
        {
          id: 123,
          number: 456,
          title: '[WIP] Test PR',
          user: { login: 'testuser' },
          head: { ref: 'feature', sha: 'abc123' },
          base: { ref: 'main' },
          created_at: new Date(Date.now() - 3600000).toISOString() // 1 hour ago
        },
        'testorg',
        'test-repo'
      );

      const result = await processPRUseCase.shouldProcess(
        instance,
        repo,
        pr,
        instance
      );

      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toBe('PR is draft/WIP');
    });
  });
});
