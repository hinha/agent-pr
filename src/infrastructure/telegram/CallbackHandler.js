/**
 * CallbackHandler - Handles Telegram bot callback queries
 *
 * This handler processes inline button callbacks from Telegram,
 * such as approve, reject, review now, skip, etc.
 *
 * @example
 * const handler = new CallbackHandler(reviewPRUseCase, stateMachine, eventBus, { githubAdapter });
 * await handler.handleCallbackQuery(query, config);
 */

class CallbackHandler {
  /**
   * @param {Object} reviewPRUseCase - ReviewPRUseCase instance
   * @param {Object} stateMachine - PRStateMachine instance
   * @param {Object} eventBus - EventBus instance
   * @param {Object} options - Configuration options
   * @param {Object} options.logger - Logger instance
   * @param {Object} options.githubAdapter - GitHub adapter factory with create/createForOwner methods
   * @param {Object} options.config - Full application config (for level options)
   * @param {Object} options.skipManager - SkipManager instance
   * @param {Object} options.stateRepositoryFactory - StateRepository factory
   * @param {Object} options.checkOutdatedReviewsUseCase - CheckOutdatedReviewsUseCase instance
   * @param {Object} options.bot - Telegram bot instance
   * @param {Object} options.chatId - Telegram chat ID
   */
  constructor(reviewPRUseCase, stateMachine, eventBus, options = {}) {
    this.reviewPRUseCase = reviewPRUseCase;
    this.stateMachine = stateMachine;
    this.eventBus = eventBus;
    this.logger = options.logger || console;
    this.githubAdapter = options.githubAdapter;
    this.config = options.config || null;
    this.skipManager = options.skipManager || null;
    this.stateRepositoryFactory = options.stateRepositoryFactory || null;
    this.checkOutdatedReviewsUseCase = options.checkOutdatedReviewsUseCase || null;
    this.confirmationManager = options.confirmationManager || null;
    this.bot = options.bot || null;
    this.chatId = options.chatId || null;
  }

