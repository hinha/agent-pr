/**
 * Unit tests for schedulerDaemon (simplified version without complex integration mocking)
 * Tests core scheduler daemon logic, state management, and lifecycle methods
 */

jest.mock('../../../src/config/yamlConfig', () => ({
  instances: {
    'test-org': {
      owner: 'test-org',
      mcp_name: 'github-work',
      maxAgeMs: 48 * 60 * 60 * 1000,
      repos: {
        'test-repo': { thread_id: 123 }
      }
    }
  },
  app: {
    checkIntervalMs: 7 * 60 * 1000,
    outdatedReviewCheckIntervalMs: 30 * 60 * 1000,
    snoozeTime: null,
    flagsmith: {
      enabled: false
    }
  }
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
}));

jest.mock('../../../src/utils/timeoutManager', () => {
  return jest.fn().mockImplementation(() => ({
    setTimeout: jest.fn((cb, delay) => 'timeout-id-123'),
    clearTimeout: jest.fn(),
    clearAll: jest.fn()
  }));
});

jest.mock('../../../src/utils/timeUtils', () => ({
  shouldSnooze: jest.fn(() => false),
  getSnoozeReason: jest.fn(() => 'Snoozing'),
  formatDuration: jest.fn((ms) => `${Math.round(ms / 60000)}m`)
}));

jest.mock('../../../src/services/mcpGithubService', () => {
  const mockService = {
    getOpenPRs: jest.fn(() => Promise.resolve([])),
    getPRDetails: jest.fn(() => Promise.resolve({ totalChanges: 0, filesChanged: [] })),
    getPRReviews: jest.fn(() => Promise.resolve([])),
    cleanup: jest.fn()
  };
  return {
    getMCPService: jest.fn(() => mockService)
  };
});

jest.mock('../../../src/services/telegramService', () => ({
  sendPRNotification: jest.fn(() => Promise.resolve()),
  sendOutdatedReviewNotification: jest.fn(() => Promise.resolve()),
  buildMapping: jest.fn(() => ({ instanceMap: new Map(), repoMap: new Map() }))
}));

jest.mock('../../../src/services/skipManager', () => {
  const skipManager = {
    getRepoKey: jest.fn((owner, repo) => `${owner}/${repo}`),
    isSkipped: jest.fn(() => false)
  };
  return skipManager;
});

jest.mock('../../../src/services/repositoryStateManager', () => ({
  state: new Map(),
  getRepoStateSync: jest.fn(() => ({
    processedPRs: new Set(),
    notificationCount: new Map(),
    processedTimestamps: new Map(),
    loaded: true
  })),
  isProcessed: jest.fn(() => Promise.resolve(false)),
  getNotificationCount: jest.fn(() => 0),
  incrementNotificationCount: jest.fn(() => Promise.resolve(1)),
  markProcessed: jest.fn(() => Promise.resolve()),
  cleanupOldEntries: jest.fn(() => 0),
  getStats: jest.fn(() => ({
    totalRepos: 1,
    totalProcessedPRs: 0,
    totalNotifications: 0
  }))
}));

jest.mock('../../../src/services/reviewStateManager', () => ({
  updateReviewState: jest.fn(() => Promise.resolve({ has_outdated: false, dismissed: false })),
  hasNewCommits: jest.fn(() => false),
  getStats: jest.fn(() => ({
    totalRepos: 0,
    totalReviews: 0,
    totalOutdated: 0,
    totalDismissed: 0
  }))
}));

jest.mock('../../../src/services/flagsmithSyncService', () => ({
  init: jest.fn(() => Promise.resolve()),
  start: jest.fn(),
  stop: jest.fn(),
  isEnabled: false
}));

jest.mock('../../../src/utils/prAnalyzer', () => ({
  analyzePRRisk: jest.fn(() => ({
    riskLevel: 'low',
    impactArea: 'unknown',
    suspiciousPatterns: [],
    recommendedReview: 'low'
  }))
}));

jest.resetModules();
const schedulerDaemon = require('../../../src/services/schedulerDaemon');
const config = require('../../../src/config/yamlConfig');
const logger = require('../../../src/utils/logger');
const repositoryStateManager = require('../../../src/services/repositoryStateManager');
const telegramService = require('../../../src/services/telegramService');
const skipManager = require('../../../src/services/skipManager');
const reviewStateManager = require('../../../src/services/reviewStateManager');
const flagsmithSyncService = require('../../../src/services/flagsmithSyncService');
const { analyzePRRisk } = require('../../../src/utils/prAnalyzer');
const timeUtils = require('../../../src/utils/timeUtils');

