const PullRequest = require('../../core/entities/PullRequest');
const ActionPayloadCodec = require('./ActionPayloadCodec');

class PRActionHandler {
  constructor(options = {}) {
    this.reviewPRUseCase = options.reviewPRUseCase;
    this.stateMachine = options.stateMachine;
    this.eventBus = options.eventBus;
    this.githubAdapter = options.githubAdapter;
    this.reviewQueueUseCase = options.reviewQueueUseCase || null;
    this.checkOutdatedReviewsUseCase = options.checkOutdatedReviewsUseCase || null;
    this.stateRepositoryFactory = options.stateRepositoryFactory || null;
    this.discordAdapter = options.discordAdapter || null;
    this.reviewPromptBuilder = options.reviewPromptBuilder;
    this.formatter = options.formatter;
    this.config = options.config || {};
    this.logger = options.logger || console;
  }

  async handleDiscordInteraction(interaction, responder, config = this.config) {
    this.config = config;
    const callback = ActionPayloadCodec.parse(interaction.customId);
    if (!callback) {
      await responder.error('Invalid action payload.');
      return { success: false, error: 'Invalid action payload' };
    }

    try {
      const instance = this._getInstance(config, callback.instanceIdx);
      const repo = this._getRepo(instance, callback.repoIdx);
      const pr = this._buildPREntity(callback, repo);
      const result = await this._dispatchDiscordAction(callback, responder, instance, repo, pr);

      await this.eventBus?.emitAsync('callback.handled', {
        action: callback.action,
        platform: 'discord',
        instanceKey: instance.key,
        repoName: repo.name,
        prNumber: result.prNumber || pr.number,
        result
      });

      return result;
    } catch (error) {
      this.logger.error(`[PRActionHandler] Discord action failed: ${error.message}`);
      await responder.error(`Action failed: ${error.message}`);

      await this.eventBus?.emitAsync('callback.error', {
        useCase: 'PRActionHandler',
        platform: 'discord',
        callbackData: interaction.customId,
        error: error.message
      });

      return { success: false, error: error.message };
    }
  }

  async _dispatchDiscordAction(callback, responder, instance, repo, pr) {
    switch (callback.action) {
    case 'review_now':
      return this._handleDiscordReviewNow(responder, instance, repo, pr);
    case 'review_level':
      return this._handleDiscordReviewLevel(responder, instance, repo, pr, callback.level);
    case 'review_level_outdated':
      return this._handleDiscordReviewLevel(responder, instance, repo, pr, callback.level, callback.reviewId);
    case 're_review':
      return this._handleDiscordReReview(responder, instance, repo, pr, callback.reviewId);
    case 'approve':
      return this._handleDiscordApprove(responder, instance, repo, pr);
    case 'approve_outdated':
      return this._handleDiscordApprove(responder, instance, repo, pr, callback.reviewId);
    case 'reject':
      return this._handleDiscordReject(responder, instance, repo, pr);
    case 'close':
      return this._handleDiscordClose(responder, instance, repo, pr);
    case 'silent':
      return this._handleDiscordSilent(responder, instance, repo, pr);
    case 'silent_dur':
      return this._handleDiscordSilentDuration(responder, instance, repo, pr, callback.hours);
    case 'dismiss_outdated':
      return this._handleDiscordDismissOutdated(responder, instance, repo, pr, callback.reviewId);
    case 'review_cancel':
      await responder.update({ content: 'Review cancelled.', embeds: [], components: [] });
      return { success: true, action: 'cancelled' };
    default:
      throw new Error(`Unknown Discord action: ${callback.action}`);
    }
  }

  async _handleDiscordReviewNow(responder, instance, repo, pr) {
    await responder.deferUpdate();
    const githubAdapter = this.githubAdapter.create(instance.key);
    const freshPR = await this._resolveFreshPR(pr, repo, githubAdapter);
    const components = this.formatter.buildLevelComponents(instance, {
      instanceIdx: instance.instanceIdx,
      repoIdx: repo.repoIdx
    }, freshPR);

    await responder.update({
      content: `Select review level for ${instance.owner}/${repo.name} PR #${freshPR.number}: ${freshPR.title}`,
      embeds: [],
      components
    });

    return { success: true, action: 'show_levels', prNumber: freshPR.number };
  }

  async _handleDiscordReReview(responder, instance, repo, pr, reviewId) {
    await responder.deferUpdate();
    const githubAdapter = this.githubAdapter.create(instance.key);
    const freshPR = await this._resolveFreshPR(pr, repo, githubAdapter);
    const components = this.formatter.buildLevelComponents(instance, {
      instanceIdx: instance.instanceIdx,
      repoIdx: repo.repoIdx
    }, freshPR, 'review_level_outdated', reviewId);

    await responder.update({
      content: `Select re-review level for ${instance.owner}/${repo.name} PR #${freshPR.number}: ${freshPR.title}`,
      embeds: [],
      components
    });

    return { success: true, action: 'show_re_review_levels', prNumber: freshPR.number };
  }