  /**
   * Handle a callback query from Telegram
   *
   * @param {Object} query - Telegram callback query object
   * @param {Object} config - Full configuration with instances
   * @returns {Promise<Object>} Handler result
   */
  async handleCallbackQuery(query, config) {
    const { data } = query;

    try {
      this.logger.debug(`[CallbackHandler] Processing callback: ${data}`);

      // Parse callback data
      const callback = this._parseCallbackData(data);

      if (!callback) {
        throw new Error(`Invalid callback data format: ${data}`);
      }

      // Get instance and repo configuration
      const instance = this._getInstance(config, callback.instanceIdx);
      const repo = this._getRepo(instance, callback.repoIdx);

      // Build PR entity from callback data
      const pr = this._buildPREntity(callback, repo);

      let result;

      // Handle different callback actions
      switch (callback.action) {
        case 'review_now':
          // Show review level selection (sends NEW message)
          result = await this._handleReviewNow(query, instance, repo, pr);
          break;

        case 'visit':
          // Send PR URL
          result = await this._handleVisit(query, instance, repo, pr);
          break;

        case 'review_cancel':
          // Cancel and delete review selection message
          result = await this._handleReviewCancel(query, instance, repo, pr);
          break;

        case 'approve':
          result = await this._handleApprove(query, instance, repo, pr);
          break;

        case 'cfm_y':
          result = await this._handleConfirmYes(query, instance, repo, pr, callback);
          break;

        case 'cfm_n':
          result = await this._handleConfirmNo(query, instance, repo, pr, callback);
          break;

        case 'reject':
          result = await this._handleReject(query, instance, repo, pr);
          break;

        case 'close':
          result = await this._handleClose(query, instance, repo, pr);
          break;

        case 'skip':
          result = await this._handleSkip(query, instance, repo, pr);
          break;

        case 'silent':
          result = await this._handleSilent(query, instance, repo, pr);
          break;

        case 'silent_dur':
          result = await this._handleSilentDur(query, instance, repo, pr, callback.hours);
          break;

        case 'silent_custom':
          result = await this._handleSilentCustom(query, instance, repo, pr);
          break;

        case 'review_level':
          result = await this._handleReviewLevel(query, instance, repo, pr, callback.level);
          break;

        case 'approve_outdated':
          result = await this._handleApproveOutdated(query, instance, repo, pr, callback.reviewId);
          break;

        case 're_review':
          result = await this._handleReReview(query, instance, repo, pr, callback.reviewId);
          break;

        case 'dismiss_outdated':
          result = await this._handleDismissOutdated(query, instance, repo, pr, callback.reviewId);
          break;

        case 'review_level_outdated':
          result = await this._handleReviewLevelOutdated(query, instance, repo, pr, callback.reviewId, callback.level);
          break;

        default:
          throw new Error(`Unknown callback action: ${callback.action}`);
      }

      // Emit callback handled event
      await this.eventBus.emitAsync('callback.handled', {
        action: callback.action,
        instanceKey: instance.key,
        repoName: repo.name,
        prNumber: pr.number,
        result
      });

      return result;

    } catch (error) {
      this.logger.error(`[CallbackHandler] Error handling callback ${data}:`, error);

      await this.eventBus.emitAsync('callback.error', {
        useCase: 'CallbackHandler',
        callbackData: data,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Parse callback data string into components
   * @private
   */
  _parseCallbackData(data) {
    // Standard format: action:instanceIdx:repoIdx:prId
    // Review level format: review_level:instanceIdx:repoIdx:prId:level
    // Outdated format: action:instanceIdx:repoIdx:prId:reviewId
    // Outdated review level: review_level_outdated:instanceIdx:repoIdx:prId:reviewId:level

    const parts = data.split(':');

    if (parts.length < 4) {
      return null;
    }

    const callback = {
      action: parts[0],
      instanceIdx: parseInt(parts[1], 10),
      repoIdx: parseInt(parts[2], 10),
      prId: parts[3]
    };

    // Handle actions with 5 parts
    if (parts.length >= 5) {
      if (callback.action === 'review_level' || callback.action === 'review_level_outdated') {
        callback.level = parts[4];
      } else if (callback.action === 'silent_dur') {
        const parsedHours = parseInt(parts[4], 10);
        const allowedHours = new Set([1, 2, 3, 4, 6, 8, 12, 24, 48]);

        if (!Number.isInteger(parsedHours) || !allowedHours.has(parsedHours)) {
          return null; // reject malformed/tampered callback
        }

        callback.hours = parsedHours;
      } else {
        // For approve_outdated, re_review, dismiss_outdated: parts[4] is reviewId
        callback.reviewId = parts[4];
      }
    }

    // Handle actions with 6 parts (review_level_outdated has both level and reviewId)
    if (parts.length >= 6 && callback.action === 'review_level_outdated') {
      callback.reviewId = parts[4];
      callback.level = parts[5];
    }

    return callback;
  }

  /**
   * Get instance configuration by index
   * @private
   */
  _getInstance(config, instanceIdx) {
    const instances = Object.values(config.instances);
    const instance = instances[instanceIdx];

    if (!instance) {
      throw new Error(`Instance not found at index ${instanceIdx}`);
    }

    return {
      ...instance,
      instanceIdx
    };
  }

  /**
   * Get repository configuration by index
   * @private
   */
  _getRepo(instance, repoIdx) {
    const repos = Object.values(instance.repos || {});
    const repo = repos[repoIdx];

    if (!repo) {
      throw new Error(`Repository not found at index ${repoIdx}`);
    }

    return {
      name: repo.name || Object.keys(instance.repos)[repoIdx],
      threadId: repo.thread_id,
      instanceKey: instance.key,
      repoIdx
    };
  }

  /**
   * Build PR entity from callback data
   * @private
   */
  _buildPREntity(callback, repo) {
    const PullRequest = require('../../core/entities/PullRequest');
    const prIdNum = parseInt(callback.prId, 10);
    const owner = repo.instanceKey.split('/')[1];

    // Placeholder entity - pr.number is 0 until resolved via _resolveFreshPR
    // callback.prId is the GitHub node ID, NOT the PR number
    return new PullRequest({
      id: prIdNum,
      number: 0,
      title: '',
      owner: owner,
      repo: repo.name,
      url: '',
      createdAt: new Date()
    });
  }

  /**
   * Resolve fresh PR data from GitHub API using node ID
   * Matches feature branch pattern: getOpenPRs() → find by id
   * @param {PullRequest} pr - Placeholder PR with node ID
   * @param {Object} repo - Repository config
   * @param {Object} githubAdapter - GitHub adapter instance
   * @returns {Promise<PullRequest>} Resolved PR with correct number and full data
   * @private
   */
  async _resolveFreshPR(pr, repo, githubAdapter) {
    const openPRs = await githubAdapter.getOpenPRs(repo.name);
    const freshData = openPRs.find(p => p.id === pr.id);
    if (freshData) {
      const PullRequest = require('../../core/entities/PullRequest');
      const freshPR = new PullRequest(freshData);
      this.logger.info(
        `[CallbackHandler] Fresh PR data loaded: #${freshPR.number} (${freshPR.headBranch} → ${freshPR.baseBranch})`
      );
      return freshPR;
    }
    this.logger.warn(`[CallbackHandler] Could not find PR with id=${pr.id} in open PRs`);
    return pr;
  }

  /**
   * Handle review level selection - show available levels
   * @private
   */
  async _handleReviewLevelSelection(query, instance, repo, pr) {
    this.logger.info(
      `[CallbackHandler] Review level requested for PR #${pr.number}`
    );

    // Answer callback to show processing
    await query.answer('Select review level...');

    // Build level selection keyboard
    const keyboard = this._buildLevelKeyboard(instance, repo, pr);

    // Edit message to show level options
    await query.editMessageText(
      `🔍 <b>Select Review Level</b>\n\n` +
      `📌 PR #${pr.number}: ${this._escapeHtml(pr.title)}\n\n` +
      `Choose the review depth:`,
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      }
    );

    return {
      success: true,
      action: 'show_levels'
    };
  }

  /**
   * Handle review_now - send NEW message with level selection (matches feature branch)
   * @private
   */
  async _handleReviewNow(query, instance, repo, pr) {
    this.logger.info(
      `[CallbackHandler] Review now requested for PR with id=${pr.id}`
    );

    await query.answer();

    // Resolve fresh PR data for display (title, number, author)
    const githubAdapter = this.githubAdapter.create(instance.key);
    pr = await this._resolveFreshPR(pr, repo, githubAdapter);

    // Get available levels from instance config
    const levels = instance.agent?.level || ['low', 'medium', 'high'];

    // Use indices already resolved by _getInstance/_getRepo
    const instanceIdx = instance.instanceIdx;
    const repoIdx = repo.repoIdx;

    // Build level selection keyboard
    const keyboard = levels.map(level => [
      {
        text: `${level === 'low' ? '🟢' : level === 'medium' ? '🟡' : '🔴'} ${level.toUpperCase()}`,
        callback_data: `review_level:${instanceIdx}:${repoIdx}:${pr.id}:${level}`
      }
    ]);

    // Add cancel button
    keyboard.push([
      { text: '❌ Cancel', callback_data: `review_cancel:${instanceIdx}:${repoIdx}:${pr.id}` }
    ]);

    // Send NEW message (not edit) - this matches feature branch UX
    await this.bot.sendMessage(
      this.chatId,
      `🔍 <b>Select Review Level for ${this._escapeHtml(`${instance.owner}/${repo.name}`)} PR #${pr.number}</b>\n\n` +
      `📌 <b>Title:</b> ${this._escapeHtml(pr.title)}\n` +
      `👤 <b>Author:</b> ${this._escapeHtml(pr.author)}\n\n` +
      `Choose review level:`,
      {
        reply_markup: { inline_keyboard: keyboard },
        message_thread_id: repo.threadId,
        parse_mode: 'HTML'
      }
    );

    return {
      success: true,
      action: 'show_levels'
    };
  }

  /**
   * Handle visit - send PR URL
   * @private
   */
  async _handleVisit(query, instance, repo, pr) {
    this.logger.info(
      `[CallbackHandler] Visit PR requested for PR with id=${pr.id}`
    );

    await query.answer('🔗 Opening PR page...');

    // Resolve fresh PR data for correct URL
    const githubAdapter = this.githubAdapter.create(instance.key);
    pr = await this._resolveFreshPR(pr, repo, githubAdapter);

    await this.bot.sendMessage(
      this.chatId,
      `🔗 <b>PR URL</b>\n\n${this._escapeHtml(pr.url)}`,
      {
        disable_web_page_preview: false,
        message_thread_id: repo.threadId,
        parse_mode: 'HTML'
      }
    );

    return {
      success: true,
      action: 'visit'
    };
  }

  /**
   * Handle review_cancel - delete review selection message
   * @private
   */
  async _handleReviewCancel(query, instance, repo, pr) {
    this.logger.info(
      `[CallbackHandler] Review cancel requested for PR #${pr.number}`
    );

    await query.answer('❌ Review cancelled');

    await this.bot.deleteMessage(this.chatId, query.message.message_id);

    return {
      success: true,
      action: 'cancelled'
    };
  }

  /**
   * Build keyboard for review level selection
   * @private
   */
  _buildLevelKeyboard(instance, repo, pr) {
    // Get available levels from instance config
    const levels = instance.agent?.level || ['low', 'medium', 'high'];

    // Use indices already resolved by _getInstance/_getRepo
    const instanceIdx = instance.instanceIdx;
    const repoIdx = repo.repoIdx;

    return levels.map(level => [
      {
        text: level.toUpperCase(),
        callback_data: `review_level:${instanceIdx}:${repoIdx}:${pr.id}:${level}`
      }
    ]);
  }

  /**
   * Escape HTML special characters
   * @private
   */
  _escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Handle approve action - show confirmation prompt
   * @private
   */
  async _handleApprove(query, instance, repo, pr) {
    this.logger.info(`[CallbackHandler] Approve confirmation requested for PR with id=${pr.id}`);

    await query.answer('Confirming approval...');

    const originalKeyboard = query.message?.reply_markup?.inline_keyboard;
    const chatId = query.message?.chat?.id || this.chatId;
    const messageId = query.message?.message_id;

    if (!messageId || !this.confirmationManager) {
      // Fallback: no confirmation, approve directly
      return await this._executeApprove(query, instance, repo, pr);
    }

    // Store pending confirmation
    this.confirmationManager.add(chatId, messageId, originalKeyboard, 'approve', {});

    // Show confirmation keyboard
    const instanceIdx = instance.instanceIdx;
    const repoIdx = repo.repoIdx;
    const confirmKeyboard = [
      [
        { text: '✅ Yes, Approve', callback_data: `cfm_y:${instanceIdx}:${repoIdx}:${pr.id}` },
        { text: '❌ No', callback_data: `cfm_n:${instanceIdx}:${repoIdx}:${pr.id}` }
      ]
    ];

    await query.editMessageReplyMarkup({ inline_keyboard: confirmKeyboard });

    return { success: true, action: 'confirm_pending' };
  }

  /**
   * Execute the actual approval (after confirmation)
   * @private
   */
  async _executeApprove(query, instance, repo, pr) {
    this.logger.info(`[CallbackHandler] Executing approve for PR with id=${pr.id}`);

    await query.answer('Approving PR...');

    const githubAdapter = this.githubAdapter.create(instance.key);
    pr = await this._resolveFreshPR(pr, repo, githubAdapter);
    const result = await this.reviewPRUseCase.approve(instance, repo, pr, githubAdapter);

    if (result.success) {
      await query.editMessageText(`✅ PR #${pr.number} approved`);
    } else {
      await query.answer(`Failed to approve: ${result.error}`, true);
    }

    return result;
  }

  /**
   * Handle reject action
   * @private
   */
  async _handleReject(query, instance, repo, pr) {
    this.logger.info(`[CallbackHandler] Rejecting PR with id=${pr.id}`);

    await query.answer('Requesting changes...');

    const githubAdapter = this.githubAdapter.create(instance.key);
    pr = await this._resolveFreshPR(pr, repo, githubAdapter);
    const result = await this.reviewPRUseCase.reject(instance, repo, pr, null, githubAdapter);

    if (result.success) {
      await query.editMessageText(`❌ Changes requested for PR #${pr.number}`);
    } else {
      await query.answer(`Failed to reject: ${result.error}`, true);
    }

    return result;
  }

  /**
   * Handle close action
   * @private
   */
  async _handleClose(query, instance, repo, pr) {
    this.logger.info(`[CallbackHandler] Closing PR with id=${pr.id}`);

    await query.answer('Closing PR...');

    const githubAdapter = this.githubAdapter.create(instance.key);
    pr = await this._resolveFreshPR(pr, repo, githubAdapter);
    const result = await this.reviewPRUseCase.close(instance, repo, pr, githubAdapter);

    if (result.success) {
      await query.editMessageText(`🔒 PR #${pr.number} closed`);
    } else {
      await query.answer(`Failed to close: ${result.error}`, true);
    }

    return result;
  }

  /**
   * Handle skip action
   * @private
   */
  async _handleSkip(query, instance, repo, pr) {
    this.logger.info(`[CallbackHandler] Skipping notifications for PR #${pr.number}`);

    await query.answer('Skipping...');

    const skipDuration = 3 * 60 * 60 * 1000; // 3 hours
    const result = await this.reviewPRUseCase.skip(instance, repo, pr, skipDuration);

    if (result.success) {
      const skipUntil = new Date(Date.now() + skipDuration).toLocaleTimeString();
      await query.editMessageText(`⏭️ Notifications skipped until ${skipUntil}`);
    } else {
      await query.answer(`Failed to skip: ${result.error}`, true);
    }

    return result;
  }

  /**
   * Handle silent action - show duration selection keyboard
   * @private
   */
  async _handleSilent(query, instance, repo, pr) {
    this.logger.info(`[CallbackHandler] Silent requested for PR with id=${pr.id}`);

    await query.answer();

    // Resolve fresh PR data for display
    const githubAdapter = this.githubAdapter.create(instance.key);
    pr = await this._resolveFreshPR(pr, repo, githubAdapter);

    const instanceIdx = instance.instanceIdx;
    const repoIdx = repo.repoIdx;

    // Build duration selection keyboard
    const keyboard = [
      [
        { text: '🔇 3 Hours', callback_data: `silent_dur:${instanceIdx}:${repoIdx}:${pr.id}:3` },
        { text: '🔇 6 Hours', callback_data: `silent_dur:${instanceIdx}:${repoIdx}:${pr.id}:6` }
      ],
      [
        { text: '🔇 8 Hours', callback_data: `silent_dur:${instanceIdx}:${repoIdx}:${pr.id}:8` },
        { text: '✏️ Custom', callback_data: `silent_custom:${instanceIdx}:${repoIdx}:${pr.id}` }
      ],
      [
        { text: '❌ Cancel', callback_data: `review_cancel:${instanceIdx}:${repoIdx}:${pr.id}` }
      ]
    ];

    // Send NEW message to thread
    await this.bot.sendMessage(
      this.chatId,
      `🔇 <b>Silent Mode for ${this._escapeHtml(`${instance.owner}/${repo.name}`)} PR #${pr.number}</b>\n\n` +
      `📌 <b>Title:</b> ${this._escapeHtml(pr.title)}\n\n` +
      `Choose silent duration:`,
      {
        reply_markup: { inline_keyboard: keyboard },
        message_thread_id: repo.threadId,
        parse_mode: 'HTML'
      }
    );

    return {
      success: true,
      action: 'show_silent_options'
    };
  }

  /**
   * Handle silent_dur action - execute silent with chosen duration
   * @private
   */
  async _handleSilentDur(query, instance, repo, pr, hours) {
    this.logger.info(`[CallbackHandler] Silencing PR with id=${pr.id} for ${hours} hours`);

    await query.answer('Silencing...');

    const githubAdapter = this.githubAdapter.create(instance.key);
    const freshPR = await this._resolveFreshPR(pr, repo, githubAdapter);

    // Check current PR state - some states can't transition to SKIPPED
    const currentState = await this.stateMachine.getState(instance.key, repo.name, freshPR.number);
    const finalStates = ['approved', 'rejected', 'closed', 'processed'];

    if (finalStates.includes(currentState)) {
      // PR is already in a final state - notifications have stopped
      const stateMessages = {
        approved: '✅ This PR has been approved',
        rejected: '❌ Changes were requested for this PR',
        closed: '🔒 This PR has been closed',
        processed: '✅ This PR has been fully processed'
      };

      await query.editMessageText(
        `${stateMessages[currentState]}\n\n` +
        `🔇 Silent mode is not needed - notifications have already stopped for this PR.`,
        { parse_mode: 'HTML' }
      );

      return { success: true, alreadyFinal: true, currentState };
    }

    const durationMs = hours * 60 * 60 * 1000;
    const result = await this.reviewPRUseCase.skip(instance, repo, freshPR, durationMs);

    if (result.success) {
      const silentUntil = new Date(Date.now() + durationMs).toLocaleString('en-GB', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
      });
      await query.editMessageText(
        `🔇 <b>PR #${freshPR.number} silenced for ${hours} hour${hours > 1 ? 's' : ''}</b>\n\n` +
        `Notifications will resume at ${silentUntil} WIB`,
        { parse_mode: 'HTML' }
      );
    } else {
      await query.answer(`Failed to silent: ${result.error}`, true);
    }

    return result;
  }

  /**
   * Handle silent_custom action - show secondary keyboard with more durations
   * @private
   */
  async _handleSilentCustom(query, instance, repo, pr) {
    this.logger.info(`[CallbackHandler] Custom silent duration requested for PR #${pr.number}`);

    await query.answer();

    const instanceIdx = instance.instanceIdx;
    const repoIdx = repo.repoIdx;

    const keyboard = [
      [
        { text: '🔇 1 Hour', callback_data: `silent_dur:${instanceIdx}:${repoIdx}:${pr.id}:1` },
        { text: '🔇 2 Hours', callback_data: `silent_dur:${instanceIdx}:${repoIdx}:${pr.id}:2` }
      ],
      [
        { text: '🔇 4 Hours', callback_data: `silent_dur:${instanceIdx}:${repoIdx}:${pr.id}:4` },
        { text: '🔇 12 Hours', callback_data: `silent_dur:${instanceIdx}:${repoIdx}:${pr.id}:12` }
      ],
      [
        { text: '🔇 24 Hours', callback_data: `silent_dur:${instanceIdx}:${repoIdx}:${pr.id}:24` },
        { text: '🔇 2 Days', callback_data: `silent_dur:${instanceIdx}:${repoIdx}:${pr.id}:48` }
      ],
      [
        { text: '❌ Cancel', callback_data: `review_cancel:${instanceIdx}:${repoIdx}:${pr.id}` }
      ]
    ];

    await query.editMessageText(
      `🔇 <b>Custom Duration</b>\n\nChoose silent duration:`,
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      }
    );

    return {
      success: true,
      action: 'show_custom_silent_options'
    };
  }

  /**
   * Handle review level selection
   * @private
   */
  async _handleReviewLevel(query, instance, repo, pr, level) {
    this.logger.info(
      `[CallbackHandler] Starting ${level} review for PR with id=${pr.id}`
    );

    await query.answer(`🚀 Running ${level} review...`);

    const githubAdapter = this.githubAdapter.create(instance.key);
    pr = await this._resolveFreshPR(pr, repo, githubAdapter);

    // Immediately show processing confirmation and disable buttons
    const timeoutString = instance.agent?.review_timeot_string || '20 minutes';
    await query.editMessageText(
      `⏳ <b>${level.toUpperCase()} Review in progress...</b>\n\n` +
      `📌 PR #${pr.number}: ${this._escapeHtml(pr.title)}\n` +
      `📂 ${this._escapeHtml(`${instance.owner}/${repo.name}`)}\n\n` +
      `⏱️ Estimated time: ~${timeoutString}\n` +
      `Please wait, the review results will appear here.`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }
    );

    const result = await this.reviewPRUseCase.execute(instance, repo, pr, level, githubAdapter);

    if (result.success) {
      await query.editMessageText(
        `✅ ${level.toUpperCase()} review completed\n` +
        `${result.reviewResult.comments.length} comments added`
      );
    } else {
      await query.editMessageText(`❌ Review failed: ${result.error}`);
    }

    return result;
  }

