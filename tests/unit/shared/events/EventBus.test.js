/**
 * Unit tests for EventBus
 */


describe('EventBus', () => {
  let bus;

  beforeEach(() => {
    bus = new EventBus();
  });

  afterEach(() => {
    bus.clear();
  });

  describe('on', () => {
    it('should register event handler', () => {
      const handler = jest.fn();
      bus.on('test.event', handler);

      expect(bus.listenerCount('test.event')).toBe(1);
    });

    it('should return unsubscribe function', () => {
      const handler = jest.fn();
      const unsubscribe = bus.on('test.event', handler);

      expect(typeof unsubscribe).toBe('function');

      unsubscribe();
      expect(bus.listenerCount('test.event')).toBe(0);
    });

    it('should support wildcard subscriptions', () => {
      const handler = jest.fn();
      bus.on('test.*', handler);

      bus.emit('test.event1', {});
      bus.emit('test.event2', {});

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should sort handlers by priority', () => {
      const calls = [];
      const handler1 = () => calls.push(1);
      const handler2 = () => calls.push(2);
      const handler3 = () => calls.push(3);

      bus.on('test', handler1, { priority: EventBus.EventPriority.LOW });
      bus.on('test', handler2, { priority: EventBus.EventPriority.HIGH });
      bus.on('test', handler3, { priority: EventBus.EventPriority.NORMAL });

      bus.emit('test', {});

      expect(calls).toEqual([2, 3, 1]);
    });

    it('should throw error for non-function handler', () => {
      expect(() => bus.on('test', 'not a function')).toThrow(TypeError);
    });

    it('should warn when max listeners exceeded', () => {
      const warnSpy = jest.spyOn(bus.logger, 'warn').mockImplementation(() => {});
      const handler = jest.fn();

      const smallBus = new EventBus({ maxListeners: 2 });

      smallBus.on('test', handler);
      smallBus.on('test', handler);
      smallBus.on('test', handler); // Should warn

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('once', () => {
    it('should execute handler only once', () => {
      const handler = jest.fn();
      bus.once('test', handler);

      bus.emit('test', {});
      bus.emit('test', {});

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should work with unsubscribe', () => {
      const handler = jest.fn();
      const unsubscribe = bus.once('test', handler);

      unsubscribe();
      bus.emit('test', {});

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('off', () => {
    it('should remove handler by ID', () => {
      const handler = jest.fn();
      const unsubscribe = bus.on('test', handler, { id: 'my-handler' });

      bus.off('test', 'my-handler');

      expect(bus.listenerCount('test')).toBe(0);
    });

    it('should remove handler by function reference', () => {
      const handler = jest.fn();
      bus.on('test', handler);

      bus.off('test', handler);

      expect(bus.listenerCount('test')).toBe(0);
    });

    it('should return false when handler not found', () => {
      const result = bus.off('nonexistent', 'handler-id');
      expect(result).toBe(false);
    });

    it('should clean up empty event arrays', () => {
      const handler = jest.fn();
      bus.on('test', handler);

      bus.off('test', handler);

      expect(bus.eventNames()).not.toContain('test');
    });
  });

  describe('emit', () => {
    it('should call registered handlers', () => {
      const handler = jest.fn();
      bus.on('test', handler);

      bus.emit('test', { data: 'test' });

      expect(handler).toHaveBeenCalledWith({ data: 'test' }, 'test');
    });

    it('should call multiple handlers', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      bus.on('test', handler1);
      bus.on('test', handler2);

      bus.emit('test', {});

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('should not call handlers for different events', () => {
      const handler = jest.fn();
      bus.on('test1', handler);

      bus.emit('test2', {});

      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle async handlers', async () => {
      const handler = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      bus.on('test', handler);

      await bus.emit('test', {}, { async: true });

      expect(handler).toHaveBeenCalled();
    });

    it('should handle errors in handlers gracefully', () => {
      const errorHandler = jest.fn();
      const throwingHandler = () => { throw new Error('Test error'); };

      bus.on('test', throwingHandler);
      bus.on('error', errorHandler);

      bus.emit('test', {});

      expect(errorHandler).toHaveBeenCalled();
      const errorCall = errorHandler.mock.calls[0][0];
      expect(errorCall).toHaveProperty('event', 'test');
      expect(errorCall).toHaveProperty('error', 'Test error');
      expect(errorCall).toHaveProperty('handlerId');
      expect(typeof errorCall.handlerId).toBe('string');
    });
  });

  describe('emitAsync', () => {
    it('should execute handlers asynchronously', async () => {
      let executionOrder = [];

      bus.on('test', async () => {
        executionOrder.push(1);
        await new Promise(resolve => setTimeout(resolve, 20));
        executionOrder.push(2);
      });

      bus.on('test', async () => {
        executionOrder.push(3);
        await new Promise(resolve => setTimeout(resolve, 10));
        executionOrder.push(4);
      });

      await bus.emitAsync('test', {});

      expect(executionOrder).toEqual([1, 3, 4, 2]);
    });
  });

  describe('wildcard listeners', () => {
    it('should match wildcard patterns', () => {
      const handler = jest.fn();
      bus.on('pr.*', handler);

      bus.emit('pr.created', {});
      bus.emit('pr.updated', {});
      bus.emit('review.created', {});

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should support multiple wildcard levels', () => {
      const handler = jest.fn();
      bus.on('pr.*.created', handler);

      bus.emit('pr.branch.created', {});
      bus.emit('pr.tag.created', {});
      bus.emit('pr.branch.updated', {});

      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('event history', () => {
    it('should track emitted events', () => {
      bus.emit('test1', { data: '1' });
      bus.emit('test2', { data: '2' });

      const history = bus.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({ event: 'test1' });
      expect(history[1]).toMatchObject({ event: 'test2' });
    });

    it('should limit history size', () => {
      const smallBus = new EventBus({ maxHistorySize: 2 });

      smallBus.emit('test1', {});
      smallBus.emit('test2', {});
      smallBus.emit('test3', {});

      const history = smallBus.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].event).toBe('test2');
      expect(history[1].event).toBe('test3');
    });

    it('should filter history by event name', () => {
      bus.emit('test1', {});
      bus.emit('test2', {});
      bus.emit('test1', {});

      const history = bus.getHistory({ event: 'test1' });
      expect(history).toHaveLength(2);
    });

    it('should limit history results', () => {
      bus.emit('test1', {});
      bus.emit('test2', {});
      bus.emit('test3', {});

      const history = bus.getHistory({ limit: 2 });
      expect(history).toHaveLength(2);
    });
  });

  describe('metrics', () => {
    it('should track event metrics', () => {
      const handler = jest.fn();
      bus.on('test', handler);

      bus.emit('test', {});
      bus.emit('test', {});
      bus.emit('other', {});

      const metrics = bus.getMetrics();
      expect(metrics.emitted).toBe(3);
      expect(metrics.handled).toBe(2);
      expect(metrics.totalEvents).toBe(1);
      expect(metrics.listenerCounts).toEqual({ test: 1 });
    });

    it('should track errors', () => {
      const throwingHandler = () => { throw new Error('Test'); };
      bus.on('test', throwingHandler);

      bus.emit('test', {});

      const metrics = bus.getMetrics();
      expect(metrics.errors).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all listeners', () => {
      bus.on('test1', jest.fn());
      bus.on('test2', jest.fn());

      bus.clear();

      expect(bus.eventNames()).toHaveLength(0);
    });

    it('should clear specific event listeners', () => {
      bus.on('test1', jest.fn());
      bus.on('test2', jest.fn());

      bus.clear('test1');

      expect(bus.eventNames()).toContain('test2');
      expect(bus.eventNames()).not.toContain('test1');
    });
  });

  describe('listenerCount', () => {
    it('should return count for specific event', () => {
      bus.on('test', jest.fn());
      bus.on('test', jest.fn());

      expect(bus.listenerCount('test')).toBe(2);
    });

    it('should include wildcard listeners in count', () => {
      bus.on('test', jest.fn());
      bus.on('test.*', jest.fn());

      // Only the wildcard matches 'test.event', 'test' is an exact match
      expect(bus.listenerCount('test.event')).toBe(1);
      // 'test.*' wildcard does not match exact 'test', only 'test.something'
      expect(bus.listenerCount('test')).toBe(1);
    });

    it('should return zero for non-existent event', () => {
      expect(bus.listenerCount('nonexistent')).toBe(0);
    });
  });

  describe('eventNames', () => {
    it('should return all registered event names', () => {
      bus.on('test1', jest.fn());
      bus.on('test2', jest.fn());

      const names = bus.eventNames();
      expect(names).toContain('test1');
      expect(names).toContain('test2');
    });

    it('should return empty array when no events', () => {
      expect(bus.eventNames()).toEqual([]);
    });
  });

  describe('scope', () => {
    it('should create scoped event bus with namespace', () => {
      const scoped = bus.scope('myapp');
      const handler = jest.fn();

      scoped.on('test', handler);
      bus.emit('myapp.test', {});

      expect(handler).toHaveBeenCalled();
    });

    it('should scope emit calls', () => {
      const scoped = bus.scope('myapp');
      const handler = jest.fn();

      bus.on('myapp.test', handler);
      scoped.emit('test', {});

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('predefined events', () => {
    it('should have all predefined event constants', () => {
      expect(EventBus.Events.PR_PROCESSED).toBe('pr.processed');
      expect(EventBus.Events.PR_APPROVED).toBe('pr.approved');
      expect(EventBus.Events.PR_REJECTED).toBe('pr.rejected');
      expect(EventBus.Events.PR_CLOSED).toBe('pr.closed');
      expect(EventBus.Events.REVIEW_CREATED).toBe('review.created');
      expect(EventBus.Events.REVIEW_OUTDATED).toBe('review.outdated');
      expect(EventBus.Events.STATE_CHANGED).toBe('state.changed');
      expect(EventBus.Events.NOTIFICATION_SENT).toBe('notification.sent');
      expect(EventBus.Events.ERROR_OCCURRED).toBe('error.occurred');
    });

    it('should have all priority levels', () => {
      expect(EventBus.EventPriority.LOW).toBe(0);
      expect(EventBus.EventPriority.NORMAL).toBe(1);
      expect(EventBus.EventPriority.HIGH).toBe(2);
      expect(EventBus.EventPriority.CRITICAL).toBe(3);
    });
  });
});
