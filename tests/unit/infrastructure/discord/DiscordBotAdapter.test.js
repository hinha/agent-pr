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
});
