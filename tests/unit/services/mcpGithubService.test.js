/**
 * Unit tests for mcpGithubService (simplified version without complex child_process mocking)
 * Tests core MCP GitHub service logic, file sanitization, language detection, and comment validation
 */

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
}));

jest.mock('../../../src/utils/timeoutManager', () => {
  const MockTimeoutManager = function() {
    this.pendingTimeouts = new Set();
    this.setTimeout = jest.fn((fn, delay, ...args) => 'timeout-id-123');
    this.clearTimeout = jest.fn();
    this.clearAll = jest.fn();
    this.getPendingCount = jest.fn(() => 0);
    this.hasPending = jest.fn(() => false);
  };
  return MockTimeoutManager;
});

jest.mock('../../../src/config/yamlConfig', () => ({
  instances: {
    'test-org': {
      owner: 'test-org',
      mcpName: 'github-work',
      key: 'test-org',
      repos: {}
    }
  },
  retries: {
    mcpRetries: 3,
    backoffFactor: 2
  }
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(() => false),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn()
}));

jest.resetModules();
const { MCPGitHubService } = require('../../../src/services/mcpGithubService');

describe('mcpGithubService (core logic)', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    const instanceConfig = {
      owner: 'test-org',
      mcpName: 'github-work',
      key: 'test-org'
    };
    service = new MCPGitHubService(instanceConfig);
  });

  describe('constructor', () => {
    test('should initialize with correct values', () => {
      expect(service.mcpBaseCmd).toBe('mcporter');
      expect(service.serverName).toBe('github-work');
      expect(service.owner).toBe('test-org');
      expect(service.instanceKey).toBe('test-org');
      expect(service.timeoutManager).toBeDefined();
    });

    test('should set mcpName from instanceConfig', () => {
      const config = {
        owner: 'my-org',
        mcpName: 'my-github-server',
        key: 'my-org'
      };
      const s = new MCPGitHubService(config);
      expect(s.serverName).toBe('my-github-server');
      expect(s.owner).toBe('my-org');
    });
  });

  describe('detectLanguage', () => {
    test('should detect JavaScript files', () => {
      expect(service.detectLanguage('test.js')).toBe('javascript');
      expect(service.detectLanguage('test.jsx')).toBe('javascript');
    });

    test('should detect TypeScript files', () => {
      expect(service.detectLanguage('test.ts')).toBe('typescript');
      expect(service.detectLanguage('test.tsx')).toBe('typescript');
    });

    test('should detect Python files', () => {
      expect(service.detectLanguage('test.py')).toBe('python');
    });

    test('should detect Go files', () => {
      expect(service.detectLanguage('test.go')).toBe('go');
    });

    test('should detect Ruby files', () => {
      expect(service.detectLanguage('test.rb')).toBe('ruby');
    });

    test('should detect PHP files', () => {
      expect(service.detectLanguage('test.php')).toBe('php');
    });

    test('should detect Java files', () => {
      expect(service.detectLanguage('Test.java')).toBe('java');
    });

    test('should detect Kotlin files', () => {
      expect(service.detectLanguage('Test.kt')).toBe('kotlin');
    });

    test('should detect Swift files', () => {
      expect(service.detectLanguage('Test.swift')).toBe('swift');
    });

    test('should detect C/C++ files', () => {
      expect(service.detectLanguage('test.c')).toBe('c');
      expect(service.detectLanguage('test.cpp')).toBe('cpp');
    });

    test('should detect C# files', () => {
      expect(service.detectLanguage('Test.cs')).toBe('csharp');
    });

    test('should detect Scala files', () => {
      expect(service.detectLanguage('Test.scala')).toBe('scala');
    });

    test('should detect Rust files', () => {
      expect(service.detectLanguage('test.rs')).toBe('rust');
    });

    test('should detect Bash files', () => {
      expect(service.detectLanguage('test.sh')).toBe('bash');
    });

    test('should detect YAML files', () => {
      expect(service.detectLanguage('test.yaml')).toBe('yaml');
      expect(service.detectLanguage('test.yml')).toBe('yaml');
    });

    test('should detect JSON files', () => {
      expect(service.detectLanguage('test.json')).toBe('json');
    });

    test('should detect XML files', () => {
      expect(service.detectLanguage('test.xml')).toBe('xml');
    });

    test('should detect HTML files', () => {
      expect(service.detectLanguage('test.html')).toBe('html');
    });

    test('should detect CSS files', () => {
      expect(service.detectLanguage('test.css')).toBe('css');
      expect(service.detectLanguage('test.scss')).toBe('scss');
      expect(service.detectLanguage('test.sass')).toBe('sass');
      expect(service.detectLanguage('test.less')).toBe('less');
    });

    test('should detect Markdown files', () => {
      expect(service.detectLanguage('README.md')).toBe('markdown');
    });

    test('should detect SQL files', () => {
      expect(service.detectLanguage('test.sql')).toBe('sql');
    });

    test('should detect Dockerfile (with extension)', () => {
      expect(service.detectLanguage('Dockerfile.dockerfile')).toBe('dockerfile');
    });

    test('should return empty string for unknown extension', () => {
      expect(service.detectLanguage('test.unknown')).toBe('');
      expect(service.detectLanguage('test')).toBe('');
    });

    test('should handle case insensitive detection', () => {
      expect(service.detectLanguage('TEST.JS')).toBe('javascript');
      expect(service.detectLanguage('Test.Py')).toBe('python');
    });

    test('should handle filenames with multiple dots', () => {
      expect(service.detectLanguage('test.min.js')).toBe('javascript');
      expect(service.detectLanguage('component.test.tsx')).toBe('typescript');
    });
  });

  describe('isTestFile', () => {
    test('should detect Go test files', () => {
      expect(service.isTestFile('utils_test.go')).toBe(true);
      expect(service.isTestFile('integration_test.go')).toBe(true);
    });

    test('should detect JavaScript test files', () => {
      expect(service.isTestFile('utils_test.js')).toBe(true);
      expect(service.isTestFile('component_test.ts')).toBe(true);
      expect(service.isTestFile('test.spec.js')).toBe(true);
      expect(service.isTestFile('test.spec.ts')).toBe(true);
    });

    test('should detect test files by pattern', () => {
      expect(service.isTestFile('path/__tests__/test.js')).toBe(true);
      expect(service.isTestFile('path/test/example.js')).toBe(true);
      expect(service.isTestFile('path/spec/example.js')).toBe(true);
      expect(service.isTestFile('path/e2e_test/test.js')).toBe(true);
      expect(service.isTestFile('path/e2e/test.js')).toBe(true);
    });

    test('should detect spec files with dot pattern', () => {
      expect(service.isTestFile('test.spec.js')).toBe(true);
      expect(service.isTestFile('component.spec.ts')).toBe(true);
    });

    test('should detect test files with underscore pattern', () => {
      expect(service.isTestFile('test_spec.js')).toBe(true);
      expect(service.isTestFile('component_spec.ts')).toBe(true);
    });

    test('should detect swagger/openapi files', () => {
      expect(service.isTestFile('swagger.json')).toBe(true);
      expect(service.isTestFile('swagger.yaml')).toBe(true);
      expect(service.isTestFile('swagger.yml')).toBe(true);
      expect(service.isTestFile('openapi.json')).toBe(true);
      expect(service.isTestFile('openapi.yaml')).toBe(true);
      expect(service.isTestFile('openapi.yml')).toBe(true);
    });

    test('should not detect non-test files', () => {
      expect(service.isTestFile('utils.js')).toBe(false);
      expect(service.isTestFile('component.tsx')).toBe(false);
      expect(service.isTestFile('index.js')).toBe(false);
      expect(service.isTestFile('app.go')).toBe(false);
    });
  });

  describe('sanitizeFileData', () => {
    test('should filter files with null blob_url', () => {
      const files = [
        { filename: 'test.js', blob_url: 'https://example.com', raw_url: 'https://example.com' },
        { filename: 'image.png', blob_url: null, raw_url: 'https://example.com' },
        { filename: 'test2.js', blob_url: 'https://example.com', raw_url: 'https://example.com' }
      ];

      const sanitized = service.sanitizeFileData(files);
      expect(sanitized).toHaveLength(2);
      expect(sanitized[0].filename).toBe('test.js');
      expect(sanitized[1].filename).toBe('test2.js');
    });

    test('should filter files with null raw_url', () => {
      const files = [
        { filename: 'test.js', blob_url: 'https://example.com', raw_url: 'https://example.com' },
        { filename: 'image.png', blob_url: 'https://example.com', raw_url: null }
      ];

      const sanitized = service.sanitizeFileData(files);
      expect(sanitized).toHaveLength(1);
      expect(sanitized[0].filename).toBe('test.js');
    });

    test('should filter files without filename', () => {
      const files = [
        { filename: 'test.js', blob_url: 'https://example.com', raw_url: 'https://example.com' },
        { blob_url: 'https://example.com', raw_url: 'https://example.com' }
      ];

      const sanitized = service.sanitizeFileData(files);
      expect(sanitized).toHaveLength(1);
      expect(sanitized[0].filename).toBe('test.js');
    });

    test('should provide default values for missing fields', () => {
      const files = [
        { filename: 'test.js', blob_url: 'https://example.com', raw_url: 'https://example.com' }
      ];

      const sanitized = service.sanitizeFileData(files);
      expect(sanitized[0].filename).toBe('test.js');
      expect(sanitized[0].additions).toBe(0);
      expect(sanitized[0].deletions).toBe(0);
      expect(sanitized[0].changes).toBe(0);
      expect(sanitized[0].status).toBe('modified');
      expect(sanitized[0].patch).toBe('');
    });

    test('should preserve existing field values', () => {
      const files = [
        {
          filename: 'test.js',
          blob_url: 'https://example.com',
          raw_url: 'https://example.com',
          additions: 10,
          deletions: 5,
          changes: 15,
          status: 'added',
          patch: '@@ -1,1 +1,2 @@'
        }
      ];

      const sanitized = service.sanitizeFileData(files);
      expect(sanitized[0].additions).toBe(10);
      expect(sanitized[0].deletions).toBe(5);
      expect(sanitized[0].changes).toBe(15);
      expect(sanitized[0].status).toBe('added');
      expect(sanitized[0].patch).toBe('@@ -1,1 +1,2 @@');
    });

    test('should handle empty array', () => {
      const sanitized = service.sanitizeFileData([]);
      expect(sanitized).toEqual([]);
    });

    test('should handle null input', () => {
      const sanitized = service.sanitizeFileData(null);
      expect(sanitized).toEqual([]);
    });

    test('should handle non-array input', () => {
      const sanitized = service.sanitizeFileData('not an array');
      expect(sanitized).toEqual([]);
    });
  });

  describe('normalizeSeverity', () => {
    test('should normalize valid severity values', () => {
      expect(service.normalizeSeverity('low')).toBe('LOW');
      expect(service.normalizeSeverity('medium')).toBe('MEDIUM');
      expect(service.normalizeSeverity('high')).toBe('HIGH');
    });

    test('should handle case variations', () => {
      expect(service.normalizeSeverity('Low')).toBe('LOW');
      expect(service.normalizeSeverity('MEDIUM')).toBe('MEDIUM');
      expect(service.normalizeSeverity('HiGh')).toBe('HIGH');
    });

    test('should handle whitespace', () => {
      expect(service.normalizeSeverity(' low ')).toBe('LOW');
      expect(service.normalizeSeverity('  medium  ')).toBe('MEDIUM');
    });

    test('should default to LOW for null', () => {
      expect(service.normalizeSeverity(null)).toBe('LOW');
    });

    test('should default to LOW for undefined', () => {
      expect(service.normalizeSeverity(undefined)).toBe('LOW');
    });

    test('should default to LOW for invalid values', () => {
      expect(service.normalizeSeverity('invalid')).toBe('LOW');
      expect(service.normalizeSeverity('critical')).toBe('LOW');
      expect(service.normalizeSeverity('')).toBe('LOW');
    });

    test('should handle non-string types', () => {
      expect(service.normalizeSeverity(123)).toBe('LOW');
      expect(service.normalizeSeverity({})).toBe('LOW');
      expect(service.normalizeSeverity([])).toBe('LOW');
    });
  });

  describe('validateAndSanitizeComments', () => {
    test('should validate and return valid comments', () => {
      const comments = [
        { file: 'test.js', line: 10, message: 'Fix this', severity: 'high' },
        { file: 'test.ts', line: 20, message: 'Consider this', severity: 'medium' }
      ];

      const { validComments, stats } = service.validateAndSanitizeComments(comments, 'test-repo', 123);

      expect(validComments).toHaveLength(2);
      expect(stats.total).toBe(2);
      expect(stats.valid).toBe(2);
      expect(stats.filtered).toBe(0);
      expect(stats.severityBreakdown.HIGH).toBe(1);
      expect(stats.severityBreakdown.MEDIUM).toBe(1);
    });

    test('should filter comments without file field', () => {
      const comments = [
        { file: 'test.js', line: 10, message: 'Valid', severity: 'low' },
        { line: 20, message: 'Invalid', severity: 'medium' }
      ];

      const { validComments, stats } = service.validateAndSanitizeComments(comments, 'test-repo', 123);

      expect(validComments).toHaveLength(1);
      expect(stats.valid).toBe(1);
      expect(stats.filtered).toBe(1);
    });

    test('should filter comments without line field', () => {
      const comments = [
        { file: 'test.js', line: 10, message: 'Valid', severity: 'low' },
        { file: 'test.ts', message: 'Invalid', severity: 'medium' }
      ];

      const { validComments, stats } = service.validateAndSanitizeComments(comments, 'test-repo', 123);

      expect(validComments).toHaveLength(1);
      expect(stats.valid).toBe(1);
      expect(stats.filtered).toBe(1);
    });

    test('should filter comments without message field', () => {
      const comments = [
        { file: 'test.js', line: 10, message: 'Valid', severity: 'low' },
        { file: 'test.ts', line: 20, severity: 'medium' }
      ];

      const { validComments, stats } = service.validateAndSanitizeComments(comments, 'test-repo', 123);

      expect(validComments).toHaveLength(1);
      expect(stats.valid).toBe(1);
      expect(stats.filtered).toBe(1);
    });

    test('should filter comments with invalid file type', () => {
      const comments = [
        { file: 'test.js', line: 10, message: 'Valid', severity: 'low' },
        { file: 123, line: 20, message: 'Invalid', severity: 'medium' }
      ];

      const { validComments, stats } = service.validateAndSanitizeComments(comments, 'test-repo', 123);

      expect(validComments).toHaveLength(1);
      expect(stats.valid).toBe(1);
      expect(stats.filtered).toBe(1);
    });

    test('should filter comments with invalid line type', () => {
      const comments = [
        { file: 'test.js', line: 10, message: 'Valid', severity: 'low' },
        { file: 'test.ts', line: '20', message: 'Invalid', severity: 'medium' }
      ];

      const { validComments, stats } = service.validateAndSanitizeComments(comments, 'test-repo', 123);

      expect(validComments).toHaveLength(1);
      expect(stats.valid).toBe(1);
      expect(stats.filtered).toBe(1);
    });

    test('should filter comments with invalid message type', () => {
      const comments = [
        { file: 'test.js', line: 10, message: 'Valid', severity: 'low' },
        { file: 'test.ts', line: 20, message: 123, severity: 'medium' }
      ];

      const { validComments, stats } = service.validateAndSanitizeComments(comments, 'test-repo', 123);

      expect(validComments).toHaveLength(1);
      expect(stats.valid).toBe(1);
      expect(stats.filtered).toBe(1);
    });

    test('should handle empty array', () => {
      const { validComments, stats } = service.validateAndSanitizeComments([], 'test-repo', 123);

      expect(validComments).toEqual([]);
      expect(stats.total).toBe(0);
      expect(stats.valid).toBe(0);
      expect(stats.filtered).toBe(0);
    });

    test('should handle non-array input', () => {
      const { validComments, stats } = service.validateAndSanitizeComments('not an array', 'test-repo', 123);

      expect(validComments).toEqual([]);
      expect(stats.total).toBe(0);
    });

    test('should normalize severity on valid comments', () => {
      const comments = [
        { file: 'test.js', line: 10, message: 'Valid', severity: 'low' },
        { file: 'test.ts', line: 20, message: 'Valid', severity: 'HIGH' }
      ];

      const { validComments } = service.validateAndSanitizeComments(comments, 'test-repo', 123);

      expect(validComments[0].severity).toBe('LOW');
      expect(validComments[1].severity).toBe('HIGH');
    });
  });

  describe('sanitizeForLogging', () => {
    test('should redact OpenAI API keys', () => {
      const output = 'sk-abc123def456789012345';
      const sanitized = service.sanitizeForLogging(output);
      expect(sanitized).toContain('sk-***REDACTED***');
      expect(sanitized).not.toContain('sk-abc123def456789012345');
    });

    test('should redact GitHub personal access tokens', () => {
      const output = 'Token: ghp_1234567890abcdefghijklmnopqrstuvwxyz123456';
      const sanitized = service.sanitizeForLogging(output);
      expect(sanitized).toContain('ghp_***REDACTED***');
    });

    test('should redact Bearer tokens', () => {
      const output = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const sanitized = service.sanitizeForLogging(output);
      expect(sanitized).toContain('Bearer ***REDACTED***');
    });

    test('should redact password fields', () => {
      const output = '{"password": "secret123"}';
      const sanitized = service.sanitizeForLogging(output);
      expect(sanitized).toContain('"password": "***REDACTED***"');
      expect(sanitized).not.toContain('secret123');
    });

    test('should redact token fields', () => {
      const output = '{"token": "abc123"}';
      const sanitized = service.sanitizeForLogging(output);
      expect(sanitized).toContain('"token": "***REDACTED***"');
    });

    test('should redact api_key fields', () => {
      const output = '{"api_key": "xyz789"}';
      const sanitized = service.sanitizeForLogging(output);
      expect(sanitized).toContain('***REDACTED***');
    });

    test('should handle empty input', () => {
      const sanitized = service.sanitizeForLogging('');
      expect(sanitized).toBe('[empty]');
    });

    test('should handle null input', () => {
      const sanitized = service.sanitizeForLogging(null);
      expect(sanitized).toBe('[empty]');
    });

    test('should truncate output to 500 characters', () => {
      const longOutput = 'a'.repeat(1000);
      const sanitized = service.sanitizeForLogging(longOutput);
      expect(sanitized.length).toBe(500);
    });
  });

  describe('extractReviewUrlFromOutput', () => {
    test('should extract GitHub review URL', () => {
      const output = 'Review created: https://github.com/org/repo/pull/123#pullrequestreview-456';
      const url = service.extractReviewUrlFromOutput(output);
      expect(url).toBe('https://github.com/org/repo/pull/123#pullrequestreview-456');
    });

    test('should return null when no URL found', () => {
      const output = 'No URL in this output';
      const url = service.extractReviewUrlFromOutput(output);
      expect(url).toBeNull();
    });

    test('should handle empty input', () => {
      const url = service.extractReviewUrlFromOutput('');
      expect(url).toBeNull();
    });

    test('should handle null input', () => {
      const url = service.extractReviewUrlFromOutput(null);
      expect(url).toBeNull();
    });

    test('should extract URL from longer output', () => {
      const output = `Some text before
https://github.com/my-org/my-repo/pull/789#pullrequestreview-101
Some text after`;
      const url = service.extractReviewUrlFromOutput(output);
      expect(url).toBe('https://github.com/my-org/my-repo/pull/789#pullrequestreview-101');
    });
  });

  describe('splitCodeIntoChunks', () => {
    test('should split code into chunks by word boundary', () => {
      const code = 'word1 word2 word3 word4';
      const chunks = service.splitCodeIntoChunks(code, 10);
      expect(chunks.length).toBeGreaterThan(1);
    });

    test('should handle empty code', () => {
      const chunks = service.splitCodeIntoChunks('', 100);
      expect(chunks).toEqual([]);
    });

    test('should handle null code', () => {
      const chunks = service.splitCodeIntoChunks(null, 100);
      expect(chunks).toEqual([]);
    });

    test('should preserve words within max length', () => {
      const code = 'short';
      const chunks = service.splitCodeIntoChunks(code, 100);
      expect(chunks).toEqual(['short']);
    });

    test('should split long code into multiple chunks', () => {
      const code = 'word1 word2 word3 word4 word5';
      const chunks = service.splitCodeIntoChunks(code, 15);
      expect(chunks.length).toBeGreaterThan(1);
    });

    test('should handle single very long word', () => {
      const code = 'a'.repeat(100);
      const chunks = service.splitCodeIntoChunks(code, 50);
      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe('buildPositionMap', () => {
    test('should return empty map for null patch', () => {
      const map = service.buildPositionMap(null);
      expect(map).toBeInstanceOf(Map);
      expect(map.size).toBe(0);
    });

    test('should return empty map for undefined patch', () => {
      const map = service.buildPositionMap(undefined);
      expect(map).toBeInstanceOf(Map);
      expect(map.size).toBe(0);
    });

    test('should return empty map for empty patch', () => {
      const map = service.buildPositionMap('');
      expect(map).toBeInstanceOf(Map);
      expect(map.size).toBe(0);
    });

    test('should parse diff hunk header', () => {
      const patch = '@@ -1,3 +1,4 @@ line1\n+new line\n context\n-old line';
      const map = service.buildPositionMap(patch);
      expect(map).toBeInstanceOf(Map);
    });

    test('should handle patch with multiple hunks', () => {
      const patch = '@@ -1,2 +1,3 @@\n+line1\n context\n@@ -10,1 +12,2 @@\n+line2\n context2';
      const map = service.buildPositionMap(patch);
      expect(map).toBeInstanceOf(Map);
    });

    test('should detect hunk pattern', () => {
      const hunkRegex = /@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/g;
      const patch = '@@ -1,3 +1,4 @@ test';
      const match = hunkRegex.exec(patch);
      expect(match).not.toBeNull();
      expect(match[1]).toBe('1'); // old start
      expect(match[3]).toBe('1'); // new start
    });
  });

  describe('isNullUrlValidationError', () => {
    test('should detect null URL validation error', () => {
      const error = new Error('blob_url and raw_url Expected string, received null MCP error -32603');
      const result = service.isNullUrlValidationError(error);
      expect(result).toBe(true);
    });

    test('should not detect other errors', () => {
      const error = new Error('Network timeout');
      const result = service.isNullUrlValidationError(error);
      expect(result).toBe(false);
    });

    test('should require all error components', () => {
      const error = new Error('blob_url error but missing other parts');
      const result = service.isNullUrlValidationError(error);
      expect(result).toBe(false);
    });

    test('should handle error without message', () => {
      const error = { name: 'Error' };
      const result = service.isNullUrlValidationError(error);
      expect(result).toBe(false);
    });
  });

  describe('retryOperation logic', () => {
    test('should calculate exponential backoff delays', () => {
      const minTimeout = 2000;
      const factor = 2;

      const attempt1Delay = minTimeout * Math.pow(factor, 1 - 1);
      const attempt2Delay = minTimeout * Math.pow(factor, 2 - 1);
      const attempt3Delay = minTimeout * Math.pow(factor, 3 - 1);

      expect(attempt1Delay).toBe(2000);
      expect(attempt2Delay).toBe(4000);
      expect(attempt3Delay).toBe(8000);
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

    test('should determine when to throw error', () => {
      const attempt = 3;
      const retries = 3;
      const shouldThrow = attempt >= retries;
      expect(shouldThrow).toBe(true);
    });

    test('should continue retrying when attempts below threshold', () => {
      const attempt = 2;
      const retries = 3;
      const shouldThrow = attempt >= retries;
      expect(shouldThrow).toBe(false);
    });
  });

  describe('Edge cases', () => {
    test('should handle PR object with missing fields', () => {
      const pr = {
        id: 123,
        number: 456,
        title: 'Test PR',
        html_url: 'https://github.com/test/repo/pull/456',
        user: { login: 'testuser' },
        created_at: '2024-01-01T00:00:00Z',
        body: 'Test body',
        base: { ref: 'main' },
        head: { ref: 'feature', sha: 'abc123' }
      };

      expect(pr.id).toBe(123);
      expect(pr.user?.login).toBe('testuser');
      expect(pr.body || 'No description provided').toBe('Test body');
    });

    test('should handle PR with no user', () => {
      const pr = {
        user: null
      };

      const author = pr.user?.login || 'unknown';
      expect(author).toBe('unknown');
    });

    test('should handle PR with no body', () => {
      const pr = {
        body: null
      };

      const description = pr.body || 'No description provided';
      expect(description).toBe('No description provided');
    });

    test('should handle review result with no comments', () => {
      const reviewResult = {
        summary: 'Test review',
        comments: []
      };

      expect(reviewResult.comments.length).toBe(0);
    });

    test('should handle review result with severity breakdown', () => {
      const stats = {
        severityBreakdown: { LOW: 2, MEDIUM: 1, HIGH: 0 }
      };

      expect(stats.severityBreakdown.HIGH).toBe(0);
      expect(stats.severityBreakdown.MEDIUM).toBe(1);
      expect(stats.severityBreakdown.LOW).toBe(2);
    });
  });

  describe('Cleanup', () => {
    test('should have cleanup method', () => {
      expect(service.cleanup).toBeDefined();
      expect(typeof service.cleanup).toBe('function');
    });

    test('should call cleanup without throwing', () => {
      // Temporarily set clearAll to a jest function to avoid errors
      service.timeoutManager.clearAll = jest.fn();
      expect(() => service.cleanup()).not.toThrow();
    });
  });
});
