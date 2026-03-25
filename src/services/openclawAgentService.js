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
    logger.info(`extractJSON called, text length: ${text.length}`);

    // Find all opening braces
    let braceIndex = 0;
    let sampleLogged = 0; // Track how many samples we've logged (limit to 5)
    const maxSamples = 5;

    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') {
        braceIndex++;
        logger.info(`Found opening brace at position ${i} (total: ${braceIndex})`);

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
                logger.info(`Found balanced braces at position ${i}-${j}, length: ${jsonStr.length}`);

                // Verify it's our expected JSON by checking for expected keys
                if (jsonStr.includes('"summary"') && jsonStr.includes('"comments"')) {
                  // Try to parse it to make sure it's valid JSON
                  try {
                    const parsed = JSON.parse(jsonStr);
                    logger.info(`Successfully parsed JSON! summary: "${parsed.summary?.substring(0, 50)}...", comments: ${parsed.comments?.length || 0}`);
                    return jsonStr;
                  } catch (e) {
                    logger.warn(`JSON at ${i}-${j} has "summary" and "comments" but failed to parse: ${e.message}`);
                  }
                } else {
                  // Log what keys this JSON has for debugging (log first few samples)
                  try {
                    const parsed = JSON.parse(jsonStr);
                    const keys = Object.keys(parsed);
                    const hasSummary = jsonStr.includes('"summary"');
                    const hasComments = jsonStr.includes('"comments"');

                    // Log more details for debugging
                    if (sampleLogged < maxSamples) {
                      logger.info(`JSON at ${i}-${j} has keys: ${keys.join(', ')} (has summary: ${hasSummary}, has comments: ${hasComments})`);
                      logger.info(`JSON sample (first 200 chars): ${jsonStr.substring(0, 200)}`);
                      sampleLogged++;
                    }
                  } catch (parseTry) {
                    if (sampleLogged < maxSamples) {
                      logger.info(`JSON at ${i}-${j} couldn't be parsed to check keys (continuing...)`);
                      logger.info(`JSON sample (first 200 chars): ${jsonStr.substring(0, 200)}`);
                      sampleLogged++;
                    }
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

    logger.warn(`No valid JSON found after checking ${braceIndex} braces`);
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

      // Log both stdout and stderr for debugging
      logger.info(`OpenClaw command completed for PR #${pr.number}`);
      logger.info(`stdout length: ${stdout?.length || 0}`);
      logger.info(`stderr length: ${stderr?.length || 0}`);
      logger.info(`stdout (first 2000 chars): ${stdout?.substring(0, 2000)}`);
      logger.info(`stdout (last 500 chars): ${stdout?.substring(Math.max(0, (stdout?.length || 0) - 500))}`);
      // Log full output for debugging when parsing fails
      logger.info(`Full agent output for PR #${pr.number}: ${stdout}`);
      if (stderr) {
        logger.info(`stderr (first 500 chars): ${stderr?.substring(0, 500)}`);
      }

      // Clean up markdown code blocks from output before parsing
      let cleanStdout = stdout;
      if (stdout) {
        cleanStdout = stdout
          .replace(/```json\s*/g, '')
          .replace(/```\s*/g, '')
          .trim();
        logger.info(`Cleaned stdout (removed markdown blocks), length: ${cleanStdout.length}`);
      }

      // Try to parse JSON
      let result;
      try {
        // First try: parse cleanStdout directly (trimmed, markdown removed)
        const trimmed = cleanStdout.trim();
        logger.debug(`Attempting to parse trimmed cleanStdout, length: ${trimmed.length}`);

        // Parse the OpenClaw response structure
        let openClawResponse = JSON.parse(trimmed);

        logger.info(`Parsed OpenClaw response, keys: ${Object.keys(openClawResponse).join(', ')}`);

        // Check if this is an OpenClaw response with nested result
        if (openClawResponse.result && openClawResponse.result.payloads && openClawResponse.result.payloads.length > 0) {
          logger.info(`Detected OpenClaw response structure with payloads (${openClawResponse.result.payloads.length} payloads)`);

          // Extract the actual review JSON from the first payload's text field
          const payloadText = openClawResponse.result.payloads[0].text;

          if (payloadText) {
            logger.info(`Payload text found (${payloadText.length} chars), first 200: ${payloadText.substring(0, 200)}`);

            // Remove markdown code blocks if present (```json ... ```)
            let reviewJsonText = payloadText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

            logger.info(`Extracted review JSON from payload (${reviewJsonText.length} chars), first 200: ${reviewJsonText.substring(0, 200)}`);

            // Parse the actual review JSON
            try {
              result = JSON.parse(reviewJsonText);
              logger.info(`Successfully parsed nested review JSON, summary: "${result.summary?.substring(0, 50)}...", comments: ${result.comments?.length || 0}`);
            } catch (innerErr) {
              logger.error(`Failed to parse nested review JSON: ${innerErr.message}`);
              logger.error(`Nested JSON text (first 500): ${reviewJsonText.substring(0, 500)}`);
              throw innerErr;
            }
          } else {
            throw new Error('Payload text is empty');
          }
        } else if (openClawResponse.summary && openClawResponse.comments) {
          // Direct review response format
          logger.info(`Detected direct review response format`);
          result = openClawResponse;
          logger.info(`Successfully parsed direct review, comments: ${result.comments?.length || 0}`);
        } else {
          logger.warn(`Unknown response format. Keys: ${Object.keys(openClawResponse).join(', ')}`);
          logger.warn(`Response structure: ${JSON.stringify(openClawResponse, null, 2).substring(0, 500)}`);
          throw new Error(`Unknown response format. Keys: ${Object.keys(openClawResponse).join(', ')}`);
        }
      } catch (parseErr) {
        // If output is not JSON, try to extract JSON from text
        logger.error(`Failed to parse JSON: ${parseErr.message}`);

        // Find JSON by brace counting - more reliable than regex
        // Try cleanStdout first (markdown removed), then raw stdout
        let jsonStr = this.extractJSON(cleanStdout);

        // If not found in cleanStdout, try raw stdout
        if (!jsonStr && stdout && stdout !== cleanStdout) {
          logger.info(`JSON not found in cleanStdout, trying raw stdout...`);
          jsonStr = this.extractJSON(stdout);
        }

        // If not found in stdout, try stderr
        if (!jsonStr && stderr && stderr.length > 0) {
          logger.info(`JSON not found in stdout, trying stderr...`);
          jsonStr = this.extractJSON(stderr);
        }

        // If still not found, try combined output
        if (!jsonStr) {
          logger.info(`JSON not found in cleanStdout/stdout/stderr separately, trying combined output...`);
          jsonStr = this.extractJSON(cleanStdout + '\n' + (stderr || ''));
        }

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
          logger.warn(`No JSON found in any output, using text fallback`);
          result = {
            summary: cleanStdout.substring(0, 500) || `Review ${level} untuk PR #${pr.number}`,
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

  /**
   * Format review body with proper GitHub markdown for fallback scenarios
   * @param {Object} params - Format parameters
   * @param {string} params.originalBody - Original review body
   * @param {number} params.prNumber - Pull request number
   * @param {string} params.originalEvent - Original event (e.g., REQUEST_CHANGES)
   * @param {string} params.newEvent - New event (e.g., COMMENT)
   * @param {string} params.reason - Reason for the change
   */
  async formatReviewBody({ originalBody, prNumber, originalEvent, newEvent, reason }) {
    return this.retryOperation(async () => {
      logger.info(`Formatting review body for PR #${prNumber} with OpenClaw agent`);

      // Load format prompt template
      const prompt = this.buildFormatPrompt(originalBody, originalEvent, newEvent, reason);

      // Use the 'main' agent for formatting (or configured format agent)
      const agentName = process.env.OPENCLAW_AGENT_FORMAT || 'main';
      const command = `openclaw agent --agent ${agentName} --message '${prompt.replace(/'/g, "\\'")}' --timeout 30`;

      logger.info(`Executing OpenClaw format command for PR #${prNumber} with agent: ${agentName}`);
      const { stdout, stderr } = await execPromise(command);

      logger.info(`OpenClaw format command completed for PR #${prNumber}`);
      logger.debug(`stdout length: ${stdout?.length || 0}`);
      if (stderr) {
        logger.debug(`stderr: ${stderr?.substring(0, 200)}`);
      }

      // Parse the response
      let formattedBody;
      try {
        const trimmed = stdout.trim();
        const openClawResponse = JSON.parse(trimmed);

        // Extract the formatted body from the response
        if (openClawResponse.result && openClawResponse.result.payloads && openClawResponse.result.payloads.length > 0) {
          formattedBody = openClawResponse.result.payloads[0].text;
          // Remove markdown code blocks if present
          formattedBody = formattedBody.replace(/```\w*\s*/g, '').replace(/```\s*/g, '').trim();
        } else if (typeof openClawResponse === 'string') {
          formattedBody = openClawResponse;
        } else {
          formattedBody = trimmed;
        }

        logger.info(`Successfully formatted review body for PR #${prNumber}, length: ${formattedBody?.length || 0}`);
        return formattedBody || originalBody; // Fallback to original if formatting fails
      } catch (parseErr) {
        logger.warn(`Failed to parse format response: ${parseErr.message}, using original body`);
        // Fallback to simple formatting if agent call fails
        return `${originalBody}\n\n---\n\n> **⚠️ AUTO-FIXED:** This review was posted as \`${newEvent}\` instead of \`${originalEvent}\` because ${reason}.`;
      }
    }, 2, 2000, config.retries.backoffFactor);
  }

  /**
   * Build format prompt from template
   */
  buildFormatPrompt(originalBody, originalEvent, newEvent, reason) {
    // Try multiple paths for prompt template (dev vs prod)
    const possiblePaths = [
      path.join(process.cwd(), 'src/prompts/review_body_format.txt'),  // Dev environment
      path.join(process.cwd(), 'prompts/review_body_format.txt'),      // Prod environment
      path.join(__dirname, '../prompts/review_body_format.txt')        // Relative to service file
    ];

    let template;
    for (const tryPath of possiblePaths) {
      try {
        template = fs.readFileSync(tryPath, 'utf-8');
        logger.info(`Format prompt template loaded from: ${tryPath}, length: ${template.length} chars`);
        break;
      } catch (err) {
        // Try next path
      }
    }

    if (!template) {
      logger.error(`Failed to read format prompt template from any of: ${possiblePaths.join(', ')}`);
      throw new Error(`Format prompt template not found in any location`);
    }

    // Replace placeholders
    return template
      .replace('{{ORIGINAL_BODY}}', originalBody)
      .replace('{{ORIGINAL_EVENT}}', originalEvent)
      .replace('{{NEW_EVENT}}', newEvent)
      .replace('{{REASON}}', reason);
  }
}

module.exports = new OpenClawAgentService();