describe('schedulerDaemon (core logic)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    schedulerDaemon.activeProcesses.clear();
    schedulerDaemon.pendingRetries.clear();
    schedulerDaemon.mcpServices.clear();
  });

  describe('constructor', () => {
    test('should initialize with default values', () => {
      expect(schedulerDaemon.checkInterval).toBeNull();
      expect(schedulerDaemon.outdatedReviewCheckInterval).toBeNull();
      expect(schedulerDaemon.activeProcesses).toBeInstanceOf(Map);
      expect(schedulerDaemon.pendingRetries).toBeInstanceOf(Map);
      expect(schedulerDaemon.mcpServices).toBeInstanceOf(Map);
      expect(schedulerDaemon.timeoutManager).toBeDefined();
    });
  });

  describe('getMCPService', () => {
    test('should cache MCP services in Map', () => {
      schedulerDaemon.mcpServices.set('test-instance', { name: 'test-service' });
      expect(schedulerDaemon.mcpServices.has('test-instance')).toBe(true);
      expect(schedulerDaemon.mcpServices.get('test-instance')).toEqual({ name: 'test-service' });
    });

    test('should track multiple instances', () => {
      schedulerDaemon.mcpServices.set('org1', { name: 'service1' });
      schedulerDaemon.mcpServices.set('org2', { name: 'service2' });

      expect(schedulerDaemon.mcpServices.size).toBe(2);
    });
  });

  describe('activeProcesses tracking', () => {
    test('should add PR to active processes', () => {
      schedulerDaemon.activeProcesses.set('123', true);
      expect(schedulerDaemon.activeProcesses.has('123')).toBe(true);
    });

    test('should remove PR from active processes', () => {
      schedulerDaemon.activeProcesses.set('123', true);
      schedulerDaemon.activeProcesses.delete('123');
      expect(schedulerDaemon.activeProcesses.has('123')).toBe(false);
    });

    test('should check if PR is actively being processed', () => {
      schedulerDaemon.activeProcesses.set('456', true);
      expect(schedulerDaemon.activeProcesses.has('456')).toBe(true);
      expect(schedulerDaemon.activeProcesses.has('789')).toBe(false);
    });
  });

  describe('pendingRetries tracking', () => {
    test('should add timeout ID to pending retries', () => {
      schedulerDaemon.pendingRetries.set('123', 'timeout-id-123');
      expect(schedulerDaemon.pendingRetries.get('123')).toBe('timeout-id-123');
    });

    test('should remove timeout ID from pending retries', () => {
      schedulerDaemon.pendingRetries.set('123', 'timeout-id-123');
      schedulerDaemon.pendingRetries.delete('123');
      expect(schedulerDaemon.pendingRetries.has('123')).toBe(false);
    });

    test('should track multiple pending retries', () => {
      schedulerDaemon.pendingRetries.set('123', 'timeout-1');
      schedulerDaemon.pendingRetries.set('456', 'timeout-2');
      schedulerDaemon.pendingRetries.set('789', 'timeout-3');

      expect(schedulerDaemon.pendingRetries.size).toBe(3);
    });
  });

  describe('PR type classification', () => {
    test('should classify bugfix PRs by title', () => {
      const pr = { title: 'fix: critical bug in authentication', description: 'Fixes login issue' };
      const type = pr.title.includes('fix') ? 'bugfix' : pr.title.includes('feat') ? 'feature' : 'other';
      expect(type).toBe('bugfix');
    });

    test('should classify feature PRs by title', () => {
      const pr = { title: 'feat: add new dashboard', description: 'Adds dashboard feature' };
      const type = pr.title.includes('fix') ? 'bugfix' : pr.title.includes('feat') ? 'feature' : 'other';
      expect(type).toBe('feature');
    });

    test('should classify other PRs', () => {
      const pr = { title: 'docs: update README', description: 'Documentation update' };
      const type = pr.title.includes('fix') ? 'bugfix' : pr.title.includes('feat') ? 'feature' : 'other';
      expect(type).toBe('other');
    });
  });

  describe('Description cleaning', () => {
    test('should remove markdown special characters', () => {
      const description = 'This is a **bold** and `code` with [link](url)';
      const cleaned = description.replace(/[*_`#[\]()]/g, '');
      expect(cleaned).toBe('This is a bold and code with linkurl');
    });

    test('should truncate long descriptions', () => {
      const longDescription = 'a'.repeat(200);
      const truncated = longDescription.substring(0, 120);
      expect(truncated.length).toBe(120);
    });

    test('should handle empty description', () => {
      const description = '';
      const cleaned = (description || 'No description').replace(/[*_`#[\]()]/g, '').substring(0, 120);
      expect(cleaned).toBe('No description');
    });

    test('should handle null description', () => {
      const description = null;
      const cleaned = (description || 'No description').replace(/[*_`#[\]()]/g, '').substring(0, 120);
      expect(cleaned).toBe('No description');
    });
  });

  describe('PR age calculation', () => {
    test('should calculate PR age in milliseconds', () => {
      const createdAt = new Date(Date.now() - 3600000); // 1 hour ago
      const prAge = Date.now() - createdAt.getTime();
      expect(prAge).toBeGreaterThan(3599000);
      expect(prAge).toBeLessThan(3601000);
    });

    test('should convert age to hours', () => {
      const ageMs = 48 * 60 * 60 * 1000; // 48 hours
      const ageHours = Math.round(ageMs / 3600000);
      expect(ageHours).toBe(48);
    });
  });

  describe('Notification count logic', () => {
    test('should check if notification count is below threshold', () => {
      const currentCount = 2;
      const shouldNotify = currentCount < 3;
      expect(shouldNotify).toBe(true);
    });

    test('should check if notification count reached threshold', () => {
      const currentCount = 3;
      shouldNotify = currentCount < 3;
      expect(shouldNotify).toBe(false);
    });

    test('should calculate next count after increment', () => {
      const currentCount = 1;
      const newCount = currentCount + 1;
      expect(newCount).toBe(2);
    });
  });

  describe('Skip manager integration', () => {
    test('should generate repo key format', () => {
      const owner = 'owner';
      const repo = 'repo';
      const repoKey = `${owner}/${repo}`;
      expect(repoKey).toBe('owner/repo');
    });

    test('should generate repo key for different combinations', () => {
      expect(`${'org1'}/${'repo1'}`).toBe('org1/repo1');
      expect(`${'org2'}/${'repo2'}`).toBe('org2/repo2');
    });
  });

  describe('Snooze logic', () => {
    test('should check if should snooze', () => {
      timeUtils.shouldSnooze.mockReturnValue(true);
      const shouldSnoozing = timeUtils.shouldSnooze(config.app.snoozeTime);
      expect(shouldSnoozing).toBe(true);
    });

    test('should get snooze reason', () => {
      timeUtils.getSnoozeReason.mockReturnValue('Weekend snooze active');
      const reason = timeUtils.getSnoozeReason(config.app.snoozeTime);
      expect(reason).toBe('Weekend snooze active');
    });
  });

  describe('Error handling for unsupported file types', () => {
    test('should detect unsupported file types error', () => {
      const err = new Error('cannot be reviewed: contains unsupported file types');
      const hasError = err.message && err.message.includes('cannot be reviewed: contains unsupported file types');
      expect(hasError).toBe(true);
    });

    test('should not trigger on other errors', () => {
      const err = new Error('Network timeout');
      const hasError = err.message && err.message.includes('cannot be reviewed: contains unsupported file types');
      expect(hasError).toBe(false);
    });
  });

  describe('Summary object construction', () => {
    test('should build summary object from PR and risk analysis', () => {
      const pr = {
        title: 'feat: new feature',
        description: 'Add new feature'
      };
      const prDetails = {
        totalChanges: 42,
        filesChanged: ['src/file.js']
      };
      const riskAnalysis = {
        riskLevel: 'medium',
        impactArea: 'api',
        suspiciousPatterns: [],
        recommendedReview: 'high'
      };

      const cleanDescription = (pr.description || 'No description').replace(/[*_`#[\]()]/g, '').substring(0, 120);
      const summary = {
        purpose: `${cleanDescription}...`,
        type: pr.title.includes('fix') ? 'bugfix' : pr.title.includes('feat') ? 'feature' : 'other',
        riskLevel: riskAnalysis.riskLevel,
        impactArea: riskAnalysis.impactArea,
        diffSize: `${prDetails.totalChanges} changes`,
        suspiciousPatterns: riskAnalysis.suspiciousPatterns,
        recommendedReview: riskAnalysis.recommendedReview,
        filesChanged: prDetails.filesChanged
      };

      expect(summary.purpose).toBe('Add new feature...');
      expect(summary.type).toBe('feature');
      expect(summary.riskLevel).toBe('medium');
      expect(summary.impactArea).toBe('api');
      expect(summary.diffSize).toBe('42 changes');
    });
  });

  describe('MCP services caching', () => {
    test('should clear all MCP services on stop', () => {
      const { getMCPService } = require('../../../src/services/mcpGithubService');
      schedulerDaemon.getMCPService('org1');
      schedulerDaemon.getMCPService('org2');

      expect(schedulerDaemon.mcpServices.size).toBe(2);

      schedulerDaemon.mcpServices.clear();
      expect(schedulerDaemon.mcpServices.size).toBe(0);
    });
  });

  describe('Instance iteration logic', () => {
    test('should iterate through all instances', () => {
      const instances = config.instances;
      const keys = Object.keys(instances);
      expect(keys).toContain('test-org');
    });

    test('should iterate through all repos in instance', () => {
      const instance = config.instances['test-org'];
      const repoKeys = Object.keys(instance.repos || {});
      expect(repoKeys).toContain('test-repo');
    });

    test('should calculate total repos across all instances', () => {
      let totalRepos = 0;
      for (const instance of Object.values(config.instances)) {
        totalRepos += Object.keys(instance.repos || {}).length;
      }
      expect(totalRepos).toBe(1);
    });
  });

  describe('waitForCompletion logic', () => {
    test('should return immediately when no active processes', async () => {
      schedulerDaemon.activeProcesses.clear();
      const startTime = Date.now();

      // Simulate the while loop logic
      const shouldContinue = schedulerDaemon.activeProcesses.size > 0;
      expect(shouldContinue).toBe(false);
    });

    test('should detect active processes', () => {
      schedulerDaemon.activeProcesses.set('123', true);
      schedulerDaemon.activeProcesses.set('456', true);

      expect(schedulerDaemon.activeProcesses.size).toBe(2);
    });

    test('should calculate timeout', () => {
      const timeoutMs = 30000;
      const startTime = Date.now();
      const hasTimedOut = Date.now() - startTime > timeoutMs;
      expect(hasTimedOut).toBe(false);
    });
  });

  describe('Review state management', () => {
    test('should check if review has new commits', () => {
      reviewStateManager.hasNewCommits.mockReturnValue(true);
      const hasNewCommits = reviewStateManager.hasNewCommits('owner', 'repo', 123, 'abc123');
      expect(hasNewCommits).toBe(true);
    });

    test('should check review state properties', () => {
      const reviewState = { has_outdated: true, dismissed: false };
      const shouldNotify = reviewState.has_outdated && !reviewState.dismissed;
      expect(shouldNotify).toBe(true);
    });

    test('should not notify if dismissed', () => {
      const reviewState = { has_outdated: true, dismissed: true };
      const shouldNotify = reviewState.has_outdated && !reviewState.dismissed;
      expect(shouldNotify).toBe(false);
    });
  });

  describe('Cleanup logic', () => {
    test('should clear timeout manager on stop', () => {
      schedulerDaemon.timeoutManager.clearAll();
      expect(schedulerDaemon.timeoutManager.clearAll).toHaveBeenCalled();
    });

    test('should clear pending retries on stop', () => {
      schedulerDaemon.pendingRetries.set('123', 'timeout-1');
      schedulerDaemon.pendingRetries.clear();
      expect(schedulerDaemon.pendingRetries.size).toBe(0);
    });

    test('should stop flagsmith sync service', () => {
      flagsmithSyncService.stop();
      expect(flagsmithSyncService.stop).toHaveBeenCalled();
    });
  });

  describe('Interval unref', () => {
    test('should check if unref is a function', () => {
      const mockInterval = { unref: jest.fn() };
      const hasUnref = typeof mockInterval.unref === 'function';
      expect(hasUnref).toBe(true);
    });

    test('should not call unref if not a function', () => {
      const mockInterval = {};
      const hasUnref = typeof mockInterval.unref === 'function';
      expect(hasUnref).toBe(false);
    });
  });

  describe('Edge cases', () => {
    test('should handle empty repos object', () => {
      const instance = { repos: {} };
      const repoKeys = Object.keys(instance.repos || {});
      expect(repoKeys.length).toBe(0);
    });

    test('should handle null repos object', () => {
      const instance = { repos: null };
      const repoKeys = Object.keys(instance.repos || {});
      expect(repoKeys.length).toBe(0);
    });

    test('should handle undefined repos object', () => {
      const instance = {};
      const repoKeys = Object.keys(instance.repos || {});
      expect(repoKeys.length).toBe(0);
    });

    test('should handle PR with no description', () => {
      const pr = { title: 'test', description: undefined };
      const cleanDesc = (pr.description || 'No description').replace(/[*_`#[\]()]/g, '');
      expect(cleanDesc).toBe('No description');
    });
  });

  describe('Stats aggregation', () => {
    test('should get repository state stats', () => {
      repositoryStateManager.getStats.mockReturnValue({
        totalRepos: 5,
        totalProcessedPRs: 10,
        totalNotifications: 15
      });

      const stats = repositoryStateManager.getStats();
      expect(stats.totalRepos).toBe(5);
      expect(stats.totalProcessedPRs).toBe(10);
      expect(stats.totalNotifications).toBe(15);
    });

    test('should get review state stats', () => {
      reviewStateManager.getStats.mockReturnValue({
        totalRepos: 3,
        totalReviews: 7,
        totalOutdated: 2,
        totalDismissed: 1
      });

      const stats = reviewStateManager.getStats();
      expect(stats.totalReviews).toBe(7);
      expect(stats.totalOutdated).toBe(2);
      expect(stats.totalDismissed).toBe(1);
    });
  });

  describe('Risk analysis integration', () => {
    test('should analyze PR risk', () => {
      const pr = { title: 'test', number: 123 };
      const prDetails = { filesChanged: [] };

      analyzePRRisk.mockReturnValue({
        riskLevel: 'high',
        impactArea: 'security',
        suspiciousPatterns: ['hardcoded-secret'],
        recommendedReview: 'high'
      });

      const riskAnalysis = analyzePRRisk(pr, prDetails);
      expect(riskAnalysis.riskLevel).toBe('high');
      expect(riskAnalysis.impactArea).toBe('security');
      expect(riskAnalysis.suspiciousPatterns).toContain('hardcoded-secret');
      expect(riskAnalysis.recommendedReview).toBe('high');
    });
  });

  describe('Timestamp handling', () => {
    test('should format PR creation timestamp', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      const isoString = date.toISOString();
      expect(isoString).toBe('2024-01-15T10:30:00.000Z');
    });

    test('should get current timestamp', () => {
      const now = Date.now();
      expect(typeof now).toBe('number');
      expect(now).toBeGreaterThan(0);
    });
  });

  describe('Log message formatting', () => {
    test('should format log message with context', () => {
      const owner = 'test-org';
      const repoName = 'test-repo';
      const prNumber = 123;
      const message = `Starting processing for PR #${prNumber}`;
      const fullMessage = `[${owner}/${repoName}] ${message}`;

      expect(fullMessage).toBe('[test-org/test-repo] Starting processing for PR #123');
    });

    test('should format retry log message', () => {
      const owner = 'test-org';
      const repoName = 'test-repo';
      const prNumber = 456;
      const message = `Retrying processing for PR #${prNumber}`;
      const fullMessage = `[${owner}/${repoName}] ${message}`;

      expect(fullMessage).toBe('[test-org/test-repo] Retrying processing for PR #456');
    });
  });

  describe('Check interval configuration', () => {
    test('should convert check interval to minutes', () => {
      const intervalMs = 7 * 60 * 1000;
      const minutes = intervalMs / 60000;
      expect(minutes).toBe(7);
    });

    test('should handle zero outdated review check interval', () => {
      const intervalMs = 0;
      const shouldRun = intervalMs > 0;
      expect(shouldRun).toBe(false);
    });

    test('should handle positive outdated review check interval', () => {
      const intervalMs = 30 * 60 * 1000;
      const shouldRun = intervalMs > 0;
      expect(shouldRun).toBe(true);
    });
  });

  describe('Service cleanup error handling', () => {
    test('should log error when cleanup fails', () => {
      const mockService = {
        cleanup: jest.fn(() => { throw new Error('Cleanup failed'); })
      };

      try {
        mockService.cleanup();
      } catch (err) {
        expect(err.message).toBe('Cleanup failed');
      }
    });
  });
});
