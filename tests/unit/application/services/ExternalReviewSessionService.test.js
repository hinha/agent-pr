const ExternalReviewSessionService = require('../../../../src/application/services/ExternalReviewSessionService');
const {
  DISCORD_HANDOFF_PROTOCOL,
  DiscordHandoffMessageType
} = require('../../../../src/shared/discordHandoffProtocol');

describe('ExternalReviewSessionService', () => {
  let service;
  let logger;

  beforeEach(() => {
    logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    service = new ExternalReviewSessionService({
      logger
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

  test('rejects lookups for unknown sessions and ignores duplicate reply targets', async () => {
    expect(service.awaitResult('missing')).rejects.toThrow('External review session not found: missing');
    expect(service.awaitPromptRequest('missing')).rejects.toThrow('External review session not found: missing');
    expect(() => service.registerReplyTargets('missing', [])).toThrow('External review session not found: missing');

    service.startSession({
      queueItemId: 'qi_targets',
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 10,
      level: 'high',
      triggerMessageId: 'trigger-targets',
      trustedBotUserId: 'bot-1',
      timeoutMs: 1000
    });

    const targets = service.registerReplyTargets('qi_targets', [
      null,
      {},
      { id: 'trigger-targets' },
      { id: 'prompt-target-1' }
    ]);

    expect(targets).toEqual(['trigger-targets', 'prompt-target-1']);
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

  test('filters unrelated replies before parsing content', () => {
    service.startSession({
      queueItemId: 'qi_filters',
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 10,
      level: 'high',
      triggerMessageId: 'trigger-filters',
      trustedBotUserId: 'bot-1',
      timeoutMs: 1000
    });

    expect(service.handleAgentReply({
      id: 'msg-unknown',
      content: '{}',
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'missing-trigger' }
    })).toEqual(expect.objectContaining({ matched: false, reason: 'unknown_trigger' }));

    const session = service.sessionsByQueueItemId.get('qi_filters');
    session.status = 'completed';
    expect(service.handleAgentReply({
      id: 'msg-completed',
      content: '{}',
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-filters' }
    })).toEqual(expect.objectContaining({ matched: true, reason: 'session_not_pending' }));

    session.status = 'pending';
    expect(service.handleAgentReply({
      id: 'msg-user',
      content: '{}',
      author: { id: 'user-1', bot: false },
      reference: { messageId: 'trigger-filters' }
    })).toEqual(expect.objectContaining({ matched: true, reason: 'author_not_bot' }));

    expect(service.handleAgentReply({
      id: 'msg-untrusted',
      content: '{}',
      author: { id: 'bot-2', bot: true },
      reference: { messageId: 'trigger-filters' }
    })).toEqual(expect.objectContaining({ matched: true, reason: 'untrusted_bot' }));
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

  test('accepts raw final review JSON as fallback after prompt has been delivered', async () => {
    service.startSession({
      queueItemId: 'qi_6b',
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 10,
      level: 'high',
      triggerMessageId: 'trigger-6b',
      channelId: 'channel-6b',
      trustedBotUserId: 'bot-1',
      timeoutMs: 1000
    });

    service.handleAgentReply({
      id: 'msg-6b-a',
      content: JSON.stringify({
        protocol: DISCORD_HANDOFF_PROTOCOL,
        session_id: 'qi_6b',
        message_type: DiscordHandoffMessageType.PROMPT_REQUEST,
        payload: { message: 'Send complete review prompt' }
      }),
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-6b' }
    });

    service.registerReplyTargets('qi_6b', [{ id: 'prompt-6b-1' }]);

    const pending = service.awaitResult('qi_6b');
    const finalHandle = service.handleAgentReply({
      id: 'msg-6b-b',
      content: '{"summary":"done","comments":[]}',
      author: { id: 'bot-1', bot: true },
      channelId: 'channel-6b',
      reference: { messageId: 'prompt-6b-1' }
    });

    await expect(pending).resolves.toEqual(expect.objectContaining({
      reviewResult: { summary: 'done', comments: [] }
    }));
    expect(finalHandle).toEqual(expect.objectContaining({
      matched: true,
      accepted: true,
      reason: 'raw_final_review_fallback'
    }));
  });

  test('buffers fragmented final review JSON until the continuation arrives', async () => {
    service.startSession({
      queueItemId: 'qi_frag',
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 11,
      level: 'high',
      triggerMessageId: 'trigger-frag',
      channelId: 'channel-frag',
      trustedBotUserId: 'bot-1',
      timeoutMs: 1000
    });

    service.handleAgentReply({
      id: 'msg-frag-a',
      content: JSON.stringify({
        protocol: DISCORD_HANDOFF_PROTOCOL,
        session_id: 'qi_frag',
        message_type: DiscordHandoffMessageType.PROMPT_REQUEST,
        payload: { message: 'Send complete review prompt' }
      }),
      author: { id: 'bot-1', bot: true },
      channelId: 'channel-frag',
      reference: { messageId: 'trigger-frag' }
    });

    service.registerReplyTargets('qi_frag', [{ id: 'prompt-frag-1' }]);

    const pending = service.awaitResult('qi_frag');
    const firstPart = service.handleAgentReply({
      id: 'msg-frag-b',
      content: '{"summary":"done","comments":[{"file":"a.js"',
      author: { id: 'bot-1', bot: true },
      channelId: 'channel-frag',
      reference: { messageId: 'prompt-frag-1' }
    });

    expect(firstPart).toEqual(expect.objectContaining({
      matched: true,
      accepted: false,
      reason: 'awaiting_final_fragment'
    }));

    const secondPart = service.handleAgentReply({
      id: 'msg-frag-c',
      content: ',"start_line":1,"severity":"LOW","message":"x"}]}',
      author: { id: 'bot-1', bot: true },
      channelId: 'channel-frag'
    });

    await expect(pending).resolves.toEqual(expect.objectContaining({
      reviewResult: expect.objectContaining({
        summary: 'done',
        comments: expect.any(Array)
      })
    }));
    expect(secondPart).toEqual(expect.objectContaining({
      matched: true,
      accepted: true,
      reason: 'raw_final_review_fallback'
    }));
  });

  test('keeps buffering continuation fragments that do not look like json starts', async () => {
    service.startSession({
      queueItemId: 'qi_frag_tail',
      instanceKey: 'github/hinha',
      repoName: 'agent-pr',
      prNumber: 18,
      level: 'high',
      triggerMessageId: 'trigger-frag-tail',
      channelId: 'channel-frag-tail',
      promptDelivered: true,
      trustedBotUserId: 'bot-1',
      timeoutMs: 1000
    });

    const pending = service.awaitResult('qi_frag_tail');
    const firstPart = service.handleAgentReply({
      id: 'msg-frag-tail-a',
      content: `{
  "summary": "done",
  "comments": [
    {
      "file": "src/application/services/ExternalReviewSessionService.js",
      "start_line": 18,
      "end_line": 25,
      "severity": "LOW",
      "message": "fragmented",
      "suggestedCode": "const normalized = content.includes(`,
      author: { id: 'bot-1', bot: true },
      channelId: 'channel-frag-tail'
    });

    expect(firstPart).toEqual(expect.objectContaining({
      matched: true,
      accepted: false,
      reason: 'awaiting_final_fragment'
    }));

    const secondPart = service.handleAgentReply({
      id: 'msg-frag-tail-b',
      content: `hasProtocol) && normalized.includes('{');"
    }
  ]
}`,
      author: { id: 'bot-1', bot: true },
      channelId: 'channel-frag-tail'
    });

    await expect(pending).resolves.toEqual(expect.objectContaining({
      reviewResult: expect.objectContaining({
        summary: 'done',
        comments: expect.arrayContaining([
          expect.objectContaining({
            file: 'src/application/services/ExternalReviewSessionService.js',
            suggestedCode: expect.stringContaining('hasProtocol')
          })
        ])
      })
    }));
    expect(secondPart).toEqual(expect.objectContaining({
      matched: true,
      accepted: true,
      reason: 'raw_final_review_fallback'
    }));
  });

  test('accepts standalone final review JSON in the same channel when exactly one session matches', async () => {
    service.startSession({
      queueItemId: 'qi_chan',
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 12,
      level: 'high',
      triggerMessageId: 'trigger-chan',
      channelId: 'channel-chan',
      promptDelivered: true,
      trustedBotUserId: 'bot-1',
      timeoutMs: 1000
    });

    const pending = service.awaitResult('qi_chan');
    const finalHandle = service.handleAgentReply({
      id: 'msg-chan-a',
      content: '{"summary":"done","comments":[]}',
      author: { id: 'bot-1', bot: true },
      channelId: 'channel-chan'
    });

    await expect(pending).resolves.toEqual(expect.objectContaining({
      reviewResult: { summary: 'done', comments: [] }
    }));
    expect(finalHandle).toEqual(expect.objectContaining({
      matched: true,
      accepted: true,
      reason: 'raw_final_review_fallback'
    }));
  });

  test('accepts raw final review JSON with inline comment copied from prompt example', async () => {
    service.startSession({
      queueItemId: 'qi_comment_json',
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 13,
      level: 'high',
      triggerMessageId: 'trigger-comment-json',
      channelId: 'channel-comment-json',
      promptDelivered: true,
      trustedBotUserId: 'bot-1',
      timeoutMs: 1000
    });

    const pending = service.awaitResult('qi_comment_json');
    const finalHandle = service.handleAgentReply({
      id: 'msg-comment-json-a',
      content: `{
  "summary": "Ringkasan review secara keseluruhan",
  "comments": [
    {
      "file": "src/file.js",
      "start_line": 42,
      "end_line": 45,  // tambahkan +10 line jika ada perubahan di baris terakhir
      "severity": "HIGH",
      "message": "Penjelasan issue dan rekomendasi perbaikan",
      "suggestedCode": "const corrected = 'contoh kode yang benar'; penjelasan tambahan sangat detail"
    }
  ]
}`,
      author: { id: 'bot-1', bot: true },
      channelId: 'channel-comment-json'
    });

    await expect(pending).resolves.toEqual(expect.objectContaining({
      reviewResult: expect.objectContaining({
        summary: 'Ringkasan review secara keseluruhan',
        comments: expect.any(Array)
      })
    }));
    expect(finalHandle).toEqual(expect.objectContaining({
      matched: true,
      accepted: true,
      reason: 'raw_final_review_fallback'
    }));
  });

  test('logs error when bot sends json-like content that cannot be parsed', () => {
    service.startSession({
      queueItemId: 'qi_bad_json',
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 15,
      level: 'high',
      triggerMessageId: 'trigger-bad-json',
      channelId: 'channel-bad-json',
      promptDelivered: true,
      trustedBotUserId: 'bot-1',
      timeoutMs: 1000
    });

    const handle = service.handleAgentReply({
      id: 'msg-bad-json-a',
      content: '{"summary":"broken","comments":[}',
      author: { id: 'bot-1', bot: true },
      channelId: 'channel-bad-json'
    });

    expect(handle).toEqual(expect.objectContaining({
      matched: true,
      accepted: false
    }));
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse external review JSON')
    );
  });

  test('keeps waiting when a continuation fragment still does not complete json', () => {
    service.startSession({
      queueItemId: 'qi_incomplete_tail',
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 16,
      level: 'high',
      triggerMessageId: 'trigger-incomplete-tail',
      channelId: 'channel-incomplete-tail',
      promptDelivered: true,
      trustedBotUserId: 'bot-1',
      timeoutMs: 1000
    });

    service.handleAgentReply({
      id: 'msg-incomplete-tail-a',
      content: '{"summary":"done","comments":[{"file":"a.js","suggestedCode":"const x = ',
      author: { id: 'bot-1', bot: true },
      channelId: 'channel-incomplete-tail'
    });

    const secondPart = service.handleAgentReply({
      id: 'msg-incomplete-tail-b',
      content: 'still incomplete',
      author: { id: 'bot-1', bot: true },
      channelId: 'channel-incomplete-tail'
    });

    expect(secondPart).toEqual(expect.objectContaining({
      matched: true,
      accepted: false,
      reason: 'awaiting_final_fragment'
    }));
  });

  test('logs unusable non-protocol replies after prompt delivery', () => {
    service.startSession({
      queueItemId: 'qi_unusable',
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 17,
      level: 'high',
      triggerMessageId: 'trigger-unusable',
      channelId: 'channel-unusable',
      promptDelivered: true,
      trustedBotUserId: 'bot-1',
      timeoutMs: 1000
    });

    const handle = service.handleAgentReply({
      id: 'msg-unusable-a',
      content: 'Saya masih mengerjakan review.',
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-unusable' }
    });

    expect(handle).toEqual(expect.objectContaining({
      matched: true,
      accepted: false,
      reason: 'non_protocol_reply'
    }));
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Unusable external review reply')
    );
  });

  test('rejects final_review envelope with invalid payload shape', () => {
    service.startSession({
      queueItemId: 'qi_invalid_payload',
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 18,
      level: 'high',
      triggerMessageId: 'trigger-invalid-payload',
      trustedBotUserId: 'bot-1',
      timeoutMs: 1000
    });

    const handle = service.handleAgentReply({
      id: 'msg-invalid-payload-a',
      content: JSON.stringify({
        protocol: DISCORD_HANDOFF_PROTOCOL,
        session_id: 'qi_invalid_payload',
        message_type: DiscordHandoffMessageType.FINAL_REVIEW,
        payload: { summary: '', comments: 'bad' }
      }),
      author: { id: 'bot-1', bot: true },
      reference: { messageId: 'trigger-invalid-payload' }
    });

    expect(handle).toEqual(expect.objectContaining({
      matched: true,
      accepted: false,
      reason: 'invalid_final_payload'
    }));
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid final payload')
    );
  });

  test('returns false when failing an unknown session', () => {
    expect(service.failSession('missing', new Error('boom'))).toBe(false);
  });

  test('accepts raw final review JSON with chunk markers injected outside strings', async () => {
    service.startSession({
      queueItemId: 'qi_chunk_marker_json',
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 14,
      level: 'high',
      triggerMessageId: 'trigger-chunk-marker-json',
      channelId: 'channel-chunk-marker-json',
      promptDelivered: true,
      trustedBotUserId: 'bot-1',
      timeoutMs: 1000
    });

    const pending = service.awaitResult('qi_chunk_marker_json');
    const finalHandle = service.handleAgentReply({
      id: 'msg-chunk-marker-json-a',
      content: `{
  "summary": "Ringkasan review secara keseluruhan",
  "comments": [
    {
      "file": "src/file.js",
      "start_line": 42,
      "end_line": 45,
      "severity": "HIGH",
      "message": "Penjelasan issue dan rekomendasi perbaikan", (1/3)
"suggestedCode": "const corrected = 'contoh kode yang benar'; penjelasan tambahan sangat detail"
    }
  ]
}`,
      author: { id: 'bot-1', bot: true },
      channelId: 'channel-chunk-marker-json'
    });

    await expect(pending).resolves.toEqual(expect.objectContaining({
      reviewResult: expect.objectContaining({
        summary: 'Ringkasan review secara keseluruhan',
        comments: expect.any(Array)
      })
    }));
    expect(finalHandle).toEqual(expect.objectContaining({
      matched: true,
      accepted: true,
      reason: 'raw_final_review_fallback'
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

  describe('fragment joining with realistic review data', () => {
    // Helper to set up a session with promptDelivered=true
    function startReadySession(queueItemId, channelId = 'channel-frag-test') {
      service.startSession({
        queueItemId,
        instanceKey: 'github/acme',
        repoName: 'api',
        prNumber: 20,
        level: 'high',
        triggerMessageId: `trigger-${queueItemId}`,
        channelId,
        promptDelivered: true,
        trustedBotUserId: 'bot-1',
        timeoutMs: 2000
      });
      return service.awaitResult(queueItemId);
    }

    // 1. 2-message fragment - JSON truncated mid-comment, continued in message 2
    test('joins 2-message fragment where JSON is truncated mid-comment', async () => {
      const pending = startReadySession('frag_real_1');

      service.handleAgentReply({
        id: 'msg-frag-1a',
        content: '{"summary":"Found 3 issues","comments":[{"file":"src/index.js","start_line":10,"end_line":15,"severity":"HIGH","message":"Critical bug in',
        author: { id: 'bot-1', bot: true },
        channelId: 'channel-frag-test'
      });

      const secondPart = service.handleAgentReply({
        id: 'msg-frag-1b',
        content: ' handler","suggestedCode":"try { await fn(); } catch(e) { log(e); }"}]}',
        author: { id: 'bot-1', bot: true },
        channelId: 'channel-frag-test'
      });

      const result = await pending;
      expect(result.reviewResult.summary).toBe('Found 3 issues');
      expect(result.reviewResult.comments).toHaveLength(1);
      expect(result.reviewResult.comments[0].file).toBe('src/index.js');
      expect(result.reviewResult.comments[0].start_line).toBe(10);
      expect(result.reviewResult.comments[0].end_line).toBe(15);
      expect(result.reviewResult.comments[0].severity).toBe('HIGH');
      expect(secondPart.accepted).toBe(true);
    });

    // 2. 2-message fragment with (1/2) (2/2) markers
    test('joins 2-message fragment with chunk markers (1/2) (2/2)', async () => {
      const pending = startReadySession('frag_real_2', 'channel-frag-test-2');

      service.handleAgentReply({
        id: 'msg-frag-2a',
        content: '(1/2) {"summary":"Two comments","comments":[{"file":"a.ts","start_line":1,"severity":"LOW","message":"Nitpick"},',
        author: { id: 'bot-1', bot: true },
        channelId: 'channel-frag-test-2'
      });

      const secondPart = service.handleAgentReply({
        id: 'msg-frag-2b',
        content: '(2/2) {"file":"b.ts","start_line":5,"severity":"MEDIUM","message":"Consider refactor"}]}',
        author: { id: 'bot-1', bot: true },
        channelId: 'channel-frag-test-2'
      });

      const result = await pending;
      expect(result.reviewResult.summary).toBe('Two comments');
      expect(result.reviewResult.comments).toHaveLength(2);
      expect(result.reviewResult.comments[0].severity).toBe('LOW');
      expect(result.reviewResult.comments[1].severity).toBe('MEDIUM');
      expect(secondPart.accepted).toBe(true);
    });

    // 3. Fragment with suggestedCode containing escaped quotes
    test('joins fragment with suggestedCode containing escaped quotes', async () => {
      const pending = startReadySession('frag_real_3', 'channel-frag-test-3');

      service.handleAgentReply({
        id: 'msg-frag-3a',
        content: '{"summary":"Quote issue","comments":[{"file":"c.js","start_line":20,"severity":"HIGH","message":"Use template literals","suggestedCode":"const msg = \\"hello\\"',
        author: { id: 'bot-1', bot: true },
        channelId: 'channel-frag-test-3'
      });

      const secondPart = service.handleAgentReply({
        id: 'msg-frag-3b',
        content: '; console.log(msg);"}]}',
        author: { id: 'bot-1', bot: true },
        channelId: 'channel-frag-test-3'
      });

      const result = await pending;
      expect(result.reviewResult.comments[0].suggestedCode).toContain('hello');
      expect(secondPart.accepted).toBe(true);
    });

    // 4. Fragment with JSON inline comments that get stripped
    test('joins single message with inline JSON comments that get stripped', async () => {
      const pending = startReadySession('frag_real_4', 'channel-frag-test-4');

      const handle = service.handleAgentReply({
        id: 'msg-frag-4a',
        content: `{
  "summary": "Review with comments syntax", // overall summary
  "comments": [
    {
      "file": "d.go", // file path
      "start_line": 30,
      "severity": "MEDIUM",
      "message": "Error handling needed"
    }
  ]
}`,
        author: { id: 'bot-1', bot: true },
        channelId: 'channel-frag-test-4'
      });

      const result = await pending;
      expect(result.reviewResult.summary).toBe('Review with comments syntax');
      expect(result.reviewResult.comments).toHaveLength(1);
      expect(result.reviewResult.comments[0].file).toBe('d.go');
      expect(handle.accepted).toBe(true);
    });

    // 5. 3-message fragment
    test('joins 3-message fragment into complete review', async () => {
      const pending = startReadySession('frag_real_5', 'channel-frag-test-5');

      const firstPart = service.handleAgentReply({
        id: 'msg-frag-5a',
        content: '{"summary":"Large review","comments":[{"file":"e.py","start_line":1,"severity":"HIGH","message":"Critical',
        author: { id: 'bot-1', bot: true },
        channelId: 'channel-frag-test-5'
      });
      expect(firstPart.accepted).toBe(false);

      const secondPart = service.handleAgentReply({
        id: 'msg-frag-5b',
        content: ' bug","suggestedCode":"def fix():\\n    pass"},{"file":"f.py","start_line":10,"severity":"LOW","mes',
        author: { id: 'bot-1', bot: true },
        channelId: 'channel-frag-test-5'
      });
      expect(secondPart.accepted).toBe(false);

      const thirdPart = service.handleAgentReply({
        id: 'msg-frag-5c',
        content: 'sage":"Style issue"}]}',
        author: { id: 'bot-1', bot: true },
        channelId: 'channel-frag-test-5'
      });

      const result = await pending;
      expect(result.reviewResult.summary).toBe('Large review');
      expect(result.reviewResult.comments).toHaveLength(2);
      expect(result.reviewResult.comments[0].severity).toBe('HIGH');
      expect(result.reviewResult.comments[1].severity).toBe('LOW');
      expect(thirdPart.accepted).toBe(true);
    });

    // 6. Single message (no fragment) - small review fits in one message
    test('accepts single non-fragmented message for small review', async () => {
      const pending = startReadySession('frag_real_6', 'channel-frag-test-6');

      const handle = service.handleAgentReply({
        id: 'msg-frag-6a',
        content: '{"summary":"LGTM","comments":[]}',
        author: { id: 'bot-1', bot: true },
        channelId: 'channel-frag-test-6'
      });

      const result = await pending;
      expect(result.reviewResult.summary).toBe('LGTM');
      expect(result.reviewResult.comments).toHaveLength(0);
      expect(handle.accepted).toBe(true);
    });

    // 7. Fragment with mixed severities (LOW, MEDIUM, HIGH)
    test('joins fragment with mixed severity comments', async () => {
      const pending = startReadySession('frag_real_7', 'channel-frag-test-7');

      service.handleAgentReply({
        id: 'msg-frag-7a',
        content: '{"summary":"Mixed severity","comments":[{"file":"g.rs","start_line":1,"severity":"LOW","message":"Whitespace"},{"file":"g.rs","start_line":5,"severity":"MEDIUM","message":"Logic"},{"file":"g.rs","start_line":10,"severity":"HIGH","messa',
        author: { id: 'bot-1', bot: true },
        channelId: 'channel-frag-test-7'
      });

      const secondPart = service.handleAgentReply({
        id: 'msg-frag-7b',
        content: 'ge":"Security vulnerability"}]}',
        author: { id: 'bot-1', bot: true },
        channelId: 'channel-frag-test-7'
      });

      const result = await pending;
      expect(result.reviewResult.comments).toHaveLength(3);
      const severities = result.reviewResult.comments.map(c => c.severity);
      expect(severities).toEqual(['LOW', 'MEDIUM', 'HIGH']);
      expect(secondPart.accepted).toBe(true);
    });

    // 8. Fragment with multi-line comments (start_line != end_line)
    test('joins fragment preserving multi-line comment ranges', async () => {
      const pending = startReadySession('frag_real_8', 'channel-frag-test-8');

      service.handleAgentReply({
        id: 'msg-frag-8a',
        content: '{"summary":"Multi-line ranges","comments":[{"file":"h.java","start_line":10,"end_line":25,"severity":"HIGH","message":"Refactor this block","suggestedCode":"public void handle() {\\n  return;\\n}"}',
        author: { id: 'bot-1', bot: true },
        channelId: 'channel-frag-test-8'
      });

      const secondPart = service.handleAgentReply({
        id: 'msg-frag-8b',
        content: ',{"file":"h.java","start_line":50,"end_line":55,"severity":"MEDIUM","message":"Also here"}]}',
        author: { id: 'bot-1', bot: true },
        channelId: 'channel-frag-test-8'
      });

      const result = await pending;
      expect(result.reviewResult.comments[0].start_line).toBe(10);
      expect(result.reviewResult.comments[0].end_line).toBe(25);
      expect(result.reviewResult.comments[1].start_line).toBe(50);
      expect(result.reviewResult.comments[1].end_line).toBe(55);
      expect(secondPart.accepted).toBe(true);
    });

    // 9. Fragment where split happens mid-suggestedCode
    test('joins fragment split in the middle of suggestedCode value', async () => {
      const pending = startReadySession('frag_real_9', 'channel-frag-test-9');

      service.handleAgentReply({
        id: 'msg-frag-9a',
        content: '{"summary":"Code suggestion split","comments":[{"file":"i.rb","start_line":8,"severity":"MEDIUM","message":"Simplify","suggestedCode":"def calculate\\n  result = data.map { |x| x',
        author: { id: 'bot-1', bot: true },
        channelId: 'channel-frag-test-9'
      });

      const secondPart = service.handleAgentReply({
        id: 'msg-frag-9b',
        content: ' * 2 }\\n  result\\nend"}]}',
        author: { id: 'bot-1', bot: true },
        channelId: 'channel-frag-test-9'
      });

      const result = await pending;
      expect(result.reviewResult.comments[0].suggestedCode).toContain('data.map');
      expect(result.reviewResult.comments[0].suggestedCode).toContain('* 2');
      expect(secondPart.accepted).toBe(true);
    });

    // 10. Fragment with Unicode/emoji in message
    test('joins fragment with Unicode and emoji in review messages', async () => {
      const pending = startReadySession('frag_real_10', 'channel-frag-test-10');

      service.handleAgentReply({
        id: 'msg-frag-10a',
        content: '{"summary":"Review dengan Unicode \u2705","comments":[{"file":"j.ts","start_line":1,"severity":"LOW","message":"Gunakan const bukan let \ud83d\udca1 dan perbaiki naming \ud83c\udf0d"}',
        author: { id: 'bot-1', bot: true },
        channelId: 'channel-frag-test-10'
      });

      const secondPart = service.handleAgentReply({
        id: 'msg-frag-10b',
        content: ',{"file":"k.ts","start_line":5,"severity":"HIGH","message":"Bug kritis \u26a0\ufe0f harap segera perbaiki"}]}',
        author: { id: 'bot-1', bot: true },
        channelId: 'channel-frag-test-10'
      });

      const result = await pending;
      expect(result.reviewResult.summary).toContain('\u2705');
      expect(result.reviewResult.comments[0].message).toContain('\ud83d\udca1');
      expect(result.reviewResult.comments[1].message).toContain('\u26a0\ufe0f');
      expect(secondPart.accepted).toBe(true);
    });
  });
});
