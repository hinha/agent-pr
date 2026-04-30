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
      this.logger.info(`[OpenClawAgentAdapter:${owner}/${repo}] stdout length: ${stdout?.length || 0}, stderr length: ${stderr?.length || 0}`);
      this.logger.debug(`[OpenClawAgentAdapter:${owner}/${repo}] stdout (first 2000 chars): ${stdout?.substring(0, 2000)}`);
      this.logger.debug(`[OpenClawAgentAdapter:${owner}/${repo}] stdout (last 500 chars): ${stdout?.substring(Math.max(0, (stdout?.length || 0) - 500))}`);
      if (stderr) {
        this.logger.info(`[OpenClawAgentAdapter:${owner}/${repo}] stderr (first 500 chars): ${stderr?.substring(0, 500)}`);
      }

      // Clean up markdown code blocks from output before parsing
      let cleanStdout = stdout;
      if (stdout) {
        cleanStdout = stdout
          .replace(/```json\s*/g, '')
          .replace(/```\s*/g, '')
          .trim();
        this.logger.debug(`[OpenClawAgentAdapter:${owner}/${repo}] Cleaned stdout (removed markdown blocks), length: ${cleanStdout.length}`);
      }

      // Parse the OpenClaw response (pass stderr for fallback extraction)
      const result = this._parseOpenClawResponse(cleanStdout, owner, repo, pr, stderr);

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
   * Extract JSON from text by counting braces (more reliable than regex)
   * Looks for the first valid JSON object with "summary" and "comments" keys
   * @param {string} text - Text to search
   * @returns {string|null} Extracted JSON string or null
   * @private
   */
  _extractJSON(text) {
    if (!text) return null;
    this.logger.debug(`[OpenClawAgentAdapter] extractJSON called, text length: ${text.length}`);

    let sampleLogged = 0;
    const maxSamples = 5;

    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') {
        // Count braces to find matching closing brace
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

                // Verify it's our expected JSON by checking for expected keys
                if (jsonStr.includes('"summary"') && jsonStr.includes('"comments"')) {
                  try {
                    const parsed = JSON.parse(jsonStr);
                    this.logger.info(`[OpenClawAgentAdapter] Successfully parsed JSON! summary: "${parsed.summary?.substring(0, 50)}...", comments: ${parsed.comments?.length || 0}`);
                    return jsonStr;
                  } catch (e) {
                    this.logger.warn(`[OpenClawAgentAdapter] JSON at ${i}-${j} has "summary" and "comments" but failed to parse: ${e.message}`);
                  }
                } else {
                  if (sampleLogged < maxSamples) {
                    try {
                      const parsed = JSON.parse(jsonStr);
                      const keys = Object.keys(parsed);
                      this.logger.debug(`[OpenClawAgentAdapter] JSON at ${i}-${j} has keys: ${keys.join(', ')}`);
                    } catch (parseTry) {
                      // Skip non-parseable JSON blocks
                    }
                    sampleLogged++;
                  }
                }
                break;
              }
            }
          }
        }
      }
    }

    this.logger.warn(`[OpenClawAgentAdapter] No valid JSON found in text`);
    return null;
  }

  /**
   * Parse OpenClaw CLI response
   * Handles multiple response formats from OpenClaw agent:
   * 1. Direct JSON: { summary, comments }
   * 2. Nested result: { result: { payloads: [{ text: "..." }] } }
   * 3. Nested result string: { result: "{ summary, comments }" }
   * 4. Fallback: extract JSON from raw text via brace counting
   *
   * @param {string} stdout - Command output
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {PullRequest} pr - Pull request object
   * @param {string} [stderr] - Command stderr output (for fallback extraction)
   * @returns {ReviewResult} Parsed review result
   * @private
   */
  _parseOpenClawResponse(stdout, owner, repo, pr, stderr) {
    let result;

    try {
      const trimmed = (stdout || '').trim();
      let openClawResponse = JSON.parse(trimmed);

      this.logger.info(`[OpenClawAgentAdapter:${owner}/${repo}] Parsed OpenClaw response, keys: ${Object.keys(openClawResponse).join(', ')}`);

      // Format 1: OpenClaw response with nested payloads structure
      // { result: { payloads: [{ text: '{"summary":"...", "comments":[...]}' }] } }
      if (openClawResponse.result && openClawResponse.result.payloads && openClawResponse.result.payloads.length > 0) {
        this.logger.info(`[OpenClawAgentAdapter:${owner}/${repo}] Detected OpenClaw response structure with payloads (${openClawResponse.result.payloads.length} payloads)`);

        const payloadText = openClawResponse.result.payloads[0].text;

        if (payloadText) {
          this.logger.info(`[OpenClawAgentAdapter:${owner}/${repo}] Payload text found (${payloadText.length} chars)`);

          // Remove markdown code blocks if present
          let reviewJsonText = payloadText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

          try {
            result = JSON.parse(reviewJsonText);
            this.logger.info(`[OpenClawAgentAdapter:${owner}/${repo}] Successfully parsed nested review JSON, comments: ${result.comments?.length || 0}`);
          } catch (innerErr) {
            this.logger.error(`[OpenClawAgentAdapter:${owner}/${repo}] Failed to parse nested review JSON: ${innerErr.message}`);
            throw innerErr;
          }
        } else {
          throw new Error('Payload text is empty');
        }

      // Format 2: Nested result as string
      } else if (openClawResponse.result && typeof openClawResponse.result === 'string') {
        this.logger.info(`[OpenClawAgentAdapter:${owner}/${repo}] Detected nested result string`);
        result = JSON.parse(openClawResponse.result);

      // Format 3: Direct review response { summary, comments }
      } else if (openClawResponse.summary && openClawResponse.comments) {
        this.logger.info(`[OpenClawAgentAdapter:${owner}/${repo}] Detected direct review response format`);
        result = openClawResponse;

      // Format 4: Nested result as object (without payloads) but has summary+comments
      } else if (openClawResponse.result && openClawResponse.result.summary && openClawResponse.result.comments) {
        this.logger.info(`[OpenClawAgentAdapter:${owner}/${repo}] Detected nested result object with summary+comments`);
        result = openClawResponse.result;

      } else {
        this.logger.warn(`[OpenClawAgentAdapter:${owner}/${repo}] Unknown response format. Keys: ${Object.keys(openClawResponse).join(', ')}`);
        throw new Error(`Unknown response format. Keys: ${Object.keys(openClawResponse).join(', ')}`);
      }

    } catch (parseErr) {
      // If output is not JSON or unknown format, try to extract JSON from text
      this.logger.error(`[OpenClawAgentAdapter:${owner}/${repo}] Failed to parse JSON: ${parseErr.message}`);

      // Try cleanStdout first, then raw stdout, then stderr
      let jsonStr = this._extractJSON(stdout);

      if (!jsonStr && stderr && stderr.length > 0) {
        this.logger.info(`[OpenClawAgentAdapter:${owner}/${repo}] JSON not found in stdout, trying stderr...`);
        jsonStr = this._extractJSON(stderr);
      }

      if (!jsonStr && stdout && stderr) {
        this.logger.info(`[OpenClawAgentAdapter:${owner}/${repo}] JSON not found separately, trying combined output...`);
        jsonStr = this._extractJSON(stdout + '\n' + stderr);
      }

      if (jsonStr) {
        this.logger.info(`[OpenClawAgentAdapter:${owner}/${repo}] Extracted JSON string (${jsonStr.length} chars), parsing...`);
        try {
          result = JSON.parse(jsonStr);
          this.logger.info(`[OpenClawAgentAdapter:${owner}/${repo}] Successfully parsed extracted JSON, comments: ${result.comments?.length || 0}`);
        } catch (extractErr) {
          this.logger.error(`[OpenClawAgentAdapter:${owner}/${repo}] Failed to parse extracted JSON: ${extractErr.message}`);
          return {
            success: false,
            error: `Failed to parse OpenClaw response: ${extractErr.message}`,
            summary: 'Review completed (parse error)',
            comments: [],
            level: 'medium',
            agentCalledToolDirectly: false,
            agentRawOutput: stdout
          };
        }
      } else {
        // Fallback: no JSON found anywhere
        this.logger.warn(`[OpenClawAgentAdapter:${owner}/${repo}] No JSON found in any output, using text fallback`);
        return {
          success: false,
          error: `Failed to parse OpenClaw response: ${parseErr.message}`,
          summary: (stdout || '').substring(0, 500) || 'Review completed (parse error)',
          comments: [],
          level: 'medium',
          agentCalledToolDirectly: false,
          agentRawOutput: stdout
        };
      }
    }

    // Check if agent called create_pull_request_review directly
    // Check via tool_calls array (structured detection)
    let agentCalledToolDirectly = result.tool_calls?.some(
      call => call.function?.name === 'create_pull_request_review'
    ) || false;

    // Also check via regex patterns in output (heuristic detection, like feature branch)
    if (!agentCalledToolDirectly) {
      const agentOutput = (stdout || '').substring(0, 2000);
      const directToolCallPatterns = [
        /\breview\s+(?:created|submitted|approved)\b/i,
        /\bpull\s+request\s+review\s+#?\d+\b/i,
        /\bsuccessfully\s+created\s+(?:a\s+)?review\b/i
      ];
      agentCalledToolDirectly = directToolCallPatterns.some(pattern => pattern.test(agentOutput));

      if (agentCalledToolDirectly) {
        this.logger.warn(`[OpenClawAgentAdapter:${owner}/${repo}] Agent may have called create_pull_request_review directly (detected via output patterns)`);
      }
    }

    // Transform comments: map start_line to line (MCP expects 'line' field)
    const transformedComments = (result.comments || []).map(comment => ({
      ...comment,
      line: comment.start_line || comment.line
    }));

    return {
      success: true,
      summary: result.summary || result.response || 'Review completed',
      comments: transformedComments,
      level: 'medium',
      agentCalledToolDirectly: agentCalledToolDirectly,
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
