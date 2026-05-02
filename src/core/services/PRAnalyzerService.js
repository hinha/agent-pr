/**
 * PRAnalyzerService - Domain service for analyzing Pull Requests
 *
 * This service provides comprehensive analysis of pull requests including
 * risk assessment, impact area determination, and suspicious pattern detection.
 * It uses domain entities and other domain services for analysis.
 *
 * @example
 * const analyzer = new PRAnalyzerService(riskCalculator);
 * const analysis = analyzer.analyze(pullRequest, fileChanges);
 */

const RiskCalculatorService = require('./RiskCalculatorService');

/**
 * Impact areas that can be affected by a PR
 * @readonly
 * @enum {string}
 */
const ImpactArea = {
  DATABASE: 'database',
  SECURITY: 'security',
  API_PRESENTATION: 'api_presentation',
  API_APPLICATION: 'api_application',
  API_DOMAIN: 'api_domain',
  API_INFRASTRUCTURE: 'api_infrastructure',
  API: 'api',
  UI: 'ui',
  MOBILE: 'mobile',
  BACKEND: 'backend',
  CONFIG: 'config',
  CORE: 'core',
  DOMAIN: 'domain',
  ARCHITECTURE: 'architecture'
};

/**
 * Review recommendations based on analysis
 * @readonly
 * @enum {string}
 */
const ReviewRecommendation = {
  CRITICAL: 'critical review',
  ATTENTION: 'requires attention',
  SAFE: 'safe review',
  LATER: 'review later'
};

/**
 * Suspicious patterns that can be detected
 * @readonly
 * @enum {string}
 */
const SuspiciousPattern = {
  DATABASE_MIGRATION: 'database_migration',
  SECURITY_CHANGES: 'security_changes',
  LARGE_FILE_CHANGES: 'large_file_changes',
  TEST_COVERAGE_REDUCED: 'test_coverage_reduced',
  CONFIG_CHANGES: 'config_changes',
  DEPENDENCY_UPDATE: 'dependency_update',
  BUILD_SYSTEM_CHANGES: 'build_system_changes',
  API_CONTRACT_CHANGES: 'api_contract_changes',
  INFRASTRUCTURE_CHANGES: 'infrastructure_changes',
  ARCHITECTURE_VIOLATION: 'architecture_violation'
};

/**
 * Architecture pattern definitions for context-aware analysis
 * @type {Object}
 */
const ARCHITECTURE_PATTERNS = {
  layered: {
    name: 'Layered/N-tier Architecture',
    type: 'backend',
    indicators: ['/controllers/', '/routes/', '/services/', '/repositories/', '/models/']
  },
  clean: {
    name: 'Clean Architecture',
    type: 'backend',
    indicators: ['/entities/', '/usecases/', '/use-cases/', '/interactors/', '/presenters/', '/gateways/']
  },
  onion: {
    name: 'Onion Architecture',
    type: 'backend',
    indicators: ['/domain/', '/application/', '/infrastructure/', '/presentation/', '/core/']
  },
  hexagonal: {
    name: 'Hexagonal/Ports & Adapters',
    type: 'backend',
    indicators: ['/ports/', '/adapters/', '/in/', '/out/', '/primary/', '/secondary/']
  },
  ddd: {
    name: 'Domain-Driven Design',
    type: 'backend',
    indicators: ['/domain/', '/aggregates/', '/entities/', '/valueobjects/', '/repositories/']
  },
  cqrs: {
    name: 'CQRS',
    type: 'backend',
    indicators: ['/commands/', '/queries/', '/handlers/', '/commandhandlers/', '/queryhandlers/']
  },
  mvvm_mobile: {
    name: 'MVVM (Mobile)',
    type: 'mobile',
    indicators: ['viewmodel', 'observable', 'livedata', 'stateflow']
  },
  mvi: {
    name: 'MVI (Model-View-Intent)',
    type: 'mobile',
    indicators: ['intent', 'reducer', 'state', 'effect']
  },
  component_based: {
    name: 'Component-Based Architecture',
    type: 'frontend',
    indicators: ['/components/', '/atoms/', '/molecules/', '/organisms/', '/templates/']
  },
  flux_redux: {
    name: 'Flux/Redux Architecture',
    type: 'frontend',
    indicators: ['/store/', '/actions/', '/reducers/', '/sagas/', '/middlewares/']
  }
};

