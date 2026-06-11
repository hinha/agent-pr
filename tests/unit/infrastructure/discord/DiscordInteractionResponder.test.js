const DiscordInteractionResponder = require('../../../../src/infrastructure/discord/DiscordInteractionResponder');

describe('DiscordInteractionResponder', () => {
  test('update acknowledges with interaction.update before deferred', async () => {
    const interaction = {
      deferred: false,
      replied: false,
      update: jest.fn().mockResolvedValue({}),
      editReply: jest.fn()
    };
    const responder = new DiscordInteractionResponder(interaction);

    await responder.update({ content: 'updated' });

    expect(interaction.update).toHaveBeenCalledWith({ content: 'updated' });
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  test('update edits reply after defer', async () => {
    const interaction = {
      deferred: true,
      replied: false,
      update: jest.fn(),
      editReply: jest.fn().mockResolvedValue({})
    };
    const responder = new DiscordInteractionResponder(interaction);

    await responder.update({ content: 'updated' });

    expect(interaction.editReply).toHaveBeenCalledWith({ content: 'updated' });
  });

  test('followUp defers first when interaction is not acknowledged', async () => {
    const interaction = {
      deferred: false,
      replied: false,
      deferUpdate: jest.fn().mockImplementation(async () => {
        interaction.deferred = true;
      }),
      followUp: jest.fn().mockResolvedValue({})
    };
    const responder = new DiscordInteractionResponder(interaction);

    await responder.followUp({ content: 'later' });

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith({ content: 'later' });
  });

  test('error replies ephemerally before acknowledgment', async () => {
    const interaction = {
      deferred: false,
      replied: false,
      reply: jest.fn().mockResolvedValue({})
    };
    const responder = new DiscordInteractionResponder(interaction);

    await responder.error('bad');

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'bad',
      ephemeral: true
    }));
  });

  test('error follows up after acknowledgment', async () => {
    const interaction = {
      deferred: true,
      replied: false,
      followUp: jest.fn().mockResolvedValue({})
    };
    const responder = new DiscordInteractionResponder(interaction);

    await responder.error('bad');

    expect(interaction.followUp).toHaveBeenCalledWith({
      content: 'bad',
      ephemeral: true
    });
  });

  test('logs when sending error response fails', async () => {
    const logger = { error: jest.fn() };
    const interaction = {
      deferred: false,
      replied: false,
      reply: jest.fn().mockRejectedValue(new Error('reply failed'))
    };
    const responder = new DiscordInteractionResponder(interaction, { logger });

    await responder.error('bad');

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('reply failed'));
  });
});