  /**
   * Handle dismiss outdated review notification
   * @private
   */
  async _handleDismissOutdated(query, instance, repo, pr, reviewId) {
    this.logger.info(`[CallbackHandler] Dismissing outdated review ${reviewId}`);

    await query.answer('Dismissing...');

    // Use injected CheckOutdatedReviewsUseCase
    if (this.checkOutdatedReviewsUseCase) {
      // Resolve fresh PR data to get current headSha
      const githubAdapter = this.githubAdapter.create(instance.key);
      const freshPR = await this._resolveFreshPR(pr, repo, githubAdapter);

      const result = await this.checkOutdatedReviewsUseCase.dismissOutdatedReview(
        instance,
        repo,
        reviewId,
        freshPR.id?.toString(),
        freshPR.headSha
      );

      if (result.success) {
        await query.editMessageText(
          `✅ Dismissed outdated review notification for ${this._escapeHtml(`${instance.owner}/${repo.name}`)} PR #${freshPR.number}`
        );
      }

      return result;
    }

    // Fallback: just acknowledge
    await query.editMessageText('✅ Notification dismissed');
    return { success: true };
  }

  /**
   * Handle approve_outdated - show confirmation prompt
   * @private
   */
  async _handleApproveOutdated(query, instance, repo, pr, reviewId) {
    this.logger.info(`[CallbackHandler] Approve outdated confirmation requested for review ${reviewId}`);

    await query.answer('Confirming approval...');

    const originalKeyboard = query.message?.reply_markup?.inline_keyboard;
    const chatId = query.message?.chat?.id || this.chatId;
    const messageId = query.message?.message_id;

    if (!messageId || !this.confirmationManager) {
      // Fallback: no confirmation, approve directly
      return await this._executeApproveOutdated(query, instance, repo, pr, reviewId);
    }

    // Store pending confirmation
    this.confirmationManager.add(chatId, messageId, originalKeyboard, 'approve_outdated', { reviewId });

    // Show confirmation keyboard with reviewId
    const instanceIdx = instance.instanceIdx;
    const repoIdx = repo.repoIdx;
    const confirmKeyboard = [
      [
        { text: '✅ Yes, Approve', callback_data: `cfm_y:${instanceIdx}:${repoIdx}:${pr.id}:${reviewId}` },
        { text: '❌ No', callback_data: `cfm_n:${instanceIdx}:${repoIdx}:${pr.id}:${reviewId}` }
      ]
    ];

    await query.editMessageReplyMarkup({ inline_keyboard: confirmKeyboard });

    return { success: true, action: 'confirm_pending' };
  }