class PRAnalyzerService {
  /**
   * @param {RiskCalculatorService} riskCalculator - Risk calculator service
   * @param {Object} options - Configuration options
   * @param {Object} options.logger - Logger instance
   */
  constructor(riskCalculator, options = {}) {
    this.riskCalculator = riskCalculator || new RiskCalculatorService();
    this.logger = options.logger || console;
  }

  /**
   * Analyze a pull request comprehensively
   *
   * @param {Object} pr - Pull request data
   * @param {Object} prDetails - PR details including files
   * @param {Array} prDetails.files - Array of file changes
   * @param {number} prDetails.filesChanged - Number of files changed
   * @param {number} prDetails.totalChanges - Total line changes
   * @returns {Object} Analysis result
   */
  analyze(pr, prDetails) {
    const { files, filesChanged, totalChanges } = prDetails;

    // Detect dominant architecture for context-aware analysis
    const dominantArchitecture = this._detectDominantArchitecture(files);

    // Calculate risk level
    const riskLevel = this.riskCalculator.calculateRisk(filesChanged, totalChanges, files);

    // Determine impact area
    const impactArea = this._determineImpactArea(files, dominantArchitecture);

    // Get recommended review
    const recommendedReview = this._getRecommendedReview(riskLevel, impactArea, pr);

    // Detect suspicious patterns
    const suspiciousPatterns = this._detectSuspiciousPatterns(files, pr);

    // Log analysis for debugging
    const archInfo = dominantArchitecture
      ? `arch=${(ARCHITECTURE_PATTERNS[dominantArchitecture] && ARCHITECTURE_PATTERNS[dominantArchitecture].name) || dominantArchitecture}`
      : 'arch=unknown';

    this.logger.debug(
      `[PRAnalyzer] PR #${pr.number}: ${archInfo}, risk=${riskLevel}, ` +
      `impact=${impactArea}, review=${recommendedReview}, ` +
      `patterns=${suspiciousPatterns.join(',') || 'none'}`
    );

    return {
      riskLevel,
      impactArea,
      recommendedReview,
      suspiciousPatterns,
      dominantArchitecture,
      riskScore: this.riskCalculator.calculateRiskScore(filesChanged, totalChanges, files)
    };
  }

  /**
   * Detect the dominant architecture pattern from file paths
   * @private
   * @param {Array<Object>} files - Array of file change objects
   * @returns {string|null} Dominant architecture key or null
   */
  _detectDominantArchitecture(files) {
    const patternScores = {};

    for (const file of files) {
      const filename = file.filename ? file.filename.toLowerCase() : '';

      for (const [key, pattern] of Object.entries(ARCHITECTURE_PATTERNS)) {
        for (const indicator of pattern.indicators) {
          if (filename.includes(indicator.toLowerCase())) {
            patternScores[key] = (patternScores[key] || 0) + 1;
            break;
          }
        }
      }
    }

    if (Object.keys(patternScores).length === 0) {
      return null;
    }

    // Return pattern with highest score
    return Object.entries(patternScores)
      .sort(([, a], [, b]) => b - a)[0][0];
  }

