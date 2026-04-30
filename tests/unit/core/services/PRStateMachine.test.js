/**
 * Tests for PRStateMachine
 */

const PRStateMachine = require('../../../../src/core/services/PRStateMachine');
const PRState = PRStateMachine.PRState;

// Mock state repository
class MockStateRepository {
  constructor() {
    this.data = new Map();
    this.repositories = new Map(); // Simulates MultiRepoStateRepository
  }

  async get(key) {
    return this.data.get(key);
  }

  async set(key, value) {
    this.data.set(key, value);
  }

  async delete(key) {
    this.data.delete(key);
  }

  async keys(prefix) {
    const allKeys = Array.from(this.data.keys());
    if (!prefix) return allKeys;
    return allKeys.filter(key => key.startsWith(prefix));
  }

  // Simulates MultiRepoStateRepository methods for notification count fallback tests
  _parseKey(key) {
    const parts = key.split('/');
    const prIndex = parts.indexOf('pr');
    if (prIndex === -1 || prIndex < 2) {
      return null;
    }

    // instanceKey is everything before "pr"
    // Example: "github/hinha/agent-pr" from "github/hinha/agent-pr/pr/123"
    const instanceKey = parts.slice(0, prIndex).join('/');

    // owner is the second part of instanceKey (after "github")
    // Example: "hinha" from "github/hinha/agent-pr"
    const instanceParts = instanceKey.split('/');
    const owner = instanceParts[1] || instanceParts[0];

    // repoName is the last part of instanceKey
    const repoName = instanceParts[instanceParts.length - 1];

    // prNumber is after "pr" - convert to number for consistency
    const prNumber = parts[prIndex + 1];

    return { instanceKey, owner, repoName, prNumber };
  }

  getRepository(owner, repoName) {
    const key = `${owner}/${repoName}`;
    if (!this.repositories.has(key)) {
      this.repositories.set(key, {
        cache: {
          notificationCounts: new Map()
        },
        _readNotificationCountFromFile: async (prId) => {
          // Simulate reading from file - return value from this.data
          const fileKey = `${key}-notification-counts`;
          const counts = this.data.get(fileKey) || {};
          return counts[prId] !== undefined ? parseInt(counts[prId], 10) : 0;
        },
        _persistNotificationCount: async (prId, count) => {
          // Simulate writing to file
          const fileKey = `${key}-notification-counts`;
          const counts = this.data.get(fileKey) || {};
          counts[prId] = count;
          this.data.set(fileKey, counts);
        }
      });
    }
    return this.repositories.get(key);
  }
}

