const { exec } = require('child_process');
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
   * Execute MCP tool call with exponential backoff retries
   */
  async callMCP(method, args = {}) {
    return this.retryOperation(async () => {
      // Build argument string for mcporter
      const argStrings = Object.entries(args)
        .map(([key, value]) => {
          if (typeof value === 'object') return `${key}:${JSON.stringify(value)}`;
          return `${key}=${JSON.stringify(value)}`;
        })
        .join(' ');

      const fullCommand = `${this.mcpBaseCmd} call ${this.serverName}.${method} ${argStrings} --output json`;
      logger.info(`Executing MCP command: ${this.serverName}.${method} (${argStrings.length} chars)`);

      // Add timeout to prevent hanging
      const timeoutMs = 60000; // 60 second timeout for MCP calls
      const startTime = Date.now();
      logger.info(`Starting MCP call (timeout: ${timeoutMs}ms)`);

      const execWithTimeout = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const elapsed = Date.now() - startTime;
          logger.error(`MCP command timeout after ${timeoutMs}ms (elapsed: ${elapsed}ms)`);
          reject(new Error(`MCP command timeout after ${timeoutMs}ms (elapsed: ${elapsed}ms)`));
        }, timeoutMs);

        logger.debug(`execPromise about to execute: ${fullCommand.substring(0, 200)}...`);

        // Add exec options to handle large payloads
        const execOptions = {
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer (increase from default 1MB)
          encoding: 'utf8'
        };
        logger.debug(`Exec options: maxBuffer=${execOptions.maxBuffer} bytes (${execOptions.maxBuffer / 1024 / 1024}MB)`);

        execPromise(fullCommand, execOptions)
          .then(({ stdout, stderr }) => {
            clearTimeout(timer);
            const elapsed = Date.now() - startTime;
            logger.info(`MCP command completed in ${elapsed}ms, stdout length: ${stdout?.length || 0}`);
            if (stderr && !stderr.includes('warning')) logger.warn(`MCP stderr: ${stderr}`);
            resolve({ stdout, stderr });
          })
          .catch(err => {
            clearTimeout(timer);
            const elapsed = Date.now() - startTime;
            logger.error(`MCP command failed after ${elapsed}ms: ${err.message}`);
            reject(err);
          });
      });

      const { stdout, stderr } = await execWithTimeout;

      try {
        return JSON.parse(stdout);
      } catch (parseErr) {
        logger.error(`Failed to parse MCP output for ${method}: ${stdout}`);
        throw new Error(`MCP response parse failed: ${parseErr.message}`);
      }
    }, config.retries.mcpRetries, 2000, config.retries.backoffFactor);
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
   * Get PR changed files and diff metadata via MCP
   */
  async getPRDetails(prNumber) {
    logger.debug(`Fetching PR #${prNumber} details via MCP`);
    const files = await this.callMCP('get_pull_request_files', {
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber
    });

    return {
      filesChanged: files.length,
      files: files.map(f => ({
        filename: f.filename,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
        status: f.status
      })),
      totalChanges: files.reduce((sum, f) => sum + f.changes, 0)
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
    const comments = reviewResult.comments.map(c => ({
      path: c.file,
      line: c.line,
      commit_id: pr.headSha,
      body: `[${c.severity.toUpperCase()}] ${c.message}`
    }));

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

      // Call MCP for this batch
      const result = await this.callMCP('create_pull_request_review', reviewArgs);

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
