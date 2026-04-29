const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const IAgentService = require('../../interfaces/IAgentService');
const { MCPError } = require('../../shared/errors');

/**
 * OpenClawAgentAdapter - AI code review agent via OpenClaw CLI
 *
 * This adapter implements the IAgentService interface using the OpenClaw CLI
 * for AI-powered code review.
 *
 * @example
 * const adapter = new OpenClawAgentAdapter(config, logger, retryHelper);
 * const result = await adapter.reviewPR('myorg', 'my-repo', pr, files, 'high');
 */
class OpenClawAgentAdapter extends IAgentService {
  /**
   * @param {Object} config - Application configuration
   * @param {Object} logger - Winston logger instance
   * @param {Object} retryHelper - RetryHelper instance
   */
  constructor(config, logger, retryHelper) {
    super();
    this.config = config;
    this.logger = logger;
    this.retryHelper = retryHelper;
    this.logger.info('OpenClawAgentAdapter initialized');
  }

  /**
   * Review a pull request using AI
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {PullRequest} pr - Pull request to review
   * @param {Array<FileChange>} files - Files changed in the PR
   * @param {string} level - Review level (low, medium, high)
   * @returns {Promise<ReviewResult>} Review result with comments
   */
  async reviewPR(owner, repo, pr, files, level) {
    const levelConfig = this.config.reviewLevels[level];
    if (!levelConfig) {
      throw new Error(`Invalid review level: ${level}`);
    }

    const instance = this._getInstanceByOwner(owner);
    if (!instance) {
      throw new Error(`No instance found for owner: ${owner}`);
    }

    this.logger.info(`[OpenClawAgentAdapter:${owner}/${repo}] Starting ${level} level review for PR #${pr.number}`);

    return this.retryHelper.retry(async () => {
      const reviewPrompt = this._buildReviewPrompt(owner, repo, pr, level, levelConfig, files);
      const agentName = instance.agent.reviewAgent;
      const command = `openclaw agent --agent ${agentName} --json --message "${this._escapeShellString(reviewPrompt)}" --timeout ${instance.agent.reviewTimeoutSeconds}`;

      this.logger.info(`[OpenClawAgentAdapter:${owner}/${repo}] Executing OpenClaw command for PR #${pr.number}`);

      const timeoutMs = instance.agent.reviewTimeoutSeconds * 1000;
      const { stdout, stderr } = await this._spawnWithTimeout(command, timeoutMs);

      this.logger.info(`[OpenClawAgentAdapter:${owner}/${repo}] OpenClaw command completed for PR #${pr.number}`);
      this.logger.debug(`stdout length: ${stdout?.length || 0}, stderr length: ${stderr?.length || 0}`);

      // Clean up markdown code blocks from output before parsing
      let cleanStdout = stdout;
      if (stdout) {
        cleanStdout = stdout
          .replace(/```json\s*/g, '')
          .replace(/```\s*/g, '')
          .trim();
      }

      // Parse the OpenClaw response
      const result = this._parseOpenClawResponse(cleanStdout, owner, repo, pr);

      this.logger.info(`[OpenClawAgentAdapter:${owner}/${repo}] Review completed: ${result.comments?.length || 0} comments`);

      return result;
    }, {
      retries: 2,
      minTimeout: 10000,
      factor: 2,
      context: `OpenClawAgent:${owner}/${repo}.reviewPR`
    });
  }

