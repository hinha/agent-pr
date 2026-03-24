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
      logger.debug(`Executing MCP command: ${fullCommand}`);

      const { stdout, stderr } = await execPromise(fullCommand);
      if (stderr && !stderr.includes('warning')) logger.warn(`MCP stderr: ${stderr}`);

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

    // Build comments array for GitHub API
    // Use 'line' + 'commit_id' for the newer API (instead of deprecated 'position')
    const comments = reviewResult.comments.map(c => ({
      path: c.file,
      line: c.line,
      commit_id: pr.headSha,
      body: `[${c.severity.toUpperCase()}] ${c.message}`
    }));

    const reviewArgs = {
      owner: this.owner,
      repo: this.repo,
      pull_number: pr.number,
      body: reviewResult.summary,
      event: 'COMMENT',  // Use COMMENT instead of APPROVE/REQUEST_CHANGES for neutral review
      commit_id: pr.headSha  // Required for line-based comments
    };

    // Only add comments if there are any
    if (comments.length > 0) {
      reviewArgs.comments = comments;
    }

    logger.debug(`Review payload: ${JSON.stringify(reviewArgs, null, 2)}`);
    return this.callMCP('create_pull_request_review', reviewArgs);
  }
}

module.exports = new MCPGitHubService();
