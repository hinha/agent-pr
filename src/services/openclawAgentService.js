const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const execPromise = util.promisify(exec);
const config = require('../config');
const logger = require('../utils/logger');

class OpenClawAgentService {
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
      logger.info(`OpenClaw raw output (first 500 chars): ${stdout?.substring(0, 500)}`);

      // Try to parse JSON, with fallback for text response
      let result;
      try {
        result = JSON.parse(stdout);
      } catch (parseErr) {
        // If output is not JSON, try to extract JSON from text
        logger.warn(`Failed to parse JSON directly, attempting extraction: ${parseErr.message}`);
        const jsonMatch = stdout.match(/\{[\s\S]*}/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
        } else {
          // Fallback: create response from text
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

    // Read prompt template from file
    const templatePath = path.join(process.cwd(), 'src/prompts/review.txt');
    logger.info(`Reading prompt template from: ${templatePath}`);
    let template;
    try {
      template = fs.readFileSync(templatePath, 'utf-8');
      logger.info(`Prompt template loaded successfully, length: ${template.length} chars`);
    } catch (err) {
      logger.error(`Failed to read prompt template from ${templatePath}: ${err.message}`);
      throw new Error(`Prompt template not found: ${templatePath}`);
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
