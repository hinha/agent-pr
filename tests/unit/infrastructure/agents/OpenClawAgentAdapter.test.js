/**
 * Unit Tests: OpenClawAgentAdapter
 *
 * Tests for the OpenClaw AI agent adapter that handles PR reviews.
 * Focuses on response parsing, comment transformation, and error handling.
 */

const OpenClawAgentAdapter = require('../../../../src/infrastructure/agents/OpenClawAgentAdapter');

describe('OpenClawAgentAdapter', () => {
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
            reviewTimeoutSeconds: 120
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

    adapter = new OpenClawAgentAdapter(mockConfig, mockLogger, mockRetryHelper);
  });

  describe('_parseOpenClawResponse', () => {
    const mockPR = { number: 42, url: 'https://github.com/testorg/repo/pull/42' };

    test('should return success: true on valid JSON with summary', () => {
      const stdout = JSON.stringify({
        summary: 'Code looks good overall',
        comments: []
      });

      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(true);
      expect(result.summary).toBe('Code looks good overall');
      expect(result.comments).toEqual([]);
    });

    test('should fallback summary to response field', () => {
      const stdout = JSON.stringify({
        response: 'Review completed successfully',
        comments: []
      });

      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(true);
      expect(result.summary).toBe('Review completed successfully');
    });

    test('should fallback summary to default string', () => {
      const stdout = JSON.stringify({
        comments: []
      });

      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(true);
      expect(result.summary).toBe('Review completed');
    });

    test('should transform start_line to line in comments', () => {
      const stdout = JSON.stringify({
        summary: 'Issues found',
        comments: [
          {
            file: 'src/index.js',
            start_line: 15,
            end_line: 20,
            message: 'Missing error handling',
            severity: 'HIGH'
          },
          {
            file: 'src/utils.js',
            line: 30,
            message: 'Consider using const',
            severity: 'LOW'
          }
        ]
      });

      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(true);
      expect(result.comments).toHaveLength(2);
      // start_line should be mapped to line
      expect(result.comments[0].line).toBe(15);
      expect(result.comments[0].start_line).toBe(15);
      expect(result.comments[0].file).toBe('src/index.js');
      // existing line field should be preserved
      expect(result.comments[1].line).toBe(30);
    });

    test('should handle nested result structure (string)', () => {
      const inner = JSON.stringify({
        summary: 'Nested review',
        comments: [{ file: 'a.js', line: 1, message: 'Fix', severity: 'LOW' }]
      });
      const stdout = JSON.stringify({ result: inner });

      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(true);
      expect(result.summary).toBe('Nested review');
      expect(result.comments).toHaveLength(1);
    });

    test('should handle nested result structure (object)', () => {
      const stdout = JSON.stringify({
        result: {
          summary: 'Nested object review',
          comments: []
        }
      });

      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(true);
      expect(result.summary).toBe('Nested object review');
    });

    test('should detect agentCalledToolDirectly from tool_calls', () => {
      const stdout = JSON.stringify({
        summary: 'Agent submitted review',
        comments: [],
        tool_calls: [
          { function: { name: 'create_pull_request_review' } }
        ]
      });

      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(true);
      expect(result.agentCalledToolDirectly).toBe(true);
    });

    test('should set agentCalledToolDirectly to false when no tool_calls', () => {
      const stdout = JSON.stringify({
        summary: 'Normal review',
        comments: []
      });

      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.agentCalledToolDirectly).toBeFalsy();
    });

    test('should return success: false on invalid JSON', () => {
      const stdout = 'not valid json {{{';

      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to parse OpenClaw response');
      expect(result.comments).toEqual([]);
      expect(result.summary).toBe('Review completed (parse error)');
      expect(result.agentRawOutput).toBe(stdout);
    });

    test('should preserve agentRawOutput in both success and failure', () => {
      const validStdout = JSON.stringify({ summary: 'ok', comments: [] });
      const successResult = adapter._parseOpenClawResponse(validStdout, 'testorg', 'repo', mockPR);
      expect(successResult.agentRawOutput).toBe(validStdout);

      const invalidStdout = 'broken';
      const failResult = adapter._parseOpenClawResponse(invalidStdout, 'testorg', 'repo', mockPR);
      expect(failResult.agentRawOutput).toBe(invalidStdout);
    });

    test('should handle empty comments array', () => {
      const stdout = JSON.stringify({
        summary: 'All good',
        comments: []
      });

      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(true);
      expect(result.comments).toEqual([]);
    });

    test('should handle missing comments field', () => {
      const stdout = JSON.stringify({
        summary: 'No comments field'
      });

      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(true);
      expect(result.comments).toEqual([]);
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
});
