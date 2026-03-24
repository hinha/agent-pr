const { exec } = require('child_process');
const util = require('util');
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

      // OpenClaw CLI: use 'agent' subcommand with --message flag
      const command = `openclaw agent --message '${reviewPrompt.replace(/'/g, "\\'")}' --model ${config.openclaw.reviewModel} --timeout 180`;

      const { stdout, stderr } = await execPromise(command);
      if (stderr) logger.warn(`Review agent stderr: ${stderr}`);

      const result = JSON.parse(stdout);

      // Ensure result has expected structure
      return {
        summary: result.summary || `Review ${level} untuk PR #${pr.number}`,
        comments: result.comments || [],
        level: level,
        timestamp: new Date().toISOString()
      };
    }, config.retries.agentRetries, 10000, config.retries.backoffFactor);
  }

  /**
   * Build review prompt based on level
   */
  buildReviewPrompt(pr, level, levelConfig) {
    const focusAreas = levelConfig.focusAreas.join(', ');

    return `Review pull request #${pr.number} dengan level **${level.toUpperCase()}**.

INSTRUKSI:
1. Analisis kode PR dengan fokus pada: ${focusAreas}
2. Berikan comment review spesifik per file dan baris jika ada issue
3. Berikan severity level untuk setiap comment: LOW, MEDIUM, atau HIGH
4. Maximum ${levelConfig.maxCommentsPerFile} comments per file

OUTPUT FORMAT (JSON):
{
  "summary": "Ringkasan review secara keseluruhan",
  "comments": [
    {
      "file": "src/file.js",
      "line": 42,
      "severity": "HIGH",
      "message": "Penjelasan issue dan rekomendasi perbaikan"
    }
  ]
}

INFO PR:
- Repository: ${config.github.owner}/${config.github.repo}
- Source branch: ${pr.headBranch}
- Target branch: ${pr.baseBranch}
- URL: ${pr.url}

Pastikan output hanya JSON yang valid, tanpa text tambahan.`;
  }
}

module.exports = new OpenClawAgentService();
