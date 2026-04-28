/**
 * Container Binding Constants
 *
 * Centralized location for dependency names to avoid string literals
 * throughout the codebase.
 */

const BINDINGS = {
  // Core
  CONFIG: 'config',
  LOGGER: 'logger',
  RETRY_HELPER: 'retryHelper',
  ERROR_HANDLER: 'errorHandler',
  EVENT_BUS: 'eventBus',

  // Existing Services (Legacy - being phased out)
  YAML_CONFIG: 'yamlConfig',
  TIMEOUT_MANAGER: 'timeoutManager',
  TIME_UTILS: 'timeUtils',
  MEMORY_MONITOR: 'memoryMonitor',

  FLAGSMITH_SYNC_SERVICE: 'flagsmithSyncService',

  // Clean Architecture - Domain Layer
  PR_ANALYZER_SERVICE: 'prAnalyzerService',
  RISK_CALCULATOR_SERVICE: 'riskCalculatorService',
  PR_STATE_MACHINE: 'prStateMachine',

  // Clean Architecture - Application Layer
  PROCESS_PR_USE_CASE: 'processPRUseCase',
  SEND_NOTIFICATION_USE_CASE: 'sendNotificationUseCase',
  REVIEW_PR_USE_CASE: 'reviewPRUseCase',
  CHECK_OUTDATED_REVIEWS_USE_CASE: 'checkOutdatedReviewsUseCase',

  PR_PROCESSING_ORCHESTRATOR: 'prProcessingOrchestrator',
  REVIEW_ORCHESTRATOR: 'reviewOrchestrator',
  STATE_COORDINATION_SERVICE: 'stateCoordinationService',
  UNIFIED_STATE_SERVICE: 'unifiedStateService',

  // Clean Architecture - Infrastructure Layer
  GITHUB_ADAPTER: 'githubAdapter',
  TELEGRAM_ADAPTER: 'telegramAdapter',
  AGENT_ADAPTER: 'agentAdapter',

  STATE_REPOSITORY: 'stateRepository',
  SKIP_REPOSITORY: 'skipRepository',
  REVIEW_REPOSITORY: 'reviewRepository'
};

module.exports = BINDINGS;
