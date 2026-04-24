const logger = require('./logger');

/**
 * Architecture pattern definitions
 * Each pattern has specific folder structures and file naming conventions
 */
const ARCHITECTURE_PATTERNS = {
  // Backend Architectures
  layered: {
    name: 'Layered/N-tier Architecture',
    type: 'backend',
    indicators: [
      '/controllers/', '/routes/', '/services/', '/repositories/', '/models/',
      'controller', 'service', 'repository', 'dao'
    ],
    structure: 'presentation → business → data → database'
  },

  clean: {
    name: 'Clean Architecture',
    type: 'backend',
    indicators: [
      '/entities/', '/usecases/', '/use-cases/', '/use_cases/',
      '/interactors/', '/presenters/', '/gateways/', '/interface/',
      'usecase', 'use-case', 'use_case', 'interactor', 'gateway'
    ],
    structure: 'entities → use cases → interface adapters → frameworks'
  },

  onion: {
    name: 'Onion Architecture',
    type: 'backend',
    indicators: [
      '/domain/', '/application/', '/infrastructure/', '/presentation/',
      '/core/', '/domainmodel/', 'domainmodel', 'domain-entity'
    ],
    structure: 'domain → application → infrastructure → presentation'
  },

  hexagonal: {
    name: 'Hexagonal/Ports & Adapters',
    type: 'backend',
    indicators: [
      '/ports/', '/adapters/', '/in/', '/out/', '/primary/', '/secondary/',
      'port', 'adapter', 'inbound', 'outbound'
    ],
    structure: 'application core surrounded by ports and adapters'
  },

  ddd: {
    name: 'Domain-Driven Design',
    type: 'backend',
    indicators: [
      '/domain/', '/aggregates/', '/entities/', '/valueobjects/',
      '/value-objects/', '/value_objects/', '/repositories/', '/services/',
      'aggregate', 'valueobject', 'value-object', 'value_object'
    ],
    structure: 'domain model with bounded contexts'
  },

  cqrs: {
    name: 'CQRS',
    type: 'backend',
    indicators: [
      '/commands/', '/queries/', '/handlers/', '/commandhandlers/',
      '/command-handlers/', '/queryhandlers/', '/query-handlers/',
      'command', 'query', 'commandhandler', 'queryhandler'
    ],
    structure: 'command and query separation'
  },

  // Mobile Architectures
  mvvm_mobile: {
    name: 'MVVM (Mobile)',
    type: 'mobile',
    indicators: [
      'viewmodel', 'view-model', 'observable', 'livedata',
      'stateflow', 'flow', 'mutablestateflow', 'compose'
    ],
    structure: 'View → ViewModel → Model'
  },

  mvi: {
    name: 'MVI (Model-View-Intent)',
    type: 'mobile',
    indicators: [
      'intent', 'reducer', 'state', 'effect',
      'unidirectional', 'single-source-of-truth'
    ],
    structure: 'View → Intent → Reducer → State → View'
  },

  mvc: {
    name: 'MVC (Model-View-Controller)',
    type: 'mobile',
    indicators: [
      '/controllers/', '/views/', '/models/',
      'controller', 'viewcontroller', 'activity', 'fragment'
    ],
    structure: 'View ↔ Controller ↔ Model'
  },

  vip: {
    name: 'VIP (View-Interactor-Presenter)',
    type: 'mobile',
    indicators: [
      'interactor', 'presenter', 'router', 'vip',
      'viewconfigurator'
    ],
    structure: 'View → Interactor → Presenter → Router'
  },

  redux_mobile: {
    name: 'Redux/Flux (Mobile)',
    type: 'mobile',
    indicators: [
      'redux', 'store', 'dispatch', 'reducer',
      'action', 'middleware', 'selector'
    ],
    structure: 'View → Action → Reducer → Store → View'
  },

  // Frontend Architectures
  mvvm_frontend: {
    name: 'MVVM (Frontend)',
    type: 'frontend',
    indicators: [
      'viewmodel', 'observable', 'reactive', 'binding',
      'computed', 'watch', 'props', 'emit'
    ],
    structure: 'View ↔ ViewModel ↔ Model'
  },

  component_based: {
    name: 'Component-Based Architecture',
    type: 'frontend',
    indicators: [
      '/components/', '/atoms/', '/molecules/', '/organisms/',
      '/templates/', '/pages/', '/hooks/', '/composables/',
      'component', 'hook', 'composable', 'atomic'
    ],
    structure: 'atomic design pattern'
  },

  micro_frontend: {
    name: 'Micro-Frontend Architecture',
    type: 'frontend',
    indicators: [
      '/micro-frontends/', '/modules/', '/federated/',
      'modulefederation', 'remote', 'host', 'shell'
    ],
    structure: 'independently deployable frontend modules'
  },

  flux_redux: {
    name: 'Flux/Redux Architecture',
    type: 'frontend',
    indicators: [
      '/store/', '/stores/', '/actions/', '/reducers/',
      '/sagas/', '/middlewares/', 'redux', 'vuex', 'pinia',
      'dispatch', 'commit', 'mutation'
    ],
    structure: 'unidirectional data flow'
  },

  // Cross-Platform
  react_native: {
    name: 'React Native',
    type: 'mobile',
    indicators: [
      'react-native', '@react-native', '.android.', '.ios.',
      '/android/', '/ios/', '/src/screens/', '/src/navigation/',
      'navigation', 'tabnavigator', 'stacknavigator'
    ],
    structure: 'cross-platform mobile with native bridges'
  },

  flutter: {
    name: 'Flutter',
    type: 'mobile',
    indicators: [
      '/lib/', '/lib/screens/', '/lib/widgets/', '/lib/models/',
      '/lib/services/', 'materialapp', 'widget', 'statefulwidget',
      'statelesswidget', 'bloc', 'cubit', 'riverpod', 'provider'
    ],
    structure: 'widget-based reactive UI'
  },

  // Architecture Detection by Language/Framework
  spring_boot: {
    name: 'Spring Boot Architecture',
    type: 'backend',
    indicators: [
      '/src/main/java/', '/controller/', '/service/', '/repository/',
      '@controller', '@service', '@repository', '@entity', '@dto'
    ],
    structure: 'Java enterprise layered architecture'
  },

  nestjs: {
    name: 'NestJS Architecture',
    type: 'backend',
    indicators: [
      '/src/', '/src/controllers/', '/src/services/', '/src/modules/',
      '@controller', '@injectable', '@module', 'decorator'
    ],
    structure: 'Node.js modular architecture with DI'
  },

  go_clean: {
    name: 'Go Clean Architecture',
    type: 'backend',
    indicators: [
      '/cmd/', '/pkg/', '/internal/', '/domain/', '/usecase/',
      '/handler/', '/repository/', '/grpc/', '/http'
    ],
    structure: 'Go standard project layout with clean arch'
  },

  // Testing Architectures
  test_driven: {
    name: 'Test-Driven Development',
    type: 'testing',
    indicators: [
      '/test/', '/tests/', '/__tests__/', '/spec/',
      '_test.go', '.test.', '.spec.', 'mock.', 'stub.'
    ],
    structure: 'test-first development approach'
  }
};

