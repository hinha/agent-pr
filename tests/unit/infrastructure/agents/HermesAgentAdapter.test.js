/**
 * Unit Tests: HermesAgentAdapter
 *
 * Tests for the Hermes AI agent adapter that handles PR reviews.
 * Focuses on response parsing, JSON extraction from plain text, and error handling.
 */

const HermesAgentAdapter = require('../../../../src/infrastructure/agents/HermesAgentAdapter');

describe('HermesAgentAdapter', () => {
  let adapter;
  let mockConfig;
  let mockLogger;
  let mockRetryHelper;

  beforeEach(() => {
    mockConfig = {
      reviewLevels: {
        low: { focusAreas: ['bugs'], maxCommentsPerFile: 2 },
        medium: { focusAreas: ['bugs', 'style'], maxCommentsPerFile: 5 },
        high: { focusAreas: ['bugs', 'style', 'security', 'performance'], maxCommentsPerFile: 10 }
      },
      instances: {
        'github/testorg': {
          key: 'github/testorg',
          owner: 'testorg',
          mcpName: 'github-test',
          agent: {
            reviewAgent: 'code-reviewer',
            reviewTimeoutSeconds: 120,
            hermesProfile: 'test-profile',
            hermesMaxTurns: 90
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

    mockRetryHelper = {
      retry: jest.fn((fn) => fn())
    };

    adapter = new HermesAgentAdapter(mockConfig, mockLogger, mockRetryHelper);
  });

  describe('_parseHermesResponse', () => {
    const mockPR = { number: 42, url: 'https://github.com/testorg/repo/pull/42' };

    // === Direct JSON in stdout ===
    test('should parse direct JSON with summary and comments', () => {
      const stdout = JSON.stringify({
        summary: 'Code looks good overall',
        comments: [
          { file: 'src/index.js', start_line: 10, severity: 'LOW', message: 'Consider const' }
        ]
      });

      const result = adapter._parseHermesResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(true);
      expect(result.summary).toBe('Code looks good overall');
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].line).toBe(10);
    });

    // === JSON wrapped in markdown code blocks ===
    test('should parse JSON wrapped in markdown code blocks', () => {
      const review = {
        summary: 'Clean code',
        comments: [
          { file: 'src/app.js', line: 20, severity: 'HIGH', message: 'Security issue' }
        ]
      };
      const stdout = '```json\n' + JSON.stringify(review, null, 2) + '\n```';

      const result = adapter._parseHermesResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(true);
      expect(result.summary).toBe('Clean code');
      expect(result.comments).toHaveLength(1);
    });

    // === JSON embedded in plain text ===
    test('should extract JSON from plain text with surrounding content', () => {
      const review = {
        summary: 'Found bugs',
        comments: [
          { file: 'x.js', line: 1, message: 'Bug', severity: 'HIGH' }
        ]
      };
      const stdout = `Here is my review:\n${JSON.stringify(review)}\nEnd of review.`;

      const result = adapter._parseHermesResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(true);
      expect(result.summary).toBe('Found bugs');
      expect(result.comments).toHaveLength(1);
    });

    // === Comment transformation: start_line → line ===
    test('should transform start_line to line in comments', () => {
      const stdout = JSON.stringify({
        summary: 'Issues found',
        comments: [
          { file: 'src/index.js', start_line: 15, end_line: 20, message: 'Missing error handling', severity: 'HIGH' },
          { file: 'src/utils.js', line: 30, message: 'Consider using const', severity: 'LOW' }
        ]
      });

      const result = adapter._parseHermesResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.comments[0].line).toBe(15);
      expect(result.comments[0].start_line).toBe(15); // original preserved via spread
      expect(result.comments[1].line).toBe(30);
    });

    // === Empty comments array ===
    test('should handle empty comments array', () => {
      const stdout = JSON.stringify({ summary: 'All good', comments: [] });

      const result = adapter._parseHermesResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(true);
      expect(result.comments).toEqual([]);
    });

    // === No JSON at all → text fallback ===
    test('should return success: false when no JSON found', () => {
      const stdout = 'not valid json at all {{{';

      const result = adapter._parseHermesResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(false);
      expect(result.comments).toEqual([]);
      expect(result.agentRawOutput).toBe(stdout);
    });

    // === null/undefined stdout ===
    test('should handle null stdout gracefully', () => {
      const result = adapter._parseHermesResponse(null, 'testorg', 'repo', mockPR);
      expect(result.success).toBe(false);
    });

    test('should handle undefined stdout gracefully', () => {
      const result = adapter._parseHermesResponse(undefined, 'testorg', 'repo', mockPR);
      expect(result.success).toBe(false);
    });

    // === Missing comments field → text fallback ===
    test('should return success: false when JSON has no comments field', () => {
      const stdout = JSON.stringify({ summary: 'No comments field' });

      const result = adapter._parseHermesResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(false);
    });

    // === agentCalledToolDirectly always false for Hermes ===
    test('should always set agentCalledToolDirectly to false', () => {
      const stdout = JSON.stringify({
        summary: 'Review done',
        comments: [],
        tool_calls: [{ function: { name: 'create_pull_request_review' } }]
      });

      const result = adapter._parseHermesResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.agentCalledToolDirectly).toBe(false);
    });

    // === agentRawOutput truncated to 1000 chars ===
    test('should truncate agentRawOutput to 1000 chars', () => {
      const longString = 'x'.repeat(2000);
      const stdout = JSON.stringify({ summary: 'ok', comments: [] });

      // Use _buildResult directly to test truncation
      const result = adapter._buildResult(
        { summary: 'ok', comments: [] },
        longString
      );

      expect(result.agentRawOutput).toHaveLength(1000);
    });

    // === Multiple JSON objects in text → picks the one with summary+comments ===
    test('should pick JSON with summary+comments when multiple objects exist', () => {
      const other = { foo: 'bar', count: 42 };
      const review = { summary: 'Picked this', comments: [{ file: 'a.js', line: 1, message: 'fix', severity: 'LOW' }] };
      const stdout = `First: ${JSON.stringify(other)}\nThen: ${JSON.stringify(review)}`;

      const result = adapter._parseHermesResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(true);
      expect(result.summary).toBe('Picked this');
    });
  });

  describe('_extractJSON', () => {
    test('should extract JSON with summary and comments from mixed text', () => {
      const json = { summary: 'Test', comments: [{ file: 'a.js', line: 1 }] };
      const text = `Some text before\n${JSON.stringify(json)}\nsome text after`;

      const result = adapter._extractJSON(text);
      expect(result).not.toBeNull();
      expect(JSON.parse(result)).toEqual(json);
    });

    test('should skip JSON objects without summary+comments keys', () => {
      const text = '{"foo": "bar"} and then {"summary": "test", "comments": []}';

      const result = adapter._extractJSON(text);
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result);
      expect(parsed.summary).toBe('test');
    });

    test('should return null for text without any JSON', () => {
      const result = adapter._extractJSON('just plain text no braces');
      expect(result).toBeNull();
    });

    test('should return null for null input', () => {
      const result = adapter._extractJSON(null);
      expect(result).toBeNull();
    });

    test('should handle nested braces in string values', () => {
      const json = { summary: 'Test {nested}', comments: [{ file: 'a.js', line: 1, message: 'Fix {this}' }] };
      const text = JSON.stringify(json);

      const result = adapter._extractJSON(text);
      expect(result).not.toBeNull();
      expect(JSON.parse(result).comments[0].message).toBe('Fix {this}');
    });
  });

  describe('_getInstanceByOwner', () => {
    test('should return instance for valid owner', () => {
      const instance = adapter._getInstanceByOwner('testorg');
      expect(instance).toBeDefined();
      expect(instance.owner).toBe('testorg');
    });

    test('should return null for unknown owner', () => {
      const instance = adapter._getInstanceByOwner('unknown');
      expect(instance).toBeNull();
    });
  });

  describe('_escapeShellString', () => {
    test('should escape double quotes', () => {
      expect(adapter._escapeShellString('say "hello"')).toBe('say \\"hello\\"');
    });

    test('should escape dollar signs', () => {
      expect(adapter._escapeShellString('cost is $100')).toBe('cost is \\$100');
    });

    test('should escape backticks', () => {
      expect(adapter._escapeShellString('run `cmd`')).toBe('run \\`cmd\\`');
    });

    test('should escape backslashes', () => {
      expect(adapter._escapeShellString('path\\to\\file')).toBe('path\\\\to\\\\file');
    });
  });

  describe('_buildResult', () => {
    test('should transform start_line to line in comments', () => {
      const parsed = {
        summary: 'Test',
        comments: [
          { file: 'a.js', start_line: 5, message: 'Fix', severity: 'HIGH' },
          { file: 'b.js', line: 10, message: 'Ok', severity: 'LOW' }
        ]
      };

      const result = adapter._buildResult(parsed, 'raw output');

      expect(result.success).toBe(true);
      expect(result.comments[0].line).toBe(5);
      expect(result.comments[1].line).toBe(10);
    });

    test('should default summary when missing', () => {
      const parsed = { comments: [] };
      const result = adapter._buildResult(parsed, 'raw');

      expect(result.summary).toBe('Review completed');
    });

    test('should default comments to empty array when missing', () => {
      const parsed = { summary: 'No comments' };
      const result = adapter._buildResult(parsed, 'raw');

      expect(result.comments).toEqual([]);
    });
  });

  describe('constructor', () => {
    test('should log initialization message', () => {
      expect(mockLogger.info).toHaveBeenCalledWith('HermesAgentAdapter initialized');
    });
  });

  describe('getReviewLevels', () => {
    test('should return configured review levels', async () => {
      const levels = await adapter.getReviewLevels();
      expect(levels).toEqual(['low', 'medium', 'high']);
    });

    test('should return empty array when reviewLevels not configured', async () => {
      const noLevelsAdapter = new HermesAgentAdapter({}, mockLogger, mockRetryHelper);
      const levels = await noLevelsAdapter.getReviewLevels();
      expect(levels).toEqual([]);
    });
  });
});
