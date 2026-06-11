const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const IAgentService = require('../../interfaces/IAgentService');
const { MCPError } = require('../../shared/errors');

/**
 * HermesAgentAdapter - AI code review agent via Hermes CLI
 *
 * Implements IAgentService using the Hermes CLI for AI-powered code review.
 * Unlike OpenClaw, Hermes outputs plain text and JSON must be extracted from it.
 *
 * Command format:
 *   hermes chat -q "{prompt}" --profile {profile} -Q --max-turns {turns} --cli
 *
 * @example
 * const adapter = new HermesAgentAdapter(config, logger, retryHelper);
 * const result = await adapter.reviewPR('myorg', 'my-repo', pr, files, 'high');
 */
class HermesAgentAdapter extends IAgentService {
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
    this.logger.info('HermesAgentAdapter initialized');
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
  async reviewPR(owner, repo, pr, files, level, previousComments = [], lastCommits = []) {
    const levelConfig = this.config.reviewLevels[level];
    if (!levelConfig) {
      throw new Error(`Invalid review level: ${level}`);
    }

    const instance = this._getInstanceByOwner(owner);
    if (!instance) {
      throw new Error(`No instance found for owner: ${owner}`);
    }

    this.logger.info(`[HermesAgentAdapter:${owner}/${repo}] Starting ${level} level review for PR #${pr.number}`);

    return this.retryHelper.retry(async () => {
      const reviewPrompt = this._buildReviewPrompt(owner, repo, pr, level, levelConfig, files, previousComments, lastCommits);
      const profile = instance.agent.hermesProfile;
      const maxTurns = instance.agent.hermesMaxTurns || 90;
      const command = `hermes chat -q "${this._escapeShellString(reviewPrompt)}" --profile ${profile} -Q --max-turns ${maxTurns} --cli`;

      this.logger.info(`[HermesAgentAdapter:${owner}/${repo}] Executing Hermes command for PR #${pr.number}`);

      const timeoutMs = instance.agent.reviewTimeoutSeconds * 1000;
      const { stdout, stderr } = await this._spawnWithTimeout(command, timeoutMs);

      this.logger.info(`[HermesAgentAdapter:${owner}/${repo}] Hermes command completed for PR #${pr.number}`);
      this.logger.info(`[HermesAgentAdapter:${owner}/${repo}] stdout length: ${stdout?.length || 0}, stderr length: ${stderr?.length || 0}`);
      this.logger.debug(`[HermesAgentAdapter:${owner}/${repo}] stdout (first 2000 chars): ${stdout?.substring(0, 2000)}`);
      if (stderr) {
        this.logger.info(`[HermesAgentAdapter:${owner}/${repo}] stderr (first 500 chars): ${stderr?.substring(0, 500)}`);
      }

      const result = this._parseHermesResponse(stdout, owner, repo, pr);

      this.logger.info(`[HermesAgentAdapter:${owner}/${repo}] Review completed: ${result.comments?.length || 0} comments`);

      return result;
    }, {
      retries: 2,
      minTimeout: 10000,
      factor: 2,
      context: `HermesAgent:${owner}/${repo}.reviewPR`
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

    const prompt = this._buildSummaryPrompt(owner, repo, pr, files);
    const profile = instance.agent.hermesProfile;
    const maxTurns = instance.agent.hermesMaxTurns || 90;
    const command = `hermes chat -q "${this._escapeShellString(prompt)}" --profile ${profile} -Q --max-turns ${maxTurns} --cli`;

    this.logger.info(`[HermesAgentAdapter:${owner}/${repo}] Generating summary for PR #${pr.number}`);

    return this.retryHelper.retry(async () => {
      const { stdout } = await this._spawnWithTimeout(command, 60000);

      // Try to extract a summary from plain text or JSON response
      const cleanStdout = stdout
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();

      try {
        const response = JSON.parse(cleanStdout);
        return response.result || response.response || response.summary || JSON.stringify(response);
      } catch {
        // Return plain text as summary
        return cleanStdout;
      }
    }, {
      retries: 2,
      minTimeout: 5000,
      factor: 2,
      context: `HermesAgent:${owner}/${repo}.summarizePR`
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
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`');
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
   * Build review prompt using shared template
   * @private
   */
  _buildReviewPrompt(owner, repo, pr, level, levelConfig, files, previousComments = [], lastCommits = []) {
    const focusAreas = levelConfig.focusAreas.join(', ');

    const possiblePaths = [
      path.join(process.cwd(), 'src/prompts/review.txt'),
      path.join(process.cwd(), 'prompts/review.txt'),
      path.join(__dirname, '../../prompts/review.txt')
    ];

    let template;
    for (const tryPath of possiblePaths) {
      try {
        template = fs.readFileSync(tryPath, 'utf-8');
        this.logger.info(`[HermesAgentAdapter:${owner}/${repo}] Prompt template loaded from: ${tryPath}`);
        break;
      } catch {
        // Try next path
      }
    }

    if (!template) {
      this.logger.error(`[HermesAgentAdapter:${owner}/${repo}] Failed to read prompt template`);
      throw new Error('Prompt template not found');
    }

    const instance = this._getInstanceByOwner(owner);
    const mcpName = instance?.mcpName || 'github';

    // Build previous comments block
    let previousCommentsBlock = '';
    if (previousComments && previousComments.length > 0) {
      const formattedComments = previousComments
        .map(c => `- File: ${c.path || 'unknown'}, Line: ${c.line || '?'} - "${c.body?.substring(0, 200) || ''}"`)
        .join('\n');

      previousCommentsBlock =
        'KOMENTAR REVIEW SEBELUMNYA (sudah pernah diberikan di PR ini):\n' +
        'PENTING: JANGAN ulangi komentar yang sama pada file dan baris yang sama kecuali issue belum diperbaiki.\n' +
        'Jika developer sudah memperbaiki issue yang disebutkan di komentar sebelumnya, SKIP komentar tersebut.\n' +
        formattedComments;
      this.logger.info(`[HermesAgentAdapter:${owner}/${repo}] Including ${previousComments.length} previous comments in prompt`);
    } else {
      previousCommentsBlock = '(Tidak ada komentar review sebelumnya)';
    }

    // Build last commits block
    let lastCommitsBlock = '';
    if (lastCommits && lastCommits.length > 0) {
      const formattedCommits = lastCommits
        .map(c => `- [${c.sha}] ${c.message} (oleh ${c.author})`)
        .join('\n');

      lastCommitsBlock =
        'COMMIT TERAKHIR DI PR INI (perubahan yang baru saja dilakukan developer):\n' +
        'Gunakan informasi ini untuk memahami apa yang sudah diperbaiki. Jika commit terakhir sudah memperbaiki issue yang sama dengan komentar sebelumnya, JANGAN ulangi komentar tersebut.\n' +
        'Gunakan MCP ' + mcpName + ' untuk melihat detail diff commit jika perlu (tool get_commit dengan sha lengkap).\n' +
        formattedCommits;
      this.logger.info(`[HermesAgentAdapter:${owner}/${repo}] Including ${lastCommits.length} last commits in prompt`);
    } else {
      lastCommitsBlock = '(Tidak ada commit info)';
    }

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
      .replace('{{MCP_NAME}}', mcpName)
      .replace('{{PREVIOUS_COMMENTS}}', previousCommentsBlock)
      .replace('{{LAST_COMMITS}}', lastCommitsBlock);
  }

  /**
   * Build summary prompt
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
   * Extract JSON from plain text by counting braces
   * Looks for the first valid JSON object with "summary" and "comments" keys
   * @param {string} text - Text to search
   * @returns {string|null} Extracted JSON string or null
   * @private
   */
  _extractJSON(text) {
    if (!text) return null;
    this.logger.debug(`[HermesAgentAdapter] extractJSON called, text length: ${text.length}`);

    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') {
        let braceCount = 1;
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
            if (char === '{') braceCount++;
            else if (char === '}') {
              braceCount--;
              if (braceCount === 0) {
                const jsonStr = text.substring(i, j + 1);

                if (jsonStr.includes('"summary"') && jsonStr.includes('"comments"')) {
                  try {
                    JSON.parse(jsonStr);
                    return jsonStr;
                  } catch {
                    this.logger.warn(`[HermesAgentAdapter] JSON at ${i}-${j} has expected keys but failed to parse`);
                  }
                }
                break;
              }
            }
          }
        }
      }
    }

    this.logger.warn(`[HermesAgentAdapter] No valid JSON found in text`);
    return null;
  }

  /**
   * Parse Hermes CLI response (plain text output)
   *
   * Hermes outputs plain text, so JSON must be extracted from it:
   * 1. Clean markdown code blocks
   * 2. Try direct JSON parse
   * 3. Fallback: extract JSON via brace counting (looking for "summary" + "comments")
   *
   * @param {string} stdout - Command output
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {PullRequest} pr - Pull request object
   * @returns {ReviewResult} Parsed review result
   * @private
   */
  _parseHermesResponse(stdout, owner, repo, pr) {
    let cleanStdout = (stdout || '').trim();

    // Remove markdown code blocks
    cleanStdout = cleanStdout
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();

    // Try direct JSON parse
    try {
      const parsed = JSON.parse(cleanStdout);
      if (parsed.summary && parsed.comments) {
        this.logger.info(`[HermesAgentAdapter:${owner}/${repo}] Direct JSON parse succeeded`);
        return this._buildResult(parsed, stdout);
      }
    } catch {
      // Not direct JSON, try extraction
    }

    // Fallback: extract JSON from plain text
    const jsonStr = this._extractJSON(stdout);
    if (jsonStr) {
      try {
        const parsed = JSON.parse(jsonStr);
        this.logger.info(`[HermesAgentAdapter:${owner}/${repo}] Extracted JSON from plain text, comments: ${parsed.comments?.length || 0}`);
        return this._buildResult(parsed, stdout);
      } catch (extractErr) {
        this.logger.error(`[HermesAgentAdapter:${owner}/${repo}] Failed to parse extracted JSON: ${extractErr.message}`);
      }
    }

    // No JSON found - return text fallback
    this.logger.warn(`[HermesAgentAdapter:${owner}/${repo}] No JSON found in Hermes output, using text fallback`);
    return {
      success: false,
      error: 'Failed to extract JSON from Hermes response',
      summary: (stdout || '').substring(0, 500) || 'Review completed (parse error)',
      comments: [],
      level: 'medium',
      agentCalledToolDirectly: false,
      agentRawOutput: (stdout || '').substring(0, 1000)
    };
  }

  /**
   * Build a ReviewResult from parsed JSON
   * @param {Object} parsed - Parsed JSON with summary and comments
   * @param {string} stdout - Raw stdout for agentRawOutput
   * @returns {ReviewResult}
   * @private
   */
  _buildResult(parsed, stdout) {
    const transformedComments = (parsed.comments || []).map(comment => ({
      ...comment,
      line: comment.start_line || comment.line
    }));

    return {
      success: true,
      summary: parsed.summary || 'Review completed',
      comments: transformedComments,
      level: 'medium',
      agentCalledToolDirectly: false,
      agentRawOutput: (stdout || '').substring(0, 1000)
    };
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
          `Hermes agent timeout after ${timeoutMs}ms`,
          'hermes',
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
            'hermes',
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
          'hermes',
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

module.exports = HermesAgentAdapter;
