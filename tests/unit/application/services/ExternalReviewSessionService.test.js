const ExternalReviewSessionService = require('../../../../src/application/services/ExternalReviewSessionService');
const {
  DISCORD_HANDOFF_PROTOCOL,
  DiscordHandoffMessageType
} = require('../../../../src/shared/discordHandoffProtocol');

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
      content: JSON.stringify({
        protocol: DISCORD_HANDOFF_PROTOCOL,
        session_id: 'qi_1',
        message_type: DiscordHandoffMessageType.FINAL_REVIEW,
        payload: { summary: 'done', comments: [] }
      }),
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-1' }
    });

    await expect(pending).resolves.toEqual(expect.objectContaining({
      reviewResult: { summary: 'done', comments: [] }
    }));
    await expect(promptRequest).resolves.toBeNull();
    expect(handle).toEqual(expect.objectContaining({ matched: true, accepted: true }));
  });

  test('accepts final review JSON extracted from wrapped plain text', async () => {
    service.startSession({
      queueItemId: 'qi_1b',
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 10,
      level: 'high',
      triggerMessageId: 'trigger-1b',
      trustedBotUserId: 'bot-1',
      timeoutMs: 1000
    });

    const pending = service.awaitResult('qi_1b');
    const handle = service.handleAgentReply({
      id: 'msg-1b',
      content: `\`\`\`json\n${JSON.stringify({
        protocol: DISCORD_HANDOFF_PROTOCOL,
        session_id: 'qi_1b',
        message_type: DiscordHandoffMessageType.FINAL_REVIEW,
        payload: { summary: 'done', comments: [] }
      })}\n\`\`\``,
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-1b' }
    });

    await expect(pending).resolves.toEqual(expect.objectContaining({
      reviewResult: { summary: 'done', comments: [] }
    }));
    expect(handle).toEqual(expect.objectContaining({ matched: true, accepted: true }));
  });

  test('captures prompt_request envelope and keeps waiting for final review', async () => {
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
      content: JSON.stringify({
        protocol: DISCORD_HANDOFF_PROTOCOL,
        session_id: 'qi_2',
        message_type: DiscordHandoffMessageType.PROMPT_REQUEST,
        payload: { message: 'Send complete review prompt' }
      }),
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-2' }
    });

    await expect(promptRequest).resolves.toEqual(expect.objectContaining({ id: 'msg-2' }));
    expect(handle).toEqual(expect.objectContaining({
      matched: true,
      accepted: false,
      reason: 'prompt_request'
    }));
    expect(service.sessionsByQueueItemId.has('qi_2')).toBe(true);
  });

  test('ignores non-protocol JSON before prompt request', async () => {
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

    const handle = service.handleAgentReply({
      id: 'msg-2b',
      content: '{"status":"awaiting_review_prompt","message":"Send complete review prompt"}',
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-2b' }
    });

    expect(handle).toEqual(expect.objectContaining({
      matched: true,
      accepted: false,
      reason: 'non_protocol_handshake'
    }));
  });

  test('accepts plain-text prompt request as fallback before prompt detail is sent', async () => {
    service.startSession({
      queueItemId: 'qi_2c',
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 10,
      level: 'high',
      triggerMessageId: 'trigger-2c',
      trustedBotUserId: 'bot-1',
      timeoutMs: 1000
    });

    const promptRequest = service.awaitPromptRequest('qi_2c');
    const handle = service.handleAgentReply({
      id: 'msg-2c',
      content: 'Silakan kirim prompt review lengkap di reply ini. Saya tunggu.',
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-2c' }
    });

    await expect(promptRequest).resolves.toEqual(expect.objectContaining({ id: 'msg-2c' }));
    expect(handle).toEqual(expect.objectContaining({
      matched: true,
      accepted: false,
      reason: 'prompt_request_text_fallback'
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
      content: JSON.stringify({
        protocol: DISCORD_HANDOFF_PROTOCOL,
        session_id: 'qi_4',
        message_type: DiscordHandoffMessageType.FINAL_REVIEW,
        payload: { summary: 'done', comments: [] }
      }),
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-4' }
    });

    const duplicate = service.handleAgentReply({
      id: 'msg-5',
      content: JSON.stringify({
        protocol: DISCORD_HANDOFF_PROTOCOL,
        session_id: 'qi_4',
        message_type: DiscordHandoffMessageType.FINAL_REVIEW,
        payload: { summary: 'again', comments: [] }
      }),
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
      content: JSON.stringify({
        protocol: DISCORD_HANDOFF_PROTOCOL,
        session_id: 'qi_5',
        message_type: DiscordHandoffMessageType.PROMPT_REQUEST,
        payload: { message: 'Send prompt' }
      }),
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-5' }
    });

    const nonFinal = service.handleAgentReply({
      id: 'msg-5b',
      content: JSON.stringify({
        protocol: DISCORD_HANDOFF_PROTOCOL,
        session_id: 'qi_5',
        message_type: DiscordHandoffMessageType.PROGRESS,
        payload: { percent: 50 }
      }),
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-5' }
    });

    expect(nonFinal).toEqual(expect.objectContaining({
      matched: true,
      accepted: false,
      reason: 'non_terminal_protocol_message'
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
      content: JSON.stringify({
        protocol: DISCORD_HANDOFF_PROTOCOL,
        session_id: 'qi_6',
        message_type: DiscordHandoffMessageType.PROMPT_REQUEST,
        payload: { message: 'Send complete review prompt' }
      }),
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-6' }
    });

    service.registerReplyTargets('qi_6', [{ id: 'prompt-6-1' }, { id: 'prompt-6-2' }]);

    const pending = service.awaitResult('qi_6');
    const finalHandle = service.handleAgentReply({
      id: 'msg-6b',
      content: JSON.stringify({
        protocol: DISCORD_HANDOFF_PROTOCOL,
        session_id: 'qi_6',
        message_type: DiscordHandoffMessageType.FINAL_REVIEW,
        payload: { summary: 'done', comments: [] }
      }),
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

  test('does not treat final_status as review result', async () => {
    service.startSession({
      queueItemId: 'qi_7',
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 10,
      level: 'high',
      triggerMessageId: 'trigger-7',
      trustedBotUserId: 'bot-1',
      timeoutMs: 1000
    });

    service.handleAgentReply({
      id: 'msg-7a',
      content: JSON.stringify({
        protocol: DISCORD_HANDOFF_PROTOCOL,
        session_id: 'qi_7',
        message_type: DiscordHandoffMessageType.PROMPT_REQUEST,
        payload: { message: 'Send complete review prompt' }
      }),
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-7' }
    });

    const finalHandle = service.handleAgentReply({
      id: 'msg-7b',
      content: JSON.stringify({
        protocol: DISCORD_HANDOFF_PROTOCOL,
        session_id: 'qi_7',
        message_type: DiscordHandoffMessageType.FINAL_STATUS,
        payload: { state: 'approved', message: 'Tidak ada issue kritis. Review selesai.' }
      }),
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'msg-7a' }
    });

    expect(finalHandle).toEqual(expect.objectContaining({
      matched: true,
      accepted: false,
      reason: 'non_terminal_protocol_message'
    }));
    expect(service.sessionsByQueueItemId.has('qi_7')).toBe(true);
  });

  test('ignores envelope with wrong session id', async () => {
    service.startSession({
      queueItemId: 'qi_8',
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 10,
      level: 'high',
      triggerMessageId: 'trigger-8',
      trustedBotUserId: 'bot-1',
      timeoutMs: 1000
    });

    const handle = service.handleAgentReply({
      id: 'msg-8',
      content: JSON.stringify({
        protocol: DISCORD_HANDOFF_PROTOCOL,
        session_id: 'wrong-session',
        message_type: DiscordHandoffMessageType.PROMPT_REQUEST,
        payload: { message: 'Send prompt' }
      }),
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-8' }
    });

    expect(handle).toEqual(expect.objectContaining({
      matched: true,
      accepted: false,
      reason: 'non_protocol_handshake'
    }));
  });
});
