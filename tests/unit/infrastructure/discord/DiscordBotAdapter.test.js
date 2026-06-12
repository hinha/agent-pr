jest.mock('discord.js', () => require('../../../../__mocks__/discord.js'));

const DiscordBotAdapter = require('../../../../src/infrastructure/discord/DiscordBotAdapter');

describe('DiscordBotAdapter', () => {
  const config = {
    app: {
      discord: {
        enabled: true,
        mentionBotName: '<@123456789012345678>'
      }
    },
    instances: {
      'github/acme': {
        key: 'github/acme',
        owner: 'acme',
        repos: {
          api: {
            discordChannelId: 'channel-1'
          }
        }
      }
    }
  };

  test('sends PR notification to configured Discord channel', async () => {
    const adapter = new DiscordBotAdapter('token', {
      config,
      logger: { info: jest.fn(), error: jest.fn() }
    });

    const result = await adapter.sendPRNotification({
      owner: 'acme',
      repo: 'api',
      pr: {
        id: 99,
        number: 7,
        title: 'Add feature',
        url: 'https://github.com/acme/api/pull/7'
      },
      summary: {
        riskLevel: 'LOW',
        impactArea: 'api',
        purpose: 'Add feature',
        filesChanged: 2,
        diffSize: 30
      }
    });

    expect(result.success).toBe(true);
    expect(adapter.client.channels.fetch).toHaveBeenCalledWith('channel-1');
  });

  test('uses safe allowedMentions for Hermes mention token', async () => {
    const adapter = new DiscordBotAdapter('token', {
      config,
      logger: { info: jest.fn(), error: jest.fn() }
    });

    await adapter.sendHermesMention({
      instance: { owner: 'acme' },
      repo: { name: 'api' },
      mentionBotName: '<@123456789012345678>',
      content: '<@123456789012345678>\nReview prompt'
    });

    const channel = await adapter.client.channels.fetch.mock.results[0].value;
    expect(channel.send).toHaveBeenCalledWith(expect.objectContaining({
      allowedMentions: {
        parse: [],
        users: ['123456789012345678']
      }
    }));
  });

  test('returns message object from sendHermesMention and can split long replies', async () => {
    const adapter = new DiscordBotAdapter('token', {
      config,
      logger: { info: jest.fn(), error: jest.fn() }
    });

    const trigger = await adapter.sendHermesMention({
      instance: { owner: 'acme' },
      repo: { name: 'api' },
      mentionBotName: '<@123456789012345678>',
      content: 'short trigger'
    });

    const reply = jest.fn().mockResolvedValue({ id: 'reply-1' });
    trigger.message.reply = reply;

    const result = await adapter.sendReplyChunks(trigger.message, 'a'.repeat(8000), {
      prefix: 'Prompt review'
    });

    expect(trigger.message).toBeDefined();
    expect(reply).toHaveBeenCalledTimes(5);
    for (const call of reply.mock.calls) {
      expect(call[0].content.length).toBeLessThanOrEqual(2000);
    }
    expect(result).toHaveLength(5);
  });

  test('requests message intents for handoff reply flow', () => {
    const adapter = new DiscordBotAdapter('token', {
      config,
      logger: { info: jest.fn(), error: jest.fn() }
    });

    expect(adapter.client.options.intents).toEqual([1, 2, 4]);
  });

  test('skips start when Discord is disabled', async () => {
    const adapter = new DiscordBotAdapter(null, {
      config: { app: { discord: { enabled: false } }, instances: {} },
      logger: { info: jest.fn(), error: jest.fn() }
    });

    await adapter.start();

    expect(adapter.client.login).not.toHaveBeenCalled();
  });

  test('throws on start when enabled without token', async () => {
    const adapter = new DiscordBotAdapter(null, {
      config,
      logger: { info: jest.fn(), error: jest.fn() }
    });

    await expect(adapter.start()).rejects.toThrow('Discord bot token is required');
  });

  test('starts and stops enabled client', async () => {
    const eventBus = { emitAsync: jest.fn().mockResolvedValue() };
    const adapter = new DiscordBotAdapter('token', {
      config,
      eventBus,
      logger: { info: jest.fn(), error: jest.fn() }
    });

    await adapter.start();
    await adapter.stop();

    expect(adapter.client.login).toHaveBeenCalledWith('token');
    expect(adapter.client.destroy).toHaveBeenCalled();
    expect(eventBus.emitAsync).toHaveBeenCalledWith('discord.started', expect.any(Object));
    expect(eventBus.emitAsync).toHaveBeenCalledWith('discord.stopped', expect.any(Object));
  });

  test('does not login twice and stop is a no-op when not started', async () => {
    const adapter = new DiscordBotAdapter('token', {
      config,
      logger: { info: jest.fn(), error: jest.fn() }
    });

    await adapter.stop();
    await adapter.start();
    await adapter.start();

    expect(adapter.client.login).toHaveBeenCalledTimes(1);
  });

  test('throws when repo mapping or channel is missing', async () => {
    const adapter = new DiscordBotAdapter('token', {
      config,
      logger: { info: jest.fn(), error: jest.fn() }
    });

    await expect(adapter.sendPRNotification({
      owner: 'acme',
      repo: 'missing',
      pr: { id: 1, number: 1, title: 'x' },
      summary: {}
    })).rejects.toThrow('No Discord repo mapping');
  });

  test('plain Hermes name does not allow broad mentions', () => {
    const adapter = new DiscordBotAdapter('token', {
      config,
      logger: { info: jest.fn(), error: jest.fn() }
    });

    expect(adapter._buildAllowedMentions('@Hermes')).toEqual({
      parse: [],
      users: []
    });
  });

  test('uses retry helper and supports queue notifications plus thread targets', async () => {
    const retryHelper = {
      retry: jest.fn((fn) => fn())
    };
    const adapter = new DiscordBotAdapter('token', {
      config: {
        ...config,
        instances: {
          'github/acme': {
            ...config.instances['github/acme'],
            repos: {
              api: {
                discordThreadId: 'thread-1'
              }
            }
          }
        }
      },
      retryHelper,
      logger: { info: jest.fn(), error: jest.fn() }
    });

    await adapter.sendQueueCompletedNotification({ instanceKey: 'github/acme', repoName: 'api', prNumber: 7, prTitle: 'Done', level: 'high', duration: 60000 });
    await adapter.sendQueueFailedNotification({ instanceKey: 'github/acme', repoName: 'api', prNumber: 7, prTitle: 'Done', level: 'high', error: 'boom' });

    expect(retryHelper.retry).toHaveBeenCalled();
    expect(adapter.client.channels.fetch).toHaveBeenCalledWith('thread-1');
  });

  test('throws when instance is missing or target is not sendable', async () => {
    const adapter = new DiscordBotAdapter('token', {
      config,
      logger: { info: jest.fn(), error: jest.fn() }
    });

    await expect(adapter.sendQueueCompletedNotification({
      instanceKey: 'github/missing',
      repoName: 'api',
      prNumber: 1,
      prTitle: 'x',
      level: 'low',
      duration: 1000
    })).rejects.toThrow('Instance not found for queue notification');

    adapter.client.channels.fetch.mockResolvedValueOnce({});
    await expect(adapter.sendHermesMention({
      instance: { owner: 'acme' },
      repo: { name: 'api' },
      mentionBotName: '<@123456789012345678>',
      content: 'x'
    })).rejects.toThrow('Discord target is not sendable');
  });

  test('wires client event handlers for ready, interaction, and error', async () => {
    const logger = { info: jest.fn(), error: jest.fn() };
    const adapter = new DiscordBotAdapter('token', { config, logger });
    const interactionListener = jest.fn();
    adapter.on('interaction', interactionListener);

    adapter.client.handlers.ready();
    adapter.client.handlers.interactionCreate({ isButton: () => false });
    adapter.client.handlers.interactionCreate({ isButton: () => true, customId: 'x' });
    adapter.client.handlers.error(new Error('client-fail'));

    expect(logger.info).toHaveBeenCalledWith('[DiscordBotAdapter] Logged in as agent-pr-test#0001');
    expect(interactionListener).toHaveBeenCalledWith(expect.objectContaining({ customId: 'x' }));
    expect(logger.error).toHaveBeenCalledWith('[DiscordBotAdapter] Client error: client-fail');
    expect(adapter._getRepoIndices('acme', 'api')).toEqual({ instanceIdx: 0, repoIdx: 0 });
  });

  test('forwards messageCreate events to external review session service and corrects invalid JSON replies', async () => {
    const externalReviewSessionService = {
      handleAgentReply: jest.fn().mockReturnValue({ matched: true, accepted: false, reason: 'invalid_json' })
    };
    const adapter = new DiscordBotAdapter('token', {
      config,
      externalReviewSessionService,
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
    });
    const messageListener = jest.fn();
    const reply = jest.fn().mockResolvedValue({ id: 'reply-1' });
    adapter.on('message', messageListener);

    await adapter.client.handlers.messageCreate({
      id: 'm-1',
      content: 'not json',
      author: { id: '123', bot: true },
      reference: { messageId: 'trigger-1' },
      reply
    });

    expect(messageListener).toHaveBeenCalled();
    expect(externalReviewSessionService.handleAgentReply).toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('valid JSON only')
    }));
  });
});
