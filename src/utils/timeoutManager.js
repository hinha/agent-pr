/**
 * TimeoutManager - Centralized timeout management for tracking and clearing all pending timeouts
 *
 * This utility prevents memory leaks by ensuring all setTimeout calls are tracked
 * and can be properly cleared during shutdown, preventing code execution after
 * the service has stopped.
 */
class TimeoutManager {
  constructor() {
    this.pendingTimeouts = new Set();
  }

  /**
   * Create a tracked timeout
   * @param {Function} fn - Function to execute
   * @param {number} delay - Delay in milliseconds
   * @param {...any} args - Arguments to pass to the function
   * @returns {NodeJS.Timeout} Timeout ID
   */
  setTimeout(fn, delay, ...args) {
    const id = setTimeout(() => {
      this.pendingTimeouts.delete(id);
      fn(...args);
    }, delay);
    this.pendingTimeouts.add(id);

    // Allow process to exit if this is the only active timer
    if (typeof id.unref === 'function') {
      id.unref();
    }

    return id;
  }

  /**
   * Clear a specific tracked timeout
   * @param {NodeJS.Timeout} id - Timeout ID to clear
   */
  clearTimeout(id) {
    if (this.pendingTimeouts.has(id)) {
      clearTimeout(id);
      this.pendingTimeouts.delete(id);
    }
  }

  /**
   * Clear all pending timeouts
   * Call this during service shutdown to prevent code execution after stop
   */
  clearAll() {
    this.pendingTimeouts.forEach(id => clearTimeout(id));
    this.pendingTimeouts.clear();
  }

  /**
   * Get count of pending timeouts
   * @returns {number} Number of pending timeouts
   */
  getPendingCount() {
    return this.pendingTimeouts.size;
  }

  /**
   * Check if there are any pending timeouts
   * @returns {boolean} True if there are pending timeouts
   */
  hasPending() {
    return this.pendingTimeouts.size > 0;
  }
}

module.exports = TimeoutManager;
