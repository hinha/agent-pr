/**
 * EventBus - Event-driven communication mechanism
 *
 * Provides pub/sub pattern for decoupled communication between components.
 * Supports both synchronous and asynchronous event handlers.
 *
 * @example
 * const bus = new EventBus();
 * bus.on(''pr.processed'', (data) => console.log(data));
 * bus.emit(''pr.processed'', { prNumber: 123 });
 */

/**
 * Event priority levels
 * @readonly
 * @enum {number}
 */
const EventPriority = {
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
  CRITICAL: 3
};

class EventBus {
  /**
   * @param {Object} options - Configuration options
   * @param {Object} options.logger - Logger instance
   * @param {boolean} options.enableLogging - Enable event logging
   * @param {number} options.maxListeners - Maximum listeners per event (default: 50)
   */
  constructor(options = {}) {
    this._listeners = new Map();
    this._wildcardListeners = [];
    this._onceListeners = new Map();
    this.logger = options.logger || console;
    this.enableLogging = options.enableLogging || false;
    this.maxListeners = options.maxListeners || 50;
    this._eventHistory = [];
    this._maxHistorySize = options.maxHistorySize || 1000;
    this._metrics = {
      emitted: 0,
      handled: 0,
      errors: 0
    };
  }

  /**
   * Subscribe to an event
   *
   * @param {string} event - Event name (supports wildcards with *)
   * @param {Function} handler - Event handler function
   * @param {Object} options - Subscription options
   * @param {number} options.priority - Event priority (default: NORMAL)
   * @param {string} options.id - Optional handler ID for unsubscribe
   * @returns {Function} Unsubscribe function
   */
  on(event, handler, options = {}) {
    if (typeof handler !== 'function') {
      throw new TypeError('Handler must be a function');
    }

    const handlerMeta = {
      handler,
      priority: options.priority || EventPriority.NORMAL,
      id: options.id || this._generateHandlerId(),
      timestamp: Date.now()
    };

    // Handle wildcard subscriptions
    if (event.includes('*')) {
      const pattern = new RegExp('^' + event.replace(/\*/g, '.*') + '$');
      this._wildcardListeners.push({
        pattern,
        ...handlerMeta
      });
    } else {
      // Regular event subscription
      if (!this._listeners.has(event)) {
        this._listeners.set(event, []);
      }

      const listeners = this._listeners.get(event);
      if (listeners.length >= this.maxListeners) {
        this.logger.warn(
          `[EventBus] Max listeners (${this.maxListeners}) reached for event "${event}"`
        );
      }

      listeners.push(handlerMeta);
      // Sort by priority (highest first)
      listeners.sort((a, b) => b.priority - a.priority);
    }

    if (this.enableLogging) {
      this.logger.debug(`[EventBus] Subscribed to event: ${event} (id: ${handlerMeta.id})`);
    }

    // Return unsubscribe function
    return () => this.off(event, handlerMeta.id);
  }

  /**
   * Subscribe to an event for one-time execution
   *
   * @param {string} event - Event name
   * @param {Function} handler - Event handler function
   * @returns {Function} Unsubscribe function
   */
  once(event, handler) {
    const handlerId = this._generateHandlerId('once');
    let called = false;

    const wrappedHandler = (...args) => {
      if (called) return;
      called = true;
      this.off(event, handlerId);
      handler(...args);
    };

    return this.on(event, wrappedHandler, {
      id: handlerId
    });
  }

  /**
   * Unsubscribe from an event
   *
   * @param {string} event - Event name
   * @param {string|Function} handlerOrId - Handler ID or function reference
   * @returns {boolean} True if handler was removed
   */
  off(event, handlerOrId) {
    let removed = false;

    if (!this._listeners.has(event)) {
      return removed;
    }

    const listeners = this._listeners.get(event);
    const initialLength = listeners.length;

    if (typeof handlerOrId === 'string') {
      // Remove by ID
      const index = listeners.findIndex(h => h.id === handlerOrId);
      if (index >= 0) {
        listeners.splice(index, 1);
        removed = true;
      }
    } else if (typeof handlerOrId === 'function') {
      // Remove by function reference
      const index = listeners.findIndex(h => h.handler === handlerOrId);
      if (index >= 0) {
        listeners.splice(index, 1);
        removed = true;
      }
    }

    // Clean up empty event arrays
    if (listeners.length === 0) {
      this._listeners.delete(event);
    }

    if (removed && this.enableLogging) {
      this.logger.debug(`[EventBus] Unsubscribed from event: ${event}`);
    }

    return removed;
  }

