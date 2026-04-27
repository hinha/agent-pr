/**
 * Unit tests for TimeoutManager utility
 * Tests timeout tracking, clearing, and management functionality
 */

const TimeoutManager = require('../../../src/utils/timeoutManager');

describe('TimeoutManager', () => {
  let timeoutManager;

  beforeEach(() => {
    jest.useFakeTimers();
    timeoutManager = new TimeoutManager();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    if (timeoutManager) {
      timeoutManager.clearAll();
    }
  });

  describe('setTimeout', () => {
    test('should create a tracked timeout', () => {
      const callback = jest.fn();
      const timeoutId = timeoutManager.setTimeout(callback, 1000);

      expect(timeoutId).toBeDefined();
      expect(typeof timeoutId).toBe('object');
      expect(timeoutManager.hasPending()).toBe(true);
      expect(timeoutManager.getPendingCount()).toBe(1);
    });

    test('should execute callback after delay', () => {
      const callback = jest.fn();
      timeoutManager.setTimeout(callback, 1000);

      expect(callback).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1000);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(timeoutManager.hasPending()).toBe(false);
    });

    test('should pass arguments to callback', () => {
      const callback = jest.fn();
      timeoutManager.setTimeout(callback, 1000, 'arg1', 'arg2', 123);

      jest.advanceTimersByTime(1000);

      expect(callback).toHaveBeenCalledWith('arg1', 'arg2', 123);
    });

    test('should track multiple timeouts independently', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      const callback3 = jest.fn();

      timeoutManager.setTimeout(callback1, 1000);
      timeoutManager.setTimeout(callback2, 2000);
      timeoutManager.setTimeout(callback3, 3000);

      expect(timeoutManager.getPendingCount()).toBe(3);

      jest.advanceTimersByTime(1000);
      expect(callback1).toHaveBeenCalledTimes(1);
      expect(timeoutManager.getPendingCount()).toBe(2);

      jest.advanceTimersByTime(1000);
      expect(callback2).toHaveBeenCalledTimes(1);
      expect(timeoutManager.getPendingCount()).toBe(1);

      jest.advanceTimersByTime(1000);
      expect(callback3).toHaveBeenCalledTimes(1);
      expect(timeoutManager.hasPending()).toBe(false);
    });

    test('should handle zero-delay timeouts', () => {
      const callback = jest.fn();
      timeoutManager.setTimeout(callback, 0);

      jest.advanceTimersByTime(0);

      expect(callback).toHaveBeenCalled();
    });
  });

  describe('clearTimeout', () => {
    test('should clear a specific timeout', () => {
      const callback = jest.fn();
      const timeoutId = timeoutManager.setTimeout(callback, 1000);

      timeoutManager.clearTimeout(timeoutId);

      expect(timeoutManager.hasPending()).toBe(false);

      jest.advanceTimersByTime(1000);

      expect(callback).not.toHaveBeenCalled();
    });

    test('should not affect other timeouts when clearing one', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      const timeoutId1 = timeoutManager.setTimeout(callback1, 1000);
      const timeoutId2 = timeoutManager.setTimeout(callback2, 1000);

      timeoutManager.clearTimeout(timeoutId1);

      expect(timeoutManager.getPendingCount()).toBe(1);

      jest.advanceTimersByTime(1000);

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    test('should handle clearing already-executed timeout', () => {
      const callback = jest.fn();
      const timeoutId = timeoutManager.setTimeout(callback, 100);

      jest.advanceTimersByTime(100);
      expect(callback).toHaveBeenCalled();

      // Should not throw error
      expect(() => {
        timeoutManager.clearTimeout(timeoutId);
      }).not.toThrow();
    });

    test('should handle clearing non-existent timeout', () => {
      const fakeId = {};

      // Should not throw error
      expect(() => {
        timeoutManager.clearTimeout(fakeId);
      }).not.toThrow();
    });
  });

  describe('clearAll', () => {
    test('should clear all pending timeouts', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      const callback3 = jest.fn();

      timeoutManager.setTimeout(callback1, 1000);
      timeoutManager.setTimeout(callback2, 2000);
      timeoutManager.setTimeout(callback3, 3000);

      expect(timeoutManager.getPendingCount()).toBe(3);

      timeoutManager.clearAll();

      expect(timeoutManager.hasPending()).toBe(false);
      expect(timeoutManager.getPendingCount()).toBe(0);

      jest.advanceTimersByTime(3000);

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
      expect(callback3).not.toHaveBeenCalled();
    });

    test('should handle clearing when no timeouts are pending', () => {
      expect(() => {
        timeoutManager.clearAll();
      }).not.toThrow();

      expect(timeoutManager.hasPending()).toBe(false);
    });

    test('should allow new timeouts after clearing all', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      timeoutManager.setTimeout(callback1, 1000);
      timeoutManager.clearAll();

      const timeoutId = timeoutManager.setTimeout(callback2, 1000);

      expect(timeoutManager.hasPending()).toBe(true);
      expect(timeoutManager.getPendingCount()).toBe(1);

      jest.advanceTimersByTime(1000);

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledTimes(1);
    });
  });

  describe('hasPending', () => {
    test('should return false when no timeouts are pending', () => {
      expect(timeoutManager.hasPending()).toBe(false);
    });

    test('should return true when timeouts are pending', () => {
      timeoutManager.setTimeout(() => {}, 1000);
      expect(timeoutManager.hasPending()).toBe(true);
    });

    test('should return false after all timeouts execute', () => {
      const callback = jest.fn();
      timeoutManager.setTimeout(callback, 100);

      expect(timeoutManager.hasPending()).toBe(true);

      jest.advanceTimersByTime(100);

      expect(timeoutManager.hasPending()).toBe(false);
    });

    test('should return false after clearing all timeouts', () => {
      timeoutManager.setTimeout(() => {}, 1000);
      expect(timeoutManager.hasPending()).toBe(true);

      timeoutManager.clearAll();
      expect(timeoutManager.hasPending()).toBe(false);
    });
  });

  describe('getPendingCount', () => {
    test('should return 0 when no timeouts are pending', () => {
      expect(timeoutManager.getPendingCount()).toBe(0);
    });

    test('should return correct count of pending timeouts', () => {
      expect(timeoutManager.getPendingCount()).toBe(0);

      timeoutManager.setTimeout(() => {}, 1000);
      expect(timeoutManager.getPendingCount()).toBe(1);

      timeoutManager.setTimeout(() => {}, 2000);
      expect(timeoutManager.getPendingCount()).toBe(2);

      timeoutManager.setTimeout(() => {}, 3000);
      expect(timeoutManager.getPendingCount()).toBe(3);
    });

    test('should decrease count when timeout executes', () => {
      const callback = jest.fn();
      timeoutManager.setTimeout(callback, 100);

      expect(timeoutManager.getPendingCount()).toBe(1);

      jest.advanceTimersByTime(100);

      expect(timeoutManager.getPendingCount()).toBe(0);
    });

    test('should decrease count when timeout is cleared', () => {
      const timeoutId = timeoutManager.setTimeout(() => {}, 1000);

      expect(timeoutManager.getPendingCount()).toBe(1);

      timeoutManager.clearTimeout(timeoutId);

      expect(timeoutManager.getPendingCount()).toBe(0);
    });
  });

  describe('unref behavior', () => {
    test('should call unref on timeout if available', () => {
      const timeoutId = timeoutManager.setTimeout(() => {}, 1000);

      // In Node.js, setTimeout returns an object with unref method
      expect(typeof timeoutId.unref).toBe('function');
    });
  });

  describe('automatic cleanup after execution', () => {
    test('should remove timeout from pending set after execution', () => {
      const callback = jest.fn();
      const timeoutId = timeoutManager.setTimeout(callback, 100);

      expect(timeoutManager.hasPending()).toBe(true);

      jest.advanceTimersByTime(100);

      expect(callback).toHaveBeenCalled();
      expect(timeoutManager.hasPending()).toBe(false);
    });

    test('should handle rapid execution and cleanup', () => {
      const callbacks = Array.from({ length: 10 }, () => jest.fn());

      for (const callback of callbacks) {
        timeoutManager.setTimeout(callback, 100);
      }

      expect(timeoutManager.getPendingCount()).toBe(10);

      jest.advanceTimersByTime(100);

      expect(timeoutManager.getPendingCount()).toBe(0);
      callbacks.forEach(callback => {
        expect(callback).toHaveBeenCalledTimes(1);
      });
    });
  });
});
