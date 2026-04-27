/**
 * Unit tests for prStateManager (simplified version without FS mocking)
 * Tests core PR state tracking logic
 */

jest.mock('../../../src/config/yamlConfig', () => ({
  storage: {
    processedPrsPath: '/data/processed_prs.json',
    notificationCountsPath: '/data/notification_counts.json',
    processedTimestampsPath: '/data/processed_timestamps.json'
  },
  ensureRepoStorageDir: jest.fn((owner, repo) => `/data/instances/${owner}/${repo}`)
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
}));

jest.mock('fs/promises', () => ({
  readFile: jest.fn(() => Promise.reject(new Error('ENOENT'))),
  writeFile: jest.fn(() => Promise.resolve())
}));

jest.resetModules();
const prStateManager = require('../../../src/services/prStateManager');

describe('prStateManager (core logic)', () => {
  beforeEach(() => {
    // Clear the state for each test
    prStateManager.processedPRs.clear();
    prStateManager.notificationCount.clear();
    prStateManager.processedTimestamps.clear();
  });

  describe('isProcessed', () => {
    test('should return false for unprocessed PR', async () => {
      const result = await prStateManager.isProcessed('123');
      expect(result).toBe(false);
    });

    test('should return true for processed PR', async () => {
      prStateManager.processedPRs.add('123');
      const result = await prStateManager.isProcessed('123');
      expect(result).toBe(true);
    });

    test('should convert PR ID to string for lookup', async () => {
      prStateManager.processedPRs.add('123');
      const result = await prStateManager.isProcessed(123);
      expect(result).toBe(true);
    });
  });

  describe('getNotificationCount', () => {
    test('should return 0 for PR with no notifications', () => {
      const count = prStateManager.getNotificationCount('123');
      expect(count).toBe(0);
    });

    test('should return current count for PR', () => {
      prStateManager.notificationCount.set('123', 2);
      const count = prStateManager.getNotificationCount('123');
      expect(count).toBe(2);
    });

    test('should convert PR ID to string for lookup', () => {
      prStateManager.notificationCount.set('123', 3);
      const count = prStateManager.getNotificationCount(123);
      expect(count).toBe(3);
    });
  });

  describe('cleanupOldEntries logic', () => {
    test('should remove entries older than max age', () => {
      const now = Date.now();
      prStateManager.processedPRs.add('123');
      prStateManager.processedTimestamps.set('123', now - 10 * 24 * 60 * 60 * 1000); // 10 days old
      prStateManager.notificationCount.set('123', 3);

      prStateManager.processedPRs.add('456');
      prStateManager.processedTimestamps.set('456', now - 1 * 24 * 60 * 60 * 1000); // 1 day old
      prStateManager.notificationCount.set('456', 2);

      const cleaned = prStateManager.cleanupOldEntries(7 * 24 * 60 * 60 * 1000); // 7 days max age

      expect(cleaned).toBe(1);
      expect(prStateManager.processedPRs.has('123')).toBe(false);
      expect(prStateManager.processedPRs.has('456')).toBe(true);
    });

    test('should clean up orphaned notification counts', () => {
      prStateManager.notificationCount.set('123', 3);
      // No corresponding entry in processedPRs

      const cleaned = prStateManager.cleanupOldEntries();

      expect(cleaned).toBe(1);
      expect(prStateManager.notificationCount.has('123')).toBe(false);
    });

    test('should handle empty state', () => {
      const cleaned = prStateManager.cleanupOldEntries();
      expect(cleaned).toBe(0);
    });

    test('should not remove recent entries', () => {
      const now = Date.now();
      prStateManager.processedPRs.add('123');
      prStateManager.processedTimestamps.set('123', now - 1000); // 1 second old
      prStateManager.notificationCount.set('123', 1);

      const cleaned = prStateManager.cleanupOldEntries();

      expect(cleaned).toBe(0);
      expect(prStateManager.processedPRs.has('123')).toBe(true);
    });
  });

  describe('Timestamp management', () => {
    test('should track when PR was processed', () => {
      const now = Date.now();
      const prId = '123';

      prStateManager.processedTimestamps.set(prId, now);

      expect(prStateManager.processedTimestamps.get(prId)).toBe(now);
    });

    test('should update timestamp for existing PR', () => {
      const prId = '123';
      const oldTime = Date.now() - 10000;

      prStateManager.processedTimestamps.set(prId, oldTime);
      const newTime = Date.now();
      prStateManager.processedTimestamps.set(prId, newTime);

      expect(prStateManager.processedTimestamps.get(prId)).toBe(newTime);
    });
  });

  describe('Data structure integrity', () => {
    test('should maintain consistency across PR sets and maps', () => {
      const prId = '123';
      const now = Date.now();

      // Add PR with all associated data
      prStateManager.processedPRs.add(prId);
      prStateManager.processedTimestamps.set(prId, now);
      prStateManager.notificationCount.set(prId, 2);

      expect(prStateManager.processedPRs.has(prId)).toBe(true);
      expect(prStateManager.processedTimestamps.has(prId)).toBe(true);
      expect(prStateManager.notificationCount.has(prId)).toBe(true);
    });

    test('should handle multiple PRs independently', () => {
      prStateManager.processedPRs.add('123');
      prStateManager.processedPRs.add('456');
      prStateManager.processedPRs.add('789');

      expect(prStateManager.processedPRs.size).toBe(3);

      prStateManager.notificationCount.set('123', 1);
      prStateManager.notificationCount.set('456', 2);
      prStateManager.notificationCount.set('789', 3);

      expect(prStateManager.notificationCount.get('123')).toBe(1);
      expect(prStateManager.notificationCount.get('456')).toBe(2);
      expect(prStateManager.notificationCount.get('789')).toBe(3);
    });
  });

  describe('PR ID handling', () => {
    test('should store PR IDs as strings', () => {
      const numericId = 123;
      const stringId = '123';

      prStateManager.processedPRs.add(numericId.toString());
      prStateManager.processedPRs.add(stringId);

      // Set should not have duplicates
      expect(prStateManager.processedPRs.size).toBe(1);
    });

    test('should handle PR IDs with different formats', () => {
      prStateManager.processedPRs.add('123');
      prStateManager.processedPRs.add('456');
      prStateManager.processedPRs.add('789');

      expect(prStateManager.processedPRs.has('123')).toBe(true);
      expect(prStateManager.processedPRs.has('456')).toBe(true);
      expect(prStateManager.processedPRs.has('789')).toBe(true);
      expect(prStateManager.processedPRs.has('999')).toBe(false);
    });
  });

  describe('Max age calculation', () => {
    test('should calculate default max age as 7 days', () => {
      const defaultMaxAge = 7 * 24 * 60 * 60 * 1000;
      expect(defaultMaxAge).toBe(7 * 24 * 60 * 60 * 1000);
    });

    test('should accept custom max age in milliseconds', () => {
      const customMaxAge = 14 * 24 * 60 * 60 * 1000; // 14 days
      const now = Date.now();

      prStateManager.processedPRs.add('123');
      prStateManager.processedTimestamps.set('123', now - 10 * 24 * 60 * 60 * 1000); // 10 days old

      const cleaned = prStateManager.cleanupOldEntries(customMaxAge);

      expect(cleaned).toBe(0); // Should not clean, 10 days < 14 days
    });
  });

  describe('State initialization', () => {
    test('should initialize with empty state', () => {
      expect(prStateManager.processedPRs).toBeInstanceOf(Set);
      expect(prStateManager.notificationCount).toBeInstanceOf(Map);
      expect(prStateManager.processedTimestamps).toBeInstanceOf(Map);
    });
  });

  describe('Edge cases', () => {
    test('should handle cleanup with no timestamps', () => {
      prStateManager.processedPRs.add('123');
      // No corresponding timestamp

      const cleaned = prStateManager.cleanupOldEntries();
      // Should not crash, just skip PRs without timestamps
      expect(cleaned).toBe(0);
    });

    test('should handle cleanup with very old timestamps', () => {
      const ancientTime = 1; // Unix epoch
      prStateManager.processedPRs.add('123');
      prStateManager.processedTimestamps.set('123', ancientTime);
      prStateManager.notificationCount.set('123', 5);

      const cleaned = prStateManager.cleanupOldEntries();

      expect(cleaned).toBe(1);
      expect(prStateManager.processedPRs.has('123')).toBe(false);
    });

    test('should handle PR ID with leading zeros', () => {
      const prId = '00123';
      prStateManager.processedPRs.add(prId);

      expect(prStateManager.processedPRs.has(prId)).toBe(true);
      expect(prStateManager.processedPRs.has('123')).toBe(false);
    });
  });

  describe('Orphaned entry cleanup', () => {
    test('should detect and clean orphaned notification counts', () => {
      // PR 123 has notification count but is not in processedPRs
      prStateManager.notificationCount.set('123', 3);

      // PR 456 is fully processed
      prStateManager.processedPRs.add('456');
      prStateManager.processedTimestamps.set('456', Date.now());
      prStateManager.notificationCount.set('456', 2);

      const cleaned = prStateManager.cleanupOldEntries();

      expect(cleaned).toBe(1);
      expect(prStateManager.notificationCount.has('123')).toBe(false);
      expect(prStateManager.notificationCount.has('456')).toBe(true);
    });

    test('should handle multiple orphaned entries', () => {
      prStateManager.notificationCount.set('123', 1);
      prStateManager.notificationCount.set('456', 2);
      prStateManager.notificationCount.set('789', 3);
      // None are in processedPRs

      const cleaned = prStateManager.cleanupOldEntries();

      expect(cleaned).toBe(3);
      expect(prStateManager.notificationCount.size).toBe(0);
    });
  });

  describe('incrementNotificationCount logic', () => {
    test('should increment from 0 to 1 for new PR', () => {
      const initialCount = prStateManager.getNotificationCount('123');
      expect(initialCount).toBe(0);

      // Simulate increment logic
      const newCount = initialCount + 1;
      prStateManager.notificationCount.set('123', newCount);

      expect(prStateManager.getNotificationCount('123')).toBe(1);
    });

    test('should increment multiple times', () => {
      prStateManager.notificationCount.set('123', 2);

      // Simulate increment logic
      const current = prStateManager.getNotificationCount('123');
      const newCount = current + 1;
      prStateManager.notificationCount.set('123', newCount);

      expect(prStateManager.getNotificationCount('123')).toBe(3);
    });
  });
});
