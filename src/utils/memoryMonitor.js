/**
 * MemoryMonitor - Runtime memory monitoring with automatic recovery actions
 *
 * Monitors memory usage and takes action at three thresholds:
 * - Warning (70%): Log elevated memory usage
 * - Critical (85%): Trigger garbage collection if available
 * - Restart (95%): Trigger graceful shutdown for auto-restart
 */
const logger = require('./logger');

class MemoryMonitor {
  constructor(options = {}) {
    // Configuration
    this.intervalMs = options.intervalMs || 60 * 1000; // Check every minute
    this.memoryLimit = options.memoryLimit || 128 * 1024 * 1024; // 128MB default

    // Three-tier threshold system
    this.warnThreshold = options.warnThreshold || Math.floor(this.memoryLimit * 0.7); // 70%
    this.critThreshold = options.critThreshold || Math.floor(this.memoryLimit * 0.85); // 85%
    this.restartThreshold = options.restartThreshold || Math.floor(this.memoryLimit * 0.95); // 95%

    // State
    this.intervalId = null;
    this.gcAvailable = typeof global.gc === 'function';
    this.onCritical = options.onCritical || null; // Callback for critical memory events

    // Tracking
    this.lastGC = null;
    this.gcCount = 0;
    this.warnCount = 0;
    this.critCount = 0;
  }

  /**
   * Start memory monitoring
   */
  start() {
    if (!this.gcAvailable) {
      logger.warn('Garbage collection not available. Start with --expose-gc flag for GC support.');
    }

    this.intervalId = setInterval(() => {
      this.checkMemory();
    }, this.intervalMs);

    // Allow process to exit if this is the only active timer
    if (typeof this.intervalId.unref === 'function') {
      this.intervalId.unref();
    }

    logger.info('Memory monitor started', {
      limit: `${this.memoryLimit / 1024 / 1024}MB`,
      warn: `${this.warnThreshold / 1024 / 1024}MB`,
      critical: `${this.critThreshold / 1024 / 1024}MB`,
      restart: `${this.restartThreshold / 1024 / 1024}MB`,
      interval: `${this.intervalMs / 1000}s`,
      gcAvailable: this.gcAvailable
    });
  }

  /**
   * Check memory usage and take appropriate action
   */
  checkMemory() {
    const usage = process.memoryUsage();
    const heapUsed = usage.heapUsed;

    // Log memory stats
    logger.debug('Memory usage', {
      heapUsed: `${Math.round(heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)}MB`,
      rss: `${Math.round(usage.rss / 1024 / 1024)}MB`,
      external: `${Math.round(usage.external / 1024 / 1024)}MB`,
      arrayBuffers: `${Math.round(usage.arrayBuffers / 1024 / 1024)}MB`,
      usagePercent: `${Math.round((heapUsed / this.memoryLimit) * 100)}%`
    });

    // Level 1: Warning threshold - just log
    if (heapUsed > this.warnThreshold && heapUsed <= this.critThreshold) {
      this.warnCount++;
      logger.warn('Memory usage elevated', {
        heapUsed: `${Math.round(heapUsed / 1024 / 1024)}MB`,
        threshold: `${this.warnThreshold / 1024 / 1024}MB`,
        warnCount: this.warnCount
      });
    }

    // Level 2: Critical threshold - trigger GC if available
    if (heapUsed > this.critThreshold && heapUsed <= this.restartThreshold) {
      this.critCount++;
      logger.error('Critical memory usage - attempting garbage collection', {
        heapUsed: `${Math.round(heapUsed / 1024 / 1024)}MB`,
        threshold: `${this.critThreshold / 1024 / 1024}MB`,
        gcAvailable: this.gcAvailable,
        critCount: this.critCount
      });

      if (this.gcAvailable) {
        this.triggerGarbageCollection(usage);
      } else if (this.onCritical) {
        this.onCritical('GC unavailable', usage);
      }
    }

    // Level 3: Restart threshold - trigger restart
    if (heapUsed > this.restartThreshold) {
      logger.error('Memory exceeded restart threshold - initiating restart', {
        heapUsed: `${Math.round(heapUsed / 1024 / 1024)}MB`,
        threshold: `${this.restartThreshold / 1024 / 1024}MB`,
        limit: `${this.memoryLimit / 1024 / 1024}MB`
      });

      // Trigger graceful shutdown which will restart process
      if (this.onCritical) {
        this.onCritical('restart required', usage);
      } else {
        logger.error('No restart handler configured, forcing restart...');
        process.exit(1);
      }
    }
  }

