/**
 * Shared action payload codec for Telegram callback_data and Discord custom_id.
 */
class ActionPayloadCodec {
  static get ALLOWED_SILENT_HOURS() {
    return new Set([1, 2, 3, 4, 6, 8, 12, 24, 48]);
  }

  /**
   * @param {Object} payload
   * @param {string} payload.action
   * @param {number} payload.instanceIdx
   * @param {number} payload.repoIdx
   * @param {string|number} payload.prId
   * @param {string} [payload.level]
   * @param {string} [payload.reviewId]
   * @param {number} [payload.hours]
   * @returns {string}
   */
  static format(payload) {
    const parts = [
      payload.action,
      payload.instanceIdx,
      payload.repoIdx,
      payload.prId
    ];

    if (payload.action === 'review_level_outdated') {
      parts.push(payload.reviewId, payload.level);
    } else if (payload.action === 'review_level') {
      parts.push(payload.level);
    } else if (payload.action === 'silent_dur') {
      parts.push(payload.hours);
    } else if (payload.reviewId) {
      parts.push(payload.reviewId);
    }

    return parts.map(part => String(part)).join(':');
  }

  /**
   * @param {string} data
   * @returns {Object|null}
   */
  static parse(data) {
    if (!data || typeof data !== 'string') {
      return null;
    }

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

    if (!Number.isInteger(callback.instanceIdx) || !Number.isInteger(callback.repoIdx)) {
      return null;
    }

    if (parts.length >= 5) {
      if (callback.action === 'review_level' || callback.action === 'review_level_outdated') {
        callback.level = parts[4];
      } else if (callback.action === 'silent_dur') {
        const parsedHours = parseInt(parts[4], 10);

        if (!Number.isInteger(parsedHours) || !ActionPayloadCodec.ALLOWED_SILENT_HOURS.has(parsedHours)) {
          return null;
        }

        callback.hours = parsedHours;
      } else {
        callback.reviewId = parts[4];
      }
    }

    if (parts.length >= 6 && callback.action === 'review_level_outdated') {
      callback.reviewId = parts[4];
      callback.level = parts[5];
    }

    return callback;
  }
}

module.exports = ActionPayloadCodec;
