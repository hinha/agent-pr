/**
 * Time utility functions for scheduling and time-based checks
 */

/**
 * Get current timestamp in Asia/Jakarta timezone (WIB, UTC+7)
 * @returns {Date} Current timestamp in WIB
 */
function getCurrentTimestampWIB() {
  const now = new Date();
  // Convert to UTC then add WIB offset (UTC+7)
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const wibTime = new Date(utc + (7 * 3600000));
  return wibTime;
}

/**
 * Get current hour in Asia/Jakarta timezone (WIB, UTC+7)
 * @returns {number} Current hour (0-23) in WIB
 */
function getCurrentHourWIB() {
  return getCurrentTimestampWIB().getHours();
}

/**
 * Get current day of week in WIB timezone
 * @returns {number} Day of week (0=Sunday, 1=Monday, ..., 6=Saturday)
 */
function getCurrentDayOfWeekWIB() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const wibTime = new Date(utc + (7 * 3600000));
  return wibTime.getDay();
}

/**
 * Check if current day is a weekend (Saturday or Sunday) in WIB timezone
 * @returns {boolean} True if today is Saturday or Sunday
 */
function isWeekendWIB() {
  const day = getCurrentDayOfWeekWIB();
  return day === 0 || day === 6; // 0=Sunday, 6=Saturday
}

/**
 * Check if current time is within snooze hours (using WIB timezone)
 * @param {Object} snoozeConfig - Snooze configuration
 * @param {boolean} snoozeConfig.enabled - Whether snooze is enabled
 * @param {number} snoozeConfig.startHour - Start hour (20 for 20:00)
 * @param {number} snoozeConfig.endHour - End hour (6 for 06:00)
 * @returns {boolean} True if current time is within snooze period
 */
function isSnoozeTime(snoozeConfig) {
  if (!snoozeConfig || !snoozeConfig.enabled) {
    return false;
  }

  const currentHour = getCurrentHourWIB();
  const { startHour, endHour } = snoozeConfig;

  // Handle overnight snooze (e.g., 20:00 to 06:00 next day)
  if (startHour > endHour) {
    return currentHour >= startHour || currentHour < endHour;
  }

  // Handle same-day snooze (e.g., 01:00 to 06:00)
  return currentHour >= startHour && currentHour < endHour;
}

/**
 * Check if notifications should be snoozed (based on time AND/OR day)
 * @param {Object} snoozeConfig - Snooze configuration
 * @param {boolean} snoozeConfig.enabled - Whether snooze is enabled
 * @param {boolean} snoozeConfig.skip_weekends - Whether to skip weekends
 * @returns {boolean} True if notifications should be snoozed
 */
function shouldSnooze(snoozeConfig) {
  if (!snoozeConfig || !snoozeConfig.enabled) {
    return false;
  }

  // Check weekend first
  if (snoozeConfig.skip_weekends && isWeekendWIB()) {
    return true;
  }

  // Check time-based snooze
  return isSnoozeTime(snoozeConfig);
}

/**
 * Get human-readable reason for snooze
 * @param {Object} snoozeConfig - Snooze configuration
 * @returns {string} Reason string or empty string if not snoozing
 */
function getSnoozeReason(snoozeConfig) {
  if (!snoozeConfig || !snoozeConfig.enabled) {
    return '';
  }

  // Check weekend first
  if (snoozeConfig.skipWeekends && isWeekendWIB()) {
    const dayIndex = getCurrentDayOfWeekWIB();
    const dayNames = snoozeConfig.dayNames || ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
    const currentDay = dayNames[dayIndex];

    // If day name is available (weekday with custom names), show it
    // For weekend (Saturday/Sunday) where dayNames doesn't have those indices
    if (currentDay) {
      return `Weekend detected (${currentDay})`;
    }
    // Fallback for weekend without custom day names
    return 'Weekend detected';
  }

  // Check time-based snooze
  if (isSnoozeTime(snoozeConfig)) {
    const { startHour, endHour } = snoozeConfig;
    return `Snooze time active (${startHour}:00 - ${endHour}:00)`;
  }

  return '';
}

module.exports = {
  isSnoozeTime,
  shouldSnooze,
  getSnoozeReason,
  getCurrentTimestampWIB,
  getCurrentHourWIB
};
