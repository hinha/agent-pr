const EventEmitter = require('events');
const { Client, GatewayIntentBits } = require('discord.js');
const DiscordMessageFormatter = require('./DiscordMessageFormatter');
const { extractDiscordUserIdFromMention } = require('../../utils/discordMention');

class DiscordBotAdapter extends EventEmitter {
  constructor(botToken, options = {}) {
    super();
    this.botToken = botToken;
    this.logger = options.logger || console;
    this.retryHelper = options.retryHelper;
    this.config = options.config || {};
    this.eventBus = options.eventBus || null;
    this.externalReviewSessionService = options.externalReviewSessionService || null;
    this.formatter = options.formatter || new DiscordMessageFormatter();
    this.client = options.client || new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });
    this.instanceMap = new Map();
    this.repoMap = new Map();
    this.started = false;

    this._buildMapping();
    this._setupHandlers();
  }

  async start() {
    if (!this.config.app?.discord?.enabled) {
      this.logger.info('[DiscordBotAdapter] Discord disabled, skipping start');
      return;
    }

    if (!this.botToken) {
      throw new Error('Discord bot token is required when app.discord.enabled is true');
    }

    if (!this.started) {
      await this.client.login(this.botToken);
      this.started = true;
    }

    this.logger.info('[DiscordBotAdapter] Discord bot started');

    if (this.eventBus) {
      await this.eventBus.emitAsync('discord.started', {
        timestamp: new Date().toISOString()
      });
    }
  }

  async stop() {
    if (!this.client || !this.started) {
      return;
    }

    await this.client.destroy();
    this.started = false;
    this.logger.info('[DiscordBotAdapter] Discord bot stopped');

    if (this.eventBus) {
      await this.eventBus.emitAsync('discord.stopped', {
        timestamp: new Date().toISOString()
      });
    }
  }

  async sendPRNotification(notification) {
    const indices = this._getRepoIndices(notification.owner, notification.repo);
    if (!indices) {
      throw new Error(`No Discord repo mapping found for ${notification.owner}/${notification.repo}`);
    }

    const payload = this.formatter.buildPRNotification(notification, indices);
    const message = await this._sendToRepo(notification.owner, notification.repo, payload);

    return { success: true, id: message.id };
  }

  async sendOutdatedReviewNotification(notification) {
    const indices = this._getRepoIndices(notification.owner, notification.repo);
    if (!indices) {
      throw new Error(`No Discord repo mapping found for ${notification.owner}/${notification.repo}`);
    }

    const payload = this.formatter.buildOutdatedReviewNotification(notification, indices);
    const message = await this._sendToRepo(notification.owner, notification.repo, payload);

    return { success: true, id: message.id };
  }

  async sendHermesMention({ instance, repo, content, mentionBotName }) {
    const allowedMentions = this._buildAllowedMentions(mentionBotName);
    const message = await this._sendToRepo(instance.owner, repo.name, {
      content,
      allowedMentions
    });

    return { success: true, id: message.id, message };
  }

  async sendReply(targetMessage, content, extraPayload = {}) {
    const payload = { content, ...extraPayload };

    if (targetMessage && typeof targetMessage.reply === 'function') {
      return targetMessage.reply(payload);
    }

    const channel = targetMessage?.channel;
    if (channel && typeof channel.send === 'function') {
      return channel.send({
        ...payload,
        reply: { messageReference: targetMessage.id }
      });
    }

    throw new Error('Discord reply target is not sendable');
  }

  async sendReplyChunks(targetMessage, content, options = {}) {
    const prefix = options.prefix || 'Prompt review';
    const maxContentLength = options.maxContentLength || 2000;
    const mentionBotName = options.mentionBotName || '';
    const mentionPrefix = mentionBotName ? `${mentionBotName}\n` : '';
    const allowedMentions = mentionBotName ? this._buildAllowedMentions(mentionBotName) : undefined;
    const headerTemplateLength = `${mentionPrefix}${prefix} (${999}/${999}):\n`.length;
    const chunkSize = options.chunkSize || Math.max(200, maxContentLength - headerTemplateLength);
    const chunks = this._chunkContent(content, chunkSize);
    const sent = [];

    for (let index = 0; index < chunks.length; index++) {
      const header = `${mentionPrefix}${prefix} (${index + 1}/${chunks.length}):\n`;
      const payload = allowedMentions ? { allowedMentions } : {};
      sent.push(await this.sendReply(targetMessage, `${header}${chunks[index]}`, payload));
    }

    return sent;
  }

  async sendReplyTextAttachment(targetMessage, content, options = {}) {
    const mentionBotName = options.mentionBotName || '';
    const allowedMentions = mentionBotName ? this._buildAllowedMentions(mentionBotName) : undefined;
    const fileName = options.fileName || 'review-prompt.txt';
    const introLines = [];

    if (mentionBotName) {
      introLines.push(mentionBotName);
    }
    introLines.push(options.intro || `Prompt review lengkap ada di attachment \`${fileName}\`.`);
    introLines.push('Baca attachment ini sebagai sumber prompt lengkap yang harus direview.');

    const payload = {
      files: [
        {
          attachment: Buffer.from(content, 'utf8'),
          name: fileName
        }
      ]
    };

    if (allowedMentions) {
      payload.allowedMentions = allowedMentions;
    }

    return this.sendReply(targetMessage, introLines.join('\n'), payload);
  }

  async sendQueueCompletedNotification(data) {
    const instance = this.config.instances?.[data.instanceKey];
    if (!instance) {
      throw new Error(`Instance not found for queue notification: ${data.instanceKey}`);
    }

    const payload = this.formatter.buildQueueCompleted(data);
    const message = await this._sendToRepo(instance.owner, data.repoName, payload);
    return { success: true, id: message.id };
  }

  async sendQueueFailedNotification(data) {
    const instance = this.config.instances?.[data.instanceKey];
    if (!instance) {
      throw new Error(`Instance not found for queue notification: ${data.instanceKey}`);
    }

    const payload = this.formatter.buildQueueFailed(data);
    const message = await this._sendToRepo(instance.owner, data.repoName, payload);
    return { success: true, id: message.id };
  }

  async _sendToRepo(owner, repoName, payload) {
    const repoInfo = this._getRepoInfoByOwnerRepo(owner, repoName);
    if (!repoInfo) {
      throw new Error(`Repo config not found for ${owner}/${repoName}`);
    }

    const targetId = repoInfo.repo.discordThreadId || repoInfo.repo.discordChannelId;
    if (!targetId) {
      throw new Error(`Discord channel is not configured for ${owner}/${repoName}`);
    }

    const send = async () => {
      const channel = await this.client.channels.fetch(targetId);
      if (!channel || typeof channel.send !== 'function') {
        throw new Error(`Discord target is not sendable: ${targetId}`);
      }
      return channel.send(payload);
    };

    if (this.retryHelper?.retry) {
      return this.retryHelper.retry(send, {
        retries: 3,
        minTimeout: 1000,
        factor: 2,
        context: 'DiscordBotAdapter.send'
      });
    }

    return send();
  }

  _setupHandlers() {
    this.client.on('ready', () => {
      this.logger.info(`[DiscordBotAdapter] Logged in as ${this.client.user?.tag || 'unknown bot'}`);
    });

    this.client.on('interactionCreate', (interaction) => {
      if (!interaction.isButton || !interaction.isButton()) {
        return;
      }
      this.emit('interaction', interaction);
    });

    this.client.on('messageCreate', async (message) => {
      this.emit('message', message);

      if (!this.externalReviewSessionService) {
        return;
      }

      this.externalReviewSessionService.handleAgentReply(message);
    });

    this.client.on('error', (error) => {
      this.logger.error(`[DiscordBotAdapter] Client error: ${error.message}`);
    });
  }

  _buildMapping() {
    let instanceIdx = 0;
    for (const [instanceKey, instance] of Object.entries(this.config.instances || {})) {
      const owner = instance.owner || instanceKey.split('/')[1];
      this.instanceMap.set(instanceIdx, { instanceKey, instance, owner });

      let repoIdx = 0;
      for (const [repoName, repo] of Object.entries(instance.repos || {})) {
        this.repoMap.set(`${instanceIdx}:${repoIdx}`, {
          owner,
          repoName,
          repo,
          instanceKey,
          instance
        });
        repoIdx++;
      }

      instanceIdx++;
    }
  }

  _getRepoInfoByOwnerRepo(owner, repoName) {
    for (const value of this.repoMap.values()) {
      if (value.owner === owner && value.repoName === repoName) {
        return value;
      }
    }
    return null;
  }

  _getRepoIndices(owner, repoName) {
    for (const [key, value] of this.repoMap.entries()) {
      if (value.owner === owner && value.repoName === repoName) {
        const [instanceIdx, repoIdx] = key.split(':').map(Number);
        return { instanceIdx, repoIdx };
      }
    }
    return null;
  }

  _buildAllowedMentions(mentionBotName) {
    const userId = extractDiscordUserIdFromMention(mentionBotName);
    return {
      parse: [],
      users: userId ? [userId] : []
    };
  }

  _chunkContent(content, maxLength = 3600) {
    const text = String(content || '');
    if (text.length <= maxLength) {
      return [text];
    }

    const chunks = [];
    let remaining = text;

    while (remaining.length > maxLength) {
      let splitAt = remaining.lastIndexOf('\n', maxLength);
      if (splitAt < maxLength * 0.6) {
        splitAt = remaining.lastIndexOf(' ', maxLength);
      }
      if (splitAt < maxLength * 0.6) {
        splitAt = maxLength;
      }

      chunks.push(remaining.slice(0, splitAt).trim());
      remaining = remaining.slice(splitAt).trim();
    }

    if (remaining.length > 0) {
      chunks.push(remaining);
    }

    return chunks;
  }
}

module.exports = DiscordBotAdapter;
