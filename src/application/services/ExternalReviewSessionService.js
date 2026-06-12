class ExternalReviewSessionService {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.sessionsByQueueItemId = new Map();
    this.sessionsByTriggerMessageId = new Map();
  }

  startSession(sessionInput = {}) {
    const timeoutMs = sessionInput.timeoutMs || 0;
    const now = Date.now();
    const deadlineAt = sessionInput.deadlineAt || new Date(now + timeoutMs).toISOString();
    const session = {
      ...sessionInput,
      deadlineAt,
      status: 'pending'
    };

    const promise = new Promise((resolve, reject) => {
      session.resolve = resolve;
      session.reject = reject;
    });

    session.promise = promise;
    session.timer = setTimeout(() => {
      this.failSession(session.queueItemId, new Error('Timed out waiting for external review reply'));
    }, Math.max(timeoutMs, 1));

    this.sessionsByQueueItemId.set(session.queueItemId, session);
    this.sessionsByTriggerMessageId.set(String(session.triggerMessageId), session);

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

  handleAgentReply(message) {
    const triggerMessageId = this._extractReplyTargetMessageId(message);
    if (!triggerMessageId) {
      return { matched: false, accepted: false, reason: 'not_a_reply' };
    }

    const session = this.sessionsByTriggerMessageId.get(String(triggerMessageId));
    if (!session) {
      return { matched: false, accepted: false, reason: 'unknown_trigger' };
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

    const content = String(message.content || '').trim();
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (_error) {
      return { matched: true, accepted: false, reason: 'invalid_json', session };
    }

    session.status = 'completed';
    this._clearSession(session.queueItemId);
    session.resolve({
      session: this._publicSession(session),
      reviewResult: parsed,
      rawContent: content,
      messageId: message.id
    });

    this.logger.info(
      `[ExternalReviewSessionService] Accepted external review reply for ${session.instanceKey}/${session.repoName} PR #${session.prNumber}`
    );

    return { matched: true, accepted: true, session: this._publicSession(session), reviewResult: parsed };
  }

  failSession(queueItemId, error) {
    const session = this.sessionsByQueueItemId.get(queueItemId);
    if (!session) {
      return false;
    }

    session.status = 'failed';
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
    this.sessionsByTriggerMessageId.delete(String(session.triggerMessageId));
  }

  _publicSession(session) {
    return {
      queueItemId: session.queueItemId,
      instanceKey: session.instanceKey,
      repoName: session.repoName,
      prNumber: session.prNumber,
      level: session.level,
      triggerMessageId: session.triggerMessageId,
      trustedBotUserId: session.trustedBotUserId,
      deadlineAt: session.deadlineAt
    };
  }
}

module.exports = ExternalReviewSessionService;
