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
    this.reviewToolsAvailable = null;
    this.reviewToolsChecked = undefined;
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

      const result = await this.spawnWithTimeout(this.mcpBaseCmd, spawnArgs, timeoutMs, startTime);

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
      status: f.status || 'modified'
    }));
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
   * Check if review tools are available
   */
  async checkReviewToolsAvailable() {
    if (this.reviewToolsChecked !== undefined) {
      return this.reviewToolsAvailable;
    }

    this.reviewToolsChecked = true;

    // Try to call get_pull_request_reviews to check if it's available
    try {
      await this.callMCP('get_pull_request_reviews', {
        owner: this.owner,
        repo: '_test_',
        pull_number: 1
      });
      this.reviewToolsAvailable = true;
      logger.info(`[MCP:${this.instanceKey}] Review tools are available`);
      return true;
    } catch (err) {
      if (err.message.includes('Unknown tool') || err.message.includes('get_pull_request_reviews')) {
        this.reviewToolsAvailable = false;
        logger.warn(`[MCP:${this.instanceKey}] Review tools NOT available - outdated review feature disabled`);
        return false;
      }
      // Other errors (like repo not found) - assume tool is available
      this.reviewToolsAvailable = true;
      return true;
    }
  }

  /**
   * Fetch all reviews for a PR
   */
  async getPRReviews(repo, prNumber) {
    logger.debug(`[MCP:${this.instanceKey}/${repo}] Fetching reviews for PR #${prNumber}`);

    // Check if tools are available first
    if (await this.checkReviewToolsAvailable() === false) {
      logger.debug(`[MCP:${this.instanceKey}/${repo}] Skipping review fetch - tool not available`);
      return [];
    }

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
      logger.error(`[MCP:${this.instanceKey}/${repo}] Failed to fetch reviews for PR #${prNumber}: ${err.message}`);
      return [];
    }
  }

  /**
   * Fetch all issue comments (general discussion) for a PR
   */
  async getPRComments(repo, prNumber) {
    logger.debug(`[MCP:${this.instanceKey}/${repo}] Fetching comments for PR #${prNumber}`);

    // Check if tools are available first
    if (await this.checkReviewToolsAvailable() === false) {
      logger.debug(`[MCP:${this.instanceKey}/${repo}] Skipping comment fetch - tool not available`);
      return [];
    }

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
      logger.error(`[MCP:${this.instanceKey}/${repo}] Failed to fetch comments for PR #${prNumber}: ${err.message}`);
      return [];
    }
  }

  /**
   * Create a PR review with per-line comments
   */
  async createReviewWithComments(repo, pr, reviewResult) {
    logger.info(`[MCP:${this.instanceKey}/${repo}] Creating review for PR #${pr.number} with ${reviewResult.comments.length} comments`);

    const severities = reviewResult.comments.map(c => c.severity.toUpperCase());
    const hasHigh = severities.includes('HIGH');
    const hasMedium = severities.includes('MEDIUM');

    let event = 'COMMENT';
    if (hasHigh) {
      event = 'REQUEST_CHANGES';
    } else if (hasMedium && reviewResult.comments.length > 0) {
      event = 'COMMENT';
    } else if (reviewResult.comments.length === 0) {
      event = 'COMMENT';
    }

    logger.info(`[MCP:${this.instanceKey}/${repo}] Review event: ${event}`);

    const comments = reviewResult.comments.map(c => {
      let commentBody = `[${c.severity.toUpperCase()}] ${c.message}`;

      if (c.suggestedCode) {
        commentBody += `\n\n**Suggested fix:**\n\`\`\`\n${c.suggestedCode}\n\`\`\``;
      }

      return {
        path: c.file,
        line: c.line,
        commit_id: pr.headSha,
        body: commentBody
      };
    });

    const BATCH_SIZE = 5;
    const commentBatches = [];

    for (let i = 0; i < comments.length; i += BATCH_SIZE) {
      commentBatches.push(comments.slice(i, i + BATCH_SIZE));
    }

    logger.info(`[MCP:${this.instanceKey}/${repo}] Processing ${comments.length} comments in ${commentBatches.length} batches`);

    let firstReviewResult = null;

    for (const batch of commentBatches) {
      const batchNumber = commentBatches.indexOf(batch) + 1;

      const reviewArgs = {
        owner: this.owner,
        repo: repo,
        pull_number: pr.number,
        body: batchNumber === 1 ? reviewResult.summary : `Additional comments (batch ${batchNumber}/${commentBatches.length})`,
        event: batchNumber === 1 ? event : 'COMMENT',
        commit_id: pr.headSha
      };

      if (batch.length > 0) {
        reviewArgs.comments = batch;
      }

      logger.info(`[MCP:${this.instanceKey}/${repo}] Sending batch ${batchNumber}/${commentBatches.length}`);

      let result;
      try {
        result = await this.callMCP('create_pull_request_review', reviewArgs);
      } catch (error) {
        if (error.message.includes('Can not request changes on your own pull request')) {
          logger.warn(`[MCP:${this.instanceKey}/${repo}] Cannot request changes on own PR, falling back to COMMENT`);
          try {
            const telegramService = require('./telegramService');
            await telegramService.sendWarning(this.owner, repo, pr.number, `Cannot request changes on your own PR. Review posted as COMMENT instead.`);
          } catch (telegramErr) {
            logger.error(`Failed to send Telegram warning: ${telegramErr.message}`);
          }

          const fallbackArgs = { ...reviewArgs, event: 'COMMENT' };
          if (fallbackArgs.body) {
            try {
              const openclawAgentService = require('./openclawAgentService');
              fallbackArgs.body = await openclawAgentService.formatReviewBody({
                originalBody: fallbackArgs.body,
                prNumber: pr.number,
                originalEvent: 'REQUEST_CHANGES',
                newEvent: 'COMMENT',
                reason: 'GitHub does not allow requesting changes on your own pull request',
                owner: this.owner,
                repo: repo
              });
            } catch (formatErr) {
              logger.error(`Failed to format review body: ${formatErr.message}`);
              fallbackArgs.body = `${fallbackArgs.body}\n\n---\n\n> **⚠️ AUTO-FIXED:** This review was posted as \`COMMENT\` instead of \`REQUEST_CHANGES\`.`;
            }
          }
          result = await this.callMCP('create_pull_request_review', fallbackArgs);
        } else {
          throw error;
        }
      }

      if (!result || !result.id) {
        throw new Error(`Batch ${batchNumber} failed: ${JSON.stringify(result)}`);
      }

      logger.info(`[MCP:${this.instanceKey}/${repo}] Batch ${batchNumber} created: ID=${result.id}`);

      if (batchNumber === 1) {
        firstReviewResult = result;
      }

      if (batchNumber < commentBatches.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return firstReviewResult;
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
