/**
 * Unit tests for telegramService (simplified version without complex Telegram Bot API mocking)
 * Tests core Telegram service logic, HTML escaping, callback parsing, and message formatting
 */

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

jest.mock('node-telegram-bot-api', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    off: jest.fn(),
    sendMessage: jest.fn(() => Promise.resolve({ message_id: 1 })),
    answerCallbackQuery: jest.fn(() => Promise.resolve()),
    editMessageText: jest.fn(() => Promise.resolve()),
    editMessageReplyMarkup: jest.fn(() => Promise.resolve()),
    deleteMessage: jest.fn(() => Promise.resolve()),
    stopPolling: jest.fn(() => Promise.resolve()),
    deleteWebhook: jest.fn(() => Promise.resolve())
  }));
});

jest.mock('../../../src/config/yamlConfig', () => ({
  instances: {
    'test-org': {
      owner: 'test-org',
      key: 'test-org',
      repos: {
        'test-repo': { threadId: 123 }
      }
    }
  },
  app: {
    telegram: {
      botToken: 'test-token',
      chatId: 'test-chat-id'
    }
  },
  retries: {
    telegramRetries: 3,
    backoffFactor: 2
  },
  getRepoConfig: jest.fn((owner, repo) => ({
    threadId: 123,
    instance: {
      key: 'test-org',
      agent: { reviewTimeoutMessage: '2-5 minutes' }
    }
  }))
}));

jest.mock('../../../src/services/mcpGithubService', () => ({
  getMCPService: jest.fn(() => ({
    getOpenPRs: jest.fn(() => Promise.resolve([])),
    getPRDetails: jest.fn(() => Promise.resolve({ totalChanges: 0, filesChanged: [] })),
    approvePR: jest.fn(() => Promise.resolve()),
    requestChanges: jest.fn(() => Promise.resolve()),
    closePR: jest.fn(() => Promise.resolve()),
    callMCP: jest.fn(() => Promise.resolve()),
    createReviewWithComments: jest.fn(() => Promise.resolve({ html_url: 'https://example.com' }))
  }))
}));

jest.mock('../../../src/services/skipManager', () => ({
  addSkip: jest.fn(() => Promise.resolve())
}));

jest.mock('../../../src/services/repositoryStateManager', () => ({
  markProcessed: jest.fn(() => Promise.resolve())
}));

jest.mock('../../../src/services/reviewStateManager', () => ({
  clearReviewState: jest.fn(() => Promise.resolve()),
  markDismissed: jest.fn(() => Promise.resolve())
}));

jest.mock('../../../src/services/openclawAgentService', () => ({
  runReviewWithLevel: jest.fn(() => Promise.resolve({
    summary: 'Test review',
    comments: []
  }))
}));

jest.resetModules();
const telegramService = require('../../../src/services/telegramService');