  /**
   * Emit an event synchronously
   *
   * @param {string} event - Event name
   * @param {*} data - Event data payload
   * @param {Object} options - Emit options
   * @param {boolean} options.async - Execute handlers asynchronously (default: false)
   * @returns {Promise<void>}
   */
  async emit(event, data, options = {}) {
    this._metrics.emitted++;

    // Record event in history
    this._addToHistory(event, data);

    if (this.enableLogging) {
      this.logger.debug(`[EventBus] Emitting event: ${event}`);
    }

    const handlers = this._getHandlersForEvent(event);

    if (handlers.length === 0) {
      return;
    }

    // Execute handlers
    if (options.async) {
      await this._executeHandlersAsync(handlers, event, data);
    } else {
      this._executeHandlersSync(handlers, event, data);
    }
  }

  /**
   * Emit an event asynchronously (alias for emit with async option)
   *
   * @param {string} event - Event name
   * @param {*} data - Event data payload
   * @returns {Promise<void>}
   */
  async emitAsync(event, data) {
    return this.emit(event, data, { async: true });
  }

  /**
   * Get all handlers for an event (including wildcard matches)
   * @private
   * @param {string} event - Event name
   * @returns {Array} Handler metadata objects
   */
  _getHandlersForEvent(event) {
    const handlers = [];

    // Get specific event handlers
    if (this._listeners.has(event)) {
      handlers.push(...this._listeners.get(event));
    }

    // Get wildcard handlers
    for (const wildcard of this._wildcardListeners) {
      if (wildcard.pattern.test(event)) {
        handlers.push(wildcard);
      }
    }

    return handlers;
  }

  /**
   * Execute handlers synchronously
   * @private
   * @param {Array} handlers - Handler metadata objects
   * @param {string} event - Event name
   * @param {*} data - Event data
   */
  _executeHandlersSync(handlers, event, data) {
    for (const handlerMeta of handlers) {
      try {
        handlerMeta.handler(data, event);
        this._metrics.handled++;
      } catch (error) {
        this._metrics.errors++;
        this._handleError(error, event, handlerMeta);
      }
    }
  }