  /**
   * Execute the actual approve-outdated (after confirmation)
   * @private
   */
  async _executeApproveOutdated(query, instance, repo, pr, reviewId) {
    this.logger.info(`[CallbackHandler] Executing approve outdated for review ${reviewId}`);

    await query.answer('Approving PR...');

    const githubAdapter = this.githubAdapter.create(instance.key);
    pr = await this._resolveFreshPR(pr, repo, githubAdapter);
    const result = await this.reviewPRUseCase.approve(instance, repo, pr, githubAdapter);

    if (result.success) {
      // Clear review state
      if (this.stateRepositoryFactory) {
        const stateRepository = this.stateRepositoryFactory.create(instance.owner, repo.name);
        await stateRepository.clearReviewState(pr.id);
        await stateRepository.markProcessed(instance.owner, repo.name, pr.id);
      }

      await query.editMessageText(
        `✅ ${this._escapeHtml(`${instance.owner}/${repo.name}`)} PR #${pr.number} has been approved!`
      );
    } else {
      await query.answer(`Failed to approve: ${result.error}`, true);
    }

    return result;
  }

  /**
   * Handle confirmation Yes - execute the pending approval
   * @private
   */
  async _handleConfirmYes(query, instance, repo, pr, callback) {
    const chatId = query.message?.chat?.id || this.chatId;
    const messageId = query.message?.message_id;

    const confirmation = this.confirmationManager?.consume(chatId, messageId);

    if (!confirmation) {
      await query.answer('Confirmation expired', true);
      return { success: false, action: 'expired' };
    }

    const { actionType, extraData } = confirmation;

    if (actionType === 'approve_outdated' && extraData?.reviewId) {
      return await this._executeApproveOutdated(query, instance, repo, pr, extraData.reviewId);
    }

    return await this._executeApprove(query, instance, repo, pr);
  }

