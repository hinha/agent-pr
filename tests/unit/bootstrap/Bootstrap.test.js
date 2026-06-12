describe('Bootstrap', () => {
  const originalProcessOn = process.on;
  const originalProcessExit = process.exit;

  let Bootstrap;
  let bootstrap;
  let mockContainer;
  let logger;
  let bot;
  let config;
  let telegramAdapter;
  let discordAdapter;
  let orchestrator;
  let reviewQueueWorker;
  let queueNotificationSubscriber;
  let flagsmithSyncService;
  let eventBus;
  let commandHandler;
  let callbackHandler;
  let skipManager;
  let stateRepositoryFactory;
  let checkOutdatedReviewsUseCase;
  let confirmationManager;
  let prActionHandler;
  let MockDiscordInteractionResponder;
  let MemoryMonitorMock;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    logger = {
      info: jest.fn(),
      error: jest.fn()
    };

    config = {
      app: {
        checkIntervalMs: 420000,
        memoryLimit: 256 * 1024 * 1024,
        telegram: { enabled: true },
        discord: { enabled: true },
        flagsmith: { enabled: true, syncIntervalMs: 60000 }
      },
      instances: {
        'github/acme': {
          key: 'github/acme',
          owner: 'acme',
          repos: {
            api: { enabled: true }
          }
        }
      }
    };

    telegramAdapter = {
      start: jest.fn().mockResolvedValue(),
      stop: jest.fn().mockResolvedValue(),
      on: jest.fn(),
      off: jest.fn(),
      getBot: jest.fn(() => bot),
      isPollingOwner: true,
      chatId: 123
    };

    bot = {
      answerCallbackQuery: jest.fn().mockResolvedValue(),
      editMessageText: jest.fn().mockResolvedValue(),
      editMessageReplyMarkup: jest.fn().mockResolvedValue()
    };

    discordAdapter = {
      start: jest.fn().mockResolvedValue(),
      stop: jest.fn().mockResolvedValue(),
      on: jest.fn(),
      off: jest.fn()
    };

    orchestrator = {
      isRunning: false,
      start: jest.fn().mockResolvedValue(),
      stop: jest.fn().mockResolvedValue(),
      getStats: jest.fn(() => ({
        isRunning: true,
        uptime: 1000,
        isPolling: true,
        totalProcessed: 4,
        totalNotified: 3,
        totalErrors: 1,
        lastPollTime: '2026-06-11T00:00:00.000Z'
      }))
    };

    reviewQueueWorker = {
      start: jest.fn().mockResolvedValue(),
      stop: jest.fn().mockResolvedValue()
    };

    queueNotificationSubscriber = { subscribe: jest.fn() };
    flagsmithSyncService = {
      init: jest.fn().mockResolvedValue(),
      start: jest.fn(),
      stop: jest.fn()
    };
    eventBus = {
      emitAsync: jest.fn().mockResolvedValue(),
      clear: jest.fn()
    };
    commandHandler = { handleCommand: jest.fn().mockResolvedValue() };
    callbackHandler = { handleCallbackQuery: jest.fn().mockResolvedValue() };
    skipManager = {};
    stateRepositoryFactory = {};
    checkOutdatedReviewsUseCase = {};
    confirmationManager = {
      setBot: jest.fn(),
      clearAll: jest.fn()
    };
    prActionHandler = {
      handleDiscordInteraction: jest.fn().mockResolvedValue({ success: true })
    };

    mockContainer = {
      get: jest.fn((name) => ({
        logger,
        config,
        telegramAdapter,
        discordAdapter,
        prProcessingOrchestrator: orchestrator,
        reviewQueueWorker,
        queueNotificationSubscriber,
        flagsmithSyncService,
        eventBus,
        commandHandler,
        callbackHandler,
        skipManager,
        stateRepositoryFactory,
        checkOutdatedReviewsUseCase,
        confirmationManager,
        prActionHandler
      })[name])
    };

    MockDiscordInteractionResponder = jest.fn().mockImplementation(() => ({
      error: jest.fn().mockResolvedValue()
    }));

    MemoryMonitorMock = jest.fn().mockImplementation(({ onCritical }) => ({
      start: jest.fn(),
      stop: jest.fn(),
      onCritical
    }));

    jest.doMock('../../../src/container/Container', () => mockContainer);
    jest.doMock('../../../src/utils/memoryMonitor', () => MemoryMonitorMock);
    jest.doMock('../../../src/shared/utils/version', () => ({
      getVersionInfo: jest.fn(() => ({ fullString: '1.2.3' }))
    }));
    jest.doMock('../../../src/infrastructure/discord/DiscordInteractionResponder', () => MockDiscordInteractionResponder);

    const processOnSpy = jest.fn();
    process.on = processOnSpy;
    process.exit = jest.fn();

    Bootstrap = require('../../../src/bootstrap/Bootstrap');
    bootstrap = new Bootstrap();
  });

  afterEach(() => {
    process.on = originalProcessOn;
    process.exit = originalProcessExit;
  });

  test('starts telegram, discord, queue worker, flagsmith, and emits startup event', async () => {
    const setupErrorHandlers = jest.spyOn(bootstrap, '_setupErrorHandlers').mockImplementation(() => {});
    const startMemoryMonitor = jest.spyOn(bootstrap, '_startMemoryMonitor').mockImplementation(() => {});
    const shutdownHandlers = jest.spyOn(bootstrap, '_setupShutdownHandlers').mockImplementation(() => {});
    const setupTelegramCallbacks = jest.spyOn(bootstrap, '_setupTelegramCallbacks').mockImplementation(() => {});
    const setupDiscordInteractions = jest.spyOn(bootstrap, '_setupDiscordInteractions').mockImplementation(() => {});

    await bootstrap.start();

    expect(telegramAdapter.start).toHaveBeenCalled();
    expect(discordAdapter.start).toHaveBeenCalled();
    expect(setupTelegramCallbacks).toHaveBeenCalledWith(logger, config);
    expect(setupDiscordInteractions).toHaveBeenCalledWith(logger, config);
    expect(orchestrator.start).toHaveBeenCalled();
    expect(reviewQueueWorker.start).toHaveBeenCalled();
    expect(queueNotificationSubscriber.subscribe).toHaveBeenCalled();
    expect(flagsmithSyncService.init).toHaveBeenCalledWith(config);
    expect(flagsmithSyncService.start).toHaveBeenCalledWith(60000);
    expect(setupErrorHandlers).toHaveBeenCalledWith(logger);
    expect(startMemoryMonitor).toHaveBeenCalledWith(logger, config);
    expect(shutdownHandlers).toHaveBeenCalled();
    expect(eventBus.emitAsync).toHaveBeenCalledWith('application.started', expect.objectContaining({
      config: expect.objectContaining({ instances: 1, checkInterval: 420000 })
    }));
  });

  test('skips disabled telegram, discord, and flagsmith paths', async () => {
    config.app.telegram.enabled = false;
    config.app.discord.enabled = false;
    config.app.flagsmith.enabled = false;

    jest.spyOn(bootstrap, '_setupErrorHandlers').mockImplementation(() => {});
    jest.spyOn(bootstrap, '_startMemoryMonitor').mockImplementation(() => {});
    jest.spyOn(bootstrap, '_setupShutdownHandlers').mockImplementation(() => {});

    await bootstrap.start();

    expect(telegramAdapter.start).not.toHaveBeenCalled();
    expect(discordAdapter.start).not.toHaveBeenCalled();
    expect(flagsmithSyncService.init).not.toHaveBeenCalled();
    expect(orchestrator.start).toHaveBeenCalled();
    expect(reviewQueueWorker.start).toHaveBeenCalled();
  });

  test('stops resources and detaches telegram and discord handlers', async () => {
    const memoryMonitor = { stop: jest.fn() };
    bootstrap.memoryMonitor = memoryMonitor;
    bootstrap._reviewQueueWorker = reviewQueueWorker;
    bootstrap._callbackQueryHandler = jest.fn();
    bootstrap._messageHandler = jest.fn();
    bootstrap._discordInteractionHandler = jest.fn();

    await bootstrap.stop();

    expect(memoryMonitor.stop).toHaveBeenCalled();
    expect(orchestrator.stop).toHaveBeenCalled();
    expect(reviewQueueWorker.stop).toHaveBeenCalled();
    expect(discordAdapter.off).toHaveBeenCalledWith('interaction', expect.any(Function));
    expect(discordAdapter.stop).toHaveBeenCalled();
    expect(telegramAdapter.off).toHaveBeenCalledWith('callback_query', expect.any(Function));
    expect(telegramAdapter.off).toHaveBeenCalledWith('message', expect.any(Function));
    expect(telegramAdapter.stop).toHaveBeenCalled();
    expect(confirmationManager.clearAll).toHaveBeenCalled();
    expect(flagsmithSyncService.stop).toHaveBeenCalled();
    expect(eventBus.emitAsync).toHaveBeenCalledWith('application.stopped', expect.any(Object));
    expect(eventBus.clear).toHaveBeenCalled();
    expect(bootstrap._callbackQueryHandler).toBeNull();
    expect(bootstrap._messageHandler).toBeNull();
    expect(bootstrap._discordInteractionHandler).toBeNull();
  });

  test('returns early from stop when shutdown already in progress', async () => {
    bootstrap.isShuttingDown = true;

    await bootstrap.stop();

    expect(orchestrator.stop).not.toHaveBeenCalled();
  });

  test('setup telegram callbacks wires dependencies and handles callback errors', async () => {
    bootstrap._setupTelegramCallbacks(logger, config);

    expect(callbackHandler.bot).toBeDefined();
    expect(callbackHandler.chatId).toBe(123);
    expect(callbackHandler.skipManager).toBe(skipManager);
    expect(callbackHandler.stateRepositoryFactory).toBe(stateRepositoryFactory);
    expect(callbackHandler.checkOutdatedReviewsUseCase).toBe(checkOutdatedReviewsUseCase);
    expect(callbackHandler.confirmationManager).toBe(confirmationManager);
    expect(confirmationManager.setBot).toHaveBeenCalled();
    expect(telegramAdapter.on).toHaveBeenCalledWith('callback_query', expect.any(Function));
    expect(telegramAdapter.on).toHaveBeenCalledWith('message', expect.any(Function));

    const callbackHandlerFn = telegramAdapter.on.mock.calls.find(([event]) => event === 'callback_query')[1];
    const messageHandlerFn = telegramAdapter.on.mock.calls.find(([event]) => event === 'message')[1];

    await messageHandlerFn({ text: '/status' });
    expect(commandHandler.handleCommand).toHaveBeenCalledWith({ text: '/status' }, config);

    callbackHandler.handleCallbackQuery.mockRejectedValueOnce(new Error('boom'));
    await callbackHandlerFn({ id: 'q1', data: 'x', message: { message_id: 99 } });
    expect(bot.answerCallbackQuery).toHaveBeenCalledWith('q1', { text: 'An error occurred', show_alert: true });
  });

  test('setup telegram callbacks skips when adapter is unavailable', () => {
    mockContainer.get.mockImplementation((name) => {
      if (name === 'telegramAdapter') return null;
      return ({
        logger,
        config,
        callbackHandler,
        commandHandler,
        skipManager,
        stateRepositoryFactory,
        checkOutdatedReviewsUseCase,
        confirmationManager
      })[name];
    });

    bootstrap._setupTelegramCallbacks(logger, config);

    expect(logger.info).toHaveBeenCalledWith('[Bootstrap] Telegram adapter unavailable; callbacks skipped');
  });

  test('wraps callback query with helper methods bound to bot and chat', async () => {
    const bot = {
      answerCallbackQuery: jest.fn().mockResolvedValue('answered'),
      editMessageText: jest.fn().mockResolvedValue('edited'),
      editMessageReplyMarkup: jest.fn().mockResolvedValue('markup')
    };
    const query = { id: 'cb1', message: { message_id: 7 } };

    const wrapped = bootstrap._wrapCallbackQuery(query, bot, 123);

    await wrapped.answer('ok', true);
    await wrapped.editMessageText('hello', { disable_web_page_preview: true });
    await wrapped.editMessageReplyMarkup({ inline_keyboard: [] });

    expect(bot.answerCallbackQuery).toHaveBeenCalledWith('cb1', { text: 'ok', show_alert: true });
    expect(bot.editMessageText).toHaveBeenCalledWith('hello', expect.objectContaining({
      chat_id: 123,
      message_id: 7,
      parse_mode: 'HTML'
    }));
    expect(bot.editMessageReplyMarkup).toHaveBeenCalledWith({ inline_keyboard: [] }, expect.objectContaining({
      chat_id: 123,
      message_id: 7
    }));
  });

  test('setup discord interactions forwards button interactions and handles responder errors', async () => {
    bootstrap._setupDiscordInteractions(logger, config);
    expect(discordAdapter.on).toHaveBeenCalledWith('interaction', expect.any(Function));

    const interactionHandler = discordAdapter.on.mock.calls[0][1];
    const interaction = { customId: 'payload' };
    await interactionHandler(interaction);

    expect(MockDiscordInteractionResponder).toHaveBeenCalledWith(interaction, { logger });
    expect(prActionHandler.handleDiscordInteraction).toHaveBeenCalledWith(
      interaction,
      expect.any(Object),
      config
    );

    prActionHandler.handleDiscordInteraction.mockRejectedValueOnce(new Error('fail'));
    const responder = { error: jest.fn().mockResolvedValue() };
    MockDiscordInteractionResponder.mockImplementationOnce(() => responder);
    MockDiscordInteractionResponder.mockImplementationOnce(() => responder);
    await interactionHandler(interaction);
    expect(responder.error).toHaveBeenCalledWith('An error occurred');
  });

  test('setup discord interactions returns early when adapter is unavailable', () => {
    mockContainer.get.mockImplementation((name) => {
      if (name === 'discordAdapter') return null;
      return ({ prActionHandler })[name];
    });

    bootstrap._setupDiscordInteractions(logger, config);

    expect(bootstrap._discordInteractionHandler).toBeNull();
  });

  test('starts memory monitor and triggers graceful shutdown on critical usage', async () => {
    const stopSpy = jest.spyOn(bootstrap, 'stop').mockResolvedValue();

    bootstrap._startMemoryMonitor(logger, config);

    expect(MemoryMonitorMock).toHaveBeenCalledWith(expect.objectContaining({
      memoryLimit: 256 * 1024 * 1024,
      intervalMs: 60000,
      onCritical: expect.any(Function)
    }));
    expect(bootstrap.memoryMonitor.start).toHaveBeenCalled();

    await bootstrap.memoryMonitor.onCritical('restart required', { heapUsed: 300 * 1024 * 1024 });

    expect(stopSpy).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  test('setup shutdown handlers registers SIGTERM and SIGINT listeners', async () => {
    const stopSpy = jest.spyOn(bootstrap, 'stop').mockResolvedValue();

    bootstrap._setupShutdownHandlers();

    expect(process.on).toHaveBeenCalledTimes(2);
    const sigtermHandler = process.on.mock.calls.find(([signal]) => signal === 'SIGTERM')[1];
    const sigintHandler = process.on.mock.calls.find(([signal]) => signal === 'SIGINT')[1];

    await sigtermHandler();
    await sigintHandler();

    expect(stopSpy).toHaveBeenCalledTimes(2);
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  test('getStatus and getContainer return current runtime state', () => {
    bootstrap.isShuttingDown = true;

    expect(bootstrap.getStatus()).toEqual(expect.objectContaining({
      isRunning: true,
      totalProcessed: 4,
      isShuttingDown: true
    }));
    expect(bootstrap.getContainer()).toBe(mockContainer);
  });
});
