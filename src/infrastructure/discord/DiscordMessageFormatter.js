const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const ActionPayloadCodec = require('../../application/services/ActionPayloadCodec');

class DiscordMessageFormatter {
  buildPRNotification(notification, indices) {
    const { owner, repo, pr, summary } = notification;
    const embed = new EmbedBuilder()
      .setTitle(`New PR: ${pr.title}`)
      .setColor(this._riskColor(summary.riskLevel))
      .addFields(
        { name: 'Repository', value: `${owner}/${repo}`, inline: true },
        { name: 'Risk', value: summary.riskLevel || 'UNKNOWN', inline: true },
        { name: 'Impact', value: summary.impactArea || 'unknown', inline: true },
        { name: 'Files', value: String(summary.filesChanged || 0), inline: true },
        { name: 'Changes', value: String(summary.diffSize || 0), inline: true },
        { name: 'Purpose', value: this._truncate(summary.purpose || 'No description provided', 1024) }
      );

    if (pr.createdAt) {
      embed.setTimestamp(new Date(pr.createdAt));
    }
    if (pr.url) {
      embed.setURL(pr.url);
    }

    return {
      embeds: [embed],
      components: this._buildPRComponents(indices.instanceIdx, indices.repoIdx, pr)
    };
  }

  buildOutdatedReviewNotification(notification, indices) {
    const {
      owner, repo, pr, reviewState, reviewUser, outdatedCommit, currentCommit
    } = notification;
    const reviewId = reviewState?.reviewId || reviewState?.id || pr.id;
    const reviewLabel = typeof reviewState === 'object'
      ? (reviewState.state || reviewState.id || 'UNKNOWN')
      : (reviewState || 'UNKNOWN');

    const embed = new EmbedBuilder()
      .setTitle(`Outdated review: ${owner}/${repo} PR #${pr.number}`)
      .setColor(0xf59e0b)
      .setDescription(this._truncate(pr.title || '', 1024))
      .addFields(
        { name: 'Review', value: `${reviewUser || 'unknown'}: ${reviewLabel}`, inline: true },
        { name: 'Commit', value: `${this._shortSha(outdatedCommit)} -> ${this._shortSha(currentCommit)}`, inline: true }
      );

    if (pr.url) {
      embed.setURL(pr.url);
    }

    return {
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(
          this._button('Approve', ButtonStyle.Success, {
            action: 'approve_outdated',
            ...indices,
            prId: pr.id,
            reviewId
          }),
          this._button('Re-review', ButtonStyle.Primary, {
            action: 're_review',
            ...indices,
            prId: pr.id,
            reviewId
          }),
          this._linkButton('Visit PR', pr.url)
        ),
        new ActionRowBuilder().addComponents(
          this._button('Silent', ButtonStyle.Secondary, {
            action: 'silent',
            ...indices,
            prId: pr.id
          }),
          this._button('Dismiss', ButtonStyle.Danger, {
            action: 'dismiss_outdated',
            ...indices,
            prId: pr.id,
            reviewId
          })
        )
      ]
    };
  }

  buildLevelComponents(instance, indices, pr, action = 'review_level', reviewId) {
    const levels = instance.agent?.level || instance.agent?.levels || ['low', 'medium', 'high'];
    const buttons = levels.map(level => this._button(level.toUpperCase(), ButtonStyle.Primary, {
      action,
      ...indices,
      prId: pr.id,
      reviewId,
      level
    }));

    return [
      new ActionRowBuilder().addComponents(...buttons.slice(0, 5)),
      new ActionRowBuilder().addComponents(
        this._button('Cancel', ButtonStyle.Secondary, {
          action: 'review_cancel',
          ...indices,
          prId: pr.id
        })
      )
    ];
  }

  buildSilentComponents(indices, pr) {
    return [
      new ActionRowBuilder().addComponents(
        this._button('3 Hours', ButtonStyle.Secondary, { action: 'silent_dur', ...indices, prId: pr.id, hours: 3 }),
        this._button('6 Hours', ButtonStyle.Secondary, { action: 'silent_dur', ...indices, prId: pr.id, hours: 6 }),
        this._button('8 Hours', ButtonStyle.Secondary, { action: 'silent_dur', ...indices, prId: pr.id, hours: 8 }),
        this._button('24 Hours', ButtonStyle.Secondary, { action: 'silent_dur', ...indices, prId: pr.id, hours: 24 })
      )
    ];
  }

  buildQueueCompleted(data) {
    const minutes = Math.round(data.duration / 60000);
    const embed = new EmbedBuilder()
      .setTitle('Review Completed')
      .setColor(0x22c55e)
      .setDescription(`${data.instanceKey}/${data.repoName} PR #${data.prNumber}`)
      .addFields(
        { name: 'Title', value: this._truncate(data.prTitle || '-', 1024) },
        { name: 'Level', value: String(data.level || '').toUpperCase(), inline: true },
        { name: 'Duration', value: `~${minutes}m`, inline: true }
      );

    if (data.reviewUrl) {
      embed.setURL(data.reviewUrl);
    }

    return { embeds: [embed] };
  }

  buildQueueFailed(data) {
    const embed = new EmbedBuilder()
      .setTitle('Review Failed')
      .setColor(0xef4444)
      .setDescription(`${data.instanceKey}/${data.repoName} PR #${data.prNumber}`)
      .addFields(
        { name: 'Title', value: this._truncate(data.prTitle || '-', 1024) },
        { name: 'Level', value: String(data.level || '').toUpperCase(), inline: true },
        { name: 'Error', value: this._truncate(data.error || 'unknown error', 1024) }
      );

    return { embeds: [embed] };
  }

  _buildPRComponents(instanceIdx, repoIdx, pr) {
    const indices = { instanceIdx, repoIdx };

    return [
      new ActionRowBuilder().addComponents(
        this._button('Review Now', ButtonStyle.Primary, { action: 'review_now', ...indices, prId: pr.id }),
        this._linkButton('Visit PR', pr.url)
      ),
      new ActionRowBuilder().addComponents(
        this._button('Approve', ButtonStyle.Success, { action: 'approve', ...indices, prId: pr.id }),
        this._button('Reject', ButtonStyle.Danger, { action: 'reject', ...indices, prId: pr.id }),
        this._button('Close', ButtonStyle.Danger, { action: 'close', ...indices, prId: pr.id }),
        this._button('Silent', ButtonStyle.Secondary, { action: 'silent', ...indices, prId: pr.id })
      )
    ];
  }

  _button(label, style, payload) {
    return new ButtonBuilder()
      .setLabel(label)
      .setStyle(style)
      .setCustomId(ActionPayloadCodec.format(payload));
  }

  _linkButton(label, url) {
    return new ButtonBuilder()
      .setLabel(label)
      .setStyle(ButtonStyle.Link)
      .setURL(url || 'https://github.com');
  }

  _riskColor(riskLevel) {
    const normalized = String(riskLevel || '').toUpperCase();
    if (normalized === 'HIGH') return 0xef4444;
    if (normalized === 'MEDIUM') return 0xf59e0b;
    if (normalized === 'LOW') return 0x22c55e;
    return 0x94a3b8;
  }

  _shortSha(sha) {
    return sha ? String(sha).substring(0, 7) : 'unknown';
  }

  _truncate(value, limit) {
    const text = String(value || '');
    return text.length > limit ? `${text.substring(0, limit - 3)}...` : text;
  }
}

module.exports = DiscordMessageFormatter;