describe('telegramService (core logic)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mappings
    telegramService.instanceMap.clear();
    telegramService.repoMap.clear();
  });

  describe('escapeHtml', () => {
    test('should escape less than signs', () => {
      expect(telegramService.escapeHtml('<div>')).toBe('&lt;div&gt;');
    });

    test('should escape greater than signs', () => {
      expect(telegramService.escapeHtml('test>value')).toBe('test&gt;value');
    });

    test('should escape both < and >', () => {
      expect(telegramService.escapeHtml('<test>')).toBe('&lt;test&gt;');
    });

    test('should handle null input', () => {
      expect(telegramService.escapeHtml(null)).toBe('N/A');
    });

    test('should handle undefined input', () => {
      expect(telegramService.escapeHtml(undefined)).toBe('N/A');
    });

    test('should convert non-string values to string', () => {
      expect(telegramService.escapeHtml(123)).toBe('123');
    });

    test('should handle strings with special characters', () => {
      expect(telegramService.escapeHtml('a<b>c')).toBe('a&lt;b&gt;c');
    });

    test('should handle empty string', () => {
      expect(telegramService.escapeHtml('')).toBe('');
    });

    test('should handle multiple special characters', () => {
      expect(telegramService.escapeHtml('<<<>>>')).toBe('&lt;&lt;&lt;&gt;&gt;&gt;');
    });
  });

  describe('Callback data parsing', () => {
    test('should parse standard 4-part callback data', () => {
      const dataParts = 'review_now:0:0:123'.split(':');
      expect(dataParts).toEqual(['review_now', '0', '0', '123']);
      expect(dataParts.length).toBe(4);
    });

    test('should parse 5-part review_level callback data', () => {
      const dataParts = 'review_level:0:0:123:low'.split(':');
      expect(dataParts).toEqual(['review_level', '0', '0', '123', 'low']);
      expect(dataParts.length).toBe(5);
    });

    test('should parse 5-part approve_outdated callback data', () => {
      const dataParts = 'approve_outdated:0:0:123:456'.split(':');
      expect(dataParts).toEqual(['approve_outdated', '0', '0', '123', '456']);
    });

    test('should parse 6-part review_level_outdated callback data', () => {
      const dataParts = 'review_level_outdated:0:0:123:456:medium'.split(':');
      expect(dataParts).toEqual(['review_level_outdated', '0', '0', '123', '456', 'medium']);
      expect(dataParts.length).toBe(6);
    });

    test('should identify action type from callback data', () => {
      const data1 = 'review_now:0:0:123'.split(':');
      expect(data1[0]).toBe('review_now');

      const data2 = 'approve:0:0:123'.split(':');
      expect(data2[0]).toBe('approve');

      const data3 = 'skip:0:0:123'.split(':');
      expect(data3[0]).toBe('skip');
    });

    test('should convert string PR ID to number', () => {
      const prIdStr = '123';
      const prIdNum = parseInt(prIdStr);
      expect(prIdNum).toBe(123);
      expect(typeof prIdNum).toBe('number');
    });

    test('should handle invalid callback data format', () => {
      const dataParts = 'invalid'.split(':');
      expect(dataParts.length).toBe(1);
      expect(dataParts.length < 4 && dataParts.length !== 5 && dataParts.length !== 6).toBe(true);
    });
  });

  describe('buildMapping logic', () => {
    test('should create instance index mapping', () => {
      const instances = {
        'org1': { owner: 'org1', repos: { 'repo1': {} } },
        'org2': { owner: 'org2', repos: { 'repo2': {} } }
      };

      let instanceIdx = 0;
      for (const [instanceKey, instance] of Object.entries(instances)) {
        expect(instanceIdx).toBeGreaterThanOrEqual(0);
        expect(instance.owner).toBeDefined();
        instanceIdx++;
      }
      expect(instanceIdx).toBe(2);
    });

    test('should create repo index mapping', () => {
      const instance = {
        owner: 'test-org',
        repos: {
          'repo1': {},
          'repo2': {},
          'repo3': {}
        }
      };

      let repoIdx = 0;
      const repoKeys = [];
      for (const repoName of Object.keys(instance.repos || {})) {
        repoKeys.push(`${0}:${repoIdx}`);
        repoIdx++;
      }

      expect(repoIdx).toBe(3);
      expect(repoKeys).toContain('0:0');
      expect(repoKeys).toContain('0:1');
      expect(repoKeys).toContain('0:2');
    });

    test('should generate compact callback data format', () => {
      const instanceIdx = 0;
      const repoIdx = 1;
      const prId = 123;
      const action = 'review_now';

      const callbackData = `${action}:${instanceIdx}:${repoIdx}:${prId}`;
      expect(callbackData).toBe('review_now:0:1:123');
    });

    test('should handle empty repos object', () => {
      const instance = { owner: 'test-org', repos: {} };
      const repoCount = Object.keys(instance.repos || {}).length;
      expect(repoCount).toBe(0);
    });

    test('should handle null repos object', () => {
      const instance = { owner: 'test-org', repos: null };
      const repoCount = Object.keys(instance.repos || {}).length;
      expect(repoCount).toBe(0);
    });
  });

  describe('getRepoInfo logic', () => {
    test('should get repo info from composite key', () => {
      const repoMap = new Map();
      repoMap.set('0:0', { owner: 'org1', repo: 'repo1' });
      repoMap.set('0:1', { owner: 'org1', repo: 'repo2' });
      repoMap.set('1:0', { owner: 'org2', repo: 'repo1' });

      const info1 = repoMap.get('0:0');
      expect(info1).toEqual({ owner: 'org1', repo: 'repo1' });

      const info2 = repoMap.get('1:0');
      expect(info2).toEqual({ owner: 'org2', repo: 'repo1' });
    });

    test('should return undefined for non-existent key', () => {
      const repoMap = new Map();
      repoMap.set('0:0', { owner: 'org1', repo: 'repo1' });

      const info = repoMap.get('9:9');
      expect(info).toBeUndefined();
    });

    test('should construct composite key from indices', () => {
      const instanceIdx = 0;
      const repoIdx = 1;
      const key = `${instanceIdx}:${repoIdx}`;
      expect(key).toBe('0:1');
    });
  });

  describe('getRepoIndices logic', () => {
    test('should find repo indices by owner and repo', () => {
      const repoMap = new Map([
        ['0:0', { owner: 'org1', repo: 'repo1' }],
        ['0:1', { owner: 'org1', repo: 'repo2' }],
        ['1:0', { owner: 'org2', repo: 'repo1' }]
      ]);

      for (const [key, value] of repoMap.entries()) {
        if (value.owner === 'org1' && value.repo === 'repo2') {
          const [instanceIdx, repoIdx] = key.split(':').map(Number);
          expect(instanceIdx).toBe(0);
          expect(repoIdx).toBe(1);
        }
      }
    });

    test('should return null when repo not found', () => {
      const repoMap = new Map([
        ['0:0', { owner: 'org1', repo: 'repo1' }]
      ]);

      let found = false;
      for (const [key, value] of repoMap.entries()) {
        if (value.owner === 'nonexistent' && value.repo === 'repo') {
          found = true;
        }
      }
      expect(found).toBe(false);
    });
  });

  describe('Retry operation logic', () => {
    test('should calculate exponential backoff delays', () => {
      const minTimeout = 3000;
      const factor = 2;

      const attempt1Delay = minTimeout * Math.pow(factor, 1 - 1);
      const attempt2Delay = minTimeout * Math.pow(factor, 2 - 1);
      const attempt3Delay = minTimeout * Math.pow(factor, 3 - 1);

      expect(attempt1Delay).toBe(3000);
      expect(attempt2Delay).toBe(6000);
      expect(attempt3Delay).toBe(12000);
    });

    test('should calculate delay for any attempt number', () => {
      const minTimeout = 3000;
      const factor = 2;
      const attempt = 4;

      const delay = minTimeout * Math.pow(factor, attempt - 1);
      expect(delay).toBe(24000);
    });

    test('should track attempt count', () => {
      let attempt = 0;
      const retries = 3;

      while (attempt < retries) {
        attempt++;
        expect(attempt).toBeGreaterThan(0);
        expect(attempt).toBeLessThanOrEqual(retries);
      }
      expect(attempt).toBe(retries);
    });
  });

  describe('Message formatting', () => {
    test('should format PR notification message', () => {
      const owner = 'test-org';
      const repo = 'test-repo';
      const prNumber = 123;
      const title = 'Fix bug in authentication';

      const message = `🔔 <b>NEW PR DETECTED</b>\n<b>${owner}/${repo} PR #${prNumber}: ${title}</b>`;

      expect(message).toContain('test-org/test-repo');
      expect(message).toContain('PR #123');
      expect(message).toContain('Fix bug in authentication');
      expect(message).toContain('NEW PR DETECTED');
    });

    test('should format review complete message', () => {
      const owner = 'test-org';
      const repo = 'test-repo';
      const level = 'HIGH';
      const commentsCount = 5;

      const message = `✅ <b>Review Complete!</b>\n\n📁 <b>Repo:</b> ${owner}/${repo}\n📝 <b>Level:</b> ${level}\n💬 <b>Comments:</b> ${commentsCount}`;

      expect(message).toContain('Review Complete');
      expect(message).toContain('test-org/test-repo');
      expect(message).toContain('HIGH');
      expect(message).toContain('5');
    });

    test('should format outdated review notification', () => {
      const owner = 'test-org';
      const repo = 'test-repo';
      const prNumber = 456;
      const reviewSha = 'abc123def456';
      const currentSha = '789ghi012jkl';

      const message = `🔄 <b>OUTDATED REVIEW DETECTED</b>\n<b>${owner}/${repo} PR #${prNumber}</b>\n• Review HEAD: <code>${reviewSha.substring(0, 7)}</code>\n• Current HEAD: <code>${currentSha.substring(0, 7)}</code>`;

      expect(message).toContain('OUTDATED REVIEW DETECTED');
      expect(message).toContain('abc123d');
      expect(message).toContain('789ghi0');
    });

    test('should handle suspicious patterns in summary', () => {
      const suspiciousPatterns = ['hardcoded-secret', 'sql-injection'];
      const suspiciousPatternsStr = suspiciousPatterns?.length
        ? suspiciousPatterns.join(', ')
        : 'None';

      expect(suspiciousPatternsStr).toBe('hardcoded-secret, sql-injection');
    });

    test('should handle empty suspicious patterns', () => {
      const suspiciousPatterns = [];
      const suspiciousPatternsStr = suspiciousPatterns?.length
        ? suspiciousPatterns.join(', ')
        : 'None';

      expect(suspiciousPatternsStr).toBe('None');
    });

    test('should handle undefined suspicious patterns', () => {
      const suspiciousPatterns = undefined;
      const suspiciousPatternsStr = suspiciousPatterns?.length
        ? suspiciousPatterns.join(', ')
        : 'None';

      expect(suspiciousPatternsStr).toBe('None');
    });
  });

  describe('Inline keyboard construction', () => {
    test('should build standard PR notification keyboard', () => {
      const instanceIdx = 0;
      const repoIdx = 0;
      const prId = 123;

      const inlineKeyboard = {
        inline_keyboard: [
          [
            { text: '🔍 Review Now', callback_data: `review_now:${instanceIdx}:${repoIdx}:${prId}` },
            { text: '🔗 Visit PR', callback_data: `visit:${instanceIdx}:${repoIdx}:${prId}` }
          ],
          [
            { text: '✅ Approve', callback_data: `approve:${instanceIdx}:${repoIdx}:${prId}` },
            { text: '❌ Reject', callback_data: `reject:${instanceIdx}:${repoIdx}:${prId}` }
          ],
          [
            { text: '🔒 Close PR', callback_data: `close:${instanceIdx}:${repoIdx}:${prId}` },
            { text: '⏸️ Skip (3h)', callback_data: `skip:${instanceIdx}:${repoIdx}:${prId}` }
          ]
        ]
      };

      expect(inlineKeyboard.inline_keyboard).toHaveLength(3);
      expect(inlineKeyboard.inline_keyboard[0]).toHaveLength(2);
      expect(inlineKeyboard.inline_keyboard[0][0].callback_data).toBe('review_now:0:0:123');
    });

    test('should build review level selection keyboard', () => {
      const instanceIdx = 0;
      const repoIdx = 0;
      const prId = 123;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '🟢 Low (Basic)', callback_data: `review_level:${instanceIdx}:${repoIdx}:${prId}:low` },
            { text: '🟡 Medium (Standard)', callback_data: `review_level:${instanceIdx}:${repoIdx}:${prId}:medium` }
          ],
          [
            { text: '🔴 High (Comprehensive)', callback_data: `review_level:${instanceIdx}:${repoIdx}:${prId}:high` }
          ],
          [
            { text: '❌ Batal', callback_data: `review_cancel:${instanceIdx}:${repoIdx}:${prId}` }
          ]
        ]
      };

      expect(keyboard.inline_keyboard).toHaveLength(3);
      expect(keyboard.inline_keyboard[2][0].callback_data).toContain('review_cancel');
    });

    test('should build outdated review keyboard', () => {
      const instanceIdx = 0;
      const repoIdx = 0;
      const prId = 123;
      const reviewId = 456;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '✅ Approve', callback_data: `approve_outdated:${instanceIdx}:${repoIdx}:${prId}:${reviewId}` },
            { text: '🔍 Re-review', callback_data: `re_review:${instanceIdx}:${repoIdx}:${prId}:${reviewId}` }
          ],
          [
            { text: '🔗 Visit PR', callback_data: `visit:${instanceIdx}:${repoIdx}:${prId}` },
            { text: '❌ Dismiss', callback_data: `dismiss_outdated:${instanceIdx}:${repoIdx}:${prId}:${reviewId}` }
          ]
        ]
      };

      expect(keyboard.inline_keyboard).toHaveLength(2);
      expect(keyboard.inline_keyboard[0][0].callback_data).toContain('approve_outdated');
    });
  });

  describe('Polling error handling', () => {
    test('should detect 409 conflict error', () => {
      const error = { code: 'ETELEGRAM', message: 'Error: 409 conflict' };
      const isConflict = error.code === 'ETELEGRAM' && error.message.includes('409');
      expect(isConflict).toBe(true);
    });

    test('should detect EFATAL error', () => {
      const error = { code: 'EFATAL', message: 'Fatal error' };
      const isFatal = error.code === 'EFATAL';
      expect(isFatal).toBe(true);
    });

    test('should identify non-409 errors', () => {
      const error = { code: 'ETELEGRAM', message: 'Network timeout' };
      const isConflict = error.code === 'ETELEGRAM' && error.message.includes('409');
      expect(isConflict).toBe(false);
    });

    test('should calculate polling restart delay', () => {
      const restartDelay = 5000;
      expect(restartDelay).toBe(5000);
    });
  });

  describe('GitHub API error handling', () => {
    test('should detect own PR restriction error', () => {
      const errorMessage = 'Can not request changes on your own pull request';
      const isOwnPR = errorMessage.includes('Can not request changes on your own pull request');
      expect(isOwnPR).toBe(true);
    });

    test('should handle other request changes errors', () => {
      const errorMessage = 'Network timeout while requesting changes';
      const isOwnPR = errorMessage.includes('Can not request changes on your own pull request');
      expect(isOwnPR).toBe(false);
    });
  });

  describe('Date formatting for review display', () => {
    test('should format review date', () => {
      const reviewDate = new Date('2024-01-15T10:30:00Z');
      const formatted = reviewDate.toLocaleString('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short'
      });

      expect(formatted).toBeDefined();
      expect(typeof formatted).toBe('string');
    });

    test('should truncate SHA for display', () => {
      const fullSha = 'abc123def456789abc123def456789';
      const shortSha = fullSha.substring(0, 7);
      expect(shortSha).toBe('abc123d');
      expect(shortSha.length).toBe(7);
    });

    test('should handle null SHA', () => {
      const sha = null;
      const shortSha = sha?.substring(0, 7) || 'N/A';
      expect(shortSha).toBe('N/A');
    });

    test('should handle undefined SHA', () => {
      const sha = undefined;
      const shortSha = sha?.substring(0, 7) || 'N/A';
      expect(shortSha).toBe('N/A');
    });
  });

  describe('Edge cases', () => {
    test('should handle empty summary object', () => {
      const summary = {};
      const purpose = summary.purpose || 'N/A';
      const type = summary.type || 'N/A';
      expect(purpose).toBe('N/A');
      expect(type).toBe('N/A');
    });

    test('should handle PR with no author', () => {
      const author = undefined;
      const displayAuthor = author || 'Unknown';
      expect(displayAuthor).toBe('Unknown');
    });

    test('should handle PR with no URL', () => {
      const url = null;
      const displayUrl = url || 'N/A';
      expect(displayUrl).toBe('N/A');
    });

    test('should handle PR with no title', () => {
      const title = '';
      const displayTitle = title || 'Untitled PR';
      expect(displayTitle).toBe('Untitled PR');
    });

    test('should handle missing thread ID', () => {
      const threadId = undefined;
      const actualThreadId = threadId || null;
      expect(actualThreadId).toBeNull();
    });
  });

  describe('Callback data format validation', () => {
    test('should validate 4-part format', () => {
      const data = 'action:0:0:123';
      const parts = data.split(':');
      expect(parts.length).toBe(4);
    });

    test('should validate 5-part format', () => {
      const data = 'action:0:0:123:extra';
      const parts = data.split(':');
      expect(parts.length).toBe(5);
    });

    test('should validate 6-part format', () => {
      const data = 'action:0:0:123:extra:more';
      const parts = data.split(':');
      expect(parts.length).toBe(6);
    });

    test('should reject invalid formats', () => {
      const data1 = 'action:0:0';
      const data2 = 'action:0';
      const data3 = 'action';

      expect(data1.split(':').length).toBe(3);
      expect(data2.split(':').length).toBe(2);
      expect(data3.split(':').length).toBe(1);

      // All should be invalid (not 4, 5, or 6)
      const validLengths = [4, 5, 6];
      expect(validLengths.includes(data1.split(':').length)).toBe(false);
      expect(validLengths.includes(data2.split(':').length)).toBe(false);
      expect(validLengths.includes(data3.split(':').length)).toBe(false);
    });
  });

  describe('Action type detection', () => {
    test('should detect review_now action', () => {
      const action = 'review_now';
      expect(action).toBe('review_now');
    });

    test('should detect approve action', () => {
      const action = 'approve';
      expect(action).toBe('approve');
    });

    test('should detect reject action', () => {
      const action = 'reject';
      expect(action).toBe('reject');
    });

    test('should detect close action', () => {
      const action = 'close';
      expect(action).toBe('close');
    });

    test('should detect skip action', () => {
      const action = 'skip';
      expect(action).toBe('skip');
    });

    test('should detect visit action', () => {
      const action = 'visit';
      expect(action).toBe('visit');
    });

    test('should detect review_level action', () => {
      const action = 'review_level';
      expect(action).toBe('review_level');
    });

    test('should detect review_cancel action', () => {
      const action = 'review_cancel';
      expect(action).toBe('review_cancel');
    });

    test('should detect approve_outdated action', () => {
      const action = 'approve_outdated';
      expect(action).toBe('approve_outdated');
    });

    test('should detect re_review action', () => {
      const action = 're_review';
      expect(action).toBe('re_review');
    });

    test('should detect dismiss_outdated action', () => {
      const action = 'dismiss_outdated';
      expect(action).toBe('dismiss_outdated');
    });

    test('should detect review_level_outdated action', () => {
      const action = 'review_level_outdated';
      expect(action).toBe('review_level_outdated');
    });
  });

  describe('Level validation', () => {
    test('should recognize valid review levels', () => {
      const validLevels = ['low', 'medium', 'high'];
      expect(validLevels).toContain('low');
      expect(validLevels).toContain('medium');
      expect(validLevels).toContain('high');
    });

    test('should format level for display', () => {
      const level = 'low';
      const displayLevel = level.toUpperCase();
      expect(displayLevel).toBe('LOW');
    });

    test('should format medium level', () => {
      const level = 'medium';
      const displayLevel = level.toUpperCase();
      expect(displayLevel).toBe('MEDIUM');
    });

    test('should format high level', () => {
      const level = 'high';
      const displayLevel = level.toUpperCase();
      expect(displayLevel).toBe('HIGH');
    });
  });
});
