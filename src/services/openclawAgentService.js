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
   * Invoke OpenClaw summary agent to generate structured PR intelligence
   */
  async generateSummary(pr, prDetails) {
    return this.retryOperation(async () => {
      logger.debug(`Invoking summary agent for PR #${pr.number}`);
      
      // Prepare input payload for the summary agent
      const payload = JSON.stringify({ pr, prDetails });
      const command = `openclaw agent invoke ${config.openclaw.summaryAgent} --message '${payload.replace(/'/g, "\\'")}' --timeout 90`;
      
      const { stdout, stderr } = await execPromise(command);
      if (stderr) logger.warn(`Summary agent stderr: ${stderr}`);

      try {
        return JSON.parse(stdout);
      } catch (parseErr) {
        logger.error(`Failed to parse summary agent output: ${stdout}`);
        throw new Error(`Summary agent output parse failed: ${parseErr.message}`);
      }
    }, config.retries.agentRetries, 5000, config.retries.backoffFactor);
  }

  /**
   * Invoke full review agent for deep AI analysis of a PR
   */
  async runFullReview(pr) {
    return this.retryOperation(async () => {
      logger.info(`Starting full review agent for PR #${pr.number}`);
      
      // Execute gemini review sesuai aturan baru: hanya buat review comment, tidak approve otomatis
      const fullReviewPrompt = `Review pull request #${pr.number} yang ada di GitHub repository PT-Sinarmas-Multifinance/simasfin-backend. INSTRUKSI WAJIB:
      1. BANDINGKAN kode antara source branch (${pr.headBranch}) dengan target branch (${pr.baseBranch}) — analisis semua perubahan yang diusulkan
      2. Buat SUMMARY HIGH LEVEL yang ringkas: tujuan utama PR, skala perubahan, dan area yang terdampak
      3. Berikan COMMENT REVIEW yang jelas: potensi masalah, best practice yang perlu diperbaiki, atau poin positif dari perubahan
      4. HANYA GENERATE KOMENTAR REVIEW — JANGAN lakukan approve otomatis, proses approve hanya lewat tombol terpisah di Telegram
      INFORMASI LENGKAP REPO:
      - Pemilik akun GitHub: PT-Sinarmas-Multifinance (akun kerja/kantor)
      - Nama repository: simasfin-backend
      - Pembuat PR: ${pr.author}
      - URL penuh PR: ${pr.url}
      - Source branch (candidate): ${pr.headBranch}
      - Target branch (main): ${pr.baseBranch}
      Hasil review harus terstruktur jelas untuk dikirim sebagai komentar di PR.`;
      const command = `openclaw run --model github-copilot/claude-sonnet-4.6 --message '${fullReviewPrompt.replace(/'/g, "\\'")}' --timeout 120`;
      const { stdout, stderr } = await execPromise(command);
      
      if (stderr) logger.warn(`Review agent stderr: ${stderr}`);
      return JSON.parse(stdout);
    }, config.retries.agentRetries, 10000, config.retries.backoffFactor);
  }
}

module.exports = new OpenClawAgentService();