  /**
   * Handle confirmation No - cancel and restore original keyboard
   * @private
   */
  async _handleConfirmNo(query, instance, repo, pr, callback) {
    const chatId = query.message?.chat?.id || this.chatId;
    const messageId = query.message?.message_id;

    const confirmation = this.confirmationManager?.consume(chatId, messageId);

    if (!confirmation) {
      await query.answer('Confirmation expired', true);
      return { success: false, action: 'expired' };
    }

    await query.answer('Approval cancelled');

    // Restore original keyboard
    const { originalKeyboard } = confirmation;
    if (originalKeyboard) {
      await query.editMessageReplyMarkup({ inline_keyboard: originalKeyboard });
    }

    return { success: true, action: 'confirm_cancelled' };
  }

  /**
   * Handle re_review - show level selection for outdated PR
   * @private
   */
  async _handleReReview(query, instance, repo, pr, reviewId) {
    this.logger.info(`[CallbackHandler] Re-review requested for PR #${pr.number}, review ${reviewId}`);

    await query.answer();

    // Get available levels from instance config
    const levels = instance.agent?.level || ['low', 'medium', 'high'];

    // Use indices already resolved by _getInstance/_getRepo
    const instanceIdx = instance.instanceIdx;
    const repoIdx = repo.repoIdx;

    // Build level selection keyboard for outdated review
    const keyboard = levels.map(level => [
      {
        text: `${level === 'low' ? '🟢' : level === 'medium' ? '🟡' : '🔴'} ${level.toUpperCase()}`,
        callback_data: `review_level_outdated:${instanceIdx}:${repoIdx}:${pr.id}:${reviewId}:${level}`
      }
    ]);

    // Add cancel button
    keyboard.push([
      { text: '❌ Cancel', callback_data: `review_cancel:${instanceIdx}:${repoIdx}:${pr.id}` }
    ]);

    // Update message to show level options
    await query.editMessageReplyMarkup({
      inline_keyboard: keyboard
    });

    return {
      success: true,
      action: 'show_re_review_levels'
    };
  }