  /**
   * Trigger garbage collection and log results
   * @param {Object} usageBefore - Memory usage before GC
   */
  triggerGarbageCollection(usageBefore) {
    const beforeGC = usageBefore.heapUsed;
    const beforeTime = Date.now();

    try {
      global.gc();

      const afterGC = process.memoryUsage().heapUsed;
      const freed = beforeGC - afterGC;
      const duration = Date.now() - beforeTime;

      this.gcCount++;
      this.lastGC = beforeTime;

      logger.info('Garbage collection completed', {
        before: `${Math.round(beforeGC / 1024 / 1024)}MB`,
        after: `${Math.round(afterGC / 1024 / 1024)}MB`,
        freed: `${Math.round(freed / 1024 / 1024)}MB`,
        freedPercent: `${Math.round((freed / beforeGC) * 100)}%`,
        duration: `${duration}ms`,
        gcCount: this.gcCount
      });

      // If GC didn't help enough, trigger callback
      if (afterGC > this.critThreshold && this.onCritical) {
        logger.error('GC ineffective, memory still critical');
        this.onCritical('GC ineffective', process.memoryUsage());
      }
    } catch (error) {
      logger.error('Garbage collection failed', { error: error.message });
      if (this.onCritical) {
        this.onCritical('GC failed', usageBefore);
      }
    }
  }

  /**
   * Stop memory monitoring
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Memory monitor stopped', {
        totalWarnings: this.warnCount,
        totalCritical: this.critCount,
        totalGC: this.gcCount
      });
    }
  }

  /**
   * Get current memory statistics
   * @returns {Object} Memory statistics
   */
  getMemoryStats() {
    const usage = process.memoryUsage();
    return {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      rss: usage.rss,
      external: usage.external,
      arrayBuffers: usage.arrayBuffers,
      heapUsedMB: Math.round(usage.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(usage.heapTotal / 1024 / 1024),
      rssMB: Math.round(usage.rss / 1024 / 1024),
      usagePercent: Math.round((usage.heapUsed / this.memoryLimit) * 100),
      status: this.getMemoryStatus(usage.heapUsed),
      thresholds: {
        warn: this.warnThreshold,
        critical: this.critThreshold,
        restart: this.restartThreshold
      }
    };
  }

  /**
   * Get memory status based on current usage
   * @param {number} heapUsed - Current heap used in bytes
   * @returns {string} Status: NORMAL, WARNING, CRITICAL, or CRITICAL_RESTART
   */
  getMemoryStatus(heapUsed) {
    if (heapUsed > this.restartThreshold) return 'CRITICAL_RESTART';
    if (heapUsed > this.critThreshold) return 'CRITICAL';
    if (heapUsed > this.warnThreshold) return 'WARNING';
    return 'NORMAL';
  }

  /**
   * Manually trigger garbage collection if available
   * @returns {Object} GC results
   */
  manualGC() {
    if (!this.gcAvailable) {
      return { success: false, message: 'GC not available' };
    }

    const beforeGC = process.memoryUsage().heapUsed;
    global.gc();
    const afterGC = process.memoryUsage().heapUsed;

    return {
      success: true,
      beforeMB: Math.round(beforeGC / 1024 / 1024),
      afterMB: Math.round(afterGC / 1024 / 1024),
      freedMB: Math.round((beforeGC - afterGC) / 1024 / 1024)
    };
  }
}

module.exports = MemoryMonitor;