  /**
   * Determine the impact area based on files changed
   * @private
   * @param {Array<Object>} files - Array of file change objects
   * @param {string|null} dominantArchitecture - Detected architecture
   * @returns {string} Dominant impact area
   */
  _determineImpactArea(files, dominantArchitecture) {
    const impactAreas = {
      database: 0,
      security: 0,
      api_presentation: 0,
      api_application: 0,
      api_domain: 0,
      api_infrastructure: 0,
      ui: 0,
      mobile: 0,
      backend: 0,
      config: 0,
      architecture: 0
    };

    for (const file of files) {
      const filename = file.filename ? file.filename.toLowerCase() : '';

      // Database impact
      if (this._matchesAny(filename, ['migration', 'schema', '/models/', 'sequelize', 'prisma', '.sql', 'gorm'])) {
        impactAreas.database++;
      }

      // Security impact
      if (this._matchesAny(filename, ['auth', 'security', 'password', 'jwt', 'session', 'permission', 'authorization'])) {
        impactAreas.security++;
      }

      // Architecture-aware API impact
      const apiImpacts = this._detectAPIImpact(filename, dominantArchitecture);
      if (apiImpacts.presentation) impactAreas.api_presentation++;
      if (apiImpacts.application) impactAreas.api_application++;
      if (apiImpacts.domain) impactAreas.api_domain++;
      if (apiImpacts.infrastructure) impactAreas.api_infrastructure++;

      // UI impact
      if (this._matchesAny(filename, ['component', '/views/', '/pages/', '/templates/']) ||
          this._endsWithAny(filename, ['.jsx', '.tsx', '.vue', '.svelte'])) {
        impactAreas.ui++;
      }

      // Mobile impact
      if (this._matchesAny(filename, ['android/', 'ios/', '/mobile/']) ||
          this._hasMobileArchitecture(filename)) {
        impactAreas.mobile++;
      }

      // Backend impact
      if (this._hasBackendArchitecture(filename)) {
        impactAreas.backend++;
      }

      // Config impact
      if (this._matchesAny(filename, ['config', '.env', 'docker', 'webpack', 'vite'])) {
        impactAreas.config++;
      }

      // Architecture impact
      if (this._matchesAny(filename, ['/ports/', '/adapters/', '/interactors/'])) {
        impactAreas.architecture++;
      }
    }

    // Aggregate API impact
    const totalAPIImpact = impactAreas.api_presentation +
                          impactAreas.api_application +
                          impactAreas.api_domain +
                          impactAreas.api_infrastructure;

    const simplifiedImpacts = {
      database: impactAreas.database,
      security: impactAreas.security,
      api: totalAPIImpact,
      ui: impactAreas.ui,
      mobile: impactAreas.mobile,
      backend: impactAreas.backend,
      config: impactAreas.config,
      core: 0,
      domain: impactAreas.api_domain,
      architecture: impactAreas.architecture
    };

    // Find dominant impact area
    const maxImpact = Math.max(...Object.values(simplifiedImpacts));
    const areasWithMax = Object.keys(simplifiedImpacts).filter(area => simplifiedImpacts[area] === maxImpact);

    // If mixed areas or no impact, return 'core'
    if (areasWithMax.length > 2 || maxImpact === 0) {
      return ImpactArea.CORE;
    }

    // Return dominant area
    return areasWithMax[0];
  }

  /**
   * Detect API impact based on architecture
   * @private
   * @param {string} filename - File path
   * @param {string|null} dominantArchitecture - Detected architecture
   * @returns {Object} Impact areas
   */
  _detectAPIImpact(filename, dominantArchitecture) {
    const impacts = {
      presentation: false,
      application: false,
      domain: false,
      infrastructure: false
    };

    switch (dominantArchitecture) {
      case 'layered':
        if (this._matchesAny(filename, ['/controller', '/routes/', '/api/'])) {
          impacts.presentation = true;
        }
        if (this._matchesAny(filename, ['/service'])) {
          impacts.application = true;
        }
        if (this._matchesAny(filename, ['/repository', '/dao'])) {
          impacts.infrastructure = true;
        }
        break;

      case 'clean':
      case 'onion':
        if (this._matchesAny(filename, ['/presentation'])) {
          impacts.presentation = true;
        }
        if (this._matchesAny(filename, ['/application', '/usecase', '/interactor'])) {
          impacts.application = true;
        }
        if (this._matchesAny(filename, ['/domain', '/entity'])) {
          impacts.domain = true;
        }
        if (this._matchesAny(filename, ['/infrastructure', '/gateway'])) {
          impacts.infrastructure = true;
        }
        break;

      case 'hexagonal':
        if (this._matchesAny(filename, ['/primary'])) {
          impacts.presentation = true;
        }
        if (this._matchesAny(filename, ['/ports', 'port'])) {
          impacts.infrastructure = true;
        }
        if (this._matchesAny(filename, ['/secondary'])) {
          impacts.infrastructure = true;
        }
        break;

      default:
        // Generic detection
        if (this._matchesAny(filename, ['controller', '/routes/', '/api/'])) {
          impacts.presentation = true;
        }
        if (this._matchesAny(filename, ['service', 'handler'])) {
          impacts.application = true;
        }
        if (this._matchesAny(filename, ['repository', 'dao'])) {
          impacts.infrastructure = true;
        }
    }

    return impacts;
  }

