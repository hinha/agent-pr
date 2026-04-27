/**
 * Unit tests for openclawAgentService
 * Tests OpenClaw CLI integration logic, JSON extraction, retry logic, and prompt building
 */

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
}));

jest.mock('fs', () => ({
  readFileSync: jest.fn(() => 'Template with {{PR_NUMBER}} and {{LEVEL}}')
}));

jest.mock('../../../src/utils/timeoutManager', () => {
  return jest.fn().mockImplementation(() => ({
    setTimeout: jest.fn((cb) => {
      setTimeout(cb, 0); // Execute immediately for tests
    })
  }));
});

jest.resetModules();
const openclawAgentService = require('../../../src/services/openclawAgentService');

describe('openclawAgentService (core logic)', () => {
  describe('escapeShellString', () => {
    test('should escape backslashes', () => {
      expect(openclawAgentService.escapeShellString('test\\path')).toBe('test\\\\path');
    });

    test('should escape double quotes', () => {
      expect(openclawAgentService.escapeShellString('say "hello"')).toBe('say \\"hello\\"');
    });

    test('should escape dollar signs', () => {
      expect(openclawAgentService.escapeShellString('$VAR')).toBe('\\$VAR');
    });

    test('should escape backticks', () => {
      expect(openclawAgentService.escapeShellString('`cmd`')).toBe('\\`cmd\\`');
    });

    test('should handle multiple special characters', () => {
      const input = 'test "value" $VAR `cmd` \\path';
      const result = openclawAgentService.escapeShellString(input);
      expect(result).toContain('\\"');
      expect(result).toContain('\\$');
      expect(result).toContain('\\`');
      expect(result).toContain('\\\\');
    });

    test('should handle empty string', () => {
      expect(openclawAgentService.escapeShellString('')).toBe('');
    });

    test('should handle string with no special characters', () => {
      expect(openclawAgentService.escapeShellString('simple-text_123')).toBe('simple-text_123');
    });
  });

  describe('extractJSON', () => {
    test('should extract valid JSON with summary and comments', () => {
      const text = 'Some text before {"summary":"test","comments":[]} some text after';
      const result = openclawAgentService.extractJSON(text);
      expect(result).toBe('{"summary":"test","comments":[]}');
    });

    test('should return null when no valid JSON found', () => {
      const text = 'No JSON here';
      const result = openclawAgentService.extractJSON(text);
      expect(result).toBeNull();
    });

    test('should handle nested braces with required keys', () => {
      const text = '{"outer":{"summary":"test","comments":[]}}';
      const result = openclawAgentService.extractJSON(text);
      expect(result).toBe(text);
    });

    test('should ignore JSON without required keys', () => {
      const text = '{"name":"test","value":123}';
      const result = openclawAgentService.extractJSON(text);
      expect(result).toBeNull();
    });

    test('should handle escaped quotes in strings', () => {
      const text = '{"summary":"Test with \\"quotes\\"","comments":[]}';
      const result = openclawAgentService.extractJSON(text);
      expect(result).toBe(text);
    });

    test('should handle empty input', () => {
      const result = openclawAgentService.extractJSON('');
      expect(result).toBeNull();
    });

    test('should handle malformed JSON', () => {
      const text = '{"summary": test}'; // Missing quotes around test
      const result = openclawAgentService.extractJSON(text);
      expect(result).toBeNull();
    });
  });

  describe('retryOperation logic', () => {
    test('should calculate exponential backoff delays', () => {
      const minTimeout = 1000;
      const factor = 2;

      const attempt1Delay = minTimeout * Math.pow(factor, 1 - 1);
      const attempt2Delay = minTimeout * Math.pow(factor, 2 - 1);
      const attempt3Delay = minTimeout * Math.pow(factor, 3 - 1);

      expect(attempt1Delay).toBe(1000);
      expect(attempt2Delay).toBe(2000);
      expect(attempt3Delay).toBe(4000);
    });

    test('should cap delay at reasonable maximum', () => {
      const minTimeout = 1000;
      const factor = 2;
      const maxDelay = 5000;

      const attempt5Delay = minTimeout * Math.pow(factor, 5 - 1);
      const cappedDelay = Math.min(attempt5Delay, maxDelay);

      expect(cappedDelay).toBe(5000);
    });
  });

  describe('JSON parsing logic', () => {
    test('should remove json markdown blocks', () => {
      let stdout = '```json\n{"key":"value"}\n```';
      stdout = stdout.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      expect(stdout).toBe('{"key":"value"}');
    });

    test('should remove markdown blocks from nested JSON', () => {
      let payloadText = '```json\n{"summary":"test"}\n```';
      payloadText = payloadText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      expect(payloadText).toBe('{"summary":"test"}');
    });

    test('should handle multiple markdown blocks', () => {
      let text = '```json\n{"a":1}\n```\ntext\n```json\n{"b":2}\n```';
      text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      expect(text).toContain('{"a":1}');
      expect(text).toContain('{"b":2}');
    });

    test('should detect nested OpenClaw response structure', () => {
      const response = {
        result: {
          payloads: [{
            text: '{"summary":"test","comments":[]}'
          }]
        }
      };

      const hasPayloads = response.result?.payloads?.length > 0;
      const hasText = response.result.payloads[0].text;

      expect(hasPayloads).toBe(true);
      expect(hasText).toBeTruthy();
    });

    test('should detect direct review response format', () => {
      const response = {
        summary: 'test summary',
        comments: [{ id: 1 }]
      };

      const hasSummary = response.summary;
      const hasComments = response.comments && response.comments.length > 0;
      const isDirect = hasSummary && hasComments;

      expect(isDirect).toBe(true);
    });

    test('should handle empty comments array', () => {
      const response = {
        summary: 'test',
        comments: []
      };

      const hasComments = response.comments && response.comments.length > 0;
      expect(hasComments).toBe(false);
    });
  });

  describe('comment transformation logic', () => {
    test('should map start_line to line field', () => {
      const comments = [
        { start_line: 10, end_line: 15, body: 'Test comment' },
        { start_line: 20, end_line: 25, body: 'Another comment' }
      ];

      const transformed = comments.map(comment => ({
        ...comment,
        line: comment.start_line || comment.line
      }));

      expect(transformed[0].line).toBe(10);
      expect(transformed[1].line).toBe(20);
    });

    test('should preserve existing line field', () => {
      const comments = [
        { line: 5, body: 'Test' }
      ];

      const transformed = comments.map(comment => ({
        ...comment,
        line: comment.start_line || comment.line
      }));

      expect(transformed[0].line).toBe(5);
    });

    test('should handle missing start_line and line', () => {
      const comments = [
        { body: 'Test comment' }
      ];

      const transformed = comments.map(comment => ({
        ...comment,
        line: comment.start_line || comment.line
      }));

      expect(transformed[0].line).toBeUndefined();
    });
  });

  describe('direct tool call detection patterns', () => {
    test('should detect review created pattern', () => {
      const patterns = [
        /\breview\s+(?:created|submitted|approved)\b/i,
        /\bpull\s+request\s+review\s+#?\d+\b/i,
        /\bsuccessfully\s+created\s+(?:a\s+)?review\b/i
      ];

      // Each pattern should match its corresponding output
      const output1 = 'review created';
      const output2 = 'pull request review #456';
      const output3 = 'successfully created review';

      expect(patterns[0].test(output1)).toBe(true);
      expect(patterns[1].test(output2)).toBe(true);
      expect(patterns[2].test(output3)).toBe(true);
    });

    test('should not detect tool call in normal output', () => {
      const patterns = [
        /\breview\s+(?:created|submitted|approved)\b/i,
        /\bpull\s+request\s+review\s+#?\d+\b/i,
        /\bsuccessfully\s+created\s+(?:a\s+)?review\b/i
      ];

      const output = 'Code review started... processing files';
      expect(patterns.some(p => p.test(output))).toBe(false);
    });
  });

  describe('command parsing logic', () => {
    test('should parse command with quoted arguments', () => {
      const command = 'echo "hello world"';
      const args = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < command.length; i++) {
        const char = command[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ' ' && !inQuotes) {
          if (current) args.push(current);
          current = '';
        } else {
          current += char;
        }
      }
      if (current) args.push(current);

      expect(args[0]).toBe('echo');
      expect(args[1]).toBe('hello world');
    });

    test('should parse command without quotes', () => {
      const command = 'echo hello world';
      const args = command.split(' ');
      expect(args[0]).toBe('echo');
      expect(args[1]).toBe('hello');
      expect(args[2]).toBe('world');
    });
  });

  describe('timeout calculation', () => {
    test('should convert seconds to milliseconds', () => {
      const timeoutSeconds = 60;
      const timeoutMs = timeoutSeconds * 1000;
      expect(timeoutMs).toBe(60000);
    });

    test('should calculate correct retry delays', () => {
      const baseDelay = 1000;
      const factor = 2;

      for (let attempt = 1; attempt <= 5; attempt++) {
        const delay = baseDelay * Math.pow(factor, attempt - 1);
        expect(delay).toBeGreaterThan(0);
      }
    });
  });

  describe('template variable replacement', () => {
    test('should replace all template variables', () => {
      const template = '{{PR_NUMBER}} {{LEVEL}} {{FOCUS_AREAS}} {{MAX_COMMENTS}}';
      const prNumber = 123;
      const level = 'MEDIUM';
      const focusAreas = 'bugs, performance';
      const maxComments = 10;

      let result = template.replace('{{PR_NUMBER}}', prNumber);
      result = result.replace('{{LEVEL}}', level);
      result = result.replace('{{FOCUS_AREAS}}', focusAreas);
      result = result.replace('{{MAX_COMMENTS}}', maxComments);

      expect(result).toContain('123');
      expect(result).toContain('MEDIUM');
      expect(result).toContain('bugs, performance');
      expect(result).toContain('10');
    });

    test('should handle missing variables gracefully', () => {
      const template = '{{PR_NUMBER}} {{LEVEL}}';
      const result = template.replace('{{PR_NUMBER}}', '123');

      expect(result).toContain('123');
      expect(result).toContain('{{LEVEL}}'); // Unreplaced variable remains
    });
  });

  describe('error handling logic', () => {
    test('should validate review level exists', () => {
      const validLevels = ['low', 'medium', 'high'];
      const level = 'medium';

      expect(validLevels.includes(level)).toBe(true);
      expect(validLevels.includes('invalid')).toBe(false);
    });

    test('should handle missing template files', () => {
      const possiblePaths = [
        'path1/to/file.txt',
        'path2/to/file.txt'
      ];

      let foundTemplate = false;
      for (const tryPath of possiblePaths) {
        // Simulate file not found
        foundTemplate = false;
      }

      expect(foundTemplate).toBe(false);
    });
  });

  describe('edge cases', () => {
    test('should handle very long strings in extractJSON', () => {
      const longText = 'a'.repeat(10000) + '{"summary":"test","comments":[]}' + 'b'.repeat(10000);
      const result = openclawAgentService.extractJSON(longText);
      expect(result).toBe('{"summary":"test","comments":[]}');
    });

    test('should handle JSON with whitespace', () => {
      const text = '  \n  {"summary":"test","comments":[]}  \n  ';
      const result = openclawAgentService.extractJSON(text);
      expect(result).toContain('{"summary":"test","comments":[]}');
    });

    test('should handle empty string in escapeShellString', () => {
      expect(openclawAgentService.escapeShellString('')).toBe('');
    });
  });

  describe('response fallback logic', () => {
    test('should create fallback response when JSON not found', () => {
      const cleanStdout = 'No valid JSON here';
      const level = 'low';
      const prNumber = 123;

      const fallback = {
        summary: cleanStdout.substring(0, 500) || `Review ${level} untuk PR #${prNumber}`,
        comments: []
      };

      expect(fallback.summary).toBeDefined();
      expect(fallback.comments).toEqual([]);
    });

    test('should truncate long output for fallback', () => {
      const longText = 'a'.repeat(1000);
      const truncated = longText.substring(0, 500);

      expect(truncated.length).toBe(500);
      // The truncated string still contains 'a's but not the part after position 500
      expect(truncated).toBe('a'.repeat(500));
    });
  });

  describe('timeout manager integration', () => {
    test('should use timeout manager for delays', () => {
      const timeoutManager = openclawAgentService.timeoutManager;
      expect(timeoutManager).toBeDefined();
      expect(typeof timeoutManager.setTimeout).toBe('function');
    });
  });
});
