class DiscordInteractionResponder {
  constructor(interaction, options = {}) {
    this.interaction = interaction;
    this.logger = options.logger || console;
  }

  async deferUpdate() {
    if (this._isAcknowledged()) return;
    return this.interaction.deferUpdate();
  }

  async update(payload) {
    if (this._isAcknowledged()) {
      return this.interaction.editReply(payload);
    }
    return this.interaction.update(payload);
  }

  async followUp(payload) {
    if (!this._isAcknowledged()) {
      await this.interaction.deferUpdate();
    }
    return this.interaction.followUp(payload);
  }

  async error(message) {
    const payload = {
      content: message,
      components: [],
      embeds: []
    };

    try {
      if (this._isAcknowledged()) {
        return await this.interaction.followUp({ content: message, ephemeral: true });
      }
      return await this.interaction.reply({ ...payload, ephemeral: true });
    } catch (err) {
      this.logger.error(`[DiscordInteractionResponder] Failed to send error response: ${err.message}`);
    }
  }

  _isAcknowledged() {
    return this.interaction.deferred || this.interaction.replied;
  }
}

module.exports = DiscordInteractionResponder;
