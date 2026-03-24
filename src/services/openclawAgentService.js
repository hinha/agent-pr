const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const execPromise = util.promisify(exec);
const config = require('../config');
const logger = require('../utils/logger');

class OpenClawAgentService {
  /**
   * Extract JSON from text by counting braces (more reliable than regex)
   * Looks for the first valid JSON object with "summary" and "comments" keys
   */
  extractJSON(text) {
    // Find all opening braces
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') {
        // Count braces to find matching closing brace
        let braceCount = 1; // Start with 1 because we found the first '{'
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
                // Found balanced braces, extract this substring
                const jsonStr = text.substring(i, j + 1);
                logger.debug(`Checking JSON at position ${i}-${j}, length: ${jsonStr.length}`);

                // Verify it's our expected JSON by checking for expected keys
                if (jsonStr.includes('"summary"') && jsonStr.includes('"comments"')) {
                  // Try to parse it to make sure it's valid JSON
                  try {
                    JSON.parse(jsonStr);
                    logger.info(`Found valid JSON object at position ${i}-${j}`);
                    return jsonStr;
                  } catch (e) {
                    logger.debug(`JSON at ${i}-${j} is not valid, continuing search...`);
                  }
                }
                // Found a valid JSON object but not our target, continue to next brace
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
        logger.warn(`Agent attempt ${attempt} failed: ${err.message}, retrying in ${delay}ms, retries left: ${retries - attempt}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Run review with specified level (low/medium/high)
   * @param {Object} pr - Pull request object
   * @param {string} level - Review level: 'low', 'medium', or 'high'
   */
  async runReviewWithLevel(pr, level) {
    const levelConfig = config.reviewLevels[level];
    if (!levelConfig) {
      throw new Error(`Invalid review level: ${level}`);
    }

    return this.retryOperation(async () => {
      logger.info(`Starting ${level} level review for PR #${pr.number}`);

      // Build level-specific prompt
      const reviewPrompt = this.buildReviewPrompt(pr, level, levelConfig);

      // OpenClaw CLI: use level-specific agent via Gateway
      // Falls back to 'main' (default agent) or OPENCLAW_AGENT_REVIEW
      const agentMap = {
        low: process.env.OPENCLAW_AGENT_LOW || 'main',
        medium: process.env.OPENCLAW_AGENT_MEDIUM || 'main',
        high: process.env.OPENCLAW_AGENT_HIGH || 'main'
      };
      const agentName = agentMap[level] || config.openclaw.reviewAgent || 'main';
      const command = `openclaw agent --agent ${agentName} --json --message '${reviewPrompt.replace(/'/g, "\\'")}' --timeout ${config.openclaw.reviewTimeoutSeconds}`;

      logger.info(`Executing OpenClaw command for PR #${pr.number} with agent: ${agentName}`);
      const { stdout, stderr } = await execPromise(command);
      if (stderr) logger.warn(`Review agent stderr: ${stderr}`);

      // Log raw output for debugging
      logger.info(`OpenClaw command completed for PR #${pr.number}, output length: ${stdout?.length || 0}`);
      logger.info(`OpenClaw raw output (first 1000 chars): ${stdout?.substring(0, 1000)}`);

      // Try to parse JSON, with fallback for text response
      let result;
      try {
        // First try: parse stdout directly (trimmed)
        const trimmed = stdout.trim();
        logger.debug(`Attempting to parse trimmed output, length: ${trimmed.length}`);
        result = JSON.parse(trimmed);
        logger.info(`Successfully parsed JSON directly, summary: ${result.summary?.substring(0, 100)}..., comments: ${result.comments?.length || 0}`);
      } catch (parseErr) {
        // If output is not JSON, try to extract JSON from text
        logger.warn(`Failed to parse JSON directly: ${parseErr.message}`);

        // Find JSON by brace counting - more reliable than regex
        const jsonStr = this.extractJSON(stdout);
        if (jsonStr) {
          logger.info(`Extracted JSON string (${jsonStr.length} chars), attempting to parse...`);
          try {
            result = JSON.parse(jsonStr);
            logger.info(`Successfully parsed extracted JSON, comments: ${result.comments?.length || 0}`);
          } catch (extractErr) {
            logger.error(`Failed to parse extracted JSON: ${extractErr.message}`);
            logger.error(`Extracted string (first 500): ${jsonStr.substring(0, 500)}`);
            throw extractErr;
          }
        } else {
          // Fallback: create response from text
          logger.warn(`No JSON found in output, using text fallback`);
          result = {
            summary: stdout.substring(0, 500) || `Review ${level} untuk PR #${pr.number}`,
            comments: []
          };
        }
      }

      // Ensure result has expected structure
      return {
        summary: result.summary || `Review ${level} untuk PR #${pr.number}`,
        comments: result.comments || [],
        level: level,
        timestamp: new Date().toISOString()
      };
    }, config.retries.agentRetries, 1000, config.retries.backoffFactor);
  }

  /**
   * Build review prompt based on level
   */
  buildReviewPrompt(pr, level, levelConfig) {
    const focusAreas = levelConfig.focusAreas.join(', ');

    // Try multiple paths for prompt template (dev vs prod)
    const possiblePaths = [
      path.join(process.cwd(), 'src/prompts/review.txt'),  // Dev environment
      path.join(process.cwd(), 'prompts/review.txt'),      // Prod environment
      path.join(__dirname, '../prompts/review.txt')        // Relative to service file
    ];

    let template;
    let templatePath = '';
    for (const tryPath of possiblePaths) {
      try {
        template = fs.readFileSync(tryPath, 'utf-8');
        templatePath = tryPath;
        logger.info(`Prompt template loaded from: ${tryPath}, length: ${template.length} chars`);
        break;
      } catch (err) {
        // Try next path
      }
    }

    if (!template) {
      logger.error(`Failed to read prompt template from any of: ${possiblePaths.join(', ')}`);
      throw new Error(`Prompt template not found in any location`);
    }

    // Replace placeholders
    return template
      .replace('{{PR_NUMBER}}', pr.number)
      .replace('{{LEVEL}}', level.toUpperCase())
      .replace('{{FOCUS_AREAS}}', focusAreas)
      .replace('{{MAX_COMMENTS}}', levelConfig.maxCommentsPerFile)
      .replace('{{OWNER}}', config.github.owner)
      .replace('{{REPO}}', config.github.repo)
      .replace('{{SOURCE_BRANCH}}', pr.headBranch)
      .replace('{{TARGET_BRANCH}}', pr.baseBranch)
      .replace('{{PR_URL}}', pr.url);
  }
}

module.exports = new OpenClawAgentService();
