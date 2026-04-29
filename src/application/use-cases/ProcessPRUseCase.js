/**
 * ProcessPRUseCase - Application use case for processing a Pull Request
 *
 * This use case orchestrates the entire PR processing workflow:
 * 1. Analyze PR risk and impact
 * 2. Check if PR should be notified
 * 3. Update state machine
 * 4. Trigger notification if needed
 * 5. Emit domain events
 *
 * @example
 * const useCase = new ProcessPRUseCase(stateMachine, analyzer, notificationService, eventBus);
 * await useCase.execute(instance, repo, pullRequest);
 */

const PRStateMachine = require('../../core/services/PRStateMachine');
const { PRState } = PRStateMachine;

class ProcessPRUseCase {
  /**
   * @param {Object} stateMachine - PRStateMachine instance
   * @param {Object} analyzer - PRAnalyzerService instance
   * @param {Object} notificationService - NotificationService instance
   * @param {Object} eventBus - EventBus instance
   * @param {Object} options - Configuration options
   * @param {Object} options.logger - Logger instance
   */
  constructor(stateMachine, analyzer, notificationService, eventBus, options = {}) {
    this.stateMachine = stateMachine;
    this.analyzer = analyzer;
    this.notificationService = notificationService;
    this.eventBus = eventBus;
    this.logger = options.logger || console;
  }

  /**
   * Execute the PR processing use case
   *
   * @param {Object} instance - Instance configuration
   * @param {Object} repo - Repository configuration
   * @param {Object} pr - PullRequest entity
   * @param {Object} prDetails - PR details (files, changes, etc.)
   * @returns {Promise<Object>} Processing result
   */
  async execute(instance, repo, pr, prDetails) {
    const instanceKey = instance.key;
    const repoName = repo.name;
    const prNumber = pr.number;

    try {
      this.logger.info(
        `[ProcessPRUseCase] Processing PR #${prNumber} in ${instanceKey}/${repoName}`
      );

      // Step 1: Analyze PR risk and impact
      const analysis = this.analyzer.analyze(pr, prDetails);

      this.logger.debug(
        `[ProcessPRUseCase] PR #${prNumber} analysis: risk=${analysis.riskLevel}, ` +
        `impact=${analysis.impactArea}, recommendation=${analysis.recommendedReview}`
      );

      // Step 2: Check if PR is currently skipped
      const isSkipped = await this.stateMachine.isSkipped(instanceKey, repoName, prNumber);
      if (isSkipped) {
        this.logger.debug(`[ProcessPRUseCase] PR #${prNumber} is currently skipped`);
        return {
          prNumber,
          status: 'skipped',
          reason: 'Skip period active'
        };
      }

      // Step 3: Get current state and check if should notify
      const currentState = await this.stateMachine.getState(instanceKey, repoName, prNumber);
      const shouldNotify = await this.stateMachine.shouldNotify(instanceKey, repoName, prNumber, currentState);

      if (!shouldNotify) {
        this.logger.debug(
          `[ProcessPRUseCase] PR #${prNumber} should not be notified (state=${currentState})`
        );
        return {
          prNumber,
          status: 'already_processed',
          currentState,
          reason: 'Max notifications reached or terminal state'
        };
      }

      // Step 4: Transition to NOTIFIED state
      const transitionResult = await this.stateMachine.transition(
        instanceKey,
        repoName,
        prNumber,
        PRState.NOTIFIED,
        { analysis }
      );

      // Step 5: Send notification
      const notificationResult = await this.notificationService.sendPRNotification(
        instance,
        repo,
        pr,
        prDetails,
        analysis
      );

      // Step 6: Emit domain event
      await this.eventBus.emitAsync('pr.processed', {
        instanceKey,
        repoName,
        prNumber,
        analysis,
        notificationSent: notificationResult.success
      });

      this.logger.info(
        `[ProcessPRUseCase] PR #${prNumber} processed successfully ` +
        `(notification count: ${transitionResult.notificationCount})`
      );

      return {
        prNumber,
        status: 'processed',
        currentState: transitionResult.currentState,
        notificationCount: transitionResult.notificationCount,
        analysis,
        notificationSent: notificationResult.success
      };

    } catch (error) {
      this.logger.error(
        `[ProcessPRUseCase] Error processing PR #${prNumber}:`,
        error
      );

      // Emit error event
      await this.eventBus.emitAsync('error.occurred', {
        useCase: 'ProcessPRUseCase',
        prNumber,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Check if PR should be processed (pre-flight check)
   *
   * @param {Object} instance - Instance configuration
   * @param {Object} repo - Repository configuration
   * @param {Object} pr - PullRequest entity
   * @param {Object} instanceConfig - Instance configuration with maxAgeHours
   * @returns {Promise<Object>} Check result
   */
  async shouldProcess(instance, repo, pr, instanceConfig) {
    const instanceKey = instance.key;
    const repoName = repo.name;
    const prNumber = pr.number;

    // Check PR age
    const maxAgeMs = instanceConfig.maxAgeMs || (instanceConfig.maxAgeHours || 48) * 60 * 60 * 1000;
    const prAgeMs = typeof pr.getAgeInMs === 'function' ? pr.getAgeInMs() : (Date.now() - new Date(pr.createdAt).getTime());

    if (prAgeMs > maxAgeMs) {
      return {
        shouldProcess: false,
        reason: 'PR too old',
        prAgeHours: typeof pr.getAgeInHours === 'function' ? pr.getAgeInHours() : Math.floor(prAgeMs / (60 * 60 * 1000)),
        maxAgeHours: Math.floor(maxAgeMs / (60 * 60 * 1000))
      };
    }

    // Check if PR is a draft (check title for WIP indicators)
    const title = (pr.title || '').toLowerCase();
    const isDraft = title.includes('wip') || title.includes('draft') || title.includes('[wip]');

    if (isDraft) {
      return {
        shouldProcess: false,
        reason: 'PR is draft/WIP'
      };
    }

    // Check if already processed
    const currentState = await this.stateMachine.getState(instanceKey, repoName, prNumber);
    if (this.stateMachine.isTerminalState(currentState)) {
      return {
        shouldProcess: false,
        reason: 'PR in terminal state',
        currentState
      };
    }

    return {
      shouldProcess: true
    };
  }

  /**
   * Batch process multiple PRs
   *
   * @param {Object} instance - Instance configuration
   * @param {Object} repo - Repository configuration
   * @param {Array} prs - Array of PRs with details
   * @returns {Promise<Array>} Array of processing results
   */
  async executeBatch(instance, repo, prs) {
    const results = [];

    for (const { pr, prDetails } of prs) {
      try {
        const result = await this.execute(instance, repo, pr, prDetails);
        results.push(result);
      } catch (error) {
        results.push({
          prNumber: pr.number,
          status: 'error',
          error: error.message
        });
      }
    }

    return results;
  }
}

module.exports = ProcessPRUseCase;