describe('PRStateMachine', () => {
  let stateMachine;
  let mockRepository;
  let mockLogger;

  beforeEach(() => {
    mockRepository = new MockStateRepository();
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };
    stateMachine = new PRStateMachine(mockRepository, {
      logger: mockLogger,
      maxNotifications: 3
    });
  });

  describe('constructor', () => {
    test('should initialize with state repository', () => {
      expect(stateMachine.stateRepository).toBe(mockRepository);
    });

    test('should throw error if state repository is not provided', () => {
      expect(() => new PRStateMachine(null)).toThrow('State repository is required');
    });

    test('should use default maxNotifications if not provided', () => {
      const sm = new PRStateMachine(mockRepository);
      expect(sm.maxNotifications).toBe(3);
    });

    test('should use custom maxNotifications if provided', () => {
      const sm = new PRStateMachine(mockRepository, { maxNotifications: 5 });
      expect(sm.maxNotifications).toBe(5);
    });
  });

  describe('getState', () => {
    test('should return PENDING for non-existent PR', async () => {
      const state = await stateMachine.getState('github/hinha/agent-pr', 'agent-pr', 123);
      expect(state).toBe(PRState.PENDING);
    });

    test('should return stored state', async () => {
      const key = 'github/hinha/agent-pr/agent-pr/pr/123';
      await mockRepository.set(key, { state: PRState.NOTIFIED, lastUpdated: new Date().toISOString() });

      const state = await stateMachine.getState('github/hinha/agent-pr', 'agent-pr', 123);
      expect(state).toBe(PRState.NOTIFIED);
    });

    test('should return PENDING if state data exists but state field is missing', async () => {
      const key = 'github/hinha/agent-pr/agent-pr/pr/123';
      await mockRepository.set(key, { lastUpdated: new Date().toISOString() });

      const state = await stateMachine.getState('github/hinha/agent-pr', 'agent-pr', 123);
      expect(state).toBe(PRState.PENDING);
    });
  });

  describe('transition', () => {
    test('should perform valid state transition', async () => {
      const result = await stateMachine.transition(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        PRState.NOTIFIED
      );

      expect(result.currentState).toBe(PRState.NOTIFIED);
      expect(result.previousState).toBe(PRState.PENDING);
      expect(result.notificationCount).toBe(1);
      expect(result.isProcessed).toBe(false);
    });

    test('should throw error for invalid transition', async () => {
      // First transition to NOTIFIED, then to PROCESSED
      await stateMachine.transition(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        PRState.NOTIFIED
      );
      await stateMachine.transition(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        PRState.PROCESSED
      );

      // Try to transition from PROCESSED - should fail
      await expect(
        stateMachine.transition(
          'github/hinha/agent-pr',
          'agent-pr',
          123,
          PRState.NOTIFIED
        )
      ).rejects.toThrow('Invalid state transition');
    });

    test('should increment notification count when transitioning to NOTIFIED', async () => {
      const result1 = await stateMachine.transition(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        PRState.NOTIFIED
      );

      expect(result1.notificationCount).toBe(1);

      // Self-transition (re-notification) should also increment
      const result2 = await stateMachine.transition(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        PRState.NOTIFIED
      );

      expect(result2.notificationCount).toBe(2);

      // Another re-notification
      const result3 = await stateMachine.transition(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        PRState.NOTIFIED
      );

      expect(result3.notificationCount).toBe(3);
    });

    test('should increment notification count for self-transition to NOTIFIED (re-notification)', async () => {
      await stateMachine.transition(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        PRState.NOTIFIED
      );

      const result = await stateMachine.transition(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        PRState.NOTIFIED
      );

      // Self-transition (re-notification) increments count
      expect(result.notificationCount).toBe(2);
    });

    test('should persist state with metadata', async () => {
      const metadata = { reason: 'Test transition', userId: '123' };
      await stateMachine.transition(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        PRState.NOTIFIED,
        metadata
      );

      const key = 'github/hinha/agent-pr/agent-pr/pr/123';
      const stateData = await mockRepository.get(key);

      expect(stateData.state).toBe(PRState.NOTIFIED);
      expect(stateData.transitions[0].metadata).toEqual(metadata);
    });

    test('should track transition history', async () => {
      await stateMachine.transition(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        PRState.NOTIFIED
      );

      await stateMachine.transition(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        PRState.APPROVED
      );

      const key = 'github/hinha/agent-pr/agent-pr/pr/123';
      const stateData = await mockRepository.get(key);

      expect(stateData.transitions).toHaveLength(2);
      expect(stateData.transitions[0].from).toBe(PRState.PENDING);
      expect(stateData.transitions[0].to).toBe(PRState.NOTIFIED);
      expect(stateData.transitions[1].from).toBe(PRState.NOTIFIED);
      expect(stateData.transitions[1].to).toBe(PRState.APPROVED);
    });
  });

  describe('getNotificationCount', () => {
    test('should return 0 for PR with no state data', async () => {
      const count = await stateMachine.getNotificationCount(
        'github/hinha/agent-pr',
        'agent-pr',
        123
      );

      expect(count).toBe(0);
    });

    test('should return notification count from state data', async () => {
      const key = 'github/hinha/agent-pr/agent-pr/pr/123';
      await mockRepository.set(key, {
        state: PRState.NOTIFIED,
        notificationCount: 2,
        lastUpdated: new Date().toISOString()
      });

      const count = await stateMachine.getNotificationCount(
        'github/hinha/agent-pr',
        'agent-pr',
        123
      );

      expect(count).toBe(2);
    });

    test('should return 0 if state data exists but notificationCount is undefined', async () => {
      const key = 'github/hinha/agent-pr/agent-pr/pr/123';
      await mockRepository.set(key, {
        state: PRState.PENDING,
        lastUpdated: new Date().toISOString()
      });

      const count = await stateMachine.getNotificationCount(
        'github/hinha/agent-pr',
        'agent-pr',
        123
      );

      expect(count).toBe(0);
    });

    describe('fallback to file storage', () => {
      test('should fallback to file storage when state data has no count', async () => {
        const key = 'github/hinha/agent-pr/agent-pr/pr/123';
        // Set state data without notificationCount
        await mockRepository.set(key, {
          state: PRState.PENDING,
          lastUpdated: new Date().toISOString()
        });

        // Set notification count in file storage
        const fsRepo = mockRepository.getRepository('hinha', 'agent-pr');
        await fsRepo._persistNotificationCount(123, 3);

        const count = await stateMachine.getNotificationCount(
          'github/hinha/agent-pr',
          'agent-pr',
          123
        );

        expect(count).toBe(3);
      });

      test('should fallback to file storage when no state data exists', async () => {
        // Set notification count in file storage
        const fsRepo = mockRepository.getRepository('hinha', 'agent-pr');
        await fsRepo._persistNotificationCount(456, 2);

        const count = await stateMachine.getNotificationCount(
          'github/hinha/agent-pr',
          'agent-pr',
          456
        );

        expect(count).toBe(2);
      });

      test('should prefer state data notificationCount over file storage', async () => {
        const key = 'github/hinha/agent-pr/agent-pr/pr/123';
        // Set state data with notificationCount
        await mockRepository.set(key, {
          state: PRState.NOTIFIED,
          notificationCount: 5,
          lastUpdated: new Date().toISOString()
        });

        // Set different notification count in file storage
        const fsRepo = mockRepository.getRepository('hinha', 'agent-pr');
        await fsRepo._persistNotificationCount(123, 10);

        const count = await stateMachine.getNotificationCount(
          'github/hinha/agent-pr',
          'agent-pr',
          123
        );

        // Should return the count from state data (5), not from file (10)
        expect(count).toBe(5);
      });

      test('should return 0 when fallback fails and no count exists', async () => {
        // No state data, no file storage set up
        const count = await stateMachine.getNotificationCount(
          'github/hinha/agent-pr',
          'agent-pr',
          999
        );

        expect(count).toBe(0);
      });

      test('should handle errors in fallback gracefully', async () => {
        // Mock a repository that throws error
        mockRepository._parseKey = () => {
          throw new Error('Parse error');
        };

        const count = await stateMachine.getNotificationCount(
          'github/hinha/agent-pr',
          'agent-pr',
          123
        );

        expect(count).toBe(0);
      });

      test('should handle missing repository gracefully', async () => {
        const key = 'github/hinha/agent-pr/agent-pr/pr/123';
        await mockRepository.set(key, {
          state: PRState.PENDING,
          lastUpdated: new Date().toISOString()
        });

        // Mock getRepository to return undefined
        mockRepository.getRepository = () => undefined;

        const count = await stateMachine.getNotificationCount(
          'github/hinha/agent-pr',
          'agent-pr',
          123
        );

        expect(count).toBe(0);
      });
    });
  });

  describe('shouldNotify', () => {
    test('should return true for PR in PENDING state with no notifications', async () => {
      const shouldNotify = await stateMachine.shouldNotify(
        'github/hinha/agent-pr',
        'agent-pr',
        123
      );

      expect(shouldNotify).toBe(true);
    });

    test('should return false for PR in PROCESSED state', async () => {
      // Need valid path to PROCESSED: PENDING -> NOTIFIED -> PROCESSED
      await stateMachine.transition(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        PRState.NOTIFIED
      );
      await stateMachine.transition(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        PRState.PROCESSED
      );

      const shouldNotify = await stateMachine.shouldNotify(
        'github/hinha/agent-pr',
        'agent-pr',
        123
      );

      expect(shouldNotify).toBe(false);
    });

    test('should return false when max notifications reached', async () => {
      // Simulate 3 notifications
      const key = 'github/hinha/agent-pr/agent-pr/pr/123';
      await mockRepository.set(key, {
        state: PRState.NOTIFIED,
        notificationCount: 3,
        lastUpdated: new Date().toISOString()
      });

      const shouldNotify = await stateMachine.shouldNotify(
        'github/hinha/agent-pr',
        'agent-pr',
        123
      );

      expect(shouldNotify).toBe(false);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Max notifications reached')
      );
    });

    test('should return true when notifications below max', async () => {
      const key = 'github/hinha/agent-pr/agent-pr/pr/123';
      await mockRepository.set(key, {
        state: PRState.NOTIFIED,
        notificationCount: 2,
        lastUpdated: new Date().toISOString()
      });

      const shouldNotify = await stateMachine.shouldNotify(
        'github/hinha/agent-pr',
        'agent-pr',
        123
      );

      expect(shouldNotify).toBe(true);
    });
  });

  describe('isTerminalState', () => {
    test('should return true for PROCESSED state', () => {
      expect(stateMachine.isTerminalState(PRState.PROCESSED)).toBe(true);
    });

    test('should return false for non-terminal states', () => {
      expect(stateMachine.isTerminalState(PRState.PENDING)).toBe(false);
      expect(stateMachine.isTerminalState(PRState.NOTIFIED)).toBe(false);
      expect(stateMachine.isTerminalState(PRState.APPROVED)).toBe(false);
      expect(stateMachine.isTerminalState(PRState.REJECTED)).toBe(false);
    });
  });

  describe('isInState', () => {
    test('should return true when PR is in specified state', async () => {
      await stateMachine.transition(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        PRState.NOTIFIED
      );

      const isInState = await stateMachine.isInState(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        PRState.NOTIFIED
      );

      expect(isInState).toBe(true);
    });

    test('should return false when PR is not in specified state', async () => {
      await stateMachine.transition(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        PRState.APPROVED
      );

      const isInState = await stateMachine.isInState(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        PRState.NOTIFIED
      );

      expect(isInState).toBe(false);
    });
  });

  describe('markAsProcessed', () => {
    test('should transition PR to PROCESSED state', async () => {
      // First transition to NOTIFIED (valid path to PROCESSED)
      await stateMachine.transition(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        PRState.NOTIFIED
      );

      const result = await stateMachine.markAsProcessed(
        'github/hinha/agent-pr',
        'agent-pr',
        123
      );

      expect(result.currentState).toBe(PRState.PROCESSED);
      expect(result.isProcessed).toBe(true);
    });

    test('should include metadata in transition', async () => {
      // First transition to NOTIFIED (valid path to PROCESSED)
      await stateMachine.transition(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        PRState.NOTIFIED
      );

      const metadata = { processedBy: 'test-user' };
      await stateMachine.markAsProcessed(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        metadata
      );

      const key = 'github/hinha/agent-pr/agent-pr/pr/123';
      const stateData = await mockRepository.get(key);

      // Should have 2 transitions: NOTIFIED -> PROCESSED
      expect(stateData.transitions[1].metadata.processedBy).toBe('test-user');
      expect(stateData.transitions[1].metadata.reason).toBe('Marked as processed');
    });
  });

  describe('markAsSkipped', () => {
    test('should transition PR to SKIPPED state with skip duration', async () => {
      const duration = 3600000; // 1 hour
      const result = await stateMachine.markAsSkipped(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        duration
      );

      expect(result.currentState).toBe(PRState.SKIPPED);

      const key = 'github/hinha/agent-pr/agent-pr/pr/123';
      const stateData = await mockRepository.get(key);

      expect(stateData.transitions[0].metadata.duration).toBe(duration);
      expect(stateData.transitions[0].metadata.skipUntil).toBeDefined();
    });
  });

  describe('isSkipped', () => {
    test('should return false for PR not in SKIPPED state', async () => {
      await stateMachine.transition(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        PRState.NOTIFIED
      );

      const isSkipped = await stateMachine.isSkipped(
        'github/hinha/agent-pr',
        'agent-pr',
        123
      );

      expect(isSkipped).toBe(false);
    });

    test('should return true for PR in SKIPPED state within skip period', async () => {
      const duration = 3600000; // 1 hour
      await stateMachine.markAsSkipped(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        duration
      );

      const isSkipped = await stateMachine.isSkipped(
        'github/hinha/agent-pr',
        'agent-pr',
        123
      );

      expect(isSkipped).toBe(true);
    });

    test('should auto-transition to PENDING when skip period expires', async () => {
      const duration = 100; // 100ms
      await stateMachine.markAsSkipped(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        duration
      );

      // Wait for skip period to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      const isSkipped = await stateMachine.isSkipped(
        'github/hinha/agent-pr',
        'agent-pr',
        123
      );

      expect(isSkipped).toBe(false);

      // Verify state transitioned back to PENDING
      const state = await stateMachine.getState(
        'github/hinha/agent-pr',
        'agent-pr',
        123
      );
      expect(state).toBe(PRState.PENDING);
    });
  });

  describe('getTransitions', () => {
    test('should return empty array for PR with no transitions', async () => {
      const transitions = await stateMachine.getTransitions(
        'github/hinha/agent-pr',
        'agent-pr',
        123
      );

      expect(transitions).toEqual([]);
    });

    test('should return transition history', async () => {
      await stateMachine.transition(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        PRState.NOTIFIED
      );

      await stateMachine.transition(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        PRState.APPROVED
      );

      const transitions = await stateMachine.getTransitions(
        'github/hinha/agent-pr',
        'agent-pr',
        123
      );

      expect(transitions).toHaveLength(2);
      expect(transitions[0].to).toBe(PRState.NOTIFIED);
      expect(transitions[1].to).toBe(PRState.APPROVED);
    });
  });

  describe('getPRsByState', () => {
    test('should return empty array for no PRs in state', async () => {
      const prs = await stateMachine.getPRsByState(
        'github/hinha/agent-pr',
        'agent-pr',
        PRState.NOTIFIED
      );

      expect(prs).toEqual([]);
    });

    test('should return PRs in specified state', async () => {
      await stateMachine.transition(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        PRState.NOTIFIED
      );

      await stateMachine.transition(
        'github/hinha/agent-pr',
        'agent-pr',
        456,
        PRState.APPROVED
      );

      await stateMachine.transition(
        'github/hinha/agent-pr',
        'agent-pr',
        789,
        PRState.NOTIFIED
      );

      const notifiedPRs = await stateMachine.getPRsByState(
        'github/hinha/agent-pr',
        'agent-pr',
        PRState.NOTIFIED
      );

      expect(notifiedPRs).toHaveLength(2);
      expect(notifiedPRs).toContain(123);
      expect(notifiedPRs).toContain(789);
    });
  });

  describe('reset', () => {
    test('should delete PR state', async () => {
      await stateMachine.transition(
        'github/hinha/agent-pr',
        'agent-pr',
        123,
        PRState.NOTIFIED
      );

      await stateMachine.reset(
        'github/hinha/agent-pr',
        'agent-pr',
        123
      );

      const state = await stateMachine.getState(
        'github/hinha/agent-pr',
        'agent-pr',
        123
      );

      expect(state).toBe(PRState.PENDING);
    });
  });

  describe('state key building', () => {
    test('should build correct state key', () => {
      const key = stateMachine._buildStateKey('github/hinha/agent-pr', 'agent-pr', 123);
      expect(key).toBe('github/hinha/agent-pr/agent-pr/pr/123');
    });

    test('should build correct state prefix', () => {
      const prefix = stateMachine._buildStatePrefix('github/hinha/agent-pr', 'agent-pr');
      expect(prefix).toBe('github/hinha/agent-pr/agent-pr/pr/');
    });

    test('should extract PR number from key', () => {
      const prNumber = stateMachine._extractPRNumberFromKey('github/hinha/agent-pr/agent-pr/pr/123');
      expect(prNumber).toBe(123);
    });

    test('should return null for invalid key format', () => {
      const prNumber = stateMachine._extractPRNumberFromKey('invalid-key');
      expect(prNumber).toBeNull();
    });
  });
});
