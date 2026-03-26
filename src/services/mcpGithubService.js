const { exec, spawn } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const config = require('../config');
const logger = require('../utils/logger');

class MCPGitHubService {
  constructor() {
    this.mcpBaseCmd = config.mcp.baseCommand;
    this.serverName = config.mcp.serverName;
    this.owner = config.github.owner;
    this.repo = config.github.repo;
  }

  /**
   * Custom exponential backoff retry logic to avoid external dependency issues
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
        logger.warn(`MCP attempt ${attempt} failed: ${err.message}, retrying in ${delay}ms, retries left: ${retries - attempt}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Execute MCP tool call using spawn (bypasses shell to avoid command injection)
   */
  async callMCP(method, args = {}) {
    return this.retryOperation(async () => {
      const timeoutMs = 60000; // 60 second timeout for MCP calls
      const startTime = Date.now();
      logger.info(`Starting MCP call ${this.serverName}.${method} (timeout: ${timeoutMs}ms)`);

      // Build arguments array for spawn (bypasses shell interpretation)
      const spawnArgs = ['call', `${this.serverName}.${method}`, '--output', 'json'];

      // Add each argument as separate item (avoids shell interpretation)
      // For mcporter: primitive values (string, number, boolean) use key=value
      // Complex values (object, array) use key:JSON
      for (const [key, value] of Object.entries(args)) {
        if (value === null || value === undefined) {
          spawnArgs.push(`${key}=null`);
        } else if (typeof value === 'object') {
          // Objects and arrays: use colon format with JSON
          spawnArgs.push(`${key}:${JSON.stringify(value)}`);
        } else if (typeof value === 'string') {
          // Strings: use equals format, but DON'T JSON.stringify (avoids double quotes)
          // The string value is passed directly as key=value
          spawnArgs.push(`${key}=${value}`);
        } else {
          // Numbers, booleans: use equals format
          spawnArgs.push(`${key}=${value}`);
        }
      }

      logger.info(`Executing MCP command: ${this.serverName}.${method} with ${Object.keys(args).length} args`);

      // Use spawn with maxBuffer option to handle large payloads
      const result = await this.spawnWithTimeout(this.mcpBaseCmd, spawnArgs, timeoutMs, startTime);

      try {
        const parsed = JSON.parse(result.stdout);
        logger.info(`MCP response parsed for ${method}: type=${typeof parsed}, isArray=${Array.isArray(parsed)}, keys=${Object.keys(parsed || {}).join(', ')}`);
        logger.info(`MCP response preview: ${JSON.stringify(parsed).substring(0, 500)}`);

        // Check if MCP response contains an error
        if (parsed.error) {
          const errorMsg = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error);
          logger.error(`MCP returned error for ${method}: ${errorMsg}`);
          throw new Error(`MCP error: ${errorMsg}`);
        }

        return parsed;
      } catch (parseErr) {
        logger.error(`Failed to parse MCP output for ${method}: ${result.stdout}`);
        throw new Error(`MCP response parse failed: ${parseErr.message}`);
      }
    }, config.retries.mcpRetries, 2000, config.retries.backoffFactor);
  }

  /**
   * Spawn command with timeout and large buffer support
   */
  spawnWithTimeout(command, args, timeoutMs, startTime) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        spawnProcess.kill('SIGTERM');
        const elapsed = Date.now() - startTime;
        logger.error(`MCP command timeout after ${timeoutMs}ms (elapsed: ${elapsed}ms)`);
        reject(new Error(`MCP command timeout after ${timeoutMs}ms (elapsed: ${elapsed}ms)`));
      }, timeoutMs);

      logger.debug(`spawn about to execute: ${command} ${args.slice(0, 4).join(' ')}... (${args.length} total args)`);

      // Spawn with maxBuffer to handle large payloads (10MB)
      // Note: encoding option in spawn options doesn't work as expected, so we decode manually
      const spawnProcess = spawn(command, args, {
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        shell: false // Important: disable shell to avoid command injection
      });

      let stdout = '';
      let stderr = '';

      spawnProcess.stdout.on('data', (data) => {
        // Explicitly decode buffer to string
        stdout += data.toString('utf8');
      });

      spawnProcess.stderr.on('data', (data) => {
        // Explicitly decode buffer to string
        stderr += data.toString('utf8');
      });

      spawnProcess.on('close', (code) => {
        clearTimeout(timer);
        const elapsed = Date.now() - startTime;
        logger.info(`MCP command completed in ${elapsed}ms, exit code: ${code}, stdout length: ${stdout?.length || 0}`);
        if (stderr && !stderr.includes('warning')) logger.warn(`MCP stderr: ${stderr}`);
        if (code !== 0) {
          reject(new Error(`MCP command failed with exit code ${code}: ${stderr || stdout}`));
        } else {
          resolve({ stdout, stderr });
        }
      });

      spawnProcess.on('error', (err) => {
        clearTimeout(timer);
        const elapsed = Date.now() - startTime;
        logger.error(`MCP command failed after ${elapsed}ms: ${err.message}`);
        reject(err);
      });
    });
  }

  /**
   * Fetch all open pull requests via MCP list_pull_requests
   */
  async getOpenPRs() {
    logger.debug('Fetching open PRs via MCP');
    const rawPRs = await this.callMCP('list_pull_requests', {
      owner: this.owner,
      repo: this.repo,
      state: 'open',
      per_page: 100,
      page: 1
    });

    // Debug: log the response structure
    logger.info(`MCP response type: ${typeof rawPRs}, isArray: ${Array.isArray(rawPRs)}`);
    if (!Array.isArray(rawPRs)) {
      logger.info(`MCP response keys: ${Object.keys(rawPRs || {}).join(', ')}`);
      logger.info(`MCP response (first 500 chars): ${JSON.stringify(rawPRs).substring(0, 500)}`);
    }

    return rawPRs.map(pr => ({
      id: pr.id,
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      author: pr.user?.login || 'tinuswan',
      createdAt: new Date(pr.created_at),
      description: pr.body || 'No description provided',
      baseBranch: pr.base?.ref,
      headBranch: pr.head?.ref,
      headSha: pr.head?.sha
    }));
  }

  /**
   * Check if a file is a test file (should be excluded from review)
   */
  isTestFile(filename) {
    const testPatterns = [
      '_test.go',           // Go test files
      '_test.js',           // JavaScript test files
      '_test.ts',           // TypeScript test files
      '.test.',             // Files with .test. in name
      '/e2e_test/',         // E2E test folder
      '/e2e/',              // E2E folder
      '/__tests__/',        // JavaScript test folder
      '/test/',             // Generic test folder
      '/tests/',            // Generic tests folder
      '/spec/',             // Spec/test folder
      '_spec.',             // Spec files (Jasmine, etc)
      '.spec.',             // Spec files variant
      'swagger.json',       // Swagger/OpenAPI spec files
      'swagger.yaml',       // Swagger YAML spec files
      'swagger.yml',        // Swagger YAML variant
      'openapi.json',       // OpenAPI spec files
      'openapi.yaml',       // OpenAPI YAML spec files
      'openapi.yml',        // OpenAPI YAML variant
    ];

    return testPatterns.some(pattern => filename.includes(pattern));
  }

  /**
   * Get PR changed files and diff metadata via MCP
   */
  async getPRDetails(prNumber) {
    logger.debug(`Fetching PR #${prNumber} details via MCP`);
    const files = await this.callMCP('get_pull_request_files', {
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber
    });

    // Filter out test files
    const filteredFiles = files.filter(f => !this.isTestFile(f.filename));
    const skippedCount = files.length - filteredFiles.length;

    if (skippedCount > 0) {
      logger.info(`Filtered out ${skippedCount} test file(s) from PR #${prNumber}`);
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
      // Keep original count for reference
      totalFilesChanged: files.length
    };
  }

  /**
   * Create a PR review with per-line comments
   * @param {Object} pr - PR object
   * @param {Object} reviewResult - Review result with comments array
   */
  async createReviewWithComments(pr, reviewResult) {
    logger.debug(`Creating review for PR #${pr.number} with ${reviewResult.comments.length} comments`);

    // Determine event based on highest severity
    const severities = reviewResult.comments.map(c => c.severity.toUpperCase());
    const hasHigh = severities.includes('HIGH');
    const hasMedium = severities.includes('MEDIUM');

    // Select event based on severity
    let event = 'COMMENT';
    if (hasHigh) {
      event = 'REQUEST_CHANGES';  // HIGH severity → request changes
    } else if (hasMedium && reviewResult.comments.length > 0) {
      event = 'COMMENT';  // MEDIUM → neutral comment
    } else if (reviewResult.comments.length === 0) {
      event = 'COMMENT';  // No comments → neutral
    }

    logger.info(`Review event: ${event} (HIGH: ${hasHigh}, MEDIUM: ${hasMedium}, Comments: ${reviewResult.comments.length})`);

    // Build comments array for GitHub API
    // Use 'line' + 'commit_id' for the newer API (instead of deprecated 'position')
    const comments = reviewResult.comments.map(c => {
      let commentBody = `[${c.severity.toUpperCase()}] ${c.message}`;

      // Append suggested code if available
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

    // Process comments in batches to avoid command line length issues
    const BATCH_SIZE = 5; // 5 comments per batch
    const commentBatches = [];

    for (let i = 0; i < comments.length; i += BATCH_SIZE) {
      commentBatches.push(comments.slice(i, i + BATCH_SIZE));
    }

    logger.info(`Processing ${comments.length} comments in ${commentBatches.length} batches (${BATCH_SIZE} comments per batch)`);

    let firstReviewResult = null;
    let batchNumber = 0;

    // Process each batch
    for (const batch of commentBatches) {
      batchNumber++;

      // Build review args for this batch
      const reviewArgs = {
        owner: this.owner,
        repo: this.repo,
        pull_number: pr.number,
        body: batchNumber === 1 ? reviewResult.summary : `Additional comments (batch ${batchNumber}/${commentBatches.length})`,
        event: batchNumber === 1 ? event : 'COMMENT', // First batch uses determined event, rest use COMMENT
        commit_id: pr.headSha
      };

      // Add comments to this batch
      if (batch.length > 0) {
        reviewArgs.comments = batch;
      }

      logger.info(`Sending batch ${batchNumber}/${commentBatches.length} (${batch.length} comments)`);
      logger.debug(`Batch ${batchNumber} payload: ${JSON.stringify(reviewArgs, null, 2)}`);

      // Call MCP for this batch with fallback for "own PR" restriction
      let result;
      try {
        result = await this.callMCP('create_pull_request_review', reviewArgs);
      } catch (error) {
        // Handle GitHub API restriction: Can not request changes on your own pull request
        if (error.message.includes('Can not request changes on your own pull request')) {
          logger.warn(`Cannot request changes on own PR #${pr.number}, falling back to COMMENT event`);
          // Send warning notification to Telegram
          try {
            const telegramService = require('./telegramService');
            await telegramService.sendWarning(pr.number, `Cannot request changes on your own PR (GitHub API restriction). Review posted as COMMENT instead.\n\nReview with ${batch.length} comments has been submitted.`);
          } catch (telegramErr) {
            logger.error(`Failed to send Telegram warning: ${telegramErr.message}`);
          }
          // Retry with COMMENT event instead of REQUEST_CHANGES
          const fallbackArgs = { ...reviewArgs, event: 'COMMENT' };
          // Use OpenClaw agent to format the body with proper GitHub markdown
          if (fallbackArgs.body) {
            try {
              const openclawAgentService = require('./openclawAgentService');
              fallbackArgs.body = await openclawAgentService.formatReviewBody({
                originalBody: fallbackArgs.body,
                prNumber: pr.number,
                originalEvent: 'REQUEST_CHANGES',
                newEvent: 'COMMENT',
                reason: 'GitHub does not allow requesting changes on your own pull request'
              });
              logger.info(`Review body formatted by OpenClaw agent for PR #${pr.number}`);
            } catch (formatErr) {
              logger.error(`Failed to format review body with agent: ${formatErr.message}, using fallback format`);
              // Fallback to simple formatting
              fallbackArgs.body = `${fallbackArgs.body}\n\n---\n\n> **⚠️ AUTO-FIXED:** This review was posted as \`COMMENT\` instead of \`REQUEST_CHANGES\` because GitHub doesn't allow requesting changes on your own PR.`;
            }
          }
          logger.info(`Retrying batch ${batchNumber} with COMMENT event`);
          result = await this.callMCP('create_pull_request_review', fallbackArgs);
          logger.info(`Successfully posted review as COMMENT for PR #${pr.number}`);
        } else {
          throw error; // Re-throw other errors
        }
      }

      // Verify success
      if (!result || !result.id) {
        throw new Error(`Batch ${batchNumber} failed: ${JSON.stringify(result)}`);
      }

      logger.info(`Batch ${batchNumber}/${commentBatches.length} created: ID=${result.id}, URL=${result.html_url}, State=${result.state}`);

      // Store first batch result for return
      if (batchNumber === 1) {
        firstReviewResult = result;
      }

      // Small delay between batches to avoid rate limiting (except for last batch)
      if (batchNumber < commentBatches.length) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
      }
    }

    logger.info(`All ${commentBatches.length} batches completed successfully for PR #${pr.number}`);
    return firstReviewResult;
  }
}

module.exports = new MCPGitHubService();