  /**
   * Generate a summary for a pull request
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {PullRequest} pr - Pull request to summarize
   * @param {Array<FileChange>} files - Files changed in the PR
   * @returns {Promise<string>} Generated summary
   */
  async summarizePR(owner, repo, pr, files) {
    const instance = this._getInstanceByOwner(owner);
    if (!instance) {
      throw new Error(`No instance found for owner: ${owner}`);
    }

    const summaryAgent = instance.agent.summaryAgent || instance.agent.reviewAgent;

    const prompt = this._buildSummaryPrompt(owner, repo, pr, files);
    const command = `openclaw agent --agent ${summaryAgent} --json --message "${this._escapeShellString(prompt)}" --timeout 60`;

    this.logger.info(`[OpenClawAgentAdapter:${owner}/${repo}] Generating summary for PR #${pr.number}`);

    return this.retryHelper.retry(async () => {
      const { stdout } = await this._spawnWithTimeout(command, 60000);
      const cleanStdout = stdout.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

      try {
        const response = JSON.parse(cleanStdout);
        return response.result || response.response || response.summary || JSON.stringify(response);
      } catch (parseErr) {
        // If parsing fails, return the cleaned output
        return cleanStdout;
      }
    }, {
      retries: 2,
      minTimeout: 5000,
      factor: 2,
      context: `OpenClawAgent:${owner}/${repo}.summarizePR`
    });
  }

  /**
   * Get available review levels
   * @returns {Array<string>} Array of available review levels
   */
  async getReviewLevels() {
    return Object.keys(this.config.reviewLevels || {});
  }

