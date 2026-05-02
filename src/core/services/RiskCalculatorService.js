/**
 * RiskCalculatorService - Domain service for calculating PR risk levels
 *
 * This service encapsulates the business logic for determining the risk
 * associated with a pull request based on various factors.
 *
 * @example
 * const calculator = new RiskCalculatorService();
 * const risk = calculator.calculateRisk(filesChanged, totalChanges, files);
 */

/**
 * Risk levels supported by the calculator
 * @readonly
 * @enum {string}
 */
const RiskLevel = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high'
};

class RiskCalculatorService {
  /**
   * Default thresholds for risk calculation
   * @type {Object}
   */
  static DEFAULT_THRESHOLDS = {
    HIGH_RISK_FILE_COUNT: 15,
    HIGH_RISK_TOTAL_CHANGES: 500,
    MEDIUM_RISK_FILE_COUNT: 5,
    MEDIUM_RISK_TOTAL_CHANGES: 100,
    LARGE_FILE_CHANGES: 500
  };

  /**
   * High-risk file patterns
   * @type {string[]}
   */
  static HIGH_RISK_PATTERNS = [
    'migration',
    'auth',
    'security',
    'password'
  ];

  /**
   * @param {Object} options - Configuration options
   * @param {Object} options.thresholds - Custom thresholds for risk calculation
   */
  constructor(options = {}) {
    this.thresholds = {
      ...RiskCalculatorService.DEFAULT_THRESHOLDS,
      ...(options.thresholds || {})
    };
  }

  /**
   * Calculate risk level based on PR size and characteristics
   *
   * @param {number} filesChanged - Number of files changed
   * @param {number} totalChanges - Total number of line changes
   * @param {Array<Object>} files - Array of file change objects
   * @returns {string} Risk level (low, medium, or high)
   */
  calculateRisk(filesChanged, totalChanges, files = []) {
    // Check high risk conditions first
    if (this._isHighRiskBySize(filesChanged, totalChanges)) {
      return RiskLevel.HIGH;
    }

    if (this._isHighRiskByPatterns(files)) {
      return RiskLevel.HIGH;
    }

    // Check medium risk conditions
    if (this._isMediumRisk(filesChanged, totalChanges)) {
      return RiskLevel.MEDIUM;
    }

    // Default to low risk
    return RiskLevel.LOW;
  }

  /**
   * Check if PR is high risk based on size alone
   * @private
   * @param {number} filesChanged - Number of files changed
   * @param {number} totalChanges - Total number of line changes
   * @returns {boolean}
   */
  _isHighRiskBySize(filesChanged, totalChanges) {
    return filesChanged > this.thresholds.HIGH_RISK_FILE_COUNT ||
           totalChanges > this.thresholds.HIGH_RISK_TOTAL_CHANGES;
  }

  /**
   * Check if PR is high risk based on file patterns
   * @private
   * @param {Array<Object>} files - Array of file change objects
   * @returns {boolean}
   */
  _isHighRiskByPatterns(files) {
    return files.some(file => {
      const filename = file.filename ? file.filename.toLowerCase() : '';
      return RiskCalculatorService.HIGH_RISK_PATTERNS.some(pattern =>
        filename.includes(pattern)
      );
    });
  }

  /**
   * Check if PR is medium risk
   * @private
   * @param {number} filesChanged - Number of files changed
   * @param {number} totalChanges - Total number of line changes
   * @returns {boolean}
   */
  _isMediumRisk(filesChanged, totalChanges) {
    return filesChanged >= this.thresholds.MEDIUM_RISK_FILE_COUNT ||
           totalChanges >= this.thresholds.MEDIUM_RISK_TOTAL_CHANGES;
  }

  /**
   * Check if a specific file represents high risk
   * @param {Object} file - File change object
   * @returns {boolean}
   */
  isHighRiskFile(file) {
    const filename = file.filename ? file.filename.toLowerCase() : '';
    return RiskCalculatorService.HIGH_RISK_PATTERNS.some(pattern =>
      filename.includes(pattern)
    );
  }

  /**
   * Check if a file has excessive changes
   * @param {Object} file - File change object
   * @returns {boolean}
   */
  isLargeFileChange(file) {
    return (file.changes || 0) > this.thresholds.LARGE_FILE_CHANGES;
  }

  /**
   * Get risk score (0-100) for more granular assessment
   * @param {number} filesChanged - Number of files changed
   * @param {number} totalChanges - Total number of line changes
   * @param {Array<Object>} files - Array of file change objects
   * @returns {number} Risk score from 0 (low) to 100 (high)
   */
  calculateRiskScore(filesChanged, totalChanges, files = []) {
    let score = 0;

    // Size-based scoring (0-50 points)
    const sizeScore = Math.min(
      (filesChanged / this.thresholds.HIGH_RISK_FILE_COUNT) * 25 +
      (totalChanges / this.thresholds.HIGH_RISK_TOTAL_CHANGES) * 25,
      50
    );
    score += sizeScore;

    // Pattern-based scoring (0-50 points)
    let patternScore = 0;
    if (this._isHighRiskByPatterns(files)) {
      patternScore += 30;
    }
    if (files.some(f => this.isLargeFileChange(f))) {
      patternScore += 20;
    }
    score += patternScore;

    return Math.min(Math.round(score), 100);
  }

  /**
   * Validate if risk level is valid
   * @param {string} riskLevel - Risk level to validate
   * @returns {boolean}
   */
  isValidRiskLevel(riskLevel) {
    return Object.values(RiskLevel).includes(riskLevel);
  }

  /**
   * Get numeric risk weight for comparison
   * @param {string} riskLevel - Risk level
   * @returns {number} Numeric weight (0=low, 1=medium, 2=high)
   */
  getRiskWeight(riskLevel) {
    const weights = {
      [RiskLevel.LOW]: 0,
      [RiskLevel.MEDIUM]: 1,
      [RiskLevel.HIGH]: 2
    };
    return weights[riskLevel] || 0;
  }

  /**
   * Compare two risk levels
   * @param {string} risk1 - First risk level
   * @param {string} risk2 - Second risk level
   * @returns {number} Negative if risk1 < risk2, positive if risk1 > risk2, 0 if equal
   */
  compareRisk(risk1, risk2) {
    return this.getRiskWeight(risk1) - this.getRiskWeight(risk2);
  }
}

// Export risk levels as constants
RiskCalculatorService.RiskLevel = RiskLevel;

module.exports = RiskCalculatorService;