  async _handleDiscordReviewLevel(responder, instance, repo, pr, level, reviewId = null) {
    await responder.deferUpdate();

    const githubAdapter = this.githubAdapter.create(instance.key);
    const freshPR = await this._resolveFreshPR(pr, repo, githubAdapter);
    const reviewMode = this.config.app?.discord?.reviewMode || 'mention_hermes';

    if (reviewMode === 'internal_queue' || reviewMode === 'handoff_reply_submit') {
      return this._enqueueReview(responder, instance, repo, freshPR, level, reviewMode);
    }

    const { previousComments, lastCommits } = await this._loadPromptContext(githubAdapter, repo.name, freshPR.number);
    const levelConfig = this.config.reviewLevels?.[level];
    const prompt = this.reviewPromptBuilder.build({
      owner: instance.owner,
      repo: repo.name,
      pr: freshPR,
      level,
      levelConfig,
      mcpName: instance.mcpName || 'github',
      previousComments,
      lastCommits
    });
    const mentionBotName = instance.mentionBotName || instance.mention_bot_name ||
      this.config.app?.discord?.mentionBotName || this.config.app?.discord?.mention_bot_name || '@Hermes';

    await this.discordAdapter.sendHermesMention({
      instance,
      repo,
      pr: freshPR,
      mentionBotName,
      content: `${mentionBotName}\n${prompt}`
    });

    await responder.update({
      content: `Hermes review prompt sent for ${instance.owner}/${repo.name} PR #${freshPR.number} (${level.toUpperCase()}).`,
      embeds: [],
      components: []
    });

    return {
      success: true,
      action: reviewId ? 're_review_mentioned' : 'review_mentioned',
      prNumber: freshPR.number
    };
  }

  async _enqueueReview(responder, instance, repo, pr, level, reviewMode = 'internal_queue') {
    if (!this.reviewQueueUseCase) {
      throw new Error('Review queue is not available');
    }

    const result = await this.reviewQueueUseCase.enqueueReview(instance, repo, pr, level);
    if (!result.success) {
      await responder.update({
        content: `Queue full for ${instance.owner}/${repo.name} PR #${pr.number}: ${result.error}`,
        embeds: [],
        components: []
      });
      return result;
    }

    const queueMessage = reviewMode === 'handoff_reply_submit'
      ? `Review queued for ${instance.owner}/${repo.name} PR #${pr.number}. Position #${result.position}. Waiting for ${instance.mentionBotName || 'external reviewer'} handoff reply.`
      : `Review queued for ${instance.owner}/${repo.name} PR #${pr.number}. Position #${result.position}.`;

    await responder.update({
      content: queueMessage,
      embeds: [],
      components: []
    });
    return { success: true, action: 'queued', position: result.position, prNumber: pr.number };
  }

  async _handleDiscordApprove(responder, instance, repo, pr, reviewId = null) {
    await responder.deferUpdate();
    const githubAdapter = this.githubAdapter.create(instance.key);
    const freshPR = await this._resolveFreshPR(pr, repo, githubAdapter);
    const result = await this.reviewPRUseCase.approve(instance, repo, freshPR, githubAdapter);

    if (result.success && reviewId && this.stateRepositoryFactory) {
      const stateRepository = this.stateRepositoryFactory.create(instance.owner, repo.name);
      await stateRepository.clearReviewState(freshPR.id);
      await stateRepository.markProcessed(instance.owner, repo.name, freshPR.id);
    }

    await responder.update({
      content: result.success
        ? `Approved ${instance.owner}/${repo.name} PR #${freshPR.number}.`
        : `Failed to approve PR #${freshPR.number}: ${result.error}`,
      embeds: [],
      components: []
    });

    return { ...result, prNumber: freshPR.number };
  }

  async _handleDiscordReject(responder, instance, repo, pr) {
    await responder.deferUpdate();
    const githubAdapter = this.githubAdapter.create(instance.key);
    const freshPR = await this._resolveFreshPR(pr, repo, githubAdapter);
    const result = await this.reviewPRUseCase.reject(instance, repo, freshPR, null, githubAdapter);

    await responder.update({
      content: result.success
        ? `Changes requested for ${instance.owner}/${repo.name} PR #${freshPR.number}.`
        : `Failed to reject PR #${freshPR.number}: ${result.error}`,
      embeds: [],
      components: []
    });

    return { ...result, prNumber: freshPR.number };
  }

  async _handleDiscordClose(responder, instance, repo, pr) {
    await responder.deferUpdate();
    const githubAdapter = this.githubAdapter.create(instance.key);
    const freshPR = await this._resolveFreshPR(pr, repo, githubAdapter);
    const result = await this.reviewPRUseCase.close(instance, repo, freshPR, githubAdapter);

    await responder.update({
      content: result.success
        ? `Closed ${instance.owner}/${repo.name} PR #${freshPR.number}.`
        : `Failed to close PR #${freshPR.number}: ${result.error}`,
      embeds: [],
      components: []
    });

    return { ...result, prNumber: freshPR.number };
  }

