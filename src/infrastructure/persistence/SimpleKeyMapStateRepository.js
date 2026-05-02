/**
 * SimpleKeyMapStateRepository - Simple in-memory key-value store for PRStateMachine
 *
 * This repository provides a simple Map-based storage that matches the
 * PRStateMachine interface requirements (get, set, keys, delete).
 *
 * @example
 * const repo = new SimpleKeyMapStateRepository();
 * await repo.set('key', { data: 'value' });
 * const value = await repo.get('key');
 */

class SimpleKeyMapStateRepository {
  constructor() {
    this.store = new Map();
  }

  /**
   * Get value by key
   * @param {string} key - Storage key
   * @returns {Promise<*>} Stored value or undefined
   */
  async get(key) {
    return this.store.get(key);
  }

  /**
   * Set value by key
   * @param {string} key - Storage key
   * @param {*} value - Value to store
   * @returns {Promise<void>}
   */
  async set(key, value) {
    this.store.set(key, value);
  }

  /**
   * Get all keys, optionally filtered by prefix
   * @param {string} prefix - Optional prefix to filter keys
   * @returns {Promise<Array<string>>} Array of keys
   */
  async keys(prefix) {
    const allKeys = Array.from(this.store.keys());
    if (!prefix) {
      return allKeys;
    }
    return allKeys.filter(k => k.startsWith(prefix));
  }

  /**
   * Delete a key
   * @param {string} key - Storage key
   * @returns {Promise<void>}
   */
  async delete(key) {
    this.store.delete(key);
  }

  /**
   * Clear all stored data
   * @returns {Promise<void>}
   */
  async clear() {
    this.store.clear();
  }

  /**
   * Get number of stored items
   * @returns {Promise<number>} Count of stored items
   */
  async size() {
    return this.store.size;
  }

  /**
   * Clean up resources (clears all stored data)
   * @returns {Promise<void>}
   */
  async cleanup() {
    await this.clear();
  }
}

module.exports = SimpleKeyMapStateRepository;
