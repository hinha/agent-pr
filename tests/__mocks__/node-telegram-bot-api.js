/**
 * Mock for node-telegram-bot-api
 * Used by telegramService for Telegram bot operations
 */

class MockTelegramBot {
  constructor(token, options = {}) {
    this.token = token;
    this.options = options;
    this.messageId = 1;
    this.eventHandlers = new Map();
  }

  // Mock sendMessage method
  sendMessage = jest.fn().mockImplementation((chatId, message, options = {}) => {
    return Promise.resolve({
      message_id: this.messageId++,
      chat: { id: chatId },
      date: Math.floor(Date.now() / 1000),
      text: message,
      ...options
    });
  });

  // Mock answerCallbackQuery method
  answerCallbackQuery = jest.fn().mockImplementation((callbackQueryId, options = {}) => {
    return Promise.resolve(true);
  });

  // Mock editMessageText method
  editMessageText = jest.fn().mockImplementation((text, options = {}) => {
    return Promise.resolve(true);
  });

  // Mock editMessageReplyMarkup method
  editMessageReplyMarkup = jest.fn().mockImplementation((replyMarkup, options = {}) => {
    return Promise.resolve(true);
  });

  // Mock deleteMessage method
  deleteMessage = jest.fn().mockImplementation((chatId, messageId) => {
    return Promise.resolve(true);
  });

  // Mock deleteWebhook method
  deleteWebhook = jest.fn().mockImplementation((options = {}) => {
    return Promise.resolve(true);
  });

  // Mock stopPolling method
  stopPolling = jest.fn().mockImplementation(() => {
    return Promise.resolve(true);
  });

  // Mock on method for event handlers
  on = jest.fn().mockImplementation((event, handler) => {
    this.eventHandlers.set(event, handler);
    return this;
  });

  // Mock off method for event handlers
  off = jest.fn().mockImplementation((event, handler) => {
    this.eventHandlers.delete(event);
    return this;
  });

  // Helper to trigger event handlers in tests
  __triggerEvent = function(event, data) {
    const handler = this.eventHandlers.get(event);
    if (handler) {
      handler(data);
    }
  };

  // Reset all mocks
  __resetMocks = function() {
    this.sendMessage.mockClear();
    this.answerCallbackQuery.mockClear();
    this.editMessageText.mockClear();
    this.editMessageReplyMarkup.mockClear();
    this.deleteMessage.mockClear();
    this.deleteWebhook.mockClear();
    this.stopPolling.mockClear();
    this.on.mockClear();
    this.off.mockClear();
  };
}

module.exports = MockTelegramBot;
