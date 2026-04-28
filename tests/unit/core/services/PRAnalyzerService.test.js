/**
 * Unit tests for PRAnalyzerService
 */

const PRAnalyzerService = require('../../../../src/core/services/PRAnalyzerService');
const RiskCalculatorService = require('../../../../src/core/services/RiskCalculatorService');

describe('PRAnalyzerService', () => {
  let analyzer;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };
    const riskCalculator = new RiskCalculatorService();
    analyzer = new PRAnalyzerService(riskCalculator, { logger: mockLogger });
  });

  describe('analyze', () => {
    const mockPR = {
      number: 123,
      title: 'Fix authentication bug',
      description: 'Fixes login issue',
      draft: false
    };

    const mockPRDetails = {
      files: [
        { filename: 'src/auth/login.js', changes: 50, additions: 30, deletions: 20, status: 'modified' }
      ],
      filesChanged: 1,
      totalChanges: 50
    };

    it('should analyze PR and return result', () => {
      const result = analyzer.analyze(mockPR, mockPRDetails);

      expect(result).toHaveProperty('riskLevel');
      expect(result).toHaveProperty('impactArea');
      expect(result).toHaveProperty('recommendedReview');
      expect(result).toHaveProperty('suspiciousPatterns');
      expect(result).toHaveProperty('dominantArchitecture');
      expect(result).toHaveProperty('riskScore');
    });

    it('should detect high risk for auth files', () => {
      const result = analyzer.analyze(mockPR, mockPRDetails);
      expect(result.riskLevel).toBe('high');
    });

    it('should detect security impact area', () => {
      const result = analyzer.analyze(mockPR, mockPRDetails);
      expect(result.impactArea).toBe('security');
    });

    it('should recommend critical review for high risk security changes', () => {
      const result = analyzer.analyze(mockPR, mockPRDetails);
      expect(result.recommendedReview).toBe('critical review');
    });

    it('should detect suspicious patterns', () => {
      const result = analyzer.analyze(mockPR, mockPRDetails);
      expect(result.suspiciousPatterns).toContain('security_changes');
    });

    it('should log analysis details', () => {
      analyzer.analyze(mockPR, mockPRDetails);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('PR #123')
      );
    });
  });

  describe('draft PR detection', () => {
    it('should recommend "review later" for draft PRs', () => {
      const pr = {
        number: 1,
        title: 'WIP: new feature',
        draft: true
      };

      const details = {
        files: [{ filename: 'src/utils.js', changes: 10 }],
        filesChanged: 1,
        totalChanges: 10
      };

      const result = analyzer.analyze(pr, details);
      expect(result.recommendedReview).toBe('review later');
    });

    it('should recommend "review later" for WIP in title', () => {
      const pr = {
        number: 1,
        title: '[WIP] new feature',
        draft: false
      };

      const details = {
        files: [{ filename: 'src/utils.js', changes: 10 }],
        filesChanged: 1,
        totalChanges: 10
      };

      const result = analyzer.analyze(pr, details);
      expect(result.recommendedReview).toBe('review later');
    });

    it('should recommend "review later" for WIP in description', () => {
      const pr = {
        number: 1,
        title: 'new feature',
        description: 'This is WIP',
        draft: false
      };

      const details = {
        files: [{ filename: 'src/utils.js', changes: 10 }],
        filesChanged: 1,
        totalChanges: 10
      };

      const result = analyzer.analyze(pr, details);
      expect(result.recommendedReview).toBe('review later');
    });
  });

  describe('impact area detection', () => {
    it('should detect database impact', () => {
      const pr = { number: 1, title: 'Add migration' };
      const details = {
        files: [
          { filename: 'db/migrations/001_init.sql', changes: 100 }
        ],
        filesChanged: 1,
        totalChanges: 100
      };

      const result = analyzer.analyze(pr, details);
      expect(result.impactArea).toBe('database');
    });

    it('should detect UI impact', () => {
      const pr = { number: 1, title: 'Update UI' };
      const details = {
        files: [
          { filename: 'src/components/Button.jsx', changes: 50 }
        ],
        filesChanged: 1,
        totalChanges: 50
      };

      const result = analyzer.analyze(pr, details);
      expect(result.impactArea).toBe('ui');
    });

    it('should detect backend impact', () => {
      const pr = { number: 1, title: 'Update API' };
      const details = {
        files: [
          { filename: 'src/controllers/user.js', changes: 50 }
        ],
        filesChanged: 1,
        totalChanges: 50
      };

      const result = analyzer.analyze(pr, details);
      expect(result.impactArea).toBe('api');
    });

    it('should detect config impact', () => {
      const pr = { number: 1, title: 'Update config' };
      const details = {
        files: [
          { filename: 'config/database.yml', changes: 10 }
        ],
        filesChanged: 1,
        totalChanges: 10
      };

      const result = analyzer.analyze(pr, details);
      expect(result.impactArea).toBe('config');
    });

    it('should return core for mixed impacts', () => {
      const pr = { number: 1, title: 'Various changes' };
      const details = {
        files: [
          { filename: 'src/utils/a.js', changes: 10 },
          { filename: 'src/utils/b.js', changes: 10 },
          { filename: 'src/utils/c.js', changes: 10 }
        ],
        filesChanged: 3,
        totalChanges: 30
      };

      const result = analyzer.analyze(pr, details);
      expect(result.impactArea).toBe('core');
    });
  });

  describe('suspicious pattern detection', () => {
    it('should detect database migration', () => {
      const pr = { number: 1, title: 'Migration' };
      const details = {
        files: [
          { filename: 'db/migrations/001.sql', changes: 100 }
        ],
        filesChanged: 1,
        totalChanges: 100
      };

      const result = analyzer.analyze(pr, details);
      expect(result.suspiciousPatterns).toContain('database_migration');
    });

    it('should detect large file changes', () => {
      const pr = { number: 1, title: 'Big file' };
      const details = {
        files: [
          { filename: 'src/big.js', changes: 600 }
        ],
        filesChanged: 1,
        totalChanges: 600
      };

      const result = analyzer.analyze(pr, details);
      expect(result.suspiciousPatterns).toContain('large_file_changes');
    });

    it('should detect test coverage reduced', () => {
      const pr = { number: 1, title: 'Remove tests' };
      const details = {
        files: [
          { filename: 'src/app.test.js', changes: 100, deletions: 80, additions: 0, status: 'deleted' }
        ],
        filesChanged: 1,
        totalChanges: 100
      };

      const result = analyzer.analyze(pr, details);
      expect(result.suspiciousPatterns).toContain('test_coverage_reduced');
    });

    it('should detect config changes', () => {
      const pr = { number: 1, title: 'Config update' };
      const details = {
        files: [
          { filename: '.env.production', changes: 10 }
        ],
        filesChanged: 1,
        totalChanges: 10
      };

      const result = analyzer.analyze(pr, details);
      expect(result.suspiciousPatterns).toContain('config_changes');
    });

    it('should detect dependency updates', () => {
      const pr = { number: 1, title: 'Update deps' };
      const details = {
        files: [
          { filename: 'package.json', changes: 20 }
        ],
        filesChanged: 1,
        totalChanges: 20
      };

      const result = analyzer.analyze(pr, details);
      expect(result.suspiciousPatterns).toContain('dependency_update');
    });

    it('should detect build system changes', () => {
      const pr = { number: 1, title: 'Update build' };
      const details = {
        files: [
          { filename: 'webpack.config.js', changes: 30 }
        ],
        filesChanged: 1,
        totalChanges: 30
      };

      const result = analyzer.analyze(pr, details);
      expect(result.suspiciousPatterns).toContain('build_system_changes');
    });

    it('should detect API contract changes', () => {
      const pr = { number: 1, title: 'Update API spec' };
      const details = {
        files: [
          { filename: 'openapi.yaml', changes: 50 }
        ],
        filesChanged: 1,
        totalChanges: 50
      };

      const result = analyzer.analyze(pr, details);
      expect(result.suspiciousPatterns).toContain('api_contract_changes');
    });

    it('should detect infrastructure changes', () => {
      const pr = { number: 1, title: 'Update k8s' };
      const details = {
        files: [
          { filename: 'k8s/deployment.yaml', changes: 20 }
        ],
        filesChanged: 1,
        totalChanges: 20
      };

      const result = analyzer.analyze(pr, details);
      expect(result.suspiciousPatterns).toContain('infrastructure_changes');
    });

    it('should detect architecture violations', () => {
      const pr = { number: 1, title: 'Bad import' };
      const details = {
        files: [
          { filename: 'src/components/UserRepository.js', changes: 10 }
        ],
        filesChanged: 1,
        totalChanges: 10
      };

      const result = analyzer.analyze(pr, details);
      expect(result.suspiciousPatterns).toContain('architecture_violation');
    });
  });

  describe('architecture detection', () => {
    it('should detect layered architecture', () => {
      const pr = { number: 1, title: 'Layered changes' };
      const details = {
        files: [
          { filename: 'src/controllers/user.js', changes: 50 },
          { filename: 'src/services/user.js', changes: 30 },
          { filename: 'src/repositories/user.js', changes: 20 }
        ],
        filesChanged: 3,
        totalChanges: 100
      };

      const result = analyzer.analyze(pr, details);
      expect(result.dominantArchitecture).toBe('layered');
    });

    it('should detect clean architecture', () => {
      const pr = { number: 1, title: 'Clean arch changes' };
      const details = {
        files: [
          { filename: 'src/entities/user.js', changes: 50 },
          { filename: 'src/usecases/createUser.js', changes: 30 }
        ],
        filesChanged: 2,
        totalChanges: 80
      };

      const result = analyzer.analyze(pr, details);
      expect(result.dominantArchitecture).toBe('clean');
    });

    it('should return null for unknown architecture', () => {
      const pr = { number: 1, title: 'Unknown' };
      const details = {
        files: [
          { filename: 'README.md', changes: 10 }
        ],
        filesChanged: 1,
        totalChanges: 10
      };

      const result = analyzer.analyze(pr, details);
      expect(result.dominantArchitecture).toBeNull();
    });
  });

  describe('review recommendation logic', () => {
    it('should recommend critical review for high risk', () => {
      const pr = { number: 1, title: 'Big changes' };
      const details = {
        files: Array(20).fill({ filename: 'src/file.js', changes: 30 }),
        filesChanged: 20,
        totalChanges: 600
      };

      const result = analyzer.analyze(pr, details);
      expect(result.recommendedReview).toBe('critical review');
    });

    it('should recommend requires attention for medium risk with API impact', () => {
      const pr = { number: 1, title: 'API changes' };
      const details = {
        files: [
          { filename: 'src/controllers/api.js', changes: 100 }
        ],
        filesChanged: 1,
        totalChanges: 100
      };

      const result = analyzer.analyze(pr, details);
      expect(result.recommendedReview).toBe('requires attention');
    });

    it('should recommend safe review for low risk', () => {
      const pr = { number: 1, title: 'Small fix' };
      const details = {
        files: [
          { filename: 'src/utils/helpers.js', changes: 10 }
        ],
        filesChanged: 1,
        totalChanges: 10
      };

      const result = analyzer.analyze(pr, details);
      expect(result.recommendedReview).toBe('safe review');
    });
  });

  describe('risk score calculation', () => {
    it('should include risk score in analysis result', () => {
      const pr = { number: 1, title: 'Test' };
      const details = {
        files: [{ filename: 'src/test.js', changes: 50 }],
        filesChanged: 1,
        totalChanges: 50
      };

      const result = analyzer.analyze(pr, details);
      expect(result.riskScore).toBeGreaterThanOrEqual(0);
      expect(result.riskScore).toBeLessThanOrEqual(100);
    });

    it('should give higher score for larger changes', () => {
      const pr = { number: 1, title: 'Test' };
      const smallDetails = {
        files: [{ filename: 'src/test.js', changes: 10 }],
        filesChanged: 1,
        totalChanges: 10
      };
      const largeDetails = {
        files: [{ filename: 'src/test.js', changes: 300 }],
        filesChanged: 1,
        totalChanges: 300
      };

      const smallResult = analyzer.analyze(pr, smallDetails);
      const largeResult = analyzer.analyze(pr, largeDetails);
      expect(largeResult.riskScore).toBeGreaterThan(smallResult.riskScore);
    });
  });
});