  /**
   * Handle review_level_outdated - execute review with level for outdated PR
   * @private
   */
  async _handleReviewLevelOutdated(query, instance, repo, pr, reviewId, level) {
    this.logger.info(
      `[CallbackHandler] Starting ${level} re-review for PR with id=${pr.id}, review ${reviewId}`
    );

    await query.answer(`🚀 Starting ${level} re-review...`);

    const githubAdapter = this.githubAdapter.create(instance.key);
    pr = await this._resolveFreshPR(pr, repo, githubAdapter);

    // Immediately show processing confirmation and disable buttons
    const timeoutString = instance.agent?.review_timeot_string || '20 minutes';
    await query.editMessageText(
      `⏳ <b>${level.toUpperCase()} Re-review in progress...</b>\n\n` +
      `📌 PR #${pr.number}: ${this._escapeHtml(pr.title)}\n` +
      `📂 ${this._escapeHtml(`${instance.owner}/${repo.name}`)}\n\n` +
      `⏱️ Estimated time: ~${timeoutString}\n` +
      `Please wait, the review results will appear here.`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }
    );

    const result = await this.reviewPRUseCase.execute(instance, repo, pr, level, githubAdapter);

    if (result.success) {
      // Clear review state after successful re-review
      if (this.stateRepositoryFactory) {
        const stateRepository = this.stateRepositoryFactory.create(instance.owner, repo.name);
        await stateRepository.clearReviewState(pr.id);
      }

      await query.editMessageText(
        `✅ ${level.toUpperCase()} re-review completed\n` +
        `${result.reviewResult.comments.length} comments added`
      );
    } else {
      await query.editMessageText(`❌ Review failed: ${result.error}`);
    }

    return result;
  }
}

module.exports = CallbackHandler;
