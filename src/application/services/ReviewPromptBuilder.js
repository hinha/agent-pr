const fs = require('fs');
const path = require('path');
const {
  DISCORD_HANDOFF_PROTOCOL,
  DiscordHandoffMessageType
} = require('../../shared/discordHandoffProtocol');

/**
 * Renders prompts/review.txt for both CLI agents and Discord Hermes handoff.
 */
class ReviewPromptBuilder {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.templatePath = options.templatePath || null;
  }

  /**
   * @param {Object} input
   * @param {string} input.owner
   * @param {string} input.repo
   * @param {Object} input.pr
   * @param {string} input.level
   * @param {Object} input.levelConfig
   * @param {string} input.mcpName
   * @param {Array<Object>} [input.previousComments]
   * @param {Array<Object>} [input.lastCommits]
   * @returns {string}
   */
  build(input) {
    const {
      owner,
      repo,
      pr,
      level,
      levelConfig,
      mcpName = 'github',
      previousComments = [],
      lastCommits = []
    } = input;

    if (!levelConfig) {
      throw new Error(`Invalid review level: ${level}`);
    }

    const template = this._loadTemplate(owner, repo);
    const focusAreas = (levelConfig.focusAreas || []).join(', ');

    return this._replaceAll(template, {
      PR_NUMBER: pr.number,
      LEVEL: level.toUpperCase(),
      FOCUS_AREAS: focusAreas,
      MAX_COMMENTS: levelConfig.maxCommentsPerFile,
      OWNER: owner,
      REPO: repo,
      SOURCE_BRANCH: pr.headBranch || 'unknown',
      TARGET_BRANCH: pr.baseBranch || 'main',
      PR_URL: pr.url,
      MCP_NAME: mcpName,
      PREVIOUS_COMMENTS: this._buildPreviousCommentsBlock(previousComments, owner, repo),
      LAST_COMMITS: this._buildLastCommitsBlock(lastCommits, mcpName, owner, repo)
    });
  }

  buildDiscordHandoff(input) {
    const { mentionBotName, basePrompt, sessionId } = input;

    const protocolInstructions = [
      'PROTOKOL HANDOFF WAJIB:',
      `- Semua pesan mesin HARUS JSON envelope dengan "protocol": "${DISCORD_HANDOFF_PROTOCOL}"`,
      `- Semua pesan mesin HARUS membawa "session_id": "${sessionId}"`,
      '- Gunakan "message_type" untuk membedakan prompt_request, progress, final_review, final_status, atau error',
      `- Untuk meminta prompt lengkap, reply ke trigger dengan JSON: {"protocol":"${DISCORD_HANDOFF_PROTOCOL}","session_id":"${sessionId}","message_type":"${DiscordHandoffMessageType.PROMPT_REQUEST}","payload":{"message":"Send complete review prompt"}}`,
      `- HASIL FINAL WAJIB reply JSON envelope dengan "message_type":"${DiscordHandoffMessageType.FINAL_REVIEW}"`,
      `- Bentuk hasil final: {"protocol":"${DISCORD_HANDOFF_PROTOCOL}","session_id":"${sessionId}","message_type":"${DiscordHandoffMessageType.FINAL_REVIEW}","payload":{"summary":"...","comments":[...]}}`,
      '- JANGAN submit review GitHub langsung. Bot ini yang akan submit.',
      '- Chat bebas tetap boleh, tetapi bot ini hanya memproses envelope JSON dengan protocol dan session_id yang cocok.'
    ].join('\n');

    return {
      triggerContent: [
        `${mentionBotName}`,
        'KERJAKAN review ini di channel ini.',
        `SESSION_ID: ${sessionId}`,
        'Anda boleh mengirim progress atau diskusi biasa selama review berjalan.',
        `BALASAN MESIN WAJIB memakai protocol ${DISCORD_HANDOFF_PROTOCOL}.`,
        `Jika butuh prompt lengkap, reply JSON dengan message_type "${DiscordHandoffMessageType.PROMPT_REQUEST}".`,
        `Contoh prompt request: {"protocol":"${DISCORD_HANDOFF_PROTOCOL}","session_id":"${sessionId}","message_type":"${DiscordHandoffMessageType.PROMPT_REQUEST}","payload":{"message":"Send complete review prompt"}}`,
        `HASIL FINAL WAJIB reply JSON dengan message_type "${DiscordHandoffMessageType.FINAL_REVIEW}".`,
        'JANGAN submit review GitHub langsung. Bot ini yang akan submit hasil final ke GitHub.',
        'Prompt review lengkap akan dikirim sebagai attachment `.txt` pada reply setelah pesan ini.'
      ].join('\n'),
      detailContent: `${protocolInstructions}\n\n${basePrompt}`
    };
  }

  _loadTemplate(owner, repo) {
    const possiblePaths = this.templatePath
      ? [this.templatePath]
      : [
          path.join(process.cwd(), 'src/prompts/review.txt'),
          path.join(process.cwd(), 'prompts/review.txt'),
          path.join(__dirname, '../../../prompts/review.txt')
        ];

    for (const tryPath of possiblePaths) {
      try {
        const template = fs.readFileSync(tryPath, 'utf-8');
        this.logger.info(`[ReviewPromptBuilder:${owner}/${repo}] Prompt template loaded from: ${tryPath}`);
        return template;
      } catch {
        // Try next path.
      }
    }

    this.logger.error(`[ReviewPromptBuilder:${owner}/${repo}] Failed to read prompt template`);
    throw new Error('Prompt template not found');
  }

  _buildPreviousCommentsBlock(previousComments, owner, repo) {
    if (!previousComments || previousComments.length === 0) {
      return '(Tidak ada komentar review sebelumnya)';
    }

    const formattedComments = previousComments
      .map(c => `- File: ${c.path || 'unknown'}, Line: ${c.line || '?'} - "${(c.body || '').substring(0, 200)}"`)
      .join('\n');

    this.logger.info(`[ReviewPromptBuilder:${owner}/${repo}] Including ${previousComments.length} previous comments in prompt`);

    return (
      'KOMENTAR REVIEW SEBELUMNYA (sudah pernah diberikan di PR ini):\n' +
      'PENTING: JANGAN ulangi komentar yang sama pada file dan baris yang sama kecuali issue belum diperbaiki.\n' +
      'Jika developer sudah memperbaiki issue yang disebutkan di komentar sebelumnya, SKIP komentar tersebut.\n' +
      formattedComments
    );
  }

  _buildLastCommitsBlock(lastCommits, mcpName, owner, repo) {
    if (!lastCommits || lastCommits.length === 0) {
      return '(Tidak ada commit info)';
    }

    const formattedCommits = lastCommits
      .map(c => `- [${c.sha}] ${c.message} (oleh ${c.author})`)
      .join('\n');

    this.logger.info(`[ReviewPromptBuilder:${owner}/${repo}] Including ${lastCommits.length} last commits in prompt`);

    return (
      'COMMIT TERAKHIR DI PR INI (perubahan yang baru saja dilakukan developer):\n' +
      'Gunakan informasi ini untuk memahami apa yang sudah diperbaiki. Jika commit terakhir sudah memperbaiki issue yang sama dengan komentar sebelumnya, JANGAN ulangi komentar tersebut.\n' +
      `Gunakan MCP ${mcpName} untuk melihat detail diff commit jika perlu (tool get_commit dengan sha lengkap).\n` +
      formattedCommits
    );
  }

  _replaceAll(template, replacements) {
    return Object.entries(replacements).reduce((result, [key, value]) => {
      return result.split(`{{${key}}}`).join(String(value ?? ''));
    }, template);
  }
}

module.exports = ReviewPromptBuilder;
