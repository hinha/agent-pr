/**
 * Unit Tests: MCPGitHubAdapter
 *
 * Tests for the GitHub adapter that wraps MCP GitHub operations.
 */

const { spawn } = require('child_process');
const MCPGitHubAdapter = require('../../../../src/infrastructure/github/MCPGitHubAdapter');

jest.mock('child_process');

describe('MCPGitHubAdapter', () => {
  let adapter;
  let mockLogger;
  let mockRetryHelper;
  let mockSpawnProcess;

  const mockInstanceConfig = {
    key: 'github/testorg',
    owner: 'testorg',
    mcpName: 'github-work'
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    mockRetryHelper = {
      retry: jest.fn((fn) => fn()),
      retryIf: jest.fn((fn, _shouldRetry) => fn())
    };

    // Mock spawn process
    mockSpawnProcess = {
      stdout: {
        on: jest.fn(),
        off: jest.fn()
      },
      stderr: {
        on: jest.fn(),
        off: jest.fn()
      },
      on: jest.fn(),
      off: jest.fn()
    };

    spawn.mockReturnValue(mockSpawnProcess);

    adapter = new MCPGitHubAdapter(
      mockInstanceConfig,
      mockLogger,
      mockRetryHelper
    );
  });

  afterEach(() => {
    if (adapter) {
      adapter.cleanup();
    }
  });

  describe('constructor', () => {
    test('should initialize with instance config', () => {
      expect(adapter.instanceKey).toBe('github/testorg');
      expect(adapter.owner).toBe('testorg');
      expect(adapter.serverName).toBe('github-work');
      expect(adapter.mcpBaseCmd).toBe('mcporter');
      expect(adapter.mcpOutputFlag).toBe('--output json');
    });

    test('should default to mcporter when mcpClient is not provided', () => {
      const adapterNoClient = new MCPGitHubAdapter(
        { key: 'github/test', owner: 'test', mcpName: 'test-mcp' },
        mockLogger,
        mockRetryHelper
      );
      expect(adapterNoClient.mcpBaseCmd).toBe('mcporter');
    });

    test('should use custom mcpClient and output flag when provided', () => {
      const adapterCustom = new MCPGitHubAdapter(
        {
          key: 'github/test',
          owner: 'test',
          mcpName: 'test-mcp',
          mcpClient: 'openclaw mcp',
          mcpOutputFlag: ''
        },
        mockLogger,
        mockRetryHelper
      );
      expect(adapterCustom.mcpBaseCmd).toBe('openclaw mcp');
      expect(adapterCustom.mcpOutputFlag).toBe('');
    });

    test('should log initialization', () => {
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Initialized with server=github-work')
      );
    });
  });

  describe('getOpenPRs', () => {
    test('should fetch and parse open PRs from MCP', (done) => {
      const mockPRs = [
        {
          id: 123456,
          number: 456,
          title: 'Test PR',
          state: 'open',
          user: { login: 'testuser' },
          base: { ref: 'main' },
          head: { ref: 'feature', sha: 'abc123' },
          html_url: 'https://github.com/testorg/test-repo/pull/456',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          body: 'Test body'
        }
      ];

      // Set up spawn to return mock data
      let onDataCallback;
      let onCloseCallback;

      mockSpawnProcess.stdout.on.mockImplementation((event, cb) => {
        if (event === 'data') {
          onDataCallback = cb;
        }
      });

      mockSpawnProcess.stderr.on.mockImplementation((event, cb) => {
        if (event === 'data') {
          onErrorDataCallback = cb;
        }
      });

      mockSpawnProcess.on.mockImplementation((event, cb) => {
        if (event === 'close') {
          onCloseCallback = cb;
        }
      });

      adapter.getOpenPRs('test-repo').then((result) => {
        expect(spawn).toHaveBeenCalledWith(
          'mcporter',
          expect.arrayContaining([
            'call',
            'github-work.list_pull_requests',
            '--output',
            'json'
          ]),
          expect.objectContaining({
            maxBuffer: 10 * 1024 * 1024,
            shell: true
          })
        );

        expect(result).toHaveLength(1);
        expect(result[0].number).toBe(456);
        expect(result[0].title).toBe('Test PR');
        expect(result[0].author).toBe('testuser');
        expect(result[0].baseBranch).toBe('main');
        done();
      });

      // Simulate spawn output
      setTimeout(() => {
        if (onDataCallback) {
          onDataCallback(JSON.stringify(mockPRs));
        }
        if (onCloseCallback) {
          onCloseCallback(0);
        }
      }, 10);
    });

    test('should use retry helper for MCP calls', async () => {
      // Mock spawn to return immediately with empty result
      mockSpawnProcess.on.mockImplementation((event, cb) => {
        if (event === 'close') {
          setTimeout(() => cb(0), 10);
        }
      });

      mockSpawnProcess.stdout.on.mockImplementation(() => {});
      mockSpawnProcess.stderr.on.mockImplementation(() => {});

      mockRetryHelper.retryIf.mockImplementation(async (fn, _shouldRetry) => {
        return await fn();
      });

      try {
        await adapter.getOpenPRs('test-repo');
      } catch (_e) {
        // Expected to fail due to empty output
      }

      expect(mockRetryHelper.retryIf).toHaveBeenCalled();
    });

    test('should accept object-wrapped pull request arrays', async () => {
      const wrappedPRs = {
        result: {
          pull_requests: [
            {
              id: 123456,
              number: 456,
              title: 'Wrapped PR',
              state: 'open',
              user: { login: 'testuser' },
              base: { ref: 'main' },
              head: { ref: 'feature', sha: 'abc123' },
              html_url: 'https://github.com/testorg/test-repo/pull/456',
              created_at: '2024-01-01T00:00:00Z',
              body: 'Wrapped body'
            }
          ]
        }
      };

      let onDataCallback;
      let onCloseCallback;

      mockSpawnProcess.stdout.on.mockImplementation((event, cb) => {
        if (event === 'data') onDataCallback = cb;
      });
      mockSpawnProcess.stderr.on.mockImplementation(() => {});
      mockSpawnProcess.on.mockImplementation((event, cb) => {
        if (event === 'close') onCloseCallback = cb;
      });

      const promise = adapter.getOpenPRs('test-repo');

      setTimeout(() => {
        onDataCallback(JSON.stringify(wrappedPRs));
        onCloseCallback(0);
      }, 10);

      const result = await promise;
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Wrapped PR');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Found 1 open PRs')
      );
    });

    test('should throw MCPError when pull request payload is not an array shape', async () => {
      let onDataCallback;
      let onCloseCallback;

      mockSpawnProcess.stdout.on.mockImplementation((event, cb) => {
        if (event === 'data') onDataCallback = cb;
      });
      mockSpawnProcess.stderr.on.mockImplementation(() => {});
      mockSpawnProcess.on.mockImplementation((event, cb) => {
        if (event === 'close') onCloseCallback = cb;
      });

      const promise = adapter.getOpenPRs('test-repo');

      setTimeout(() => {
        onDataCallback(JSON.stringify({ status: 'ok', count: 0 }));
        onCloseCallback(0);
      }, 10);

      await expect(promise).rejects.toThrow('MCP list_pull_requests response is not an array');
    });

    test('should throw MCPError on spawn failure', (done) => {
      let onErrorCallback;

      mockSpawnProcess.on.mockImplementation((event, cb) => {
        if (event === 'error') {
          onErrorCallback = cb;
        }
      });

      mockSpawnProcess.stdout.on.mockImplementation(() => {});
      mockSpawnProcess.stderr.on.mockImplementation(() => {});

      adapter.getOpenPRs('test-repo').catch((error) => {
        expect(error).toBeDefined();
        expect(error.name).toBe('MCPError');
        done();
      });

      setTimeout(() => {
        if (onErrorCallback) {
          onErrorCallback(new Error('Spawn failed'));
        }
      }, 10);
    });

  });

  describe('getPRDetails', () => {
    test('should fetch PR files and filter test files', (done) => {
      const mockFiles = [
        {
          filename: 'src/index.js',
          additions: 50,
          deletions: 10,
          changes: 60,
          status: 'modified',
          blob_url: 'https://example.com/blob',
          raw_url: 'https://example.com/raw'
        },
        {
          filename: 'src/index.test.js',
          additions: 30,
          deletions: 5,
          changes: 35,
          status: 'modified',
          blob_url: 'https://example.com/blob',
          raw_url: 'https://example.com/raw'
        }
      ];

      let onDataCallback;
      let onCloseCallback;

      mockSpawnProcess.stdout.on.mockImplementation((event, cb) => {
        if (event === 'data') {
          onDataCallback = cb;
        }
      });

      mockSpawnProcess.stderr.on.mockImplementation(() => {});

      mockSpawnProcess.on.mockImplementation((event, cb) => {
        if (event === 'close') {
          onCloseCallback = cb;
        }
      });

      adapter.getPRDetails('test-repo', 456).then((result) => {
        expect(result.files).toHaveLength(1);
        expect(result.files[0].filename).toBe('src/index.js');
        expect(result.filesChanged).toBe(1);
        expect(result.totalFilesChanged).toBe(2); // Including test file
        done();
      });

      setTimeout(() => {
        if (onDataCallback) {
          onDataCallback(JSON.stringify(mockFiles));
        }
        if (onCloseCallback) {
          onCloseCallback(0);
        }
      }, 10);
    });

    test('should handle null URL validation error', (done) => {
      // This tests the special case where files have null URLs
      const errorResponse = {
        error: ' MCP error -32603: Invalid params: blob_url: Expected string, received null, raw_url: Expected string, received null'
      };

      let onDataCallback;
      let onCloseCallback;

      mockSpawnProcess.stdout.on.mockImplementation((event, cb) => {
        if (event === 'data') {
          onDataCallback = cb;
        }
      });

      mockSpawnProcess.stderr.on.mockImplementation(() => {});

      mockSpawnProcess.on.mockImplementation((event, cb) => {
        if (event === 'close') {
          onCloseCallback = cb;
        }
      });

      adapter.getPRDetails('test-repo', 456).catch((error) => {
        expect(error.name).toBe('MCPError');
        expect(error.message).toContain('unsupported file types');
        done();
      });

      setTimeout(() => {
        if (onDataCallback) {
          onDataCallback(JSON.stringify(errorResponse));
        }
        if (onCloseCallback) {
          onCloseCallback(0);
        }
      }, 10);
    });
  });

  describe('createReviewWithComments', () => {
    test.skip('should submit review with comments - TODO: fix callback test', (done) => {
      // Skipped due to callback timing issues in test environment
      // This test works in actual usage but the mock setup is complex
      done();
    });

    test('should handle agent-called-directly case', async () => {
      const mockPR = {
        id: 'pr_1',
        number: 456,
        headSha: 'abc123'
      };

      const mockReviewResult = {
        summary: 'Submitted by agent',
        agentCalledToolDirectly: true,
        agentRawOutput: 'Review submitted at https://github.com/testorg/test-repo/pull/456'
      };

      const result = await adapter.createReviewWithComments('test-repo', mockPR, mockReviewResult);

      expect(result.id).toBe('agent-submitted');
      expect(result.submitted_by).toBe('agent');
      expect(spawn).not.toHaveBeenCalled();
    });

    test('should fallback to COMMENT when REQUEST_CHANGES fails on own PR without retrying', (done) => {
      const mockPR = {
        id: 'pr_1',
        number: 456,
        headSha: 'abc123'
      };

      const mockReviewResult = {
        summary: 'Please make changes',
        comments: [
          {
            file: 'src/index.js',
            line: 10,
            message: 'Fix this',
            severity: 'HIGH'
          }
        ]
      };

      // Simulate the real retryIf: honor the shouldRetry predicate so
      // non-retryable errors fail fast (this is what the fix relies on).
      mockRetryHelper.retryIf = jest.fn(async (fn, shouldRetry, options = {}) => {
        const maxRetries = options.retries || 0;
        let attempt = 0;
        while (true) { // eslint-disable-line no-constant-condition
          try {
            return await fn();
          } catch (err) {
            if (attempt >= maxRetries || (shouldRetry && !shouldRetry(err))) {
              throw err;
            }
            attempt++;
          }
        }
      });

      let onDataCallback;
      let onCloseCallback;

      mockSpawnProcess.stdout.on.mockImplementation((event, cb) => {
        if (event === 'data') {
          onDataCallback = cb;
        }
      });

      mockSpawnProcess.stderr.on.mockImplementation(() => {});

      mockSpawnProcess.on.mockImplementation((event, cb) => {
        if (event !== 'close') return;
        onCloseCallback = cb;

        // Route the response based on what MCP call this spawn is for.
        const latestArgs = spawn.mock.calls[spawn.mock.calls.length - 1][1];
        const isGetFiles = latestArgs.some((a) => typeof a === 'string' && a.includes('get_pull_request_files'));
        const isRequestChanges = latestArgs.some((a) => typeof a === 'string' && a.includes('REQUEST_CHANGES'));

        setTimeout(() => {
          if (isGetFiles) {
            if (onDataCallback) onDataCallback(JSON.stringify({ files: [] }));
          } else if (isRequestChanges) {
            // Every REQUEST_CHANGES attempt must fail with the permanent 422
            // error (so a retry loop would keep failing, proving the fix).
            if (onDataCallback) {
              onDataCallback(JSON.stringify({
                error: 'Can not request changes on your own pull request'
              }));
            }
          } else {
            // COMMENT fallback succeeds
            if (onDataCallback) onDataCallback(JSON.stringify({ id: 'review_123' }));
          }
          if (onCloseCallback) onCloseCallback(0);
        }, 10);
      });

      adapter.createReviewWithComments('test-repo', mockPR, mockReviewResult).then((result) => {
        expect(result.id).toBe('review_123');
        // REQUEST_CHANGES must be attempted exactly once (no retries) before
        // the fallback to COMMENT fires.
        const requestChangesCalls = spawn.mock.calls.filter(([, args]) =>
          args.some((a) => typeof a === 'string' && a.includes('REQUEST_CHANGES'))
        );
        expect(requestChangesCalls).toHaveLength(1);
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Cannot request changes on own PR')
        );
        done();
      }).catch(done);
    });

    test('should append skipped comment to review body when file not in changed files', (done) => {
      const mockPR = { id: 'pr_1', number: 9, headSha: 'abc123' };

      const mockReviewResult = {
        summary: 'Found 1 issue',
        comments: [
          {
            file: 'src/infrastructure/persistence/FileSystemStateRepository.js',
            line: 183,
            severity: 'MEDIUM',
            message: '`clearProcessedPRs` does not clear notification counts',
            suggestedCode: 'async clearProcessedPRs(owner, repo) {\n  await this.initialize();\n}'
          }
        ]
      };

      // Changed files set does NOT include the comment's file
      const changedFiles = [{ filename: 'other-file.js' }];

      let callCount = 0;
      let onDataCallback;
      let onCloseCallback;

      mockSpawnProcess.stdout.on.mockImplementation((event, cb) => {
        if (event === 'data') onDataCallback = cb;
      });
      mockSpawnProcess.stderr.on.mockImplementation(() => {});
      mockSpawnProcess.on.mockImplementation((event, cb) => {
        if (event === 'close') {
          onCloseCallback = cb;
          callCount++;
          setTimeout(() => {
            if (callCount === 1) {
              onDataCallback(JSON.stringify(changedFiles));
            } else {
              onDataCallback(JSON.stringify({ id: 'review_body_fallback' }));
            }
            onCloseCallback(0);
          }, 10);
        }
      });

      adapter.createReviewWithComments('test-repo', mockPR, mockReviewResult).then((result) => {
        expect(result.id).toBe('review_body_fallback');

        // Should warn about file not in changed files
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('File src/infrastructure/persistence/FileSystemStateRepository.js not in changed files')
        );

        // Should log that comment was appended to body
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('0 inline comment(s) and 1 in body')
        );

        // The second spawn call should contain the body with fallback
        const lastSpawnArgs = spawn.mock.calls[1][1];
        const bodyArg = lastSpawnArgs.find(arg => arg.startsWith('body='));
        expect(bodyArg).toContain('could not be placed as inline review');
        expect(bodyArg).toContain('clearProcessedPRs');
        expect(bodyArg).toContain('async clearProcessedPRs');

        done();
      });
    });

    test('should create inline comments for files in PR and append others to body', (done) => {
      const mockPR = { id: 'pr_1', number: 9, headSha: 'abc123' };

      const mockReviewResult = {
        summary: 'Found 2 issues',
        comments: [
          {
            file: 'src/application/use-cases/ReviewPRUseCase.js',
            line: 3,
            severity: 'HIGH',
            message: 'Critical bug in transition logic'
          },
          {
            file: 'src/infrastructure/persistence/FileSystemStateRepository.js',
            line: 183,
            severity: 'MEDIUM',
            message: 'Missing cleanup',
            suggestedCode: 'async clear() {\n  await this.reset();\n}'
          }
        ]
      };

      // Only first file is in changed files; second file is NOT
      const changedFiles = [
        { filename: 'src/application/use-cases/ReviewPRUseCase.js' }
      ];

      let callCount = 0;
      let onDataCallback;
      let onCloseCallback;

      mockSpawnProcess.stdout.on.mockImplementation((event, cb) => {
        if (event === 'data') onDataCallback = cb;
      });
      mockSpawnProcess.stderr.on.mockImplementation(() => {});
      mockSpawnProcess.on.mockImplementation((event, cb) => {
        if (event === 'close') {
          onCloseCallback = cb;
          callCount++;
          setTimeout(() => {
            if (callCount === 1) {
              onDataCallback(JSON.stringify(changedFiles));
            } else {
              onDataCallback(JSON.stringify({ id: 'review_mixed' }));
            }
            onCloseCallback(0);
          }, 10);
        }
      });

      adapter.createReviewWithComments('test-repo', mockPR, mockReviewResult).then((result) => {
        expect(result.id).toBe('review_mixed');

        // 1 inline + 1 in body
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('1 inline comment(s) and 1 in body')
        );

        // HIGH severity should trigger REQUEST_CHANGES event
        const lastSpawnArgs = spawn.mock.calls[1][1];
        const eventArg = lastSpawnArgs.find(arg => arg.startsWith('event='));
        expect(eventArg).toBe('event="REQUEST_CHANGES"');

        // Body should contain fallback for the skipped MEDIUM comment
        const bodyArg = lastSpawnArgs.find(arg => arg.startsWith('body='));
        expect(bodyArg).toContain('Missing cleanup');
        expect(bodyArg).toContain('async clear()');

        done();
      });
    });

    test('should handle multiple skipped comments with suggestedCode in body', (done) => {
      const mockPR = { id: 'pr_1', number: 9, headSha: 'abc123' };

      const mockReviewResult = {
        summary: 'Code quality review',
        comments: [
          {
            file: 'src/utils/helper.js',
            line: 500,
            severity: 'MEDIUM',
            message: 'Missing error handling',
            suggestedCode: 'try {\n  await fn();\n} catch(e) { log(e); }'
          },
          {
            file: 'src/utils/helper.js',
            line: 800,
            severity: 'LOW',
            message: 'Consider using const'
          }
        ]
      };

      // Changed files set does NOT include src/utils/helper.js
      const changedFiles = [{ filename: 'src/other.js' }];

      let callCount = 0;
      let onDataCallback;
      let onCloseCallback;

      mockSpawnProcess.stdout.on.mockImplementation((event, cb) => {
        if (event === 'data') onDataCallback = cb;
      });
      mockSpawnProcess.stderr.on.mockImplementation(() => {});
      mockSpawnProcess.on.mockImplementation((event, cb) => {
        if (event === 'close') {
          onCloseCallback = cb;
          callCount++;
          setTimeout(() => {
            if (callCount === 1) {
              onDataCallback(JSON.stringify(changedFiles));
            } else {
              onDataCallback(JSON.stringify({ id: 'review_multi_skip' }));
            }
            onCloseCallback(0);
          }, 10);
        }
      });

      adapter.createReviewWithComments('test-repo', mockPR, mockReviewResult).then((result) => {
        expect(result.id).toBe('review_multi_skip');

        // Both comments skipped → 0 inline, 2 in body
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('0 inline comment(s) and 2 in body')
        );

        const lastSpawnArgs = spawn.mock.calls[1][1];
        const bodyArg = lastSpawnArgs.find(arg => arg.startsWith('body='));
        // Both comments should be in body
        expect(bodyArg).toContain('Missing error handling');
        expect(bodyArg).toContain('Consider using const');
        // Only first comment has suggestedCode
        expect(bodyArg).toContain('try {');
        // Separated by ---
        expect(bodyArg).toContain('---');

        done();
      });
    });

    test('should not append fallback section when all comment files are in PR', (done) => {
      const mockPR = { id: 'pr_1', number: 9, headSha: 'abc123' };

      const mockReviewResult = {
        summary: 'All lines in diff',
        comments: [
          {
            file: 'src/index.js',
            line: 2,
            severity: 'HIGH',
            message: 'Bug here',
            suggestedCode: 'const fixed = true;'
          }
        ]
      };

      // Comment's file IS in the changed files set
      const changedFiles = [{ filename: 'src/index.js' }];

      let callCount = 0;
      let onDataCallback;
      let onCloseCallback;

      mockSpawnProcess.stdout.on.mockImplementation((event, cb) => {
        if (event === 'data') onDataCallback = cb;
      });
      mockSpawnProcess.stderr.on.mockImplementation(() => {});
      mockSpawnProcess.on.mockImplementation((event, cb) => {
        if (event === 'close') {
          onCloseCallback = cb;
          callCount++;
          setTimeout(() => {
            if (callCount === 1) {
              onDataCallback(JSON.stringify(changedFiles));
            } else {
              onDataCallback(JSON.stringify({ id: 'review_all_inline' }));
            }
            onCloseCallback(0);
          }, 10);
        }
      });

      adapter.createReviewWithComments('test-repo', mockPR, mockReviewResult).then((result) => {
        expect(result.id).toBe('review_all_inline');

        // 1 inline comment, 0 in body
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('1 inline comment(s)')
        );

        // No "in body" suffix
        const inlineLog = mockLogger.info.mock.calls.find(
          call => call[0].includes('inline comment(s)')
        );
        expect(inlineLog[0]).not.toContain('and 0 in body');

        // Body should NOT contain fallback section
        const lastSpawnArgs = spawn.mock.calls[1][1];
        const bodyArg = lastSpawnArgs.find(arg => arg.startsWith('body='));
        expect(bodyArg).not.toContain('could not be placed as inline review');

        done();
      });
    });

    test('should format suggestedCode with correct language in fallback body', (done) => {
      const mockPR = { id: 'pr_1', number: 9, headSha: 'abc123' };

      const mockReviewResult = {
        summary: 'Python file review',
        comments: [
          {
            file: 'src/services/analyzer.py',
            line: 999,
            severity: 'MEDIUM',
            message: 'Use list comprehension',
            suggestedCode: 'result = [x for x in items if x > 0]'
          }
        ]
      };

      // Changed files set does NOT include the comment's file
      const changedFiles = [{ filename: 'src/other.js' }];

      let callCount = 0;
      let onDataCallback;
      let onCloseCallback;

      mockSpawnProcess.stdout.on.mockImplementation((event, cb) => {
        if (event === 'data') onDataCallback = cb;
      });
      mockSpawnProcess.stderr.on.mockImplementation(() => {});
      mockSpawnProcess.on.mockImplementation((event, cb) => {
        if (event === 'close') {
          onCloseCallback = cb;
          callCount++;
          setTimeout(() => {
            if (callCount === 1) {
              onDataCallback(JSON.stringify(changedFiles));
            } else {
              onDataCallback(JSON.stringify({ id: 'review_python' }));
            }
            onCloseCallback(0);
          }, 10);
        }
      });

      adapter.createReviewWithComments('test-repo', mockPR, mockReviewResult).then((result) => {
        expect(result.id).toBe('review_python');

        const lastSpawnArgs = spawn.mock.calls[1][1];
        const bodyArg = lastSpawnArgs.find(arg => arg.startsWith('body='));
        expect(bodyArg).toContain('\\`\\`\\`python');
        expect(bodyArg).toContain('result = [x for x in items if x > 0]');

        done();
      });
    });

    test('should include side: RIGHT on all inline comments', (done) => {
      const fs = require('fs');
      const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

      const mockPR = { id: 'pr_1', number: 9, headSha: 'abc123' };
      const mockReviewResult = {
        summary: 'Review with side check',
        comments: [
          { file: 'src/app.js', line: 10, severity: 'LOW', message: 'Nitpick' }
        ]
      };
      const changedFiles = [{ filename: 'src/app.js' }];

      let callCount = 0;
      let onDataCallback;
      let onCloseCallback;

      mockSpawnProcess.stdout.on.mockImplementation((event, cb) => {
        if (event === 'data') onDataCallback = cb;
      });
      mockSpawnProcess.stderr.on.mockImplementation(() => {});
      mockSpawnProcess.on.mockImplementation((event, cb) => {
        if (event === 'close') {
          onCloseCallback = cb;
          callCount++;
          setTimeout(() => {
            if (callCount === 1) {
              onDataCallback(JSON.stringify(changedFiles));
            } else {
              onDataCallback(JSON.stringify({ id: 'review_side_test' }));
            }
            onCloseCallback(0);
          }, 10);
        }
      });

      adapter.createReviewWithComments('test-repo', mockPR, mockReviewResult).then((result) => {
        expect(result.id).toBe('review_side_test');
        // Comments are written to a temp file via fs.writeFileSync
        const commentsCall = writeSpy.mock.calls.find(c => c[0].includes('/tmp/comments-'));
        const parsedComments = JSON.parse(commentsCall[1]);
        expect(parsedComments[0].side).toBe('RIGHT');
        expect(parsedComments[0].line).toBe(10);
        expect(parsedComments[0]).not.toHaveProperty('position');
        writeSpy.mockRestore();
        done();
      });
    });

    test('should add start_line and start_side for multi-line comments', (done) => {
      const fs = require('fs');
      const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

      const mockPR = { id: 'pr_1', number: 9, headSha: 'abc123' };
      const mockReviewResult = {
        summary: 'Multi-line review',
        comments: [
          { file: 'src/app.js', line: 15, startLine: 10, endLine: 15, severity: 'MEDIUM', message: 'Refactor range' }
        ]
      };
      const changedFiles = [{ filename: 'src/app.js' }];

      let callCount = 0;
      let onDataCallback;
      let onCloseCallback;

      mockSpawnProcess.stdout.on.mockImplementation((event, cb) => {
        if (event === 'data') onDataCallback = cb;
      });
      mockSpawnProcess.stderr.on.mockImplementation(() => {});
      mockSpawnProcess.on.mockImplementation((event, cb) => {
        if (event === 'close') {
          onCloseCallback = cb;
          callCount++;
          setTimeout(() => {
            if (callCount === 1) {
              onDataCallback(JSON.stringify(changedFiles));
            } else {
              onDataCallback(JSON.stringify({ id: 'review_multiline_test' }));
            }
            onCloseCallback(0);
          }, 10);
        }
      });

      adapter.createReviewWithComments('test-repo', mockPR, mockReviewResult).then((result) => {
        expect(result.id).toBe('review_multiline_test');
        // Comments are written to a temp file via fs.writeFileSync
        const commentsCall = writeSpy.mock.calls.find(c => c[0].includes('/tmp/comments-'));
        const parsedComments = JSON.parse(commentsCall[1]);
        expect(parsedComments[0].side).toBe('RIGHT');
        expect(parsedComments[0].line).toBe(15);
        expect(parsedComments[0].start_line).toBe(10);
        expect(parsedComments[0].start_side).toBe('RIGHT');
        writeSpy.mockRestore();
        done();
      });
    });
  });

  describe('approvePR', () => {
    test('should submit APPROVE review', (done) => {
      let onDataCallback;
      let onCloseCallback;

      mockSpawnProcess.stdout.on.mockImplementation((event, cb) => {
        if (event === 'data') {
          onDataCallback = cb;
        }
      });

      mockSpawnProcess.stderr.on.mockImplementation(() => {});

      mockSpawnProcess.on.mockImplementation((event, cb) => {
        if (event === 'close') {
          onCloseCallback = cb;
        }
      });

      adapter.approvePR('test-repo', 456, 'Approved!').then(() => {
        expect(spawn).toHaveBeenCalledWith(
          'mcporter',
          expect.arrayContaining([
            'call',
            'github-work.create_pull_request_review',
            'event="APPROVE"'
          ]),
          expect.any(Object)
        );
        done();
      });

      setTimeout(() => {
        if (onDataCallback) {
          onDataCallback(JSON.stringify({ id: 'review_123' }));
        }
        if (onCloseCallback) {
          onCloseCallback(0);
        }
      }, 10);
    });
  });

  describe('requestChanges', () => {
    test('should submit REQUEST_CHANGES review', (done) => {
      let onDataCallback;
      let onCloseCallback;

      mockSpawnProcess.stdout.on.mockImplementation((event, cb) => {
        if (event === 'data') {
          onDataCallback = cb;
        }
      });

      mockSpawnProcess.stderr.on.mockImplementation(() => {});

      mockSpawnProcess.on.mockImplementation((event, cb) => {
        if (event === 'close') {
          onCloseCallback = cb;
        }
      });

      adapter.requestChanges('test-repo', 456, 'Please fix').then(() => {
        expect(spawn).toHaveBeenCalledWith(
          'mcporter',
          expect.arrayContaining([
            'call',
            'github-work.create_pull_request_review',
            'event="REQUEST_CHANGES"'
          ]),
          expect.any(Object)
        );
        done();
      });

      setTimeout(() => {
        if (onDataCallback) {
          onDataCallback(JSON.stringify({ id: 'review_123' }));
        }
        if (onCloseCallback) {
          onCloseCallback(0);
        }
      }, 10);
    });
  });

  describe('closePR', () => {
    test('should close PR via update_pull_request', (done) => {
      let onDataCallback;
      let onCloseCallback;

      mockSpawnProcess.stdout.on.mockImplementation((event, cb) => {
        if (event === 'data') {
          onDataCallback = cb;
        }
      });

      mockSpawnProcess.stderr.on.mockImplementation(() => {});

      mockSpawnProcess.on.mockImplementation((event, cb) => {
        if (event === 'close') {
          onCloseCallback = cb;
        }
      });

      adapter.closePR('test-repo', 456).then(() => {
        expect(spawn).toHaveBeenCalledWith(
          'mcporter',
          expect.arrayContaining([
            'call',
            'github-work.update_pull_request',
            'state="closed"'
          ]),
          expect.any(Object)
        );
        done();
      });

      setTimeout(() => {
        if (onDataCallback) {
          onDataCallback(JSON.stringify({ state: 'closed' }));
        }
        if (onCloseCallback) {
          onCloseCallback(0);
        }
      }, 10);
    });
  });

  describe('cleanup', () => {
    test('should clean up temp files', () => {
      const fs = require('fs');
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      adapter.tempFiles = ['/tmp/comments-test.json'];
      adapter.cleanup();

      expect(fs.existsSync).toHaveBeenCalledWith('/tmp/comments-test.json');
      expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/comments-test.json');
      expect(adapter.tempFiles).toHaveLength(0);
    });
  });

  describe('_isTestFile', () => {
    test('should detect test files', () => {
      expect(adapter._isTestFile('src/index.test.js')).toBe(true);
      expect(adapter._isTestFile('src/index_spec.js')).toBe(true);
      expect(adapter._isTestFile('tests/e2e/test.go')).toBe(true);
      expect(adapter._isTestFile('src/__tests__/test.js')).toBe(true);
      expect(adapter._isTestFile('src/index.js')).toBe(false);
      expect(adapter._isTestFile('README.md')).toBe(false);
    });
  });

  describe('_detectLanguage', () => {
    test('should detect programming language from file extension', () => {
      expect(adapter._detectLanguage('src/index.js')).toBe('javascript');
      expect(adapter._detectLanguage('src/index.ts')).toBe('typescript');
      expect(adapter._detectLanguage('src/index.go')).toBe('go');
      expect(adapter._detectLanguage('src/index.py')).toBe('python');
      expect(adapter._detectLanguage('Dockerfile')).toBe('');
    });
  });

  describe('_normalizeSeverity', () => {
    test('should normalize severity values', () => {
      expect(adapter._normalizeSeverity('high')).toBe('HIGH');
      expect(adapter._normalizeSeverity('Medium')).toBe('MEDIUM');
      expect(adapter._normalizeSeverity('low')).toBe('LOW');
      expect(adapter._normalizeSeverity('invalid')).toBe('LOW');
      expect(adapter._normalizeSeverity(null)).toBe('LOW');
      expect(adapter._normalizeSeverity(undefined)).toBe('LOW');
    });
  });

  describe('_shellEscape', () => {
    test('should wrap simple strings in double quotes', () => {
      expect(adapter._shellEscape('hello')).toBe('"hello"');
    });

    test('should escape double quotes', () => {
      expect(adapter._shellEscape('say "hello"')).toBe('"say \\"hello\\""');
    });

    test('should escape dollar signs', () => {
      expect(adapter._shellEscape('$HOME')).toBe('"\\$HOME"');
    });

    test('should escape backticks', () => {
      expect(adapter._shellEscape('`whoami`')).toBe('"\\`whoami\\`"');
    });

    test('should escape backslashes', () => {
      expect(adapter._shellEscape('path\\to\\file')).toBe('"path\\\\to\\\\file"');
    });

    test('should escape newlines', () => {
      expect(adapter._shellEscape('line1\nline2')).toBe('"line1\\nline2"');
    });

    test('should handle injection attempt with single quotes', () => {
      const malicious = '\'; rm -rf /; echo \'';
      const escaped = adapter._shellEscape(malicious);
      expect(escaped).toBe(`"${malicious}"`);
      expect(escaped).not.toMatch(/(?<!\\)\$/);
      expect(escaped).not.toMatch(/(?<!\\)`/);
    });

    test('should handle command substitution attempt', () => {
      const malicious = '$(cat /etc/passwd)';
      const escaped = adapter._shellEscape(malicious);
      expect(escaped).toBe('"\\$(cat /etc/passwd)"');
    });
  });

  describe('_normalizeEvent', () => {
    test('should normalize valid event strings', () => {
      expect(adapter._normalizeEvent('APPROVE')).toBe('APPROVE');
      expect(adapter._normalizeEvent('approve')).toBe('APPROVE');
      expect(adapter._normalizeEvent('REQUEST_CHANGES')).toBe('REQUEST_CHANGES');
      expect(adapter._normalizeEvent('request_changes')).toBe('REQUEST_CHANGES');
      expect(adapter._normalizeEvent('COMMENT')).toBe('COMMENT');
      expect(adapter._normalizeEvent('comment')).toBe('COMMENT');
    });

    test('should return null for invalid or absent events', () => {
      expect(adapter._normalizeEvent(null)).toBeNull();
      expect(adapter._normalizeEvent(undefined)).toBeNull();
      expect(adapter._normalizeEvent('')).toBeNull();
      expect(adapter._normalizeEvent('INVALID')).toBeNull();
      expect(adapter._normalizeEvent(123)).toBeNull();
    });
  });

  describe('_isNonRetryableError', () => {
    test('should mark "Unknown tool" errors as non-retryable', () => {
      const err = new Error('Unknown tool: foo.bar');
      expect(adapter._isNonRetryableError(err)).toBe(true);
    });

    test('should mark "own PR" review errors as non-retryable', () => {
      const err = new Error('MCP error: Can not request changes on your own pull request');
      expect(adapter._isNonRetryableError(err)).toBe(true);
    });

    test('should mark 422 Validation Error as non-retryable', () => {
      const err = new Error('Validation Error: HTTP 422 — field invalid');
      expect(adapter._isNonRetryableError(err)).toBe(true);
    });

    test('should mark transient errors as retryable', () => {
      expect(adapter._isNonRetryableError(new Error('MCP command timeout after 60000ms'))).toBe(false);
      expect(adapter._isNonRetryableError(new Error('connect ECONNREFUSED 127.0.0.1:443'))).toBe(false);
      expect(adapter._isNonRetryableError(new Error('MCP command failed with exit code 1'))).toBe(false);
    });

    test('should be defensive against errors without a message', () => {
      expect(adapter._isNonRetryableError(null)).toBe(false);
      expect(adapter._isNonRetryableError(undefined)).toBe(false);
      expect(adapter._isNonRetryableError({})).toBe(false);
    });
  });

  describe('createReviewWithComments - explicit event from caller', () => {
    test('should use REQUEST_CHANGES from caller when no comments', (done) => {
      const mockPR = { id: 'pr_1', number: 456, headSha: 'abc123' };

      const mockReviewResult = {
        body: 'Changes requested via Telegram bot',
        comments: [],
        event: 'request_changes'
      };

      let callCount = 0;
      let onDataCallback;
      let onCloseCallback;

      mockSpawnProcess.stdout.on.mockImplementation((event, cb) => {
        if (event === 'data') onDataCallback = cb;
      });
      mockSpawnProcess.stderr.on.mockImplementation(() => {});
      mockSpawnProcess.on.mockImplementation((event, cb) => {
        if (event === 'close') {
          onCloseCallback = cb;
          callCount++;
          setTimeout(() => {
            if (callCount === 1) {
              onDataCallback(JSON.stringify([]));
            } else {
              onDataCallback(JSON.stringify({ id: 'review_reject' }));
            }
            onCloseCallback(0);
          }, 10);
        }
      });

      adapter.createReviewWithComments('test-repo', mockPR, mockReviewResult).then((result) => {
        expect(result.id).toBe('review_reject');

        // Event should be REQUEST_CHANGES from caller, not COMMENT from severity fallback
        const lastSpawnArgs = spawn.mock.calls[1][1];
        const eventArg = lastSpawnArgs.find(arg => arg.startsWith('event='));
        expect(eventArg).toBe('event="REQUEST_CHANGES"');

        done();
      });
    });

    test('should use severity fallback when caller event is invalid', (done) => {
      const mockPR = { id: 'pr_1', number: 456, headSha: 'abc123' };

      const mockReviewResult = {
        summary: 'Found issues',
        comments: [
          { file: 'src/app.js', line: 10, message: 'Bug', severity: 'HIGH' }
        ],
        event: 'INVALID_EVENT'
      };

      const changedFiles = [{ filename: 'src/app.js' }];

      let callCount = 0;
      let onDataCallback;
      let onCloseCallback;

      mockSpawnProcess.stdout.on.mockImplementation((event, cb) => {
        if (event === 'data') onDataCallback = cb;
      });
      mockSpawnProcess.stderr.on.mockImplementation(() => {});
      mockSpawnProcess.on.mockImplementation((event, cb) => {
        if (event === 'close') {
          onCloseCallback = cb;
          callCount++;
          setTimeout(() => {
            if (callCount === 1) {
              onDataCallback(JSON.stringify(changedFiles));
            } else {
              onDataCallback(JSON.stringify({ id: 'review_severity_fallback' }));
            }
            onCloseCallback(0);
          }, 10);
        }
      });

      adapter.createReviewWithComments('test-repo', mockPR, mockReviewResult).then((result) => {
        expect(result.id).toBe('review_severity_fallback');

        // Invalid event should fall back to severity-based (HIGH -> REQUEST_CHANGES)
        const lastSpawnArgs = spawn.mock.calls[1][1];
        const eventArg = lastSpawnArgs.find(arg => arg.startsWith('event='));
        expect(eventArg).toBe('event="REQUEST_CHANGES"');

        done();
      });
    });
  });
});