  /**
   * Execute handlers asynchronously
   * @private
   * @param {Array} handlers - Handler metadata objects
   * @param {string} event - Event name
   * @param {*} data - Event data
   * @returns {Promise<void>}
   */
  async _executeHandlersAsync(handlers, event, data) {
    const promises = handlers.map(async (handlerMeta) => {
      try {
        await handlerMeta.handler(data, event);
        this._metrics.handled++;
      } catch (error) {
        this._metrics.errors++;
        this._handleError(error, event, handlerMeta);
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Handle errors from event handlers
   * @private
   * @param {Error} error - Error object
   * @param {string} event - Event name
   * @param {Object} handlerMeta - Handler metadata
   */
  _handleError(error, event, handlerMeta) {
    this.logger.error(
      `[EventBus] Error in handler for event "${event}" (id: ${handlerMeta.id}):`,
      error
    );

    // Emit error event
    this.emit('error', {
      event,
      handlerId: handlerMeta.id,
      error: error.message,
      stack: error.stack
    });
  }

  /**
   * Add event to history
   * @private
   * @param {string} event - Event name
   * @param {*} data - Event data
   */
  _addToHistory(event, data) {
    this._eventHistory.push({
      event,
      timestamp: Date.now(),
      data: typeof data === 'object' ? JSON.parse(JSON.stringify(data)) : data
    });

    // Trim history if needed
    if (this._eventHistory.length > this._maxHistorySize) {
      this._eventHistory.shift();
    }
  }

  /**
   * Generate a unique handler ID
   * @private
   * @param {string} prefix - ID prefix
   * @returns {string} Unique ID
   */
  _generateHandlerId(prefix = 'handler') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get event history
   * @param {Object} options - Query options
   * @param {string} options.event - Filter by event name
   * @param {number} options.limit - Maximum number of events
   * @returns {Array} Event history
   */
  getHistory(options = {}) {
    let history = [...this._eventHistory];

    if (options.event) {
      history = history.filter(e => e.event === options.event);
    }

    if (options.limit) {
      history = history.slice(-options.limit);
    }

    return history;
  }

  /**
   * Get event metrics
   * @returns {Object} Metrics object
   */
  getMetrics() {
    return {
      ...this._metrics,
      listenerCounts: Object.fromEntries(
        Array.from(this._listeners.entries()).map(([event, handlers]) => [event, handlers.length])
      ),
      totalEvents: this._listeners.size,
      wildcardListeners: this._wildcardListeners.length
    };
  }

  /**
   * Clear all listeners
   * @param {string} [event] - Optional event name to clear only that event
   */
  clear(event) {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
      this._wildcardListeners = [];
    }

    if (this.enableLogging) {
      this.logger.debug(`[EventBus] Cleared ${event ? `event: ${event}` : 'all listeners'}`);
    }
  }

  /**
   * Get count of listeners for an event
   * @param {string} event - Event name
   * @returns {number} Listener count
   */
  listenerCount(event) {
    let count = 0;

    if (this._listeners.has(event)) {
      count += this._listeners.get(event).length;
    }

    // Count wildcard listeners that match
    for (const wildcard of this._wildcardListeners) {
      if (wildcard.pattern.test(event)) {
        count++;
      }
    }

    return count;
  }

  /**
   * Get all registered event names
   * @returns {Array<string>} Event names
   */
  eventNames() {
    return Array.from(this._listeners.keys());
  }

  /**
   * Create a scoped event bus with a namespace prefix
   * The scoped bus shares listeners with the parent bus
   * @param {string} namespace - Namespace prefix
   * @returns {EventBus} New scoped event bus
   */
  scope(namespace) {
    const scoped = new EventBus({
      logger: this.logger,
      enableLogging: this.enableLogging
    });

    // Share the same listeners with the parent
    scoped._listeners = this._listeners;
    scoped._wildcardListeners = this._wildcardListeners;

    // Proxy methods to add namespace prefix
    const originalEmit = scoped.emit.bind(scoped);
    scoped.emit = (event, ...args) => this.emit(`${namespace}.${event}`, ...args);

    const originalOn = scoped.on.bind(scoped);
    scoped.on = (event, ...args) => this.on(`${namespace}.${event}`, ...args);

    const originalOff = scoped.off.bind(scoped);
    scoped.off = (event, ...args) => this.off(`${namespace}.${event}`, ...args);

    const originalOnce = scoped.once.bind(scoped);
    scoped.once = (event, ...args) => this.once(`${namespace}.${event}`, ...args);

    return scoped;
  }
}

// Event types for common domain events
EventBus.Events = {
  // PR events
  PR_PROCESSED: 'pr.processed',
  PR_APPROVED: 'pr.approved',
  PR_REJECTED: 'pr.rejected',
  PR_CLOSED: 'pr.closed',
  PR_OUTDATED: 'pr.outdated',

  // Review events
  REVIEW_CREATED: 'review.created',
  REVIEW_OUTDATED: 'review.outdated',

  // State events
  STATE_CHANGED: 'state.changed',
  STATE_PERSISTED: 'state.persisted',

  // Notification events
  NOTIFICATION_SENT: 'notification.sent',
  NOTIFICATION_FAILED: 'notification.failed',

  // Error events
  ERROR_OCCURRED: 'error.occurred',
  MCP_ERROR: 'error.mcp',
  TELEGRAM_ERROR: 'error.telegram'
};

EventBus.EventPriority = EventPriority;

module.exports = EventBus;
