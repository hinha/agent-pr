const { spawn } = require('child_process');
const logger = require('../utils/logger');
const TimeoutManager = require('../utils/timeoutManager');
const config = require('../config/yamlConfig');

/**
 * MCP GitHub Service - Factory pattern for per-instance services
 * Each instance (GitHub organization) gets its own MCP service with its own serverName
 */
class MCPGitHubService {
  constructor(instanceConfig) {
    this.mcpBaseCmd = 'mcporter';
    this.serverName = instanceConfig.mcpName;
    this.owner = instanceConfig.owner;
    this.instanceKey = instanceConfig.key;
    this.timeoutManager = new TimeoutManager();
    logger.info(`[MCP:${this.instanceKey}] Initialized with server=${this.serverName}, owner=${this.owner}`);
  }

  /**
   * Custom exponential backoff retry logic
   */
  async retryOperation(operation, retries, minTimeout, factor) {
    let attempt = 0;
    while (attempt < retries) {
      try {
        return await operation();
      } catch (err) {
        attempt++;
        if (attempt >= retries) throw err;
        const delay = minTimeout * Math.pow(factor, attempt - 1);
        logger.warn(`[MCP:${this.instanceKey}] Attempt ${attempt} failed: ${err.message}, retrying in ${delay}ms`);
        await new Promise(resolve => {
          this.timeoutManager.setTimeout(resolve, delay);
        });
      }
    }
  }

