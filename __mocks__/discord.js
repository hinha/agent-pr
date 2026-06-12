class MockClient {
  constructor(options = {}) {
    this.options = options;
    this.handlers = {};
    this.user = { tag: 'agent-pr-test#0001' };
    this.__send = jest.fn().mockResolvedValue({ id: 'discord-message-1' });
    this.channels = {
      fetch: jest.fn().mockResolvedValue({ send: this.__send })
    };
  }

  on(event, handler) {
    this.handlers[event] = handler;
    return this;
  }

  login = jest.fn().mockResolvedValue('logged-in');
  destroy = jest.fn().mockResolvedValue();
}

class MockEmbedBuilder {
  constructor() {
    this.data = { fields: [] };
  }

  setTitle(value) { this.data.title = value; return this; }
  setURL(value) { this.data.url = value; return this; }
  setColor(value) { this.data.color = value; return this; }
  setDescription(value) { this.data.description = value; return this; }
  setTimestamp(value) { this.data.timestamp = value; return this; }
  addFields(...fields) { this.data.fields.push(...fields); return this; }
}

class MockActionRowBuilder {
  constructor() {
    this.components = [];
  }

  addComponents(...components) {
    this.components.push(...components);
    return this;
  }
}

class MockButtonBuilder {
  constructor() {
    this.data = {};
  }

  setLabel(value) { this.data.label = value; return this; }
  setStyle(value) { this.data.style = value; return this; }
  setCustomId(value) { this.data.custom_id = value; return this; }
  setURL(value) { this.data.url = value; return this; }
}

module.exports = {
  Client: MockClient,
  GatewayIntentBits: { Guilds: 1, GuildMessages: 2, MessageContent: 4 },
  EmbedBuilder: MockEmbedBuilder,
  ActionRowBuilder: MockActionRowBuilder,
  ButtonBuilder: MockButtonBuilder,
  ButtonStyle: {
    Primary: 1,
    Secondary: 2,
    Success: 3,
    Danger: 4,
    Link: 5
  }
};
