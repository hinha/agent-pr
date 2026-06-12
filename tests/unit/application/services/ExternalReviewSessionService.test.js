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
    service.sessionsByTriggerMessageId.clear();
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
    const handle = service.handleAgentReply({
      id: 'msg-1',
      content: '{"summary":"done","comments":[]}',
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-1' }
    });

    await expect(pending).resolves.toEqual(expect.objectContaining({
      reviewResult: { summary: 'done', comments: [] }
    }));
    expect(handle).toEqual(expect.objectContaining({ matched: true, accepted: true }));
  });

  test('keeps waiting after invalid JSON reply', async () => {
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

    const handle = service.handleAgentReply({
      id: 'msg-2',
      content: 'not json',
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-2' }
    });

    expect(handle).toEqual(expect.objectContaining({
      matched: true,
      accepted: false,
      reason: 'invalid_json'
    }));
    expect(service.sessionsByQueueItemId.has('qi_2')).toBe(true);
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
});
