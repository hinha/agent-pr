/**
 * Tests for PRStateMachine notification count lookup fix
 *
 * Tests the fix where prNumber was converted to number
 * before doing cache lookup in getNotificationCount fallback logic.
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

    const instanceKey = parts.slice(0, prIndex).join('/');

    const instanceParts = instanceKey.split('/');
    const owner = instanceParts[1] || instanceParts[0];

    const repoName = instanceParts[instanceParts.length - 1];

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

describe('PRStateMachine - Notification Count Lookup Fix', () => {
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

  describe('getNotificationCount', () => {
    describe('when stateData has notificationCount', () => {
      test('should return notificationCount from stateData', async () => {
        const key = 'github/hinha/agent-pr/agent-pr/pr/123';
        const stateData = { state: PRState.NOTIFIED, notificationCount: 2 };

        await mockRepository.set(key, stateData);

        const count = await stateMachine.getNotificationCount(
          'github/hinha/agent-pr',
          'agent-pr',
          123
        );

        expect(count).toBe(2);
      });

      test('should return 0 when stateData notificationCount is undefined', async () => {
        const key = 'github/hinha/agent-pr/agent-pr/pr/456';
        const stateData = { state: PRState.PENDING };

        await mockRepository.set(key, stateData);

        const count = await stateMachine.getNotificationCount(
          'github/hinha/agent-pr',
          'agent-pr',
          456
        );

        expect(count).toBe(0);
      });
    });

    describe('fallback to file storage', () => {
      test('should return count from file when stateData lacks notificationCount', async () => {
        const key = 'github/hinha/agent-pr/agent-pr/pr/789';

        // Set state data without notificationCount
        await mockRepository.set(key, {
          state: PRState.NOTIFIED,
          lastUpdated: new Date().toISOString()
        });

        // Set notification count in file storage (via _persistNotificationCount)
        const fsRepo = mockRepository.getRepository('hinha', 'agent-pr');
        await fsRepo._persistNotificationCount(789, 3);

        const count = await stateMachine.getNotificationCount(
          'github/hinha/agent-pr',
          'agent-pr',
          789
        );

        expect(count).toBe(3);
      });

      test('should return count from file when stateData does not exist', async () => {
        const key = 'github/hinha/agent-pr/agent-pr/pr/999';

        // Set notification count in file storage
        const fsRepo = mockRepository.getRepository('hinha', 'agent-pr');
        await fsRepo._persistNotificationCount(999, 2);

        const count = await stateMachine.getNotificationCount(
          'github/hinha/agent-pr',
          'agent-pr',
          999
        );

        expect(count).toBe(2);
      });

      test('should prefer stateData notificationCount over file', async () => {
        const key = 'github/hinha/agent-pr/agent-pr/pr/111';

        // Set state data with notificationCount
        await mockRepository.set(key, {
          state: PRState.NOTIFIED,
          notificationCount: 5,
          lastUpdated: new Date().toISOString()
        });

        // Set different notification count in file storage
        const fsRepo = mockRepository.getRepository('hinha', 'agent-pr');
        await fsRepo._persistNotificationCount(111, 10);

        const count = await stateMachine.getNotificationCount(
          'github/hinha/agent-pr',
          'agent-pr',
          111
        );

        // Should return count from state data (5), not from file (10)
        expect(count).toBe(5);
      });
    });
  });
});
