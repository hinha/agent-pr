const discordExports = require('../../../../src/infrastructure/discord');
const DiscordBotAdapter = require('../../../../src/infrastructure/discord/DiscordBotAdapter');
const DiscordInteractionResponder = require('../../../../src/infrastructure/discord/DiscordInteractionResponder');
const DiscordMessageFormatter = require('../../../../src/infrastructure/discord/DiscordMessageFormatter');

describe('discord index exports', () => {
  test('re-exports adapter, responder, and formatter', () => {
    expect(discordExports).toEqual({
      DiscordBotAdapter,
      DiscordInteractionResponder,
      DiscordMessageFormatter
    });
  });
});
