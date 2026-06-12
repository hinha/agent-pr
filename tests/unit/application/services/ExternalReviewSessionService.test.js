const ExternalReviewSessionService = require('../../../../src/application/services/ExternalReviewSessionService');

describe('ExternalReviewSessionService', () => {
  let service;

  beforeEach(() => {
    service = new ExternalReviewSessionService({
      logger: { info: jest.fn(), warn: jest.fn() }
    });
  });

  afterEach(() => {
    for (const session of service.sessionsByQueueItemId.values()) {
      if (session.timer) {
        clearTimeout(session.timer);
      }
    }
    service.sessionsByQueueItemId.clear();
    service.sessionsByReplyTargetMessageId.clear();
    jest.useRealTimers();
  });

  test('accepts first valid JSON reply from trusted bot', async () => {
    service.startSession({
      queueItemId: 'qi_1',
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 10,
      level: 'high',
      triggerMessageId: 'trigger-1',
      trustedBotUserId: 'bot-1',
      timeoutMs: 1000
    });

    const pending = service.awaitResult('qi_1');
    const promptRequest = service.awaitPromptRequest('qi_1');
    const handle = service.handleAgentReply({
      id: 'msg-1',
      content: '{"summary":"done","comments":[]}',
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-1' }
    });

    await expect(pending).resolves.toEqual(expect.objectContaining({
      reviewResult: { summary: 'done', comments: [] }
    }));
    await expect(promptRequest).resolves.toBeNull();
    expect(handle).toEqual(expect.objectContaining({ matched: true, accepted: true }));
  });

  test('captures handshake reply and keeps waiting for final review', async () => {
    service.startSession({
      queueItemId: 'qi_2',
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 10,
      level: 'high',
      triggerMessageId: 'trigger-2',
      trustedBotUserId: 'bot-1',
      timeoutMs: 1000
    });

    const promptRequest = service.awaitPromptRequest('qi_2');
    const handle = service.handleAgentReply({
      id: 'msg-2',
      content: 'Kirim prompt review lengkap via reply ke pesan ini.',
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-2' }
    });

    await expect(promptRequest).resolves.toEqual(expect.objectContaining({ id: 'msg-2' }));
    expect(handle).toEqual(expect.objectContaining({
      matched: true,
      accepted: false,
      reason: 'handshake_received'
    }));
    expect(service.sessionsByQueueItemId.has('qi_2')).toBe(true);
  });

  test('treats awaiting_review_prompt status JSON as handshake, not final result', async () => {
    service.startSession({
      queueItemId: 'qi_2b',
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 10,
      level: 'high',
      triggerMessageId: 'trigger-2b',
      trustedBotUserId: 'bot-1',
      timeoutMs: 1000
    });

    const promptRequest = service.awaitPromptRequest('qi_2b');
    const handle = service.handleAgentReply({
      id: 'msg-2b',
      content: '{"status":"awaiting_review_prompt","message":"Send complete review prompt"}',
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-2b' }
    });

    await expect(promptRequest).resolves.toEqual(expect.objectContaining({ id: 'msg-2b' }));
    expect(handle).toEqual(expect.objectContaining({
      matched: true,
      accepted: false,
      reason: 'prompt_request'
    }));
  });

  test('rejects on timeout', async () => {
    jest.useFakeTimers();
    service.startSession({
      queueItemId: 'qi_3',
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 10,
      level: 'high',
      triggerMessageId: 'trigger-3',
      trustedBotUserId: 'bot-1',
      timeoutMs: 50
    });

    const pending = service.awaitResult('qi_3');
    jest.advanceTimersByTime(60);

    await expect(pending).rejects.toThrow('Timed out waiting for external review reply');
  });

  test('ignores duplicate late replies after completion', () => {
    service.startSession({
      queueItemId: 'qi_4',
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 10,
      level: 'high',
      triggerMessageId: 'trigger-4',
      trustedBotUserId: 'bot-1',
      timeoutMs: 1000
    });

    service.handleAgentReply({
      id: 'msg-4',
      content: '{"summary":"done","comments":[]}',
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-4' }
    });

    const duplicate = service.handleAgentReply({
      id: 'msg-5',
      content: '{"summary":"again","comments":[]}',
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-4' }
    });

    expect(duplicate.accepted).toBe(false);
  });

  test('does not accept non-final JSON after handshake', async () => {
    service.startSession({
      queueItemId: 'qi_5',
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 10,
      level: 'high',
      triggerMessageId: 'trigger-5',
      trustedBotUserId: 'bot-1',
      timeoutMs: 1000
    });

    service.handleAgentReply({
      id: 'msg-5a',
      content: 'Send prompt',
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-5' }
    });

    const nonFinal = service.handleAgentReply({
      id: 'msg-5b',
      content: '{"status":"working"}',
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-5' }
    });

    expect(nonFinal).toEqual(expect.objectContaining({
      matched: true,
      accepted: false,
      reason: 'invalid_final_payload'
    }));
    expect(service.sessionsByQueueItemId.has('qi_5')).toBe(true);
  });

  test('accepts final reply to prompt chunk message after handshake', async () => {
    service.startSession({
      queueItemId: 'qi_6',
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 10,
      level: 'high',
      triggerMessageId: 'trigger-6',
      trustedBotUserId: 'bot-1',
      timeoutMs: 1000
    });

    service.handleAgentReply({
      id: 'msg-6a',
      content: 'Kirim prompt lengkap',
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-6' }
    });

    service.registerReplyTargets('qi_6', [{ id: 'prompt-6-1' }, { id: 'prompt-6-2' }]);

    const pending = service.awaitResult('qi_6');
    const finalHandle = service.handleAgentReply({
      id: 'msg-6b',
      content: '{"summary":"done","comments":[]}',
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'prompt-6-2' }
    });

    await expect(pending).resolves.toEqual(expect.objectContaining({
      reviewResult: { summary: 'done', comments: [] }
    }));
    expect(finalHandle).toEqual(expect.objectContaining({
      matched: true,
      accepted: true
    }));
  });
});
