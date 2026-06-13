const {
  DISCORD_HANDOFF_PROTOCOL,
  DiscordHandoffMessageType
} = require('../../shared/discordHandoffProtocol');

class ExternalReviewSessionService {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.sessionsByQueueItemId = new Map();
    this.sessionsByReplyTargetMessageId = new Map();
  }

  startSession(sessionInput = {}) {
    const timeoutMs = sessionInput.timeoutMs || 0;
    const now = Date.now();
    const deadlineAt = sessionInput.deadlineAt || new Date(now + timeoutMs).toISOString();
    const session = {
      ...sessionInput,
      sessionId: sessionInput.sessionId || sessionInput.queueItemId,
      deadlineAt,
      status: 'pending',
      promptDelivered: Boolean(sessionInput.promptDelivered),
      partialFinalContent: '',
      partialFinalUpdatedAt: null
    };

    const promise = new Promise((resolve, reject) => {
      session.resolve = resolve;
      session.reject = reject;
    });
    const promptRequestPromise = new Promise((resolve) => {
      session.resolvePromptRequest = resolve;
    });

    session.promise = promise;
    session.promptRequestPromise = promptRequestPromise;
    session.promptRequestMessage = null;
    session.timer = setTimeout(() => {
      this.failSession(session.queueItemId, new Error('Timed out waiting for external review reply'));
    }, Math.max(timeoutMs, 1));

    session.replyTargetMessageIds = new Set([String(session.triggerMessageId)]);
    this.sessionsByQueueItemId.set(session.queueItemId, session);
    this.sessionsByReplyTargetMessageId.set(String(session.triggerMessageId), session);

    this.logger.info(
      `[ExternalReviewSessionService] Started session for ${session.instanceKey}/${session.repoName} PR #${session.prNumber}`
    );

    return { ...session };
  }

  awaitResult(queueItemId) {
    const session = this.sessionsByQueueItemId.get(queueItemId);
    if (!session) {
      return Promise.reject(new Error(`External review session not found: ${queueItemId}`));
    }
    return session.promise;
  }

  awaitPromptRequest(queueItemId) {
    const session = this.sessionsByQueueItemId.get(queueItemId);
    if (!session) {
      return Promise.reject(new Error(`External review session not found: ${queueItemId}`));
    }
    return session.promptRequestPromise;
  }

  registerReplyTargets(queueItemId, messages = []) {
    const session = this.sessionsByQueueItemId.get(queueItemId);
    if (!session) {
      throw new Error(`External review session not found: ${queueItemId}`);
    }

    for (const message of messages) {
      const messageId = message?.id;
      if (!messageId) {
        continue;
      }

      const normalizedId = String(messageId);
      if (session.replyTargetMessageIds.has(normalizedId)) {
        continue;
      }

      session.replyTargetMessageIds.add(normalizedId);
      this.sessionsByReplyTargetMessageId.set(normalizedId, session);
    }

    return Array.from(session.replyTargetMessageIds);
  }

  handleAgentReply(message) {
    const replyTargetMessageId = this._extractReplyTargetMessageId(message);
    const session = replyTargetMessageId
      ? this.sessionsByReplyTargetMessageId.get(String(replyTargetMessageId))
      : this._findSessionByChannel(message);

    if (!session) {
      return { matched: false, accepted: false, reason: replyTargetMessageId ? 'unknown_trigger' : 'not_a_reply' };
    }

    if (session.status !== 'pending') {
      return { matched: true, accepted: false, reason: 'session_not_pending', session };
    }

    if (!message?.author?.bot) {
      return { matched: true, accepted: false, reason: 'author_not_bot', session };
    }

    if (String(message.author.id) !== String(session.trustedBotUserId)) {
      return { matched: true, accepted: false, reason: 'untrusted_bot', session };
    }

    session.lastMatchedMessage = message;
    const content = String(message.content || '').trim();
    const parsed = this._parsePotentialJson(content);
    const combinedParsed = session.partialFinalContent
      ? this._parsePotentialJson(`${session.partialFinalContent}\n${content}`)
      : null;
    const effectiveParsed = combinedParsed || parsed;
    const envelope = this._normalizeEnvelope(effectiveParsed, session);
    const looksLikeJsonLikeReply = this._looksLikeJsonLikeReply(content);

    if (!effectiveParsed && looksLikeJsonLikeReply) {
      this.logger.error(
        `[ExternalReviewSessionService] Failed to parse external review JSON for ${session.instanceKey}/${session.repoName} PR #${session.prNumber}: ${content.slice(0, 500)}`
      );
    }

    if (!envelope) {
      if (!session.promptRequestMessage && !session.promptDelivered) {
        if (effectiveParsed === null && this._looksLikePromptRequestText(content)) {
          this._resolvePromptRequest(session, message);
          return {
            matched: true,
            accepted: false,
            reason: 'prompt_request_text_fallback',
            session: this._publicSession(session)
          };
        }

        return { matched: true, accepted: false, reason: 'non_protocol_handshake', session: this._publicSession(session) };
      }

      const rawFinalPayload = this._normalizeRawFinalReviewPayload(effectiveParsed);
      if (rawFinalPayload) {
        this._clearPartialFinalBuffer(session);
        return this._acceptFinalPayload(session, rawFinalPayload, content, message.id, 'raw_final_review_fallback');
      }

      if (this._looksLikeFinalReviewFragment(content)) {
        this._appendPartialFinalContent(session, content);
        return {
          matched: true,
          accepted: false,
          reason: 'awaiting_final_fragment',
          session: this._publicSession(session)
        };
      }

      this.logger.error(
        `[ExternalReviewSessionService] Unusable external review reply for ${session.instanceKey}/${session.repoName} PR #${session.prNumber}: reason=non_protocol_reply content=${content.slice(0, 500)}`
      );

      return { matched: true, accepted: false, reason: 'non_protocol_reply', session: this._publicSession(session) };
    }

    if (envelope.messageType === DiscordHandoffMessageType.PROMPT_REQUEST) {
      if (!session.promptRequestMessage) {
        this._resolvePromptRequest(session, message);
      }

      return {
        matched: true,
        accepted: false,
        reason: 'prompt_request',
        session: this._publicSession(session),
        envelope
      };
    }

    if (envelope.messageType === DiscordHandoffMessageType.PROGRESS ||
      envelope.messageType === DiscordHandoffMessageType.ERROR ||
      envelope.messageType === DiscordHandoffMessageType.FINAL_STATUS) {
      return {
        matched: true,
        accepted: false,
        reason: 'non_terminal_protocol_message',
        session: this._publicSession(session),
        envelope
      };
    }

    const normalizedFinalPayload = this._normalizeFinalReviewPayload(envelope);

    if (normalizedFinalPayload) {
      this._clearPartialFinalBuffer(session);
      return this._acceptFinalPayload(session, normalizedFinalPayload, content, message.id);
    }

    this.logger.error(
      `[ExternalReviewSessionService] Invalid final payload for ${session.instanceKey}/${session.repoName} PR #${session.prNumber}: ${content.slice(0, 500)}`
    );

    return {
      matched: true,
      accepted: false,
      reason: 'invalid_final_payload',
      session: this._publicSession(session),
      envelope
    };
  }

  failSession(queueItemId, error) {
    const session = this.sessionsByQueueItemId.get(queueItemId);
    if (!session) {
      return false;
    }

    session.status = 'failed';
    this._resolvePromptRequest(session, null);
    this._clearSession(queueItemId);
    session.reject(error);

    this.logger.warn(
      `[ExternalReviewSessionService] Failed session for ${session.instanceKey}/${session.repoName} PR #${session.prNumber}: ${error.message}`
    );

    return true;
  }

  _extractReplyTargetMessageId(message) {
    return message?.reference?.messageId ||
      message?.reference?.message_id ||
      message?.messageReference?.messageId ||
      null;
  }

  _clearSession(queueItemId) {
    const session = this.sessionsByQueueItemId.get(queueItemId);
    if (!session) {
      return;
    }

    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }

    this.sessionsByQueueItemId.delete(queueItemId);
    for (const messageId of session.replyTargetMessageIds || []) {
      this.sessionsByReplyTargetMessageId.delete(String(messageId));
    }
  }

  _findSessionByChannel(message) {
    const channelId = this._extractChannelId(message);
    if (!channelId) {
      return null;
    }

    const matches = [];
    for (const session of this.sessionsByQueueItemId.values()) {
      if (session.status !== 'pending') {
        continue;
      }

      if (String(session.trustedBotUserId) !== String(message?.author?.id)) {
        continue;
      }

      if (String(session.channelId || '') !== String(channelId)) {
        continue;
      }

      matches.push(session);
    }

    if (matches.length !== 1) {
      return null;
    }

    const [session] = matches;
    if (!session.partialFinalContent && !this._looksLikeSessionMessage(message?.content)) {
      return null;
    }

    return session;
  }

  _extractChannelId(message) {
    return message?.channelId || message?.channel?.id || null;
  }

  _resolvePromptRequest(session, message) {
    if (session.promptRequestMessage !== null) {
      return;
    }

    session.promptRequestMessage = message;
    if (message?.id) {
      this.registerReplyTargets(session.queueItemId, [message]);
    }
    if (session.resolvePromptRequest) {
      session.resolvePromptRequest(message);
      session.resolvePromptRequest = null;
    }
  }

  _parsePotentialJson(content) {
    if (!content) {
      return null;
    }

    const cleanContent = content
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .replace(/\u201c|\u201d/g, '"')
      .trim();
    const chunkMarkerStrippedContent = this._stripChunkMarkers(cleanContent);
    const commentStrippedContent = this._stripJsonComments(chunkMarkerStrippedContent);

    try {
      return JSON.parse(commentStrippedContent);
    } catch (_error) {
      const extractedJson = this._extractJson(commentStrippedContent);
      if (!extractedJson) {
        return null;
      }

      try {
        return JSON.parse(extractedJson);
      } catch (_extractError) {
        return null;
      }
    }
  }

  _stripJsonComments(text) {
    if (!text) {
      return text;
    }

    let result = '';
    let inString = false;
    let escapeNext = false;

    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      const nextChar = text[index + 1];

      if (escapeNext) {
        result += char;
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        result += char;
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        result += char;
        inString = !inString;
        continue;
      }

      if (!inString && char === '/' && nextChar === '/') {
        while (index < text.length && text[index] !== '\n') {
          index++;
        }
        if (index < text.length) {
          result += '\n';
        }
        continue;
      }

      result += char;
    }

    return result;
  }

  _stripChunkMarkers(text) {
    if (!text) {
      return text;
    }

    let result = '';
    let inString = false;
    let escapeNext = false;

    for (let index = 0; index < text.length; index++) {
      const char = text[index];

      if (escapeNext) {
        result += char;
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        result += char;
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        result += char;
        inString = !inString;
        continue;
      }

      if (!inString && char === '(') {
        const remainder = text.slice(index);
        const match = remainder.match(/^\((\d+)\/(\d+)\)\s*/);
        if (match) {
          index += match[0].length - 1;
          continue;
        }
      }

      result += char;
    }

    return result;
  }

  _normalizeEnvelope(parsed, session) {
    if (!parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)) {
      return null;
    }

    if (String(parsed.protocol || '').trim() !== DISCORD_HANDOFF_PROTOCOL) {
      return null;
    }

    if (String(parsed.session_id || '').trim() !== String(session.sessionId)) {
      return null;
    }

    const messageType = String(parsed.message_type || '').trim();
    if (!Object.values(DiscordHandoffMessageType).includes(messageType)) {
      return null;
    }

    return {
      protocol: parsed.protocol,
      sessionId: parsed.session_id,
      messageType,
      payload: parsed.payload && typeof parsed.payload === 'object' && !Array.isArray(parsed.payload)
        ? parsed.payload
        : {}
    };
  }

  _normalizeFinalReviewPayload(envelope) {
    if (!envelope || envelope.messageType !== DiscordHandoffMessageType.FINAL_REVIEW) {
      return null;
    }

    if (typeof envelope.payload.summary !== 'string' || !Array.isArray(envelope.payload.comments)) {
      return null;
    }

    return {
      summary: envelope.payload.summary,
      comments: envelope.payload.comments
    };
  }

  _normalizeRawFinalReviewPayload(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.comments)) {
      return null;
    }

    return {
      summary: parsed.summary,
      comments: parsed.comments
    };
  }

  _appendPartialFinalContent(session, content) {
    session.partialFinalContent = session.partialFinalContent
      ? `${session.partialFinalContent}\n${content}`
      : String(content || '');
    session.partialFinalUpdatedAt = Date.now();
  }

  _clearPartialFinalBuffer(session) {
    session.partialFinalContent = '';
    session.partialFinalUpdatedAt = null;
  }

  _acceptFinalPayload(session, reviewResult, rawContent, messageId, reason = 'accepted') {
    session.status = 'completed';
    this._resolvePromptRequest(session, null);
    this._clearSession(session.queueItemId);
    session.resolve({
      session: this._publicSession(session),
      reviewResult,
      rawContent,
      messageId,
      message: session.lastMatchedMessage || null
    });

    this.logger.info(
      `[ExternalReviewSessionService] Accepted external review reply for ${session.instanceKey}/${session.repoName} PR #${session.prNumber}`
    );

    return {
      matched: true,
      accepted: true,
      reason,
      session: this._publicSession(session),
      reviewResult
    };
  }

  _looksLikePromptRequestText(content) {
    if (!content) {
      return false;
    }

    const normalized = String(content).trim().toLowerCase();
    const mentionsPrompt = normalized.includes('prompt');
    const asksForPrompt = normalized.includes('kirim') ||
      normalized.includes('silakan') ||
      normalized.includes('send') ||
      normalized.includes('reply') ||
      normalized.includes('tunggu') ||
      normalized.includes('wait');

    return mentionsPrompt && asksForPrompt;
  }

  _looksLikeFinalReviewFragment(content) {
    if (!content) {
      return false;
    }

    const normalized = String(content).trim();
    if (!normalized) {
      return false;
    }

    return normalized.startsWith('{') ||
      normalized.includes('"summary"') ||
      normalized.includes('"comments"') ||
      normalized.includes(`"protocol":"${DISCORD_HANDOFF_PROTOCOL}"`) ||
      normalized.includes('"message_type"');
  }

  _looksLikeSessionMessage(content) {
    if (!content) {
      return false;
    }

    return this._looksLikePromptRequestText(content) ||
      this._looksLikeFinalReviewFragment(content);
  }

  _looksLikeJsonLikeReply(content) {
    if (!content) {
      return false;
    }

    const normalized = String(content).trim();
    return normalized.startsWith('{') ||
      normalized.startsWith('```json') ||
      normalized.includes('"summary"') ||
      normalized.includes('"comments"') ||
      normalized.includes('"protocol"') ||
      normalized.includes('"message_type"');
  }

  _extractJson(text) {
    if (!text) {
      return null;
    }

    for (let i = 0; i < text.length; i++) {
      if (text[i] !== '{') {
        continue;
      }

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

        if (inString) {
          continue;
        }

        if (char === '{') {
          braceCount++;
        } else if (char === '}') {
          braceCount--;

          if (braceCount === 0) {
            return text.substring(i, j + 1);
          }
        }
      }
    }

    return null;
  }

  _isFinalReviewPayload(parsed) {
    return parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      typeof parsed.summary === 'string' &&
      Array.isArray(parsed.comments);
  }

  _publicSession(session) {
    return {
      queueItemId: session.queueItemId,
      instanceKey: session.instanceKey,
      repoName: session.repoName,
      prNumber: session.prNumber,
      level: session.level,
      sessionId: session.sessionId,
      triggerMessageId: session.triggerMessageId,
      trustedBotUserId: session.trustedBotUserId,
      channelId: session.channelId,
      deadlineAt: session.deadlineAt
    };
  }
}

module.exports = ExternalReviewSessionService;