  /**
   * Execute MCP tool call using spawn
   */
  async callMCP(method, args = {}) {
    return this.retryOperation(async () => {
      const timeoutMs = 60000;
      const startTime = Date.now();
      logger.info(`[MCP:${this.instanceKey}] Calling ${this.serverName}.${method}`);

      const spawnArgs = ['call', `${this.serverName}.${method}`, '--output', 'json'];

      for (const [key, value] of Object.entries(args)) {
        if (value === null || value === undefined) {
          spawnArgs.push(`${key}=null`);
        } else if (typeof value === 'object') {
          spawnArgs.push(`${key}:${JSON.stringify(value)}`);
        } else if (typeof value === 'string') {
          spawnArgs.push(`${key}=${value}`);
        } else {
          spawnArgs.push(`${key}=${value}`);
        }
      }

      // Log the exact command being sent (with sensitive data redacted)
      logger.debug(`[MCP:${this.instanceKey}] mcporter command: ${this.mcpBaseCmd} ${spawnArgs.slice(0, 5).join(' ')}... (${spawnArgs.length} args total)`);

      const result = await this.spawnWithTimeout(this.mcpBaseCmd, spawnArgs, timeoutMs, startTime);

      // Log stderr for debugging
      if (result.stderr && result.stderr.length > 0) {
        logger.info(`[MCP:${this.instanceKey}] stderr: ${result.stderr.substring(0, 500)}`);
      }

      try {
        const parsed = JSON.parse(result.stdout);

        if (parsed.error) {
          const errorMsg = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error);
          logger.error(`[MCP:${this.instanceKey}] Error for ${method}: ${errorMsg}`);
          throw new Error(`MCP error: ${errorMsg}`);
        }

        return parsed;
      } catch (parseErr) {
        logger.error(`[MCP:${this.instanceKey}] Failed to parse output for ${method}: ${result.stdout}`);
        throw new Error(`MCP response parse failed: ${parseErr.message}`);
      }
    }, config.retries.mcpRetries, 2000, config.retries.backoffFactor);
  }

  /**
   * Spawn command with timeout
   */
  spawnWithTimeout(command, args, timeoutMs, startTime) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        spawnProcess.stdout.off('data', onData);
        spawnProcess.stderr.off('data', onErrorData);
        spawnProcess.off('close', onClose);
        spawnProcess.off('error', onError);
        spawnProcess.kill('SIGTERM');
        const elapsed = Date.now() - startTime;
        logger.error(`[MCP:${this.instanceKey}] Timeout after ${timeoutMs}ms`);
        reject(new Error(`MCP command timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const spawnProcess = spawn(command, args, {
        maxBuffer: 10 * 1024 * 1024,
        shell: false
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
        logger.debug(`[MCP:${this.instanceKey}] Command completed in ${elapsed}ms, exit code: ${code}`);

        if (code !== 0) {
          reject(new Error(`MCP command failed with exit code ${code}: ${stderr || stdout}`));
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

        logger.error(`[MCP:${this.instanceKey}] Command failed: ${err.message}`);
        reject(err);
      };

      spawnProcess.stdout.on('data', onData);
      spawnProcess.stderr.on('data', onErrorData);
      spawnProcess.on('close', onClose);
      spawnProcess.on('error', onError);
    });
  }

  /**
   * Fetch all open pull requests for a repository
   */
  async getOpenPRs(repo) {
    logger.debug(`[MCP:${this.instanceKey}/${repo}] Fetching open PRs`);

    const rawPRs = await this.callMCP('list_pull_requests', {
      owner: this.owner,
      repo: repo,
      state: 'open',
      per_page: 100,
      page: 1
    });

    logger.info(`[MCP:${this.instanceKey}/${repo}] Found ${rawPRs.length} open PRs`);

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
   * Check if a file is a test file
   */
  isTestFile(filename) {
    const testPatterns = [
      '_test.go', '_test.js', '_test.ts', '.test.', '/e2e_test/', '/e2e/',
      '/__tests__/', '/test/', '/tests/', '/spec/', '_spec.', '.spec.',
      'swagger.json', 'swagger.yaml', 'swagger.yml',
      'openapi.json', 'openapi.yaml', 'openapi.yml'
    ];
    return testPatterns.some(pattern => filename.includes(pattern));
  }

  /**
   * Sanitize file data to handle null/undefined values
   */
  sanitizeFileData(files) {
    if (!Array.isArray(files)) return [];

    return files.filter(f => {
      if (!f.filename) return false;
      if (f.blob_url === null || f.raw_url === null) {
        logger.warn(`[MCP:${this.instanceKey}] Skipping file ${f.filename} due to null URL`);
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
      patch: f.patch || '' // Preserve diff patch for position calculation
    }));
  }

  /**
   * Build position map for a file's diff
   * Maps line numbers to diff positions for validation
   * Used to verify that a line number exists in the diff before commenting
   * Note: GitHub API now uses 'line' + 'side' instead of 'position', but we still
   * need to validate that the line exists in the diff
   */
  buildPositionMap(patch) {
    const positionMap = new Map();

    if (!patch) return positionMap;

    // Parse diff hunks
    const hunkRegex = /@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/g;
    let match;
    let currentPosition = 1;

    while ((match = hunkRegex.exec(patch)) !== null) {
      const oldStart = parseInt(match[1], 10);
      const newStart = parseInt(match[3], 10);
      const newCount = match[4] ? parseInt(match[4], 10) : 1;

      logger.debug(`[buildPositionMap] Processing hunk: @@ -${oldStart},${match[2] || 0} +${newStart},${newCount} @@, current position: ${currentPosition}`);

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
          if (currentLine <= 5 || currentLine === 91) {
            logger.info(`[buildPositionMap] Mapping line ${currentLine} -> position ${currentPosition} (added): ${line.substring(0, 30)}`);
          }
          currentLine++;
          currentPosition++;
        } else if (line.startsWith('-') && !line.startsWith('--')) {
          currentPosition++;
        } else if (line.startsWith(' ')) {
          positionMap.set(currentLine, currentPosition);
          if (currentLine <= 5) {
            logger.info(`[buildPositionMap] Mapping line ${currentLine} -> position ${currentPosition} (context)`);
          }
          currentLine++;
          currentPosition++;
        }
      }

      logger.debug(`[buildPositionMap] Finished hunk, advanced to line ${currentLine}, position ${currentPosition}`);
    }

    // Log some sample mappings for debugging
    logger.info(`[buildPositionMap] Built map with ${positionMap.size} entries`);
    logger.info(`[buildPositionMap] Sample mappings: line 1 -> ${positionMap.get(1)}, line 91 -> ${positionMap.get(91)}, line 215 -> ${positionMap.get(215)}, line 385 -> ${positionMap.get(385)}`);

    return positionMap;
  }

  /**
   * Check if an error is the specific MCP validation error for null URLs
   */
  isNullUrlValidationError(error) {
    const errorStr = error.message || JSON.stringify(error);
    return errorStr.includes('blob_url') &&
           errorStr.includes('raw_url') &&
           errorStr.includes('Expected string, received null') &&
           errorStr.includes('MCP error -32603');
  }

  /**
   * Get PR changed files and diff metadata
   */
  async getPRDetails(repo, prNumber) {
    logger.debug(`[MCP:${this.instanceKey}/${repo}] Fetching PR #${prNumber} details`);

    let rawFiles;
    try {
      rawFiles = await this.callMCP('get_pull_request_files', {
        owner: this.owner,
        repo: repo,
        pull_number: prNumber
      });
    } catch (error) {
      if (this.isNullUrlValidationError(error)) {
        logger.error(`[MCP:${this.instanceKey}/${repo}] PR #${prNumber} contains files with null URLs`);
        throw new Error(`PR #${prNumber} cannot be reviewed: contains unsupported file types`);
      }
      throw error;
    }

    const files = this.sanitizeFileData(rawFiles);
    const sanitizedSkipped = rawFiles.length - files.length;
    if (sanitizedSkipped > 0) {
      logger.warn(`[MCP:${this.instanceKey}/${repo}] Sanitized ${sanitizedSkipped} file(s) from PR #${prNumber}`);
    }

    const filteredFiles = files.filter(f => !this.isTestFile(f.filename));
    const skippedCount = files.length - filteredFiles.length;

    if (skippedCount > 0) {
      logger.info(`[MCP:${this.instanceKey}/${repo}] Filtered out ${skippedCount} test file(s) from PR #${prNumber}`);
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
   * Fetch all reviews for a PR
   */
  async getPRReviews(repo, prNumber) {
    logger.debug(`[MCP:${this.instanceKey}/${repo}] Fetching reviews for PR #${prNumber}`);

    try {
      const rawReviews = await this.callMCP('get_pull_request_reviews', {
        owner: this.owner,
        repo: repo,
        pull_number: prNumber
      });

      logger.info(`[MCP:${this.instanceKey}/${repo}] Found ${rawReviews.length} reviews for PR #${prNumber}`);

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
      if (err.message.includes('Unknown tool')) {
        logger.warn(`[MCP:${this.instanceKey}] get_pull_request_reviews tool not available - outdated review feature disabled for this instance`);
      } else {
        logger.error(`[MCP:${this.instanceKey}/${repo}] Failed to fetch reviews for PR #${prNumber}: ${err.message}`);
      }
      return [];
    }
  }

  /**
   * Fetch all issue comments (general discussion) for a PR
   */
  async getPRComments(repo, prNumber) {
    logger.debug(`[MCP:${this.instanceKey}/${repo}] Fetching comments for PR #${prNumber}`);

    try {
      const rawComments = await this.callMCP('get_pull_request_comments', {
        owner: this.owner,
        repo: repo,
        pull_number: prNumber
      });

      logger.info(`[MCP:${this.instanceKey}/${repo}] Found ${rawComments.length} comments for PR #${prNumber}`);

      return rawComments.map(c => ({
        id: c.id,
        body: c.body,
        user: c.user?.login,
        created_at: c.created_at,
        updated_at: c.updated_at
      }));
    } catch (err) {
      if (err.message.includes('Unknown tool')) {
        logger.warn(`[MCP:${this.instanceKey}] get_pull_request_comments tool not available - outdated review feature disabled for this instance`);
      } else {
        logger.error(`[MCP:${this.instanceKey}/${repo}] Failed to fetch comments for PR #${prNumber}: ${err.message}`);
      }
      return [];
    }
  }

  /**
   * Normalize and validate severity value
   * Handles undefined, null, whitespace, and case variations
   */
  normalizeSeverity(severity, commentIndex = 0) {
    let normalized = 'LOW'; // Default

    if (severity === undefined || severity === null) {
      logger.warn(`[MCP:${this.instanceKey}] Comment #${commentIndex}: severity is undefined/null, defaulting to LOW`);
      return normalized;
    }

    if (typeof severity !== 'string') {
      logger.warn(`[MCP:${this.instanceKey}] Comment #${commentIndex}: severity is not a string (${typeof severity}), defaulting to LOW`);
      return normalized;
    }

    // Trim whitespace and convert to uppercase
    normalized = severity.trim().toUpperCase();

    // Validate against allowed values
    const allowedValues = ['LOW', 'MEDIUM', 'HIGH'];
    if (!allowedValues.includes(normalized)) {
      logger.warn(`[MCP:${this.instanceKey}] Comment #${commentIndex}: invalid severity "${severity}", defaulting to LOW`);
      normalized = 'LOW';
    }

    return normalized;
  }

  /**
   * Validate and sanitize comments array
   * Returns object with valid comments and statistics
   */
  validateAndSanitizeComments(comments, repo, prNumber) {
    const stats = {
      total: 0,
      valid: 0,
      filtered: 0,
      severityBreakdown: { LOW: 0, MEDIUM: 0, HIGH: 0 }
    };

    if (!Array.isArray(comments)) {
      logger.error(`[MCP:${this.instanceKey}/${repo}] Comments is not an array: ${typeof comments}`);
      return { validComments: [], stats };
    }

    stats.total = comments.length;

    const validComments = comments
      .map((comment, index) => {
        // Create a copy to avoid in-place mutation
        const commentCopy = { ...comment };
        // Normalize severity on the copy
        commentCopy.severity = this.normalizeSeverity(comment.severity, index);
        return commentCopy;
      })
      .filter((comment, index) => {
        // Validate required fields (using index from original array would be lost, but we use current index)
        if (!comment.file || typeof comment.file !== 'string') {
          logger.warn(`[MCP:${this.instanceKey}/${repo}] Comment: missing or invalid 'file' field, filtering out`);
          stats.filtered++;
          return false;
        }

        if (!comment.line || typeof comment.line !== 'number') {
          logger.warn(`[MCP:${this.instanceKey}/${repo}] Comment: missing or invalid 'line' field, filtering out`);
          stats.filtered++;
          return false;
        }

        if (!comment.message || typeof comment.message !== 'string') {
          logger.warn(`[MCP:${this.instanceKey}/${repo}] Comment: missing or invalid 'message' field, filtering out`);
          stats.filtered++;
          return false;
        }

        // Update stats for valid comments
        stats.severityBreakdown[comment.severity]++;
        stats.valid++;

        return true;
      });

    logger.info(`[MCP:${this.instanceKey}/${repo}] Comment validation: ${stats.valid}/${stats.total} valid, ${stats.filtered} filtered`);
    logger.info(`[MCP:${this.instanceKey}/${repo}] Severity breakdown: LOW=${stats.severityBreakdown.LOW}, MEDIUM=${stats.severityBreakdown.MEDIUM}, HIGH=${stats.severityBreakdown.HIGH}`);

    return { validComments, stats };
  }

  /**
   * Sanitize output for logging to prevent sensitive data exposure
   */
  sanitizeForLogging(output) {
    if (!output) return '[empty]';
    const sanitized = output
      .replace(/(sk-[a-zA-Z0-9]{20,})/g, 'sk-***REDACTED***')
      .replace(/(ghp_[a-zA-Z0-9]{36})/g, 'ghp_***REDACTED***')
      .replace(/(gho_[a-zA-Z0-9]{36})/g, 'gho_***REDACTED***')
      .replace(/(ghu_[a-zA-Z0-9]{36})/g, 'ghu_***REDACTED***')
      .replace(/(ghs_[a-zA-Z0-9]{40})/g, 'ghs_***REDACTED***')
      .replace(/(ghr_[a-zA-Z0-9]{40})/g, 'ghr_***REDACTED***')
      .replace(/(Bearer\s+[a-zA-Z0-9\-._~+/]+=*)/gi, 'Bearer ***REDACTED***')
      .replace(/("password":\s*")[^"]*"/gi, '$1***REDACTED***"')
      .replace(/("token":\s*")[^"]*"/gi, '$1***REDACTED***"')
      .replace(/("api_?key":\s*")[^"]*"/gi, '$1***REDACTED***"');
    return sanitized.substring(0, 500);
  }

  /**
   * Extract review URL from agent output
   */
  extractReviewUrlFromOutput(output) {
    if (!output) return null;
    const urlMatch = output.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+#pullrequestreview-\d+/);
    return urlMatch ? urlMatch[0] : null;
  }

  /**
   * Create a PR review with per-line comments
   */
  async createReviewWithComments(repo, pr, reviewResult) {
    logger.info(`[MCP:${this.instanceKey}/${repo}] Creating review for PR #${pr.number}`);

    // Check if agent called create_pull_request_review directly
    if (reviewResult.agentCalledToolDirectly) {
      logger.warn(`[MCP:${this.instanceKey}/${repo}] Agent called create_pull_request_review directly, skipping duplicate submission`);
      logger.info(`[MCP:${this.instanceKey}/${repo}] Agent output (sanitized): ${this.sanitizeForLogging(reviewResult.agentRawOutput)}`);
      logger.info(`[MCP:${this.instanceKey}/${repo}] Review was already submitted by the agent. Returning success without duplicate submission.`);
      // Return a success response that mimics a GitHub review result
      // The agent already submitted the review, so we don't need to do anything
      const reviewUrl = this.extractReviewUrlFromOutput(reviewResult.agentRawOutput);
      return {
        id: 'agent-submitted',
        html_url: reviewUrl || `https://github.com/${this.owner}/${repo}/pull/${pr.number}`,
        submitted_at: new Date().toISOString(),
        submitted_by: 'agent',
        event: 'COMMENT',
        body: reviewResult.summary || 'Review submitted by OpenClaw agent',
        comments: reviewResult.comments || []
      };
    }

    // Validate and sanitize comments
    const { validComments, stats } = this.validateAndSanitizeComments(reviewResult.comments, repo, pr.number);

    if (validComments.length === 0 && stats.total > 0) {
      logger.warn(`[MCP:${this.instanceKey}/${repo}] All comments were filtered out, posting review with summary only`);
    }

    // Determine event based on normalized severities
    let event = 'COMMENT';
    const hasHigh = stats.severityBreakdown.HIGH > 0;
    const hasMedium = stats.severityBreakdown.MEDIUM > 0;
    const hasLow = stats.severityBreakdown.LOW > 0;

    if (hasHigh) {
      event = 'REQUEST_CHANGES';
      logger.info(`[MCP:${this.instanceKey}/${repo}] Event set to REQUEST_CHANGES: ${stats.severityBreakdown.HIGH} HIGH severity comment(s) found`);
    } else if (hasMedium) {
      event = 'COMMENT';
      logger.info(`[MCP:${this.instanceKey}/${repo}] Event set to COMMENT: ${stats.severityBreakdown.MEDIUM} MEDIUM severity comment(s) found`);
    } else if (hasLow) {
      event = 'COMMENT';
      logger.info(`[MCP:${this.instanceKey}/${repo}] Event set to COMMENT: ${stats.severityBreakdown.LOW} LOW severity comment(s) found`);
    } else {
      event = 'COMMENT';
      logger.info(`[MCP:${this.instanceKey}/${repo}] Event set to COMMENT: no severity-specific comments found`);
    }

    // Update reviewResult with valid comments for further processing
    reviewResult.comments = validComments;

    // Fetch PR files with patches to calculate positions
    // GitHub API requires position for review comments in /reviews endpoint
    let positionMaps = new Map();
    try {
      logger.info(`[MCP:${this.instanceKey}/${repo}] Fetching PR files with patches for position calculation`);
      const rawFiles = await this.callMCP('get_pull_request_files', {
        owner: this.owner,
        repo: repo,
        pull_number: pr.number
      });

      // Build position maps for each file
      for (const file of rawFiles || []) {
        if (file.filename && file.patch) {
          const positionMap = this.buildPositionMap(file.patch);
          positionMaps.set(file.filename, positionMap);
          logger.debug(`[MCP:${this.instanceKey}/${repo}] Built position map for ${file.filename} (${positionMap.size} lines)`);
        }
      }
      logger.info(`[MCP:${this.instanceKey}/${repo}] Built position maps for ${positionMaps.size} file(s)`);
    } catch (error) {
      logger.error(`[MCP:${this.instanceKey}/${repo}] Failed to fetch PR files for position calculation: ${error.message}`);
      logger.warn(`[MCP:${this.instanceKey}/${repo}] Comments will be omitted without position mapping`);
    }

    const comments = reviewResult.comments.map(c => {
      // Severity is already normalized by validateAndSanitizeComments
      let commentBody = `[${c.severity}] ${c.message}`;

      if (c.suggestedCode) {
        commentBody += `\n\n**Suggested fix:**\n\`\`\`\n${c.suggestedCode}\n\`\`\``;
      }

      // Get position from the diff
      // For /reviews endpoint, GitHub requires 'position' (not line+side)
      const positionMap = positionMaps.get(c.file);
      const position = positionMap ? positionMap.get(c.line) : null;

      if (position === null || position === undefined) {
        logger.warn(`[MCP:${this.instanceKey}/${repo}] No position found for ${c.file}:${c.line}, skipping comment`);
        return null;
      }

      logger.debug(`[MCP:${this.instanceKey}/${repo}] Comment ${c.file}:${c.line} -> position: ${position}`);

      return {
        path: c.file,
        position: position,
        commit_id: pr.headSha,
        body: commentBody
      };
    }).filter(c => c !== null); // Filter out null comments (missing position)

    if (validComments.length > comments.length) {
      logger.warn(`[MCP:${this.instanceKey}/${repo}] Filtered out ${validComments.length - comments.length} comment(s) due to missing position`);
    }

    // Count comments and log summary
    logger.info(`[MCP:${this.instanceKey}/${repo}] PR headSha: ${pr.headSha}, total comments to submit: ${comments.length}`);
    if (comments.length > 0) {
      const commentSummary = comments.map(c => `${c.path}:${c.position}`).join(', ');
      logger.info(`[MCP:${this.instanceKey}/${repo}] Comments: ${commentSummary}`);
    }

    // Create review with all comments in one batch (no batching)
    const reviewArgs = {
      owner: this.owner,
      repo: repo,
      pull_number: pr.number,
      body: reviewResult.summary,
      event: event,
      commit_id: pr.headSha,
      comments: comments // Send all comments at once, no batching
    };

    logger.info(`[MCP:${this.instanceKey}/${repo}] Creating review with ${comments.length} comment(s)`);
    logger.info(`[MCP:${this.instanceKey}/${repo}] Review args: owner=${this.owner}, repo=${repo}, pr=${pr.number}, event=${event}, comments=${comments.length}`);

    let result;
    try {
      result = await this.callMCP('create_pull_request_review', reviewArgs);
    } catch (error) {
      if (error.message.includes('Can not request changes on your own pull request')) {
        logger.warn(`[MCP:${this.instanceKey}/${repo}] Cannot request changes on own PR, falling back to COMMENT`);
        const fallbackArgs = { ...reviewArgs, event: 'COMMENT' };
        result = await this.callMCP('create_pull_request_review', fallbackArgs);
      } else {
        throw error;
      }
    }

    if (!result || !result.id) {
      throw new Error(`Review creation failed: ${JSON.stringify(result)}`);
    }

    logger.info(`[MCP:${this.instanceKey}/${repo}] Review created: ID=${result.id}`);
    logger.info(`[MCP:${this.instanceKey}/${repo}] ✅ Created ${comments.length} line comment(s) - check GitHub PR Files tab`);
    logger.info(`[MCP:${this.instanceKey}/${repo}] ⚠️  Check GitHub PR: https://github.com/${this.owner}/${repo}/pull/${pr.number}/files`);

    return result;
  }

  /**
   * Approve a PR
   */
  async approvePR(repo, prNumber, body = 'Approved via OpenClaw PR Monitor') {
    logger.info(`[MCP:${this.instanceKey}/${repo}] Approving PR #${prNumber}`);
    return await this.callMCP('create_pull_request_review', {
      owner: this.owner,
      repo: repo,
      pull_number: prNumber,
      event: 'APPROVE',
      body: body
    });
  }

  /**
   * Request changes on a PR
   */
  async requestChanges(repo, prNumber, body) {
    logger.info(`[MCP:${this.instanceKey}/${repo}] Requesting changes for PR #${prNumber}`);
    return await this.callMCP('create_pull_request_review', {
      owner: this.owner,
      repo: repo,
      pull_number: prNumber,
      event: 'REQUEST_CHANGES',
      body: body
    });
  }

  /**
   * Close a PR
   */
  async closePR(repo, prNumber) {
    logger.info(`[MCP:${this.instanceKey}/${repo}] Closing PR #${prNumber}`);
    return await this.callMCP('update_pull_request', {
      owner: this.owner,
      repo: repo,
      pull_number: prNumber,
      state: 'closed'
    });
  }

  /**
   * Clean up resources
   */
  cleanup() {
    this.timeoutManager.clearAll();
    logger.info(`[MCP:${this.instanceKey}] Service cleaned up`);
  }
}

/**
 * Factory function to create MCP service for an instance
 */
function createMCPService(instanceKey) {
  const instance = config.instances[instanceKey];
  if (!instance) {
    throw new Error(`Instance not found: ${instanceKey}`);
  }
  return new MCPGitHubService(instance);
}

/**
 * Get or create MCP service for an instance (cached)
 */
const mcpServiceCache = new Map();

function getMCPService(instanceKey) {
  if (!mcpServiceCache.has(instanceKey)) {
    mcpServiceCache.set(instanceKey, createMCPService(instanceKey));
  }
  return mcpServiceCache.get(instanceKey);
}

module.exports = { MCPGitHubService, createMCPService, getMCPService };