  async _handleDiscordSilent(responder, instance, repo, pr) {
    await responder.deferUpdate();
    const githubAdapter = this.githubAdapter.create(instance.key);
    const freshPR = await this._resolveFreshPR(pr, repo, githubAdapter);

    await responder.update({
      content: `Choose silent duration for ${instance.owner}/${repo.name} PR #${freshPR.number}.`,
      embeds: [],
      components: this.formatter.buildSilentComponents({
        instanceIdx: instance.instanceIdx,
        repoIdx: repo.repoIdx
      }, freshPR)
    });

    return { success: true, action: 'show_silent_options', prNumber: freshPR.number };
  }

  async _handleDiscordSilentDuration(responder, instance, repo, pr, hours) {
    await responder.deferUpdate();
    const githubAdapter = this.githubAdapter.create(instance.key);
    const freshPR = await this._resolveFreshPR(pr, repo, githubAdapter);
    const durationMs = hours * 60 * 60 * 1000;
    const result = await this.reviewPRUseCase.skip(instance, repo, freshPR, durationMs);

    await responder.update({
      content: result.success
        ? `Silenced ${instance.owner}/${repo.name} PR #${freshPR.number} for ${hours} hours.`
        : `Failed to silence PR #${freshPR.number}: ${result.error}`,
      embeds: [],
      components: []
    });

    return { ...result, prNumber: freshPR.number };
  }

  async _handleDiscordDismissOutdated(responder, instance, repo, pr, reviewId) {
    await responder.deferUpdate();
    if (!this.checkOutdatedReviewsUseCase) {
      await responder.update({ content: 'Outdated review dismissed.', embeds: [], components: [] });
      return { success: true };
    }

    const githubAdapter = this.githubAdapter.create(instance.key);
    const freshPR = await this._resolveFreshPR(pr, repo, githubAdapter);
    const result = await this.checkOutdatedReviewsUseCase.dismissOutdatedReview(
      instance,
      repo,
      reviewId,
      freshPR.id?.toString(),
      freshPR.headSha
    );

    await responder.update({
      content: result.success
        ? `Dismissed outdated review for ${instance.owner}/${repo.name} PR #${freshPR.number}.`
        : `Failed to dismiss outdated review: ${result.error}`,
      embeds: [],
      components: []
    });

    return { ...result, prNumber: freshPR.number };
  }

  async _loadPromptContext(githubAdapter, repoName, prNumber) {
    const previousComments = await this._tryLoad(
      () => githubAdapter.getPRComments(repoName, prNumber),
      `previous comments for PR #${prNumber}`,
      []
    );
    const lastCommits = await this._tryLoad(
      () => githubAdapter.getPRCommits(repoName, prNumber, 3),
      `recent commits for PR #${prNumber}`,
      []
    );

    return { previousComments, lastCommits };
  }

  async _tryLoad(loader, description, fallback) {
    try {
      return await loader();
    } catch (error) {
      this.logger.warn(`[PRActionHandler] Could not fetch ${description}: ${error.message}`);
      return fallback;
    }
  }

  async _resolveFreshPR(pr, repo, githubAdapter) {
    const openPRs = await githubAdapter.getOpenPRs(repo.name);
    const freshData = openPRs.find(p => p.id === pr.id);
    if (freshData) {
      const freshPR = new PullRequest(freshData);
      this.logger.info(`[PRActionHandler] Fresh PR data loaded: #${freshPR.number} (${freshPR.headBranch} -> ${freshPR.baseBranch})`);
      return freshPR;
    }
    this.logger.warn(`[PRActionHandler] Could not find PR with id=${pr.id} in open PRs`);
    return pr;
  }

  _getInstance(config, instanceIdx) {
    const instances = Object.values(config.instances || {});
    const instance = instances[instanceIdx];

    if (!instance) {
      throw new Error(`Instance not found at index ${instanceIdx}`);
    }

    return {
      ...instance,
      instanceIdx
    };
  }

  _getRepo(instance, repoIdx) {
    const repos = Object.values(instance.repos || {});
    const repoKeys = Object.keys(instance.repos || {});
    const repo = repos[repoIdx];

    if (!repo) {
      throw new Error(`Repository not found at index ${repoIdx}`);
    }

    return {
      name: repo.name || repoKeys[repoIdx],
      threadId: repo.threadId || repo.thread_id,
      discordChannelId: repo.discordChannelId || repo.discord_channel_id,
      discordThreadId: repo.discordThreadId || repo.discord_thread_id,
      instanceKey: instance.key,
      repoIdx
    };
  }

  _buildPREntity(callback, repo) {
    const prIdNum = parseInt(callback.prId, 10);
    const owner = repo.instanceKey.split('/')[1];

    return new PullRequest({
      id: prIdNum,
      number: 0,
      title: '',
      owner,
      repo: repo.name,
      url: '',
      createdAt: new Date()
    });
  }
}

module.exports = PRActionHandler;
