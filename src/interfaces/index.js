/**
 * Export all interface definitions
 */

const IGitHubService = require('./IGitHubService');
const ITelegramService = require('./ITelegramService');
const IAgentService = require('./IAgentService');
const IStateRepository = require('./IStateRepository');

module.exports = {
  IGitHubService,
  ITelegramService,
  IAgentService,
  IStateRepository
};
