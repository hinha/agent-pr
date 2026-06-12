const { spawn } = require('child_process');
const fs = require('fs');
const IGitHubService = require('../../interfaces/IGitHubService');
const { MCPError } = require('../../shared/errors');

/**
 * MCPGitHubAdapter - GitHub operations via MCP (Model Context Protocol)
 *
 * This adapter implements the IGitHubService interface using:
 * - `openclaw mcp` when the app runs in OpenClaw mode
 * - Hermes native MCP via `hermes -z` when the app runs in Hermes mode
 *
 * @example
 * const adapter = new MCPGitHubAdapter(instanceConfig, logger, retryHelper);
 * const prs = await adapter.getOpenPRs('my-repo');
 */
class MCPGitHubAdapter extends IGitHubService {
  /**
   * @param {Object} instanceConfig - Instance configuration
   * @param {string} instanceConfig.key - Instance key (e.g., 'github/org-name')
   * @param {string} instanceConfig.owner - Repository owner
   * @param {string} instanceConfig.mcpName - MCP server name
   * @param {Object} logger - Winston logger instance
   * @param {Object} retryHelper - RetryHelper instance
   */
  constructor(instanceConfig, logger, retryHelper) {
    super();
    this.serverName = instanceConfig.mcpName;
    this.owner = instanceConfig.owner;
    this.instanceKey = instanceConfig.key;
    this.providerAgent = instanceConfig.providerAgent || 'openclaw';
    this.runtime = instanceConfig.githubRuntime || (this.providerAgent === 'hermes' ? 'hermes' : 'openclaw');
    this.mcpBaseCmd = this.runtime === 'hermes' ? 'hermes' : 'openclaw mcp';
    this.hermesProfile = instanceConfig.agent?.hermesProfile || instanceConfig.hermesProfile || null;
    this.hermesMaxTurns = instanceConfig.agent?.hermesMaxTurns || instanceConfig.hermesMaxTurns || 90;
    this.logger = logger;
    this.retryHelper = retryHelper;
    this.tempFiles = [];
    this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}] Initialized with server=${this.serverName}, owner=${this.owner}, runtime=${this.runtime}`);
  }

  /**
   * Execute MCP tool call using spawn
   * @param {string} method - MCP method name
   * @param {Object} args - Method arguments
   * @returns {Promise<any>} MCP response
   * @private
   */
  async _callMCP(method, args = {}) {
    return this.retryHelper.retryIf(async () => {
      const timeoutMs = 60000;
      if (this.runtime === 'hermes') {
        return this._callMCPViaHermes(method, args, timeoutMs);
      }
      return this._callMCPViaOpenClaw(method, args, timeoutMs);
    }, (err) => {
      // Don't retry non-retryable errors like "Unknown tool"
      if (err.message && err.message.includes('Unknown tool')) {
        return false;
      }
      return true;
    }, {
      retries: 3,
      minTimeout: 2000,
      factor: 2,
      context: `MCP:${this.instanceKey}.${method}`
    });
  }

  async _callMCPViaOpenClaw(method, args, timeoutMs) {
    const startTime = Date.now();
    this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}] Calling ${this.serverName}.${method} via openclaw mcp`);

    const spawnArgs = ['call', `${this.serverName}.${method}`];

    for (const [key, value] of Object.entries(args)) {
      if (value === null || value === undefined) {
        spawnArgs.push(`${key}=null`);
      } else if (typeof value === 'object') {
        if (key === 'comments' && Array.isArray(value)) {
          const substitution = this._writeCommentsToTempFile(value);
          spawnArgs.push(`${key}=${substitution}`);
        } else {
          spawnArgs.push(`${key}=${this._shellEscape(JSON.stringify(value))}`);
        }
      } else if (typeof value === 'string') {
        spawnArgs.push(`${key}=${this._shellEscape(value)}`);
      } else {
        spawnArgs.push(`${key}=${value}`);
      }
    }

    this.logger.debug(`[MCPGitHubAdapter:${this.instanceKey}] OpenClaw MCP command: ${this.mcpBaseCmd} ${spawnArgs.slice(0, 5).join(' ')}... (${spawnArgs.length} args total)`);
    const result = await this._spawnWithTimeout(this.mcpBaseCmd, spawnArgs, timeoutMs, startTime);

    if (result.stderr && result.stderr.length > 0) {
      this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}] stderr: ${result.stderr.substring(0, 500)}`);
    }

    return this._parseMCPJsonResponse(method, result.stdout, spawnArgs);
  }

  async _callMCPViaHermes(method, args, timeoutMs) {
    const startTime = Date.now();
    const prompt = this._buildHermesMcpPrompt(method, args);
    const primaryArgs = this._buildHermesOneShotArgs(prompt);

    this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}] Calling ${this.serverName}.${method} via Hermes native MCP`);

    try {
      const result = await this._spawnWithTimeout(this.mcpBaseCmd, primaryArgs, timeoutMs, startTime, {
        shell: false
      });
      this._logHermesStderr(result.stderr);
      return this._parseMCPJsonResponse(method, result.stdout);
    } catch (error) {
      if (!this._shouldFallbackHermesReadOnly(method, error)) {
        throw error;
      }

      this.logger.warn(
        `[MCPGitHubAdapter:${this.instanceKey}] Hermes oneshot did not return parseable JSON for ${method}; retrying once with chat -q fallback`
      );

      const fallbackArgs = this._buildHermesChatArgs(prompt);
      const result = await this._spawnWithTimeout(this.mcpBaseCmd, fallbackArgs, timeoutMs, Date.now(), {
        shell: false
      });
      this._logHermesStderr(result.stderr);
      return this._parseMCPJsonResponse(method, result.stdout);
    }
  }

  /**
   * Spawn command with timeout
   * @param {string} command - Command to execute
   * @param {Array<string>} args - Command arguments
   * @param {number} timeoutMs - Timeout in milliseconds
   * @param {number} startTime - Start timestamp
   * @returns {Promise<{stdout: string, stderr: string}>}
   * @private
   */
  _spawnWithTimeout(command, args, timeoutMs, startTime, spawnOptions = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        spawnProcess.stdout.off('data', onData);
        spawnProcess.stderr.off('data', onErrorData);
        spawnProcess.off('close', onClose);
        spawnProcess.off('error', onError);
        spawnProcess.kill('SIGTERM');
        this.logger.error(`[MCPGitHubAdapter:${this.instanceKey}] Timeout after ${timeoutMs}ms`);
        reject(new MCPError(
          `MCP command timeout after ${timeoutMs}ms`,
          this.serverName,
          'spawn',
          true
        ));
      }, timeoutMs);

      const spawnProcess = spawn(command, args, {
        maxBuffer: 10 * 1024 * 1024,
        shell: spawnOptions.shell !== undefined ? spawnOptions.shell : true
      });

      let stdout = '';
      let stderr = '';

      const onData = (data) => { stdout += data.toString('utf8'); };
      const onErrorData = (data) => { stderr += data.toString('utf8'); };

      const onClose = (code) => {
        spawnProcess.stdout.off('data', onData);
        spawnProcess.stderr.off('data', onErrorData);
        spawnProcess.off('close', onClose);
        spawnProcess.off('error', onError);
        clearTimeout(timer);

        const elapsed = Date.now() - startTime;
        this.logger.debug(`[MCPGitHubAdapter:${this.instanceKey}] Command completed in ${elapsed}ms, exit code: ${code}`);

        if (code !== 0) {
          reject(new MCPError(
            `MCP command failed with exit code ${code}: ${stderr || stdout}`,
            this.serverName,
            'spawn',
            false,
            { exitCode: code, stderr, stdout }
          ));
        } else {
          resolve({ stdout, stderr });
        }
      };

      const onError = (err) => {
        spawnProcess.stdout.off('data', onData);
        spawnProcess.stderr.off('data', onErrorData);
        spawnProcess.off('close', onClose);
        spawnProcess.off('error', onError);
        clearTimeout(timer);

        this.logger.error(`[MCPGitHubAdapter:${this.instanceKey}] Command failed: ${err.message}`);
        reject(new MCPError(
          `MCP command failed: ${err.message}`,
          this.serverName,
          'spawn',
          false,
          { originalError: err.message }
        ));
      };

      spawnProcess.stdout.on('data', onData);
      spawnProcess.stderr.on('data', onErrorData);
      spawnProcess.on('close', onClose);
      spawnProcess.on('error', onError);
    });
  }

  /**
   * Escape a string for safe use inside double-quoted shell argument
   * Protects against shell break-out from dynamic values (body, comments, etc.)
   * @param {string} str - String to escape
   * @returns {string} Shell-safe quoted string
   * @private
   */
  _shellEscape(str) {
    const escaped = str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`')
      .replace(/\n/g, '\\n');
    return `"${escaped}"`;
  }

  _buildHermesOneShotArgs(prompt) {
    const spawnArgs = [];

    if (this.hermesProfile) {
      spawnArgs.push('--profile', this.hermesProfile);
    }

    spawnArgs.push(
      '--yolo',
      '--ignore-rules',
      '-z',
      prompt
    );

    return spawnArgs;
  }

  _buildHermesChatArgs(prompt) {
    const spawnArgs = [];

    if (this.hermesProfile) {
      spawnArgs.push('--profile', this.hermesProfile);
    }

    spawnArgs.push(
      'chat',
      '-q',
      prompt,
      '-Q',
      '--yolo',
      '--ignore-rules',
      '--source',
      'tool',
      '--max-turns',
      String(this.hermesMaxTurns)
    );

    return spawnArgs;
  }

  _isReadOnlyMcpMethod(method) {
    return new Set([
      'list_pull_requests',
      'get_pull_request_files',
      'get_pull_request_reviews',
      'get_pull_request_comments',
      'list_commits'
    ]).has(method);
  }

  _shouldFallbackHermesReadOnly(method, error) {
    if (!this._isReadOnlyMcpMethod(method)) {
      return false;
    }

    if (!(error instanceof MCPError)) {
      return false;
    }

    return (
      error.operation === 'spawn' ||
      (typeof error.message === 'string' && error.message.includes('no valid JSON found'))
    );
  }

  _logHermesStderr(stderr) {
    const trimmed = (stderr || '').trim();
    if (!trimmed) {
      return;
    }

    if (/^session_id:\s+\S+$/m.test(trimmed) && trimmed.split('\n').every(line => /^session_id:\s+\S+$/.test(line.trim()))) {
      this.logger.debug(`[MCPGitHubAdapter:${this.instanceKey}] Hermes session metadata: ${trimmed.substring(0, 500)}`);
      return;
    }

    this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}] stderr: ${trimmed.substring(0, 500)}`);
  }

  _buildHermesMcpPrompt(method, args) {
    return [
      'You are a machine bridge for a background Node.js daemon.',
      `Use the GitHub MCP tools available in the active Hermes profile. The configured MCP server alias is "${this.serverName}".`,
      `Perform the GitHub operation whose canonical method name is "${method}" using these exact arguments:`,
      JSON.stringify(args, null, 2),
      'Rules:',
      '- Actually call the MCP tool. Do not simulate the result.',
      '- Return ONLY the raw JSON result from the tool call.',
      '- No markdown fences, no prose, no explanation.',
      '- If the tool is unavailable or the call fails, return exactly {"error":"<exact error message>"}'
    ].join('\n');
  }

  _parseMCPJsonResponse(method, stdout, spawnArgs = []) {
    const cleanStdout = (stdout || '')
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleanStdout);
    } catch {
      const jsonStr = this._extractJSON(cleanStdout);
      if (!jsonStr) {
        this.logger.error(`[MCPGitHubAdapter:${this.instanceKey}] Failed to parse output for ${method}: ${stdout}`);
        throw new MCPError(
          'MCP response parse failed: no valid JSON found',
          this.serverName,
          method,
          false,
          { stdout }
        );
      }
      parsed = JSON.parse(jsonStr);
    }

    const tempFileMatch = spawnArgs.find(arg => arg.includes('$(cat /tmp/comments-'));
    if (tempFileMatch) {
      const tempFile = tempFileMatch.match(/\$\(cat\s+(\/tmp\/comments-[^)]+)\)/)?.[1];
      if (tempFile && fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
        this.logger.debug(`[MCPGitHubAdapter:${this.instanceKey}] Cleaned up temp file: ${tempFile}`);
      }
    }

    if (parsed && parsed.error) {
      const errorMsg = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error);
      this.logger.error(`[MCPGitHubAdapter:${this.instanceKey}] Error for ${method}: ${errorMsg}`);
      throw new MCPError(
        `MCP error: ${errorMsg}`,
        this.serverName,
        method,
        true,
        { originalError: parsed.error }
      );
    }

    return parsed;
  }

  _extractJSON(text) {
    if (!text) return null;

    for (let i = 0; i < text.length; i++) {
      if (text[i] !== '{' && text[i] !== '[') {
        continue;
      }

      const openChar = text[i];
      const closeChar = openChar === '{' ? '}' : ']';
      let depth = 1;
      let inString = false;
      let escapeNext = false;

      for (let j = i + 1; j < text.length; j++) {
        const char = text[j];

        if (escapeNext) {
          escapeNext = false;
          continue;
        }

        if (char === '\\') {
          escapeNext = true;
          continue;
        }

        if (char === '"') {
          inString = !inString;
          continue;
        }

        if (!inString) {
          if (char === openChar) depth++;
          if (char === closeChar) {
            depth--;
            if (depth === 0) {
              const candidate = text.substring(i, j + 1);
              try {
                JSON.parse(candidate);
                return candidate;
              } catch {
                break;
              }
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Write comments to temporary file and return the command substitution string
   * @param {Array<Object>} comments - Array of comment objects
   * @returns {string} Command substitution string
   * @private
   */
  _writeCommentsToTempFile(comments) {
    const tmpFile = `/tmp/comments-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.json`;
    fs.writeFileSync(tmpFile, JSON.stringify(comments), 'utf8');
    this.tempFiles.push(tmpFile);
    this.logger.debug(`[MCPGitHubAdapter:${this.instanceKey}] Wrote comments to temp file: ${tmpFile}`);
    return `"$(cat ${tmpFile})"`;
  }

  // ===== IGitHubService Interface Implementation =====

  /**
   * Get all open pull requests for a repository
   * @param {string} repo - Repository name
   * @returns {Promise<Array<PullRequest>>}
   */
  async getOpenPRs(repo) {
    this.logger.debug(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Fetching open PRs`);

    const rawPRs = await this._callMCP('list_pull_requests', {
      owner: this.owner,
      repo: repo,
      state: 'open',
      per_page: 100,
      page: 1
    });

    this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Found ${rawPRs.length} open PRs`);

    return rawPRs.map(pr => ({
      id: pr.id,
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      author: pr.user?.login || 'unknown',
      createdAt: new Date(pr.created_at),
      description: pr.body || 'No description provided',
      baseBranch: pr.base?.ref,
      headBranch: pr.head?.ref,
      headSha: pr.head?.sha,
      owner: this.owner,
      repo: repo
    }));
  }

  /**
   * Get PR details including changed files and metadata
   * @param {string} repo - Repository name
   * @param {number} prNumber - Pull request number
   * @returns {Promise<PRDetails>}
   */
  async getPRDetails(repo, prNumber) {
    this.logger.debug(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Fetching PR #${prNumber} details`);

    let rawFiles;
    try {
      rawFiles = await this._callMCP('get_pull_request_files', {
        owner: this.owner,
        repo: repo,
        pull_number: prNumber
      });
    } catch (error) {
      if (this._isNullUrlValidationError(error)) {
        this.logger.error(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] PR #${prNumber} contains files with null URLs`);
        throw new MCPError(
          `PR #${prNumber} cannot be reviewed: contains unsupported file types`,
          this.serverName,
          'get_pull_request_files',
          false
        );
      }
      throw error;
    }

    const files = this._sanitizeFileData(rawFiles);
    const filteredFiles = files.filter(f => !this._isTestFile(f.filename));
    const skippedCount = files.length - filteredFiles.length;

    if (skippedCount > 0) {
      this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Filtered out ${skippedCount} test file(s) from PR #${prNumber}`);
    }

    return {
      filesChanged: filteredFiles.length,
      files: filteredFiles.map(f => ({
        filename: f.filename,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
        status: f.status
      })),
      totalChanges: filteredFiles.reduce((sum, f) => sum + f.changes, 0),
      totalFilesChanged: files.length
    };
  }

  /**
   * Create a review with per-line comments
   * @param {string} repo - Repository name
   * @param {PullRequest} pr - Pull request object
   * @param {ReviewResult} reviewResult - Review data
   * @returns {Promise<Review>}
   */
  async createReviewWithComments(repo, pr, reviewResult) {
    this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Creating review for PR #${pr.number}`);

    // Check if agent called create_pull_request_review directly
    if (reviewResult.agentCalledToolDirectly) {
      this.logger.warn(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Agent called create_pull_request_review directly, skipping duplicate submission`);
      return {
        id: 'agent-submitted',
        html_url: this._extractReviewUrlFromOutput(reviewResult.agentRawOutput) || `https://github.com/${this.owner}/${repo}/pull/${pr.number}`,
        submitted_at: new Date().toISOString(),
        submitted_by: 'agent',
        event: 'COMMENT',
        body: reviewResult.summary || 'Review submitted by OpenClaw agent',
        comments: reviewResult.comments || []
      };
    }

    // Validate and sanitize comments
    const { validComments, stats } = this._validateAndSanitizeComments(reviewResult.comments, repo, pr.number);

    if (validComments.length === 0 && stats.total > 0) {
      this.logger.warn(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] All comments were filtered out, posting review with summary only`);
    }

    // Determine event: explicit event from caller takes priority, then severity-based fallback
    let event = this._normalizeEvent(reviewResult.event);

    if (!event) {
      const hasHigh = stats.severityBreakdown.HIGH > 0;
      event = hasHigh ? 'REQUEST_CHANGES' : 'COMMENT';

      if (hasHigh) {
        this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Event set to REQUEST_CHANGES: ${stats.severityBreakdown.HIGH} HIGH severity comment(s) found`);
      } else {
        this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Event set to COMMENT: no HIGH severity comments`);
      }
    } else {
      this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Event from caller: ${event}`);
    }

    // Update reviewResult with valid comments for further processing
    reviewResult.comments = validComments;

    // Fetch PR files with patches to calculate positions
    // GitHub API requires position for review comments in /reviews endpoint
    let positionMaps = new Map();
    try {
      this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Fetching PR files with patches for position calculation`);
      const rawFiles = await this._callMCP('get_pull_request_files', {
        owner: this.owner,
        repo: repo,
        pull_number: pr.number
      });

      // Build position maps for each file
      for (const file of rawFiles || []) {
        if (file.filename && file.patch) {
          const positionMap = this._buildPositionMap(file.patch);
          positionMaps.set(file.filename, positionMap);
          this.logger.debug(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Built position map for ${file.filename} (${positionMap.size} lines)`);
        }
      }
      this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Built position maps for ${positionMaps.size} file(s)`);
    } catch (error) {
      this.logger.error(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Failed to fetch PR files for position calculation: ${error.message}`);
      this.logger.warn(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Comments will be omitted without position mapping`);
    }

    // Build comments with positions
    const comments = [];
    const skippedComments = [];

    for (const c of reviewResult.comments) {
      // Get position from the diff
      // For /reviews endpoint, GitHub requires 'position' (not line+side)
      const positionMap = positionMaps.get(c.file);
      const position = positionMap ? positionMap.get(c.line) : null;

      if (position === null || position === undefined) {
        this.logger.warn(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] No position found for ${c.file}:${c.line}, will append to review body`);
        skippedComments.push(c);
        continue;
      }

      this.logger.debug(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Comment ${c.file}:${c.line} -> position: ${position}`);

      // Build comment body
      let commentBody = `[${c.severity}] ${c.message}`;

      // If there's suggested code, append it with markdown code block
      if (c.suggestedCode) {
        const language = this._detectLanguage(c.file);
        commentBody += `\n\nFix:\n\`\`\`${language}\n${c.suggestedCode}\n\`\`\``;
      }

      const comment = {
        path: c.file,
        position: position,
        body: commentBody
      };
      comments.push(comment);
      this.logger.debug(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Added comment for ${c.file}:${c.line}`);
    }

    if (skippedComments.length > 0) {
      this.logger.warn(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] ${skippedComments.length} comment(s) could not be mapped to diff positions`);
    }

    // Count comments and log summary
    this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] PR headSha: ${pr.headSha}, total comments to submit: ${comments.length}`);
    if (comments.length > 0) {
      const commentSummary = comments.map(c => `${c.path}:${c.position}`).join(', ');
      this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Comments: ${commentSummary}`);
    }

    // Create review with all comments in one batch (no batching)
    // Append skipped comments to review body as fallback so feedback is not lost
    let reviewBody = reviewResult.summary || reviewResult.body || 'Review completed';

    if (skippedComments.length > 0) {
      const fallbackSection = skippedComments.map(c => {
        let text = `**[${c.severity}] \`${c.file}:${c.line}\`** — ${c.message}`;
        if (c.suggestedCode) {
          const language = this._detectLanguage(c.file);
          text += `\n\n\`\`\`${language}\n${c.suggestedCode}\n\`\`\``;
        }
        return text;
      }).join('\n\n---\n\n');

      reviewBody += `\n\n---\n\n> **Note:** ${skippedComments.length} comment(s) could not be placed as inline review (line not in diff). Feedback appended below:\n\n${fallbackSection}`;
    }

    const reviewArgs = {
      owner: this.owner,
      repo: repo,
      pull_number: pr.number,
      body: reviewBody,
      event: event,
      commit_id: pr.headSha,
      comments: comments
    };

    this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Creating review with ${comments.length} inline comment(s)${skippedComments.length > 0 ? ` and ${skippedComments.length} in body` : ''}`);
    if (comments.length > 0) {
      this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] First comment JSON: ${JSON.stringify(comments[0])}`);
    }

    let result;
    try {
      result = await this._callMCP('create_pull_request_review', reviewArgs);
    } catch (error) {
      if (error.message && error.message.includes('Can not request changes on your own pull request')) {
        this.logger.warn(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Cannot request changes on own PR, falling back to COMMENT`);
        const fallbackArgs = { ...reviewArgs, event: 'COMMENT' };
        result = await this._callMCP('create_pull_request_review', fallbackArgs);
      } else {
        throw error;
      }
    }

    if (!result || !result.id) {
      throw new MCPError(
        `Review creation failed: ${JSON.stringify(result)}`,
        this.serverName,
        'create_pull_request_review',
        false
      );
    }

    this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Review created: ID=${result.id}`);
    this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] ✅ Created ${comments.length} inline comment(s), ${skippedComments.length} appended to body`);
    this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] ⚠️  Check GitHub PR: https://github.com/${this.owner}/${repo}/pull/${pr.number}/files`);

    return result;
  }

  /**
   * Approve a pull request
   * @param {string} repo - Repository name
   * @param {number} prNumber - Pull request number
   * @param {string} body - Approval message
   * @returns {Promise<void>}
   */
  async approvePR(repo, prNumber, body = 'Approved via OpenClaw PR Monitor') {
    this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Approving PR #${prNumber}`);
    return await this._callMCP('create_pull_request_review', {
      owner: this.owner,
      repo: repo,
      pull_number: prNumber,
      event: 'APPROVE',
      body: body
    });
  }

  /**
   * Request changes on a pull request
   * @param {string} repo - Repository name
   * @param {number} prNumber - Pull request number
   * @param {string} body - Request changes message
   * @returns {Promise<void>}
   */
  async requestChanges(repo, prNumber, body) {
    this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Requesting changes for PR #${prNumber}`);
    return await this._callMCP('create_pull_request_review', {
      owner: this.owner,
      repo: repo,
      pull_number: prNumber,
      event: 'REQUEST_CHANGES',
      body: body
    });
  }

  /**
   * Close a pull request
   * @param {string} repo - Repository name
   * @param {number} prNumber - Pull request number
   * @returns {Promise<void>}
   */
  async closePR(repo, prNumber) {
    this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Closing PR #${prNumber}`);
    return await this._callMCP('update_pull_request', {
      owner: this.owner,
      repo: repo,
      pull_number: prNumber,
      state: 'closed'
    });
  }

  /**
   * Get all reviews for a pull request
   * @param {string} repo - Repository name
   * @param {number} prNumber - Pull request number
   * @returns {Promise<Array<Review>>}
   */
  async getPRReviews(repo, prNumber) {
    this.logger.debug(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Fetching reviews for PR #${prNumber}`);

    try {
      const rawReviews = await this._callMCP('get_pull_request_reviews', {
        owner: this.owner,
        repo: repo,
        pull_number: prNumber
      });

      this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Found ${rawReviews.length} reviews for PR #${prNumber}`);

      return rawReviews.map(r => ({
        id: r.id,
        state: r.state,
        body: r.body,
        user: r.user?.login,
        submitted_at: r.submitted_at,
        head_sha: r.commit_id,
        comments: r.comments || []
      }));
    } catch (err) {
      if (err.message && err.message.includes('Unknown tool')) {
        this.logger.warn(`[MCPGitHubAdapter:${this.instanceKey}] get_pull_request_reviews tool not available`);
      } else {
        this.logger.error(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Failed to fetch reviews for PR #${prNumber}: ${err.message}`);
      }
      return [];
    }
  }

  /**
   * Get all comments for a pull request
   * @param {string} repo - Repository name
   * @param {number} prNumber - Pull request number
   * @returns {Promise<Array<Comment>>}
   */
  async getPRComments(repo, prNumber) {
    this.logger.debug(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Fetching comments for PR #${prNumber}`);

    try {
      const rawComments = await this._callMCP('get_pull_request_comments', {
        owner: this.owner,
        repo: repo,
        pull_number: prNumber
      });

      this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Found ${rawComments.length} comments for PR #${prNumber}`);

      return rawComments.map(c => ({
        id: c.id,
        path: c.path,
        line: c.line || c.original_line,
        body: c.body,
        user: c.user?.login,
        created_at: c.created_at,
        updated_at: c.updated_at
      }));
    } catch (err) {
      if (err.message && err.message.includes('Unknown tool')) {
        this.logger.warn(`[MCPGitHubAdapter:${this.instanceKey}] get_pull_request_comments tool not available`);
      } else {
        this.logger.error(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Failed to fetch comments for PR #${prNumber}: ${err.message}`);
      }
      return [];
    }
  }

  /**
   * Get recent commits for a pull request
   * @param {string} repo - Repository name
   * @param {number} prNumber - Pull request number
   * @param {number} [limit=3] - Maximum commits to return (most recent first)
   * @returns {Promise<Array<Commit>>}
   */
  async getPRCommits(repo, prNumber, limit = 3) {
    this.logger.debug(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Fetching commits for PR #${prNumber}`);

    try {
      const rawCommits = await this._callMCP('list_commits', {
        owner: this.owner,
        repo: repo,
        sha: `refs/pull/${prNumber}/head`,
        per_page: limit
      });

      const commits = (rawCommits || [])
        .slice(0, limit)
        .map(c => ({
          sha: c.sha?.substring(0, 7),
          message: c.commit?.message?.split('\n')[0] || c.commit?.message || '',
          author: c.commit?.author?.name || c.author?.login || 'unknown',
          date: c.commit?.author?.date || c.commit?.committer?.date || ''
        }));

      this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Found ${commits.length} recent commits for PR #${prNumber}`);
      return commits;
    } catch (err) {
      this.logger.error(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Failed to fetch commits for PR #${prNumber}: ${err.message}`);
      return [];
    }
  }

  /**
   * Clean up resources
   * @returns {void}
   */
  cleanup() {
    for (const tempFile of this.tempFiles) {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
          this.logger.debug(`[MCPGitHubAdapter:${this.instanceKey}] Cleaned up temp file: ${tempFile}`);
        }
      } catch (err) {
        this.logger.warn(`[MCPGitHubAdapter:${this.instanceKey}] Failed to clean up temp file ${tempFile}: ${err.message}`);
      }
    }
    this.tempFiles = [];
    this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}] Adapter cleaned up`);
  }

  // ===== Private Helper Methods =====

  /**
   * Check if an error is the specific MCP validation error for null URLs
   * @param {Error} error - Error to check
   * @returns {boolean}
   * @private
   */
  _isNullUrlValidationError(error) {
    const errorStr = error.message || JSON.stringify(error);
    return errorStr.includes('blob_url') &&
           errorStr.includes('raw_url') &&
           errorStr.includes('Expected string, received null') &&
           errorStr.includes('MCP error -32603');
  }

  /**
   * Sanitize file data to handle null/undefined values
   * @param {Array} files - Files array from MCP
   * @returns {Array} Sanitized files
   * @private
   */
  _sanitizeFileData(files) {
    if (!Array.isArray(files)) return [];

    return files.filter(f => {
      if (!f.filename) return false;
      if (f.blob_url === null || f.raw_url === null) {
        this.logger.warn(`[MCPGitHubAdapter:${this.instanceKey}] Skipping file ${f.filename} due to null URL`);
        return false;
      }
      return true;
    }).map(f => ({
      ...f,
      filename: f.filename || '',
      blob_url: f.blob_url || '',
      raw_url: f.raw_url || '',
      additions: f.additions || 0,
      deletions: f.deletions || 0,
      changes: f.changes || 0,
      status: f.status || 'modified',
      patch: f.patch || ''
    }));
  }

  /**
   * Check if a file is a test file
   * @param {string} filename - File path
   * @returns {boolean}
   * @private
   */
  _isTestFile(filename) {
    const testPatterns = [
      '_test.go', '_test.js', '_test.ts', '.test.', '/e2e_test/', '/e2e/',
      '/__tests__/', '/test/', '/tests/', '/spec/', '_spec.', '.spec.',
      'swagger.json', 'swagger.yaml', 'swagger.yml',
      'openapi.json', 'openapi.yaml', 'openapi.yml'
    ];
    return testPatterns.some(pattern => filename.includes(pattern));
  }

  /**
   * Build position map for a file's diff
   * @param {string} patch - Git diff patch
   * @returns {Map<number, number>} Line to position mapping
   * @private
   */
  _buildPositionMap(patch) {
    const positionMap = new Map();

    if (!patch) return positionMap;

    const hunkRegex = /@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/g;
    let match;
    let currentPosition = 1;

    while ((match = hunkRegex.exec(patch)) !== null) {
      const _oldStart = parseInt(match[1], 10);
      const newStart = parseInt(match[3], 10);
      const _newCount = match[4] ? parseInt(match[4], 10) : 1;

      const hunkEnd = match.index + match[0].length;
      const nextHunkStart = patch.indexOf('@@', hunkEnd);

      const hunkContent = nextHunkStart === -1
        ? patch.substring(hunkEnd)
        : patch.substring(hunkEnd, nextHunkStart);

      const lines = hunkContent.split('\n').slice(1);
      let currentLine = newStart;

      for (const line of lines) {
        if (line.startsWith('+') && !line.startsWith('++')) {
          positionMap.set(currentLine, currentPosition);
          currentLine++;
          currentPosition++;
        } else if (line.startsWith('-') && !line.startsWith('--')) {
          currentPosition++;
        } else if (line.startsWith(' ')) {
          positionMap.set(currentLine, currentPosition);
          currentLine++;
          currentPosition++;
        }
      }
    }

    return positionMap;
  }

  /**
   * Detect programming language from file extension
   * @param {string} filename - File path
   * @returns {string} Language name
   * @private
   */
  _detectLanguage(filename) {
    const extMap = {
      '.js': 'javascript',
      '.ts': 'typescript',
      '.jsx': 'javascript',
      '.tsx': 'typescript',
      '.go': 'go',
      '.py': 'python',
      '.rb': 'ruby',
      '.php': 'php',
      '.java': 'java',
      '.kt': 'kotlin',
      '.swift': 'swift',
      '.cpp': 'cpp',
      '.c': 'c',
      '.cs': 'csharp',
      '.scala': 'scala',
      '.rs': 'rust',
      '.sh': 'bash',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.json': 'json',
      '.xml': 'xml',
      '.html': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.sass': 'sass',
      '.less': 'less',
      '.md': 'markdown',
      '.sql': 'sql',
      '.dockerfile': 'dockerfile'
    };

    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    return extMap[ext] || '';
  }

  /**
   * Normalize and validate severity value
   * @param {*} severity - Severity value to normalize
   * @param {number} commentIndex - Comment index for logging
   * @returns {string} Normalized severity
   * @private
   */
  _normalizeSeverity(severity, commentIndex = 0) {
    let normalized = 'LOW';

    if (severity === undefined || severity === null) {
      this.logger.warn(`[MCPGitHubAdapter:${this.instanceKey}] Comment #${commentIndex}: severity is undefined/null, defaulting to LOW`);
      return normalized;
    }

    if (typeof severity !== 'string') {
      this.logger.warn(`[MCPGitHubAdapter:${this.instanceKey}] Comment #${commentIndex}: severity is not a string (${typeof severity}), defaulting to LOW`);
      return normalized;
    }

    normalized = severity.trim().toUpperCase();

    const allowedValues = ['LOW', 'MEDIUM', 'HIGH'];
    if (!allowedValues.includes(normalized)) {
      this.logger.warn(`[MCPGitHubAdapter:${this.instanceKey}] Comment #${commentIndex}: invalid severity "${severity}", defaulting to LOW`);
      normalized = 'LOW';
    }

    return normalized;
  }

  /**
   * Validate and sanitize comments array
   * @param {Array} comments - Comments to validate
   * @param {string} repo - Repository name
   * @param {number} prNumber - PR number
   * @returns {Object} Validation result
   * @private
   */
  _validateAndSanitizeComments(comments, repo, _prNumber) {
    const stats = {
      total: 0,
      valid: 0,
      filtered: 0,
      severityBreakdown: { LOW: 0, MEDIUM: 0, HIGH: 0 }
    };

    if (!Array.isArray(comments)) {
      this.logger.error(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Comments is not an array: ${typeof comments}`);
      return { validComments: [], stats };
    }

    stats.total = comments.length;

    const validComments = comments
      .map((comment, index) => {
        const commentCopy = { ...comment };
        commentCopy.severity = this._normalizeSeverity(comment.severity, index);
        return commentCopy;
      })
      .filter((comment) => {
        if (!comment.file || typeof comment.file !== 'string') {
          this.logger.warn(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Comment: missing or invalid 'file' field, filtering out`);
          stats.filtered++;
          return false;
        }

        if (!comment.line || typeof comment.line !== 'number') {
          this.logger.warn(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Comment: missing or invalid 'line' field, filtering out`);
          stats.filtered++;
          return false;
        }

        if (!comment.message || typeof comment.message !== 'string') {
          this.logger.warn(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Comment: missing or invalid 'message' field, filtering out`);
          stats.filtered++;
          return false;
        }

        stats.severityBreakdown[comment.severity]++;
        stats.valid++;

        return true;
      });

    this.logger.info(`[MCPGitHubAdapter:${this.instanceKey}/${repo}] Comment validation: ${stats.valid}/${stats.total} valid, ${stats.filtered} filtered`);

    return { validComments, stats };
  }

  /**
   * Normalize and validate review event value
   * @param {*} event - Event value to normalize
   * @returns {string|null} Normalized event or null if invalid/absent
   * @private
   */
  _normalizeEvent(event) {
    if (!event || typeof event !== 'string') return null;
    const v = event.trim().toUpperCase();
    return ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(v) ? v : null;
  }

  /**
   * Extract review URL from agent output
   * @param {string} output - Agent output
   * @returns {string|null} Extracted URL or null
   * @private
   */
  _extractReviewUrlFromOutput(output) {
    if (!output) return null;
    const urlMatch = output.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+#pullrequestreview-\d+/);
    return urlMatch ? urlMatch[0] : null;
  }
}

module.exports = MCPGitHubAdapter;
