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

    // === Format 3: Direct JSON { summary, comments } ===
    test('should parse direct review format with summary and comments', () => {
      const stdout = JSON.stringify({
        summary: 'Code looks good overall',
        comments: [
          { file: 'src/index.js', start_line: 10, severity: 'LOW', message: 'Consider const' }
        ]
      });

      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(true);
      expect(result.summary).toBe('Code looks good overall');
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].line).toBe(10);
    });

    // === Format 1: Nested payloads structure ===
    test('should parse OpenClaw payloads structure', () => {
      const reviewJSON = JSON.stringify({
        summary: 'Issues found in PR',
        comments: [
          { file: 'src/app.js', start_line: 20, severity: 'HIGH', message: 'Security issue' },
          { file: 'src/utils.js', line: 30, severity: 'LOW', message: 'Use const' }
        ]
      });

      const stdout = JSON.stringify({
        result: {
          payloads: [{ text: reviewJSON }]
        }
      });

      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(true);
      expect(result.summary).toBe('Issues found in PR');
      expect(result.comments).toHaveLength(2);
      expect(result.comments[0].line).toBe(20); // start_line → line
      expect(result.comments[0].severity).toBe('HIGH');
      expect(result.comments[1].line).toBe(30); // existing line preserved
    });

    test('should handle payloads with markdown code blocks in text', () => {
      const reviewJSON = `\`\`\`json\n${JSON.stringify({
        summary: 'Clean code',
        comments: []
      })}\n\`\`\``;

      const stdout = JSON.stringify({
        result: {
          payloads: [{ text: reviewJSON }]
        }
      });

      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(true);
      expect(result.summary).toBe('Clean code');
    });

    test('should fail when payloads text is empty', () => {
      const stdout = JSON.stringify({
        result: {
          payloads: [{ text: '' }]
        }
      });

      // extractJSON should also return null since there's no JSON in empty payloads
      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(false);
    });

    // === Format 2: Nested result as string ===
    test('should parse nested result string', () => {
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

    // === Format 4: Nested result object with summary+comments ===
    test('should parse nested result object with summary and comments', () => {
      const stdout = JSON.stringify({
        result: {
          summary: 'Nested object review',
          comments: [
            { file: 'b.js', start_line: 5, severity: 'MEDIUM', message: 'Refactor this' }
          ]
        }
      });

      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(true);
      expect(result.summary).toBe('Nested object review');
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].line).toBe(5);
    });

    // === Unknown format → extractJSON fallback ===
    test('should use extractJSON fallback for non-standard formats', () => {
      // Output that has JSON embedded in text
      const review = { summary: 'Found bugs', comments: [{ file: 'x.js', line: 1, message: 'Bug', severity: 'HIGH' }] };
      const stdout = `Here is my review:\n${JSON.stringify(review)}\nEnd of review.`;

      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(true);
      expect(result.summary).toBe('Found bugs');
      expect(result.comments).toHaveLength(1);
    });

    test('should try stderr when stdout has no JSON', () => {
      const stdout = 'no json here';
      const stderr = JSON.stringify({
        summary: 'Review from stderr',
        comments: [{ file: 'c.js', line: 10, message: 'Issue', severity: 'LOW' }]
      });

      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR, stderr);

      expect(result.success).toBe(true);
      expect(result.summary).toBe('Review from stderr');
    });

    // === Comment transformation ===
    test('should transform start_line to line in comments', () => {
      const stdout = JSON.stringify({
        summary: 'Issues found',
        comments: [
          { file: 'src/index.js', start_line: 15, end_line: 20, message: 'Missing error handling', severity: 'HIGH' },
          { file: 'src/utils.js', line: 30, message: 'Consider using const', severity: 'LOW' }
        ]
      });

      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.comments[0].line).toBe(15);
      expect(result.comments[0].start_line).toBe(15); // original preserved via spread
      expect(result.comments[1].line).toBe(30);
    });

    // === Agent direct call detection ===
    test('should detect agentCalledToolDirectly from tool_calls', () => {
      const stdout = JSON.stringify({
        summary: 'Agent submitted review',
        comments: [],
        tool_calls: [{ function: { name: 'create_pull_request_review' } }]
      });

      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(true);
      expect(result.agentCalledToolDirectly).toBe(true);
    });

    test('should NOT set agentCalledToolDirectly from natural language output (regex removed)', () => {
      const review = JSON.stringify({ summary: 'Done', comments: [] });
      const stdout = `I have successfully created a review for this PR.\n${review}`;

      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(true);
      expect(result.agentCalledToolDirectly).toBe(false);
    });

    test('should set agentCalledToolDirectly to false when no indicators', () => {
      const stdout = JSON.stringify({ summary: 'Normal review', comments: [] });

      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.agentCalledToolDirectly).toBe(false);
    });

    // === Error cases ===
    test('should return success: false on completely invalid output', () => {
      const stdout = 'not valid json at all {{{';

      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(false);
      expect(result.comments).toEqual([]);
      expect(result.agentRawOutput).toBe(stdout);
    });

    test('should preserve agentRawOutput (truncated to 1000 chars)', () => {
      const stdout = JSON.stringify({ summary: 'ok', comments: [] });
      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);
      expect(result.agentRawOutput).toBe(stdout.substring(0, 1000));
    });

    test('should handle null/undefined stdout gracefully', () => {
      const result = adapter._parseOpenClawResponse(null, 'testorg', 'repo', mockPR);
      expect(result.success).toBe(false);
    });

    test('should handle empty comments array', () => {
      const stdout = JSON.stringify({ summary: 'All good', comments: [] });
      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);

      expect(result.success).toBe(true);
      expect(result.comments).toEqual([]);
    });

    test('should handle missing comments field', () => {
      // This falls into "unknown format" since no comments key
      const stdout = JSON.stringify({ summary: 'No comments field' });
      const result = adapter._parseOpenClawResponse(stdout, 'testorg', 'repo', mockPR);

      // extractJSON won't find it because no "comments" key
      expect(result.success).toBe(false);
    });

    // === Real-world OpenClaw output ===
    test('should handle real OpenClaw agent output with payloads and 3 comments', () => {
      const realReview = {
        summary: 'PR #9 menunjukkan progres refactor arsitektur',
        comments: [
          {
            file: 'src/application/services/UnifiedStateService.js',
            start_line: 60,
            end_line: 60,
            severity: 'HIGH',
            message: 'Syntax error pada event name',
            suggestedCode: 'await this.eventBus.emitAsync(\'state.pr.processed\');'
          },
          {
            file: 'src/container/Container.js',
            start_line: 257,
            end_line: 273,
            severity: 'HIGH',
            message: 'Dependency wiring tidak sesuai kontrak'
          },
          {
            file: 'src/bootstrap/Bootstrap.js',
            start_line: 150,
            end_line: 156,
            severity: 'LOW',
            message: 'eventBus.clear() dipanggil sebelum emitAsync'
          }
        ]
      };

      const stdout = JSON.stringify({
        result: {
          payloads: [{ text: JSON.stringify(realReview) }]
        }
      });

      const result = adapter._parseOpenClawResponse(stdout, 'hinha', 'agent-pr', mockPR);

      expect(result.success).toBe(true);
      expect(result.comments).toHaveLength(3);
      expect(result.comments[0].line).toBe(60);
      expect(result.comments[0].severity).toBe('HIGH');
      expect(result.comments[0].suggestedCode).toBeDefined();
      expect(result.comments[1].line).toBe(257);
      expect(result.comments[2].line).toBe(150);
      expect(result.comments[2].severity).toBe('LOW');
      expect(result.summary).toContain('PR #9');
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

    test('should handle nested braces correctly', () => {
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

  describe('reviewPR and summarizePR', () => {
    const pr = {
      number: 42,
      title: 'Improve API',
      description: 'Refactor handlers',
      url: 'https://github.com/testorg/repo/pull/42',
      headBranch: 'feature/api',
      baseBranch: 'main'
    };

    test('reviewPR builds prompt, strips markdown fences, and parses result', async () => {
      adapter._spawnWithTimeout = jest.fn().mockResolvedValue({
        stdout: '```json\n' + JSON.stringify({ summary: 'Looks good', comments: [] }) + '\n```',
        stderr: ''
      });

      const result = await adapter.reviewPR('testorg', 'repo', pr, [{ filename: 'src/index.js' }], 'high');

      expect(result.success).toBe(true);
      expect(mockRetryHelper.retry).toHaveBeenCalled();
      expect(adapter._spawnWithTimeout).toHaveBeenCalledWith(expect.stringContaining('openclaw agent --agent code-reviewer'), 120000);
    });

    test('summarizePR uses summaryAgent fallback and plain text fallback', async () => {
      adapter._spawnWithTimeout = jest.fn()
        .mockResolvedValueOnce({ stdout: JSON.stringify({ summary: 'Short summary' }) })
        .mockResolvedValueOnce({ stdout: 'Plain summary' });

      await expect(adapter.summarizePR('unknown', 'repo', pr, [])).rejects.toThrow('No instance found for owner: unknown');
      await expect(adapter.summarizePR('testorg', 'repo', pr, [{ filename: 'src/a.js' }])).resolves.toBe('Short summary');
      await expect(adapter.summarizePR('testorg', 'repo', pr, [{ filename: 'src/a.js' }])).resolves.toBe('Plain summary');
    });

    test('reviewPR throws for invalid level and unknown owner', async () => {
      await expect(adapter.reviewPR('testorg', 'repo', pr, [], 'missing')).rejects.toThrow('Invalid review level: missing');
      await expect(adapter.reviewPR('unknown', 'repo', pr, [], 'high')).rejects.toThrow('No instance found for owner: unknown');
    });
  });
});