  /**
   * Escape a string for use inside double-quoted shell command
   * @param {string} str - String to escape
   * @returns {string} Escaped string
   * @private
   */
  _escapeShellString(str) {
    return str
      .replace(/\\/g, '\\\\')  // Backslash must be first
      .replace(/"/g, '\\"')     // Double quotes
      .replace(/\$/g, '\\$')    // Dollar signs
      .replace(/`/g, '\\`');    // Backticks
  }

  /**
   * Get instance configuration by owner
   * @param {string} owner - Repository owner
   * @returns {Object|null} Instance configuration
   * @private
   */
  _getInstanceByOwner(owner) {
    const instanceKey = `github/${owner}`;
    return this.config.instances[instanceKey] || null;
  }

  /**
   * Build review prompt for OpenClaw agent
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {PullRequest} pr - Pull request object
   * @param {string} level - Review level
   * @param {Object} levelConfig - Level configuration
   * @param {Array<FileChange>} files - Files changed
   * @returns {string} Review prompt
   * @private
   */
  _buildReviewPrompt(owner, repo, pr, level, levelConfig, files) {
    const focusAreas = levelConfig.focusAreas.join(', ');

    // Load prompt template from file (like feature branch)
    const possiblePaths = [
      path.join(process.cwd(), 'src/prompts/review.txt'),
      path.join(process.cwd(), 'prompts/review.txt'),
      path.join(__dirname, '../../prompts/review.txt')
    ];

    let template;
    for (const tryPath of possiblePaths) {
      try {
        template = fs.readFileSync(tryPath, 'utf-8');
        this.logger.info(`[OpenClawAgentAdapter:${owner}/${repo}] Prompt template loaded from: ${tryPath}`);
        break;
      } catch (err) {
        // Try next path
      }
    }

    if (!template) {
      this.logger.error(`[OpenClawAgentAdapter:${owner}/${repo}] Failed to read prompt template`);
      throw new Error('Prompt template not found');
    }

    const instance = this._getInstanceByOwner(owner);
    const mcpName = instance?.mcpName || 'github';

    return template
      .replace('{{PR_NUMBER}}', pr.number)
      .replace('{{LEVEL}}', level.toUpperCase())
      .replace('{{FOCUS_AREAS}}', focusAreas)
      .replace('{{MAX_COMMENTS}}', levelConfig.maxCommentsPerFile)
      .replace('{{OWNER}}', owner)
      .replace('{{REPO}}', repo)
      .replace('{{SOURCE_BRANCH}}', pr.headBranch || 'unknown')
      .replace('{{TARGET_BRANCH}}', pr.baseBranch || 'main')
      .replace('{{PR_URL}}', pr.url)
      .replace('{{MCP_NAME}}', mcpName);
  }

  /**
   * Build summary prompt for OpenClaw agent
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {PullRequest} pr - Pull request object
   * @param {Array<FileChange>} files - Files changed
   * @returns {string} Summary prompt
   * @private
   */
  _buildSummaryPrompt(owner, repo, pr, files) {
    const filesList = files.map(f => `- ${f.filename}`).join(', ');

    return (
      `Summarize the following pull request in 1-2 sentences:\n\n` +
      `Repository: ${owner}/${repo}\n` +
      `PR #${pr.number}: ${pr.title}\n` +
      `Description: ${pr.description || 'No description'}\n` +
      `Files: ${filesList}\n\n` +
      `Focus on the purpose and impact of this change.`
    );
  }

  /**
   * Parse OpenClaw CLI response
   * @param {string} stdout - Command output
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {PullRequest} pr - Pull request object
   * @returns {ReviewResult} Parsed review result
   * @private
   */
  _parseOpenClawResponse(stdout, owner, repo, pr) {
    try {
      const trimmed = stdout.trim();
      let openClawResponse = JSON.parse(trimmed);

      // Handle nested result structure
      if (openClawResponse.result) {
        if (typeof openClawResponse.result === 'string') {
          openClawResponse = JSON.parse(openClawResponse.result);
        } else {
          openClawResponse = openClawResponse.result;
        }
      }

      // Check if agent called the tool directly
      const agentCalledToolDirectly = openClawResponse.tool_calls?.some(
        call => call.function?.name === 'create_pull_request_review'
      );

      // Extract comments
      let comments = [];
      if (openClawResponse.comments && Array.isArray(openClawResponse.comments)) {
        comments = openClawResponse.comments;
      }

      return {
        summary: openClawResponse.summary || openClawResponse.response || 'Review completed',
        comments: comments,
        level: 'medium',
        agentCalledToolDirectly: agentCalledToolDirectly,
        agentRawOutput: stdout
      };
    } catch (parseErr) {
      this.logger.error(`[OpenClawAgentAdapter:${owner}/${repo}] Failed to parse OpenClaw response: ${parseErr.message}`);
      this.logger.debug(`[OpenClawAgentAdapter:${owner}/${repo}] Raw output: ${stdout}`);

      // Return a basic result on parse failure
      return {
        summary: 'Review completed (parse error)',
        comments: [],
        level: 'medium',
        agentCalledToolDirectly: false,
        agentRawOutput: stdout
      };
    }
  }

  /**
   * Spawn command with timeout
   * @param {string} command - Command to execute
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<{stdout: string, stderr: string}>}
   * @private
   */
  _spawnWithTimeout(command, timeoutMs) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, {
        shell: true,
        env: { ...process.env, NODE_ENV: 'production' }
      });

      let stdout = '';
      let stderr = '';

      const cleanup = () => {
        child.stdout.off('data', onData);
        child.stderr.off('data', onErrorData);
        child.off('close', onClose);
        child.off('error', onError);
      };

      const onData = (data) => { stdout += data.toString(); };
      const onErrorData = (data) => { stderr += data.toString(); };

      const timeoutId = setTimeout(() => {
        cleanup();
        child.kill('SIGTERM');
        reject(new MCPError(
          `Agent timeout after ${timeoutMs}ms`,
          'openclaw',
          'spawn',
          true
        ));
      }, timeoutMs);

      const onClose = (code) => {
        clearTimeout(timeoutId);
        cleanup();
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new MCPError(
            stderr || `Exit code: ${code}`,
            'openclaw',
            'spawn',
            false
          ));
        }
      };

      const onError = (err) => {
        clearTimeout(timeoutId);
        cleanup();
        reject(new MCPError(
          err.message,
          'openclaw',
          'spawn',
          false
        ));
      };

      child.stdout.on('data', onData);
      child.stderr.on('data', onErrorData);
      child.on('close', onClose);
      child.on('error', onError);
    });
  }
}

module.exports = OpenClawAgentAdapter;