  /**
   * Get recommended review based on risk and impact
   * @private
   * @param {string} riskLevel - Calculated risk level
   * @param {string} impactArea - Determined impact area
   * @param {Object} pr - Pull request data
   * @returns {string} Review recommendation
   */
  _getRecommendedReview(riskLevel, impactArea, pr) {
    // Check if PR is a draft or WIP
    const title = (pr.title || '').toLowerCase();
    const description = (pr.description || pr.body || '').toLowerCase();
    const isDraft = title.includes('wip') ||
                    title.includes('draft') ||
                    title.includes('[wip]') ||
                    description.includes('wip') ||
                    pr.draft;

    if (isDraft) {
      return ReviewRecommendation.LATER;
    }

    // Critical review conditions
    if (riskLevel === RiskCalculatorService.RiskLevel.HIGH ||
        impactArea === ImpactArea.SECURITY ||
        impactArea === ImpactArea.DATABASE ||
        impactArea === ImpactArea.MOBILE ||
        impactArea === ImpactArea.CONFIG ||
        impactArea === ImpactArea.DOMAIN ||
        impactArea === ImpactArea.ARCHITECTURE ||
        (impactArea === ImpactArea.BACKEND && riskLevel === RiskCalculatorService.RiskLevel.MEDIUM)) {
      return ReviewRecommendation.CRITICAL;
    }

    // Requires attention for medium risk with specific impacts
    if (riskLevel === RiskCalculatorService.RiskLevel.MEDIUM &&
        (impactArea === ImpactArea.API ||
         impactArea === ImpactArea.UI ||
         impactArea === ImpactArea.BACKEND ||
         impactArea === ImpactArea.CORE)) {
      return ReviewRecommendation.ATTENTION;
    }

    // Default to safe review
    return ReviewRecommendation.SAFE;
  }

  /**
   * Detect suspicious patterns in files
   * @private
   * @param {Array<Object>} files - Array of file change objects
   * @param {Object} pr - Pull request data
   * @returns {Array<string>} Detected suspicious patterns
   */
  _detectSuspiciousPatterns(files, pr) {
    const patterns = [];

    // Database migration
    if (files.some(f => f.filename && f.filename.includes('migration'))) {
      patterns.push(SuspiciousPattern.DATABASE_MIGRATION);
    }

    // Security/auth changes
    if (files.some(f => this.riskCalculator.isHighRiskFile(f))) {
      patterns.push(SuspiciousPattern.SECURITY_CHANGES);
    }

    // Large file changes
    if (files.some(f => this.riskCalculator.isLargeFileChange(f))) {
      patterns.push(SuspiciousPattern.LARGE_FILE_CHANGES);
    }

    // Test coverage reduced
    const removedTests = files.filter(f =>
      this._isTestFile(f) &&
      (f.status === 'deleted' || (f.deletions > f.additions && f.deletions > 50))
    );
    if (removedTests.length > 0) {
      patterns.push(SuspiciousPattern.TEST_COVERAGE_REDUCED);
    }

    // Config changes
    if (files.some(f => this._matchesAny(f.filename ? f.filename.toLowerCase() : '', ['config', '.env', 'docker', 'makefile']))) {
      patterns.push(SuspiciousPattern.CONFIG_CHANGES);
    }

    // Dependency changes
    if (files.some(f => this._isDependencyFile(f.filename ? f.filename.toLowerCase() : ''))) {
      patterns.push(SuspiciousPattern.DEPENDENCY_UPDATE);
    }

    // Build system changes
    if (files.some(f => this._matchesAny(f.filename ? f.filename.toLowerCase() : '', ['makefile', 'cmake', 'dockerfile', 'webpack', 'vite']))) {
      patterns.push(SuspiciousPattern.BUILD_SYSTEM_CHANGES);
    }

    // API contract changes
    if (files.some(f => this._matchesAny(f.filename ? f.filename.toLowerCase() : '', ['openapi', 'swagger', 'graphql', 'proto']))) {
      patterns.push(SuspiciousPattern.API_CONTRACT_CHANGES);
    }

    // Infrastructure changes
    if (files.some(f => this._matchesAny(f.filename ? f.filename.toLowerCase() : '', ['terraform', 'kubernetes', 'k8s', 'helm', 'ansible']))) {
      patterns.push(SuspiciousPattern.INFRASTRUCTURE_CHANGES);
    }

    // Architecture violations
    if (files.some(f => this._isArchitectureViolation(f.filename ? f.filename.toLowerCase() : ''))) {
      patterns.push(SuspiciousPattern.ARCHITECTURE_VIOLATION);
    }

    return patterns;
  }

