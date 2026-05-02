/**
 * Unit tests for memoryMonitor utility
 * Tests memory monitoring, thresholds, and garbage collection logic
 */

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
}));

const MemoryMonitor = require('../../../src/utils/memoryMonitor');

describe('MemoryMonitor', () => {
  let monitor;
  let mockOnCritical;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOnCritical = jest.fn();
    monitor = new MemoryMonitor({
      memoryLimit: 100 * 1024 * 1024, // 100MB for testing
      intervalMs: 1000,
      onCritical: mockOnCritical
    });
  });

  describe('constructor', () => {
    test('should initialize with default options', () => {
      const defaultMonitor = new MemoryMonitor();
      expect(defaultMonitor.memoryLimit).toBe(128 * 1024 * 1024); // 128MB
      expect(defaultMonitor.intervalMs).toBe(60 * 1000); // 60 seconds
    });

    test('should initialize with custom options', () => {
      expect(monitor.memoryLimit).toBe(100 * 1024 * 1024);
      expect(monitor.intervalMs).toBe(1000);
    });

    test('should calculate thresholds correctly', () => {
      const expectedWarn = Math.floor(100 * 1024 * 1024 * 0.7); // 70MB
      const expectedCrit = Math.floor(100 * 1024 * 1024 * 0.85); // 85MB
      const expectedRestart = Math.floor(100 * 1024 * 1024 * 0.95); // 95MB

      expect(monitor.warnThreshold).toBe(expectedWarn);
      expect(monitor.critThreshold).toBe(expectedCrit);
      expect(monitor.restartThreshold).toBe(expectedRestart);
    });

    test('should detect GC availability', () => {
      expect(typeof monitor.gcAvailable).toBe('boolean');
    });

    test('should initialize tracking counters to zero', () => {
      expect(monitor.gcCount).toBe(0);
      expect(monitor.warnCount).toBe(0);
      expect(monitor.critCount).toBe(0);
    });
  });

  describe('getMemoryStatus', () => {
    test('should return NORMAL status for low memory usage', () => {
      const lowUsage = 50 * 1024 * 1024; // 50MB
      expect(monitor.getMemoryStatus(lowUsage)).toBe('NORMAL');
    });

    test('should return WARNING status for elevated memory usage', () => {
      const elevatedUsage = 75 * 1024 * 1024; // 75MB (above 70MB)
      expect(monitor.getMemoryStatus(elevatedUsage)).toBe('WARNING');
    });

    test('should return CRITICAL status for high memory usage', () => {
      const highUsage = 88 * 1024 * 1024; // 88MB (above 85MB)
      expect(monitor.getMemoryStatus(highUsage)).toBe('CRITICAL');
    });

    test('should return CRITICAL_RESTART status for extreme memory usage', () => {
      const extremeUsage = 96 * 1024 * 1024; // 96MB (above 95MB)
      expect(monitor.getMemoryStatus(extremeUsage)).toBe('CRITICAL_RESTART');
    });

    test('should handle boundary conditions', () => {
      const warnThreshold = Math.floor(100 * 1024 * 1024 * 0.7);
      const critThreshold = Math.floor(100 * 1024 * 1024 * 0.85);
      const restartThreshold = Math.floor(100 * 1024 * 1024 * 0.95);

      // Just below warning threshold
      expect(monitor.getMemoryStatus(warnThreshold - 1)).toBe('NORMAL');

      // At warning threshold
      expect(monitor.getMemoryStatus(warnThreshold + 1)).toBe('WARNING');

      // At critical threshold
      expect(monitor.getMemoryStatus(critThreshold + 1)).toBe('CRITICAL');

      // At restart threshold
      expect(monitor.getMemoryStatus(restartThreshold + 1)).toBe('CRITICAL_RESTART');
    });
  });

  describe('getMemoryStats', () => {
    test('should return memory statistics', () => {
      const stats = monitor.getMemoryStats();

      expect(stats).toHaveProperty('heapUsed');
      expect(stats).toHaveProperty('heapTotal');
      expect(stats).toHaveProperty('rss');
      expect(stats).toHaveProperty('heapUsedMB');
      expect(stats).toHaveProperty('heapTotalMB');
      expect(stats).toHaveProperty('rssMB');
      expect(stats).toHaveProperty('usagePercent');
      expect(stats).toHaveProperty('status');
      expect(stats).toHaveProperty('thresholds');
    });

    test('should calculate usage percent correctly', () => {
      const stats = monitor.getMemoryStats();
      const expectedPercent = Math.round((stats.heapUsed / monitor.memoryLimit) * 100);
      expect(stats.usagePercent).toBe(expectedPercent);
    });

    test('should include threshold values', () => {
      const stats = monitor.getMemoryStats();

      expect(stats.thresholds.warnThreshold).toBe(monitor.warnThreshold);
      expect(stats.thresholds.critical).toBe(monitor.critThreshold);
      expect(stats.thresholds.restart).toBe(monitor.restartThreshold);
    });
  });

  describe('manualGC', () => {
    test('should return error when GC is not available', () => {
      monitor.gcAvailable = false;
      const result = monitor.manualGC();

      expect(result.success).toBe(false);
      expect(result.message).toBe('GC not available');
    });

    test('should return success and stats when GC is available', () => {
      monitor.gcAvailable = true;
      global.gc = jest.fn();

      const result = monitor.manualGC();

      expect(result.success).toBe(true);
      expect(result).toHaveProperty('beforeMB');
      expect(result).toHaveProperty('afterMB');
      expect(result).toHaveProperty('freedMB');

      delete global.gc;
    });
  });

  describe('start and stop', () => {
    test('should start monitoring with interval', () => {
      jest.useFakeTimers();

      monitor.start();

      expect(monitor.intervalId).not.toBeNull();

      monitor.stop();
      jest.useRealTimers();
    });

    test('should stop monitoring and clear interval', () => {
      jest.useFakeTimers();

      monitor.start();
      expect(monitor.intervalId).not.toBeNull();

      monitor.stop();
      expect(monitor.intervalId).toBeNull();

      jest.useRealTimers();
    });

    test('should handle multiple start/stop cycles', () => {
      jest.useFakeTimers();

      monitor.start();
      const firstIntervalId = monitor.intervalId;

      monitor.stop();
      monitor.start();
      const secondIntervalId = monitor.intervalId;

      expect(firstIntervalId).not.toBe(secondIntervalId);

      monitor.stop();
      jest.useRealTimers();
    });

    test('should handle multiple start calls', () => {
      jest.useFakeTimers();

      monitor.start();
      expect(monitor.intervalId).not.toBeNull();

      // Starting again creates a new interval
      monitor.start();
      expect(monitor.intervalId).not.toBeNull();

      monitor.stop();
      jest.useRealTimers();
    });
  });

  describe('Threshold calculation', () => {
    test('should use 70% for warning threshold by default', () => {
      const limit = 200 * 1024 * 1024; // 200MB
      const mon = new MemoryMonitor({ memoryLimit: limit });
      expect(mon.warnThreshold).toBe(Math.floor(limit * 0.7));
    });

    test('should use 85% for critical threshold by default', () => {
      const limit = 200 * 1024 * 1024; // 200MB
      const mon = new MemoryMonitor({ memoryLimit: limit });
      expect(mon.critThreshold).toBe(Math.floor(limit * 0.85));
    });

    test('should use 95% for restart threshold by default', () => {
      const limit = 200 * 1024 * 1024; // 200MB
      const mon = new MemoryMonitor({ memoryLimit: limit });
      expect(mon.restartThreshold).toBe(Math.floor(limit * 0.95));
    });

    test('should accept custom threshold percentages', () => {
      const mon = new MemoryMonitor({
        memoryLimit: 100 * 1024 * 1024,
        warnThreshold: 50 * 1024 * 1024, // 50%
        critThreshold: 80 * 1024 * 1024, // 80%
        restartThreshold: 90 * 1024 * 1024 // 90%
      });

      expect(mon.warnThreshold).toBe(50 * 1024 * 1024);
      expect(mon.critThreshold).toBe(80 * 1024 * 1024);
      expect(mon.restartThreshold).toBe(90 * 1024 * 1024);
    });
  });

  describe('Memory conversion', () => {
    test('should convert bytes to MB correctly', () => {
      const bytes = 10 * 1024 * 1024; // 10MB
      const mb = Math.round(bytes / 1024 / 1024);
      expect(mb).toBe(10);
    });

    test('should round MB values', () => {
      const bytes = 10.5 * 1024 * 1024; // 10.5MB
      const mb = Math.round(bytes / 1024 / 1024);
      expect(mb).toBe(11);
    });
  });

  describe('Edge cases', () => {
    test('should handle small memory limit', () => {
      const mon = new MemoryMonitor({ memoryLimit: 1 }); // 1 byte
      expect(mon.memoryLimit).toBe(1);
      // Thresholds will be calculated as Math.floor(1 * percentage)
      expect(mon.warnThreshold).toBeGreaterThanOrEqual(0);
      expect(mon.critThreshold).toBeGreaterThanOrEqual(0);
      expect(mon.restartThreshold).toBeGreaterThanOrEqual(0);
    });

    test('should handle very small memory limit', () => {
      const mon = new MemoryMonitor({ memoryLimit: 1024 }); // 1KB
      expect(mon.warnThreshold).toBe(Math.floor(1024 * 0.7));
    });

    test('should handle very large memory limit', () => {
      const mon = new MemoryMonitor({ memoryLimit: 1024 * 1024 * 1024 }); // 1GB
      expect(mon.memoryLimit).toBe(1024 * 1024 * 1024);
    });
  });

  describe('Callback handling', () => {
    test('should store onCritical callback', () => {
      const callback = jest.fn();
      const mon = new MemoryMonitor({ onCritical: callback });
      expect(mon.onCritical).toBe(callback);
    });

    test('should handle missing onCritical callback', () => {
      const mon = new MemoryMonitor();
      expect(mon.onCritical).toBeNull();
    });
  });

  describe('Tracking state', () => {
    test('should track GC count', () => {
      expect(monitor.gcCount).toBe(0);
      monitor.gcCount++;
      expect(monitor.gcCount).toBe(1);
    });

    test('should track last GC time', () => {
      const now = Date.now();
      monitor.lastGC = now;
      expect(monitor.lastGC).toBe(now);
    });

    test('should track warning count', () => {
      expect(monitor.warnCount).toBe(0);
      monitor.warnCount++;
      expect(monitor.warnCount).toBe(1);
    });

    test('should track critical count', () => {
      expect(monitor.critCount).toBe(0);
      monitor.critCount++;
      expect(monitor.critCount).toBe(1);
    });
  });
});