/**
 * Match file path against architecture patterns
 * Returns matching pattern types based on ARCHITECTURE_PATTERNS
 */
function matchArchitectureType(filePath) {
  const path = filePath.toLowerCase();
  const matchedTypes = new Set();

  for (const [key, pattern] of Object.entries(ARCHITECTURE_PATTERNS)) {
    for (const indicator of pattern.indicators) {
      const indicatorLower = indicator.toLowerCase();
      if (path.includes(indicatorLower) || path.endsWith(indicatorLower)) {
        matchedTypes.add(pattern.type);
        break;
      }
    }
  }

  return Array.from(matchedTypes);
}

/**
 * Detect dominant architecture pattern from all files
 * Returns the most prominent architecture key (e.g., 'clean', 'hexagonal', 'mvvm_mobile')
 */
function detectDominantArchitecture(files) {
  const patternScores = {};

  for (const file of files) {
    const filename = file.filename.toLowerCase();

    for (const [key, pattern] of Object.entries(ARCHITECTURE_PATTERNS)) {
      for (const indicator of pattern.indicators) {
        const indicatorLower = indicator.toLowerCase();
        if (filename.includes(indicatorLower) || filename.endsWith(indicatorLower)) {
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
  const dominant = Object.entries(patternScores)
    .sort(([, a], [, b]) => b - a)[0][0];

  return dominant;
}

/**
 * Detect API impact based on detected architecture
 * Each architecture has different conventions for API layer
 */
function detectAPIImpact(filename, dominantArchitecture) {
  const impacts = {
    presentation: false,
    application: false,
    domain: false,
    infrastructure: false
  };

  switch (dominantArchitecture) {
    case 'layered':
      // Layered: Controllers/Routes → Services → Repositories
      if (filename.includes('/controller') ||
          filename.includes('/controllers/') ||
          filename.includes('/routes/') ||
          filename.includes('/api/')) {
        impacts.presentation = true;
      }
      if (filename.includes('/service') ||
          filename.includes('/services/')) {
        impacts.application = true;
      }
      if (filename.includes('/repository') ||
          filename.includes('/repositories/') ||
          filename.includes('/dao')) {
        impacts.infrastructure = true;
      }
      break;

    case 'clean':
      // Clean: Presenters/Controllers → Use Cases → Gateways
      if (filename.includes('/presenter') ||
          filename.includes('/presenters/') ||
          filename.includes('/controller') ||
          filename.includes('/controllers/')) {
        impacts.presentation = true;
      }
      if (filename.includes('/usecase') ||
          filename.includes('/usecases/') ||
          filename.includes('/use-case') ||
          filename.includes('/use-cases/') ||
          filename.includes('/use_case') ||
          filename.includes('/use_cases/') ||
          filename.includes('/interactor') ||
          filename.includes('/interactors/')) {
        impacts.application = true;
      }
      if (filename.includes('/gateway') ||
          filename.includes('/gateways/') ||
          filename.includes('/interface') ||
          filename.includes('/interfaces/')) {
        impacts.infrastructure = true;
      }
      break;

    case 'onion':
      // Onion: Presentation → Application → Domain → Infrastructure
      if (filename.includes('/presentation/')) {
        impacts.presentation = true;
      }
      if (filename.includes('/application/')) {
        impacts.application = true;
      }
      if (filename.includes('/domain/')) {
        impacts.domain = true;
      }
      if (filename.includes('/infrastructure/')) {
        impacts.infrastructure = true;
      }
      break;

    case 'hexagonal':
      // Hexagonal: Primary Adapters → Ports → Application → Ports → Secondary Adapters
      if (filename.includes('/primary/') ||
          filename.includes('/adapter') && !filename.includes('/adapters/')) {
        impacts.presentation = true;  // Driving/Primary adapters
      }
      if (filename.includes('/ports/') ||
          filename.includes('port')) {
        impacts.infrastructure = true;  // Ports are interfaces
      }
      if (filename.includes('/secondary/')) {
        impacts.infrastructure = true;  // Driven/Secondary adapters
      }
      break;

    case 'ddd':
      // DDD: Application Layer → Domain Layer → Infrastructure Layer
      if (filename.includes('/application/') ||
          filename.includes('/app/')) {
        impacts.application = true;
      }
      if (filename.includes('/domain/') ||
          filename.includes('/aggregate') ||
          filename.includes('/entity')) {
        impacts.domain = true;
      }
      if (filename.includes('/infrastructure/') ||
          filename.includes('/repository')) {
        impacts.infrastructure = true;
      }
      break;

    case 'cqrs':
      // CQRS: Commands/Queries → Handlers → Read/Write Models
      if (filename.includes('/command') ||
          filename.includes('/query')) {
        impacts.application = true;
      }
      if (filename.includes('/handler') ||
          filename.includes('/handlers/')) {
        impacts.application = true;
      }
      break;

    case 'nestjs':
      // NestJS: Controllers → Services/Providers → Repositories
      if (filename.includes('.controller') ||
          filename.includes('@controller')) {
        impacts.presentation = true;
      }
      if (filename.includes('.service') ||
          filename.includes('@injectable')) {
        impacts.application = true;
      }
      if (filename.includes('.repository')) {
        impacts.infrastructure = true;
      }
      break;

    case 'spring_boot':
      // Spring Boot: @Controller → @Service → @Repository
      if (filename.includes('@controller') ||
          filename.includes('/rest/')) {
        impacts.presentation = true;
      }
      if (filename.includes('@service')) {
        impacts.application = true;
      }
      if (filename.includes('@repository') ||
          filename.includes('@entity')) {
        impacts.infrastructure = true;
      }
      break;

    case 'go_clean':
      // Go Clean: handlers → usecases → repositories → grpc/http
      if (filename.includes('/handler') ||
          filename.includes('/http')) {
        impacts.presentation = true;
      }
      if (filename.includes('/usecase') ||
          filename.includes('/usecases/')) {
        impacts.application = true;
      }
      if (filename.includes('/repository')) {
        impacts.infrastructure = true;
      }
      break;

    case 'mvvm_mobile':
    case 'mvvm_frontend':
      // MVVM: View → ViewModel → Model
      if (filename.includes('viewmodel') ||
          filename.includes('view-model')) {
        impacts.application = true;  // ViewModel is business logic
      }
      if (filename.includes('model') && !filename.includes('viewmodel')) {
        impacts.domain = true;
      }
      break;

    case 'mvi':
      // MVI: View → Intent → Reducer → State
      if (filename.includes('intent') ||
          filename.includes('reducer')) {
        impacts.application = true;
      }
      if (filename.includes('state')) {
        impacts.domain = true;
      }
      break;

    case 'flux_redux':
    case 'redux_mobile':
      // Redux/Flux: Component → Action → Reducer → Store
      if (filename.includes('/action') ||
          filename.includes('/actions/')) {
        impacts.application = true;
      }
      if (filename.includes('/reducer') ||
          filename.includes('/reducers/')) {
        impacts.application = true;
      }
      if (filename.includes('/store') ||
          filename.includes('/stores/')) {
        impacts.infrastructure = true;
      }
      break;

    case 'component_based':
      // Component-Based: Atomic Design
      if (filename.includes('/atom') ||
          filename.includes('/molecule') ||
          filename.includes('/organism')) {
        impacts.presentation = true;
      }
      if (filename.includes('/template')) {
        impacts.application = true;
      }
      break;

    default:
      // Generic detection for unknown architectures
      if (filename.includes('controller') ||
          filename.includes('/routes/') ||
          filename.includes('/api/')) {
        impacts.presentation = true;
      }
      if (filename.includes('service') ||
          filename.includes('handler')) {
        impacts.application = true;
      }
      if (filename.includes('repository') ||
          filename.includes('dao')) {
        impacts.infrastructure = true;
      }
  }

  return impacts;
}

/**
 * Analyze PR characteristics to determine risk level, impact area, and recommended review
 */
function analyzePRRisk(pr, prDetails) {
  const { files, filesChanged, totalChanges } = prDetails;

  // Detect dominant architecture for context-aware analysis
  const dominantArchitecture = detectDominantArchitecture(files);

  // Calculate risk level based on size and scope
  const riskLevel = calculateRiskLevel(filesChanged, totalChanges, files);

  // Determine impact area based on file types and paths (architecture-aware)
  const impactArea = determineImpactArea(files);

  // Get recommended review based on risk and impact
  const recommendedReview = getRecommendedReview(riskLevel, impactArea, pr, files);

  // Detect suspicious patterns
  const suspiciousPatterns = detectSuspiciousPatterns(files, pr);

  // Log analysis for debugging with architecture context
  const archInfo = dominantArchitecture
    ? `arch=${ARCHITECTURE_PATTERNS[dominantArchitecture]?.name || dominantArchitecture}`
    : 'arch=unknown';

  logger.debug(`[PRAnalyzer] PR #${pr.number}: ${archInfo}, risk=${riskLevel}, impact=${impactArea}, review=${recommendedReview}, patterns=${suspiciousPatterns.join(',') || 'none'}`);

  return {
    riskLevel,
    impactArea,
    recommendedReview,
    suspiciousPatterns
  };
}

/**
 * Calculate risk level based on PR size and characteristics
 */
function calculateRiskLevel(filesChanged, totalChanges, files) {
  // High risk indicators
  if (filesChanged > 15 || totalChanges > 500) {
    return 'high';
  }

  // Check for high-risk file patterns
  const hasMigrationFiles = files.some(f => f.filename.includes('migration'));
  const hasAuthFiles = files.some(f =>
    f.filename.includes('auth') ||
    f.filename.includes('security') ||
    f.filename.includes('password')
  );

  if (hasMigrationFiles || hasAuthFiles) {
    return 'high';
  }

  // Medium risk
  if (filesChanged >= 5 || totalChanges >= 100) {
    return 'medium';
  }

  // Low risk
  return 'low';
}

/**
 * Determine impact area based on file types and paths
 * Uses architecture-aware detection based on ARCHITECTURE_PATTERNS
 */
function determineImpactArea(files) {
  const impactAreas = {
    database: 0,
    security: 0,
    api_presentation: 0,  // Controllers, Views, Presenters
    api_application: 0,   // Use Cases, Services, Handlers
    api_domain: 0,        // Entities, Aggregates, Domain Logic
    api_infrastructure: 0, // Repositories, Gateways, Adapters
    ui: 0,
    mobile: 0,
    backend: 0,
    config: 0,
    core: 0,
    architecture: 0
  };

  // Detect dominant architecture first
  const dominantArchitecture = detectDominantArchitecture(files);

  for (const file of files) {
    const filename = file.filename.toLowerCase();

    // Match architecture types using ARCHITECTURE_PATTERNS
    const matchedTypes = matchArchitectureType(filename);

    // Database impact
    if (filename.includes('migration') ||
        filename.includes('schema') ||
        filename.includes('/models/') ||
        filename.includes('sequelize') ||
        filename.includes('prisma') ||
        filename.includes('.sql') ||
        filename.includes('gorm')) {
      impactAreas.database++;
    }

    // Security impact
    if (filename.includes('auth') ||
        filename.includes('security') ||
        filename.includes('password') ||
        filename.includes('jwt') ||
        filename.includes('session') ||
        filename.includes('permission') ||
        filename.includes('authorization') ||
        filename.includes('middleware') ||
        filename.includes('interceptor')) {
      impactAreas.security++;
    }

    // API impact - Architecture-aware detection
    const apiImpacts = detectAPIImpact(filename, dominantArchitecture);
    if (apiImpacts.presentation) impactAreas.api_presentation++;
    if (apiImpacts.application) impactAreas.api_application++;
    if (apiImpacts.domain) impactAreas.api_domain++;
    if (apiImpacts.infrastructure) impactAreas.api_infrastructure++;

    // Generic API fallback for undetected patterns
    if (!apiImpacts.presentation && !apiImpacts.application &&
        !apiImpacts.domain && !apiImpacts.infrastructure) {
      if (filename.includes('graphql') || filename.includes('grpc')) {
        impactAreas.api_presentation++;
      }
    }

    // UI impact - Web frontend
    if (filename.includes('component') ||
        filename.includes('view') && !filename.includes('viewmodel') ||
        filename.includes('page') ||
        filename.endsWith('.jsx') ||
        filename.endsWith('.tsx') ||
        filename.endsWith('.vue') ||
        filename.endsWith('.svelte') ||
        filename.includes('/components/') ||
        filename.includes('/views/') ||
        filename.includes('/pages/') ||
        filename.includes('/templates/')) {
      impactAreas.ui++;
    }

    // Mobile impact - using ARCHITECTURE_PATTERNS
    if (matchedTypes.includes('mobile') ||
        filename.includes('android/') ||
        filename.includes('ios/') ||
        filename.includes('/mobile/')) {
      impactAreas.mobile++;
    }

    // Backend impact - using ARCHITECTURE_PATTERNS
    if (matchedTypes.includes('backend')) {
      impactAreas.backend++;
    }

    // Config impact
    if (filename.includes('config') ||
        filename.includes('.env') ||
        filename.includes('docker') ||
        filename.includes('webpack') ||
        filename.includes('vite') ||
        filename.includes('/config/') ||
        filename.includes('makefile') ||
        filename.includes('.mk') ||
        filename.includes('.cmake') ||
        filename.includes('gradle') ||
        filename.includes('pom.xml') ||
        filename.includes('application.properties') ||
        filename.includes('application.yml') ||
        filename.includes('go.mod')) {
      impactAreas.config++;
    }

    // Domain layer impact (DDD/Clean Architecture specific)
    if (filename.includes('/domain/') ||
        filename.includes('/valueobjects/') ||
        filename.includes('/value-objects/') ||
        filename.includes('/value_objects/') ||
        filename.includes('/aggregates/')) {
      impactAreas.domain++;
    }

    // Architecture layer impact (Clean, Onion, Hexagonal boundaries)
    if (filename.includes('/ports/') ||
        filename.includes('/adapters/') ||
        filename.includes('/interactors/') ||
        filename.includes('/interface') && filename.includes('gateway')) {
      impactAreas.architecture++;
    }
  }

  // Aggregate API impact areas for backward compatibility
  const totalAPIImpact = impactAreas.api_presentation +
                        impactAreas.api_application +
                        impactAreas.api_domain +
                        impactAreas.api_infrastructure;

  // Create a simplified impact map for decision making
  const simplifiedImpacts = {
    database: impactAreas.database,
    security: impactAreas.security,
    api: totalAPIImpact,
    ui: impactAreas.ui,
    mobile: impactAreas.mobile,
    backend: impactAreas.backend,
    config: impactAreas.config,
    core: 0,
    domain: impactAreas.domain + impactAreas.api_domain,
    architecture: impactAreas.architecture
  };

  // Return the dominant impact area
  const maxImpact = Math.max(...Object.values(simplifiedImpacts));
  const dominantArea = Object.keys(simplifiedImpacts).find(area => simplifiedImpacts[area] === maxImpact);

  // If mixed areas with similar counts, return 'core'
  const areasWithMax = Object.keys(simplifiedImpacts).filter(area => simplifiedImpacts[area] === maxImpact);
  if (areasWithMax.length > 2 || maxImpact === 0) {
    return 'core';
  }

  // If API impact is dominant, be more specific based on architecture
  if (dominantArea === 'api' && dominantArchitecture) {
    if (impactAreas.api_domain > 0 && impactAreas.api_domain >= impactAreas.api_application) {
      return 'domain';  // Domain changes are critical
    }
    if (impactAreas.api_infrastructure > impactAreas.api_presentation) {
      return 'backend';  // Infrastructure/backend changes
    }
  }

  return dominantArea;
}

/**
 * Get recommended review based on risk level and impact area
 */
function getRecommendedReview(riskLevel, impactArea, pr, files) {
  // Check if PR is a draft or WIP
  const title = (pr.title || '').toLowerCase();
  const description = (pr.description || '').toLowerCase();
  const isDraft = title.includes('wip') ||
                  title.includes('draft') ||
                  title.includes('[wip]') ||
                  description.includes('wip') ||
                  pr.draft;

  if (isDraft) {
    return 'review later';
  }

  // Critical review for high-risk changes, sensitive areas, or architectural changes
  if (riskLevel === 'high' ||
      impactArea === 'security' ||
      impactArea === 'database' ||
      impactArea === 'mobile' ||
      impactArea === 'config' ||
      impactArea === 'domain' || // Domain layer is critical in DDD/Clean Architecture
      impactArea === 'architecture' || // Architecture changes are critical
      (impactArea === 'backend' && riskLevel === 'medium')) {
    return 'critical review';
  }

  // Requires attention for medium risk with api/ui/backend changes
  if (riskLevel === 'medium' &&
      (impactArea === 'api' || impactArea === 'ui' ||
       impactArea === 'backend' || impactArea === 'core')) {
    return 'requires attention';
  }

  // Safe review for low risk
  return 'safe review';
}

/**
 * Detect suspicious patterns in the PR
 */
function detectSuspiciousPatterns(files, pr) {
  const patterns = [];

  // Database migration
  if (files.some(f => f.filename.includes('migration'))) {
    patterns.push('database_migration');
  }

  // Security/auth changes
  if (files.some(f =>
    f.filename.includes('auth') ||
    f.filename.includes('security') ||
    f.filename.includes('password') ||
    f.filename.includes('jwt') ||
    f.filename.includes('crypto')
  )) {
    patterns.push('security_changes');
  }

  // Large files (more than 500 lines changed)
  if (files.some(f => f.changes > 500)) {
    patterns.push('large_file_changes');
  }

  // Test files removed or reduced - Multi-language support
  const testFiles = files.filter(f => {
    const filename = f.filename.toLowerCase();

    // Go test files
    if (filename.endsWith('_test.go')) return true;

    // Python test files
    if (filename.includes('test_') && filename.endsWith('.py')) return true;
    if (filename.endsWith('_test.py')) return true;
    if (filename.includes('/test/') && filename.endsWith('.py')) return true;
    if (filename.includes('/tests/') && filename.endsWith('.py')) return true;
    if (filename.includes('conftest.py')) return true;

    // JavaScript/TypeScript test files
    if (filename.includes('.test.') || filename.includes('.spec.')) return true;
    if (filename.includes('/test/') || filename.includes('/tests/')) return true;
    if (filename.includes('/__tests__/')) return true;
    if (filename.includes('jest.config')) return true;

    // Java test files
    if (filename.includes('test') && filename.endsWith('.java')) return true;
    if (filename.includes('/src/test/')) return true;

    // Kotlin test files
    if (filename.includes('test') && filename.endsWith('.kt')) return true;
    if (filename.includes('test') && filename.endsWith('.kts')) return true;

    // React test files
    if (filename.includes('.test.') && (filename.endsWith('.jsx') || filename.endsWith('.tsx'))) return true;

    return false;
  });

  const removedTests = testFiles.filter(f =>
    f.status === 'deleted' ||
    (f.deletions > f.additions && f.deletions > 50)
  );

  if (removedTests.length > 0) {
    patterns.push('test_coverage_reduced');
  }

  // Config changes
  if (files.some(f =>
    f.filename.includes('config') ||
    f.filename.includes('.env') ||
    f.filename.includes('docker') ||
    f.filename.includes('makefile')
  )) {
    patterns.push('config_changes');
  }

  // Dependency changes - Multi-language support
  if (files.some(f => {
    const filename = f.filename.toLowerCase();

    // Node.js/JavaScript
    if (filename === 'package.json' || filename === 'package-lock.json' ||
        filename === 'yarn.lock' || filename === 'pnpm-lock.yaml') return true;

    // Python
    if (filename === 'requirements.txt' || filename === 'setup.py' ||
        filename === 'pyproject.toml' || filename === 'pipfile' ||
        filename === 'poetry.lock') return true;

    // Go
    if (filename === 'go.mod' || filename === 'go.sum') return true;

    // Java
    if (filename === 'pom.xml' || filename === 'build.gradle') return true;

    // Kotlin
    if (filename === 'build.gradle.kts') return true;

    // Ruby
    if (filename === 'gemfile' || filename === 'gemfile.lock') return true;

    // PHP
    if (filename === 'composer.json' || filename === 'composer.lock') return true;

    // C#
    if (filename.includes('.csproj') || filename.includes('packages.config')) return true;

    return false;
  })) {
    patterns.push('dependency_update');
  }

  // Build system changes
  if (files.some(f =>
    f.filename.includes('makefile') ||
    f.filename.includes('.mk') ||
    f.filename.includes('cmake') ||
    f.filename.includes('dockerfile') ||
    f.filename.includes('build.gradle') ||
    f.filename.includes('webpack.config') ||
    f.filename.includes('vite.config')
  )) {
    patterns.push('build_system_changes');
  }

  // API contract changes
  if (files.some(f =>
    f.filename.includes('openapi') ||
    f.filename.includes('swagger') ||
    f.filename.includes('graphql') ||
    f.filename.includes('proto') ||
    f.filename.includes('thrift') ||
    f.filename.includes('.xsd') ||
    f.filename.includes('wsdl')
  )) {
    patterns.push('api_contract_changes');
  }

  // Infrastructure/DevOps changes
  if (files.some(f =>
    f.filename.includes('terraform') ||
    f.filename.includes('kubernetes') ||
    f.filename.includes('k8s') ||
    f.filename.includes('helm') ||
    f.filename.includes('ansible') ||
    f.filename.includes('.yaml') && (f.filename.includes('deploy') || f.filename.includes('k8s')) ||
    f.filename.includes('.yml') && (f.filename.includes('deploy') || f.filename.includes('k8s'))
  )) {
    patterns.push('infrastructure_changes');
  }

  // Architecture violation patterns
  if (files.some(f => {
    const filename = f.filename.toLowerCase();

    // Check for layer violations (e.g., UI importing directly from DB layer)
    if (filename.includes('component') &&
        (filename.includes('repository') || filename.includes('dao'))) {
      return true;
    }

    // Check for domain layer depending on infrastructure
    if (filename.includes('/domain/') &&
        (filename.includes('http') || filename.includes('database'))) {
      return true;
    }

    return false;
  })) {
    patterns.push('architecture_violation');
  }

  return patterns;
}

module.exports = {
  analyzePRRisk,
  detectDominantArchitecture,
  matchArchitectureType,
  ARCHITECTURE_PATTERNS
};
