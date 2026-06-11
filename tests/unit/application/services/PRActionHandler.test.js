const PRActionHandler = require('../../../../src/application/services/PRActionHandler');
const ActionPayloadCodec = require('../../../../src/application/services/ActionPayloadCodec');

describe('PRActionHandler', () => {
  let githubInstance;
  let githubAdapter;
  let discordAdapter;
  let responder;
  let formatter;
  let eventBus;
  let reviewPRUseCase;
  let reviewQueueUseCase;
  let checkOutdatedReviewsUseCase;
  let stateRepository;
  let stateRepositoryFactory;
  let reviewPromptBuilder;
  let logger;
  let config;
  let handler;

  beforeEach(() => {
    githubInstance = {
      getOpenPRs: jest.fn().mockResolvedValue([
        {
          id: 123,
          number: 9,
          title: 'Improve API',
          owner: 'acme',
          repo: 'api',
          author: 'dev',
          url: 'https://github.com/acme/api/pull/9',
          headBranch: 'feature/api',
          baseBranch: 'main',
          headSha: 'abc'
        }
      ]),
      getPRComments: jest.fn().mockResolvedValue([{ path: 'src/api.js', line: 2, body: 'Old comment' }]),
      getPRCommits: jest.fn().mockResolvedValue([{ sha: 'abc', message: 'fix', author: 'dev' }])
    };

    githubAdapter = { create: jest.fn().mockReturnValue(githubInstance) };
    discordAdapter = {
      sendHermesMention: jest.fn().mockResolvedValue({ success: true, id: 'm1' })
    };
    responder = {
      deferUpdate: jest.fn().mockResolvedValue(),
      update: jest.fn().mockResolvedValue(),
      error: jest.fn().mockResolvedValue()
    };
    formatter = {
      buildLevelComponents: jest.fn().mockReturnValue([{ type: 'levels' }]),
      buildSilentComponents: jest.fn().mockReturnValue([{ type: 'silent' }])
    };
    eventBus = { emitAsync: jest.fn().mockResolvedValue() };
    reviewPRUseCase = {
      approve: jest.fn().mockResolvedValue({ success: true }),
      reject: jest.fn().mockResolvedValue({ success: true }),
      close: jest.fn().mockResolvedValue({ success: true }),
      skip: jest.fn().mockResolvedValue({ success: true })
    };
    reviewQueueUseCase = {
      enqueueReview: jest.fn().mockResolvedValue({ success: true, position: 2 })
    };
    checkOutdatedReviewsUseCase = {
      dismissOutdatedReview: jest.fn().mockResolvedValue({ success: true })
    };
    stateRepository = {
      clearReviewState: jest.fn().mockResolvedValue(),
      markProcessed: jest.fn().mockResolvedValue()
    };
    stateRepositoryFactory = { create: jest.fn(() => stateRepository) };
    reviewPromptBuilder = {
      build: jest.fn().mockReturnValue('RENDERED PROMPT')
    };
    logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    config = {
      app: {
        discord: {
          enabled: true,
          mentionBotName: '<@123456789012345678>',
          reviewMode: 'mention_hermes'
        }
      },
      reviewLevels: {
        high: { focusAreas: ['security'], maxCommentsPerFile: 10 },
        medium: { focusAreas: ['bugs'], maxCommentsPerFile: 5 }
      },
      instances: {
        'github/acme': {
          key: 'github/acme',
          owner: 'acme',
          mcpName: 'github-work',
          repos: {
            api: { name: 'api', thread_id: 10, discordChannelId: 'channel-1' }
          }
        }
      }
    };

    handler = new PRActionHandler({
      reviewPRUseCase,
      stateMachine: {},
      eventBus,
      githubAdapter,
      reviewQueueUseCase,
      checkOutdatedReviewsUseCase,
      stateRepositoryFactory,
      discordAdapter,
      reviewPromptBuilder,
      formatter,
      logger,
      config
    });
  });

  function interactionFor(payload) {
    return { customId: ActionPayloadCodec.format(payload) };
  }

  test('returns error for invalid payload', async () => {
    const result = await handler.handleDiscordInteraction({ customId: 'bad' }, responder);

    expect(result).toEqual({ success: false, error: 'Invalid action payload' });
    expect(responder.error).toHaveBeenCalledWith('Invalid action payload.');
  });

  test('review now loads fresh PR and shows level buttons', async () => {
    const result = await handler.handleDiscordInteraction(interactionFor({
      action: 'review_now',
      instanceIdx: 0,
      repoIdx: 0,
      prId: 123
    }), responder);

    expect(result).toEqual({ success: true, action: 'show_levels', prNumber: 9 });
    expect(formatter.buildLevelComponents).toHaveBeenCalledWith(expect.objectContaining({ owner: 'acme' }), {
      instanceIdx: 0,
      repoIdx: 0
    }, expect.objectContaining({ number: 9 }));
    expect(responder.update).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Select review level')
    }));
  });

  test('re-review shows outdated review level buttons', async () => {
    const result = await handler.handleDiscordInteraction(interactionFor({
      action: 're_review',
      instanceIdx: 0,
      repoIdx: 0,
      prId: 123,
      reviewId: '77'
    }), responder);

    expect(result.action).toBe('show_re_review_levels');
    expect(formatter.buildLevelComponents).toHaveBeenCalledWith(
      expect.any(Object),
      { instanceIdx: 0, repoIdx: 0 },
      expect.objectContaining({ number: 9 }),
      'review_level_outdated',
      '77'
    );
  });

  test('review level sends rendered Hermes mention prompt', async () => {
    const result = await handler.handleDiscordInteraction(interactionFor({
      action: 'review_level',
      instanceIdx: 0,
      repoIdx: 0,
      prId: 123,
      level: 'high'
    }), responder);

    expect(result.success).toBe(true);
    expect(discordAdapter.sendHermesMention).toHaveBeenCalledWith(expect.objectContaining({
      mentionBotName: '<@123456789012345678>',
      content: '<@123456789012345678>\nRENDERED PROMPT'
    }));
    expect(reviewPromptBuilder.build).toHaveBeenCalledWith(expect.objectContaining({
      owner: 'acme',
      repo: 'api',
      level: 'high',
      previousComments: expect.any(Array),
      lastCommits: expect.any(Array)
    }));
  });

  test('review level uses internal queue mode when configured', async () => {
    handler.config.app.discord.reviewMode = 'internal_queue';

    const result = await handler.handleDiscordInteraction(interactionFor({
      action: 'review_level',
      instanceIdx: 0,
      repoIdx: 0,
      prId: 123,
      level: 'medium'
    }), responder);

    expect(result).toEqual({ success: true, action: 'queued', position: 2, prNumber: 9 });
    expect(reviewQueueUseCase.enqueueReview).toHaveBeenCalled();
    expect(discordAdapter.sendHermesMention).not.toHaveBeenCalled();
  });

  test('review level returns queue full message when enqueue fails', async () => {
    handler.config.app.discord.reviewMode = 'internal_queue';
    reviewQueueUseCase.enqueueReview.mockResolvedValueOnce({ success: false, error: 'full' });

    const result = await handler.handleDiscordInteraction(interactionFor({
      action: 'review_level',
      instanceIdx: 0,
      repoIdx: 0,
      prId: 123,
      level: 'medium'
    }), responder);

    expect(result).toEqual({ success: false, error: 'full' });
    expect(responder.update).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Queue full')
    }));
  });

  test('approve outdated review clears review state when successful', async () => {
    const result = await handler.handleDiscordInteraction(interactionFor({
      action: 'approve_outdated',
      instanceIdx: 0,
      repoIdx: 0,
      prId: 123,
      reviewId: '55'
    }), responder);

    expect(result.success).toBe(true);
    expect(stateRepositoryFactory.create).toHaveBeenCalledWith('acme', 'api');
    expect(stateRepository.clearReviewState).toHaveBeenCalledWith(123);
    expect(stateRepository.markProcessed).toHaveBeenCalledWith('acme', 'api', 123);
  });

  test('reject and close actions update responder messages', async () => {
    const rejectResult = await handler.handleDiscordInteraction(interactionFor({
      action: 'reject',
      instanceIdx: 0,
      repoIdx: 0,
      prId: 123
    }), responder);

    const closeResult = await handler.handleDiscordInteraction(interactionFor({
      action: 'close',
      instanceIdx: 0,
      repoIdx: 0,
      prId: 123
    }), responder);

    expect(rejectResult.success).toBe(true);
    expect(closeResult.success).toBe(true);
    expect(reviewPRUseCase.reject).toHaveBeenCalled();
    expect(reviewPRUseCase.close).toHaveBeenCalled();
  });

  test('silent action shows duration options and silent_dur calls skip use case', async () => {
    const showResult = await handler.handleDiscordInteraction(interactionFor({
      action: 'silent',
      instanceIdx: 0,
      repoIdx: 0,
      prId: 123
    }), responder);
    const durationResult = await handler.handleDiscordInteraction(interactionFor({
      action: 'silent_dur',
      instanceIdx: 0,
      repoIdx: 0,
      prId: 123,
      hours: 6
    }), responder);

    expect(showResult.action).toBe('show_silent_options');
    expect(formatter.buildSilentComponents).toHaveBeenCalled();
    expect(durationResult.success).toBe(true);
    expect(reviewPRUseCase.skip).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), expect.objectContaining({ number: 9 }), 21600000);
  });

  test('dismiss outdated handles missing use case and success path', async () => {
    const noDismissHandler = new PRActionHandler({
      reviewPRUseCase,
      eventBus,
      githubAdapter,
      formatter,
      logger,
      config
    });

    const fallbackResult = await noDismissHandler.handleDiscordInteraction(interactionFor({
      action: 'dismiss_outdated',
      instanceIdx: 0,
      repoIdx: 0,
      prId: 123,
      reviewId: '55'
    }), responder);

    const successResult = await handler.handleDiscordInteraction(interactionFor({
      action: 'dismiss_outdated',
      instanceIdx: 0,
      repoIdx: 0,
      prId: 123,
      reviewId: '55'
    }), responder);

    expect(fallbackResult).toEqual({ success: true });
    expect(successResult.success).toBe(true);
    expect(checkOutdatedReviewsUseCase.dismissOutdatedReview).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'acme' }),
      expect.objectContaining({ name: 'api' }),
      '55',
      '123',
      'abc'
    );
  });

  test('review cancel clears components', async () => {
    const result = await handler.handleDiscordInteraction(interactionFor({
      action: 'review_cancel',
      instanceIdx: 0,
      repoIdx: 0,
      prId: 123
    }), responder);

    expect(result).toEqual({ success: true, action: 'cancelled' });
    expect(responder.update).toHaveBeenCalledWith({ content: 'Review cancelled.', embeds: [], components: [] });
  });

  test('unknown action reports callback error through responder and event bus', async () => {
    const result = await handler.handleDiscordInteraction(interactionFor({
      action: 'unknown_action',
      instanceIdx: 0,
      repoIdx: 0,
      prId: 123
    }), responder);

    expect(result.success).toBe(false);
    expect(responder.error).toHaveBeenCalledWith(expect.stringContaining('Unknown Discord action'));
    expect(eventBus.emitAsync).toHaveBeenCalledWith('callback.error', expect.objectContaining({
      platform: 'discord'
    }));
  });

  test('tryLoad returns fallback and resolveFreshPR falls back to original PR when missing', async () => {
    const fallback = await handler._tryLoad(async () => {
      throw new Error('unavailable');
    }, 'previous comments', ['x']);

    githubInstance.getOpenPRs.mockResolvedValueOnce([]);
    const stalePR = handler._buildPREntity({ prId: '123' }, { name: 'api', instanceKey: 'github/acme' });
    const freshPR = await handler._resolveFreshPR(stalePR, { name: 'api' }, githubInstance);

    expect(fallback).toEqual(['x']);
    expect(logger.warn).toHaveBeenCalledWith('[PRActionHandler] Could not fetch previous comments: unavailable');
    expect(freshPR).toBe(stalePR);
  });

  test('get instance, repo, and PR entity support repo aliases and missing indexes', () => {
    const instance = handler._getInstance(config, 0);
    const repo = handler._getRepo(instance, 0);
    const pr = handler._buildPREntity({ prId: '123' }, repo);

    expect(instance.instanceIdx).toBe(0);
    expect(repo).toEqual(expect.objectContaining({
      name: 'api',
      threadId: 10,
      discordChannelId: 'channel-1',
      instanceKey: 'github/acme',
      repoIdx: 0
    }));
    expect(pr.id).toBe(123);
    expect(pr.owner).toBe('acme');

    expect(() => handler._getInstance({ instances: {} }, 0)).toThrow('Instance not found at index 0');
    expect(() => handler._getRepo({ repos: {} }, 0)).toThrow('Repository not found at index 0');
  });
});