  /**
   * Check if a file is a test file
   * @private
   * @param {Object} file - File change object
   * @returns {boolean}
   */
  _isTestFile(file) {
    const filename = file.filename ? file.filename.toLowerCase() : '';

    return filename.endsWith('_test.go') ||
           filename.includes('.test.') ||
           filename.includes('.spec.') ||
           filename.includes('/test/') ||
           filename.includes('/tests/') ||
           filename.includes('/__tests__/');
  }

  /**
   * Check if a file is a dependency file
   * @private
   * @param {string} filename - File path
   * @returns {boolean}
   */
  _isDependencyFile(filename) {
    const dependencyFiles = [
      'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
      'requirements.txt', 'setup.py', 'pyproject.toml', 'pipfile', 'poetry.lock',
      'go.mod', 'go.sum', 'pom.xml', 'build.gradle', 'build.gradle.kts',
      'gemfile', 'gemfile.lock', 'composer.json', 'composer.lock'
    ];

    return dependencyFiles.some(dep => filename.endsWith(dep) || filename.includes(dep));
  }

  /**
   * Check if a file represents an architecture violation
   * @private
   * @param {string} filename - File path
   * @returns {boolean}
   */
  _isArchitectureViolation(filename) {
    // UI importing from DB layer
    if (filename.includes('component') && (filename.includes('repository') || filename.includes('dao'))) {
      return true;
    }

    // Domain depending on infrastructure
    if (filename.includes('/domain/') && (filename.includes('http') || filename.includes('database'))) {
      return true;
    }

    return false;
  }

  /**
   * Check if filename matches any of the patterns
   * @private
   * @param {string} filename - File path
   * @param {Array<string>} patterns - Patterns to match
   * @returns {boolean}
   */
  _matchesAny(filename, patterns) {
    return patterns.some(pattern => filename.includes(pattern));
  }

  /**
   * Check if filename ends with any of the patterns
   * @private
   * @param {string} filename - File path
   * @param {Array<string>} patterns - Patterns to match
   * @returns {boolean}
   */
  _endsWithAny(filename, patterns) {
    return patterns.some(pattern => filename.endsWith(pattern));
  }

  /**
   * Check if file has mobile architecture indicators
   * @private
   * @param {string} filename - File path
   * @returns {boolean}
   */
  _hasMobileArchitecture(filename) {
    for (const pattern of Object.values(ARCHITECTURE_PATTERNS)) {
      if (pattern.type === 'mobile') {
        if (pattern.indicators.some(indicator => filename.includes(indicator.toLowerCase()))) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check if file has backend architecture indicators
   * @private
   * @param {string} filename - File path
   * @returns {boolean}
   */
  _hasBackendArchitecture(filename) {
    for (const pattern of Object.values(ARCHITECTURE_PATTERNS)) {
      if (pattern.type === 'backend') {
        if (pattern.indicators.some(indicator => filename.includes(indicator.toLowerCase()))) {
          return true;
        }
      }
    }
    return false;
  }
}

// Export enums
PRAnalyzerService.ImpactArea = ImpactArea;
PRAnalyzerService.ReviewRecommendation = ReviewRecommendation;
PRAnalyzerService.SuspiciousPattern = SuspiciousPattern;
PRAnalyzerService.ARCHITECTURE_PATTERNS = ARCHITECTURE_PATTERNS;

module.exports = PRAnalyzerService;
