/**
 * Unit tests for prAnalyzer utility
 * Tests PR risk analysis, architecture detection, and suspicious pattern detection
 */

const {
  analyzePRRisk,
  detectDominantArchitecture,
  matchArchitectureType,
  ARCHITECTURE_PATTERNS
} = require('../../../src/utils/prAnalyzer');

describe('prAnalyzer', () => {
  describe('ARCHITECTURE_PATTERNS', () => {
    test('should have defined architecture patterns', () => {
      expect(ARCHITECTURE_PATTERNS).toBeDefined();
      expect(typeof ARCHITECTURE_PATTERNS).toBe('object');
    });

    test('should have required architecture keys', () => {
      const requiredKeys = ['layered', 'clean', 'onion', 'hexagonal', 'ddd', 'cqrs'];
      requiredKeys.forEach(key => {
        expect(ARCHITECTURE_PATTERNS[key]).toBeDefined();
      });
    });

    test('each pattern should have name, type, indicators, and structure', () => {
      Object.values(ARCHITECTURE_PATTERNS).forEach(pattern => {
        expect(pattern.name).toBeDefined();
        expect(pattern.type).toBeDefined();
        expect(Array.isArray(pattern.indicators)).toBe(true);
        expect(pattern.structure).toBeDefined();
      });
    });
  });

  describe('matchArchitectureType', () => {
    test('should return empty array for unknown patterns', () => {
      const result = matchArchitectureType('unknown/path/file.txt');
      expect(result).toEqual([]);
    });

    test('should detect layered architecture from controller files', () => {
      const result = matchArchitectureType('src/controllers/userController.js');
      expect(result).toContain('backend');
    });

    test('should detect clean architecture from usecase files', () => {
      const result = matchArchitectureType('src/usecases/createUser.js');
      expect(result).toContain('backend');
    });

    test('should detect mobile architecture from viewmodel files', () => {
      const result = matchArchitectureType('app/viewmodel/UserViewModel.kt');
      expect(result).toContain('mobile');
    });

    test('should detect frontend architecture from component files', () => {
      const result = matchArchitectureType('src/components/Button.jsx');
      expect(result).toContain('frontend');
    });

    test('should detect multiple architecture types for mixed patterns', () => {
      const result = matchArchitectureType('src/controllers/userController.js');
      expect(result.length).toBeGreaterThan(0);
    });

    test('should be case insensitive', () => {
      const result1 = matchArchitectureType('src/Controllers/User.js');
      const result2 = matchArchitectureType('src/CONTROLLERS/User.js');
      const result3 = matchArchitectureType('src/controllers/User.js');
      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);
    });
  });

  describe('detectDominantArchitecture', () => {
    test('should return null for empty files array', () => {
      const result = detectDominantArchitecture([]);
      expect(result).toBeNull();
    });

    test('should detect layered architecture from controller files', () => {
      const files = [
        { filename: 'src/controllers/UserController.js', changes: 10 },
        { filename: 'src/services/UserService.js', changes: 5 }
      ];
      const result = detectDominantArchitecture(files);
      expect(result).toBe('layered');
    });

    test('should detect clean architecture from usecase files', () => {
      const files = [
        { filename: 'src/usecases/createUser.js', changes: 10 },
        { filename: 'src/gateways/UserGateway.js', changes: 5 }
      ];
      const result = detectDominantArchitecture(files);
      expect(result).toBe('clean');
    });

    test('should detect hexagonal architecture from adapter files', () => {
      const files = [
        { filename: 'src/adapters/primary/UserAdapter.js', changes: 10 },
        { filename: 'src/ports/UserPort.js', changes: 5 }
      ];
      const result = detectDominantArchitecture(files);
      expect(result).toBe('hexagonal');
    });

    test('should detect DDD architecture from domain files', () => {
      const files = [
        { filename: 'src/domain/aggregates/User.js', changes: 10 },
        { filename: 'src/domain/valueobjects/Email.js', changes: 5 },
        { filename: 'src/repositories/UserRepository.js', changes: 5 }
      ];
      const result = detectDominantArchitecture(files);
      // DDD has /domain/, /aggregates/, /valueobjects/ indicators
      // Onion also has /domain/, so DDD-specific indicators like /aggregates/ tip the scale
      expect(result).toBe('ddd');
    });

    test('should detect MVVM mobile architecture', () => {
      const files = [
        { filename: 'app/viewmodel/UserViewModel.kt', changes: 10 },
        { filename: 'app/model/User.kt', changes: 5 }
      ];
      const result = detectDominantArchitecture(files);
      expect(result).toBe('mvvm_mobile');
    });

    test('should detect component-based frontend architecture', () => {
      const files = [
        { filename: 'src/components/atoms/Button.jsx', changes: 10 },
        { filename: 'src/components/organisms/Form.jsx', changes: 5 }
      ];
      const result = detectDominantArchitecture(files);
      expect(result).toBe('component_based');
    });

    test('should return architecture with highest score when multiple exist', () => {
      const files = [
        { filename: 'src/controllers/UserController.js', changes: 10 },
        { filename: 'src/controllers/PostController.js', changes: 10 },
        { filename: 'src/services/UserService.js', changes: 5 }
      ];
      const result = detectDominantArchitecture(files);
      expect(result).toBe('layered');
    });
  });

  describe('analyzePRRisk', () => {
    const mockPR = {
      id: 123,
      number: 1,
      title: 'Test PR',
      description: 'Test description',
      author: 'testuser',
      draft: false
    };

    test('should return risk analysis object with required fields', () => {
      const prDetails = {
        files: [{ filename: 'src/index.js', changes: 10 }],
        filesChanged: 1,
        totalChanges: 10
      };

      const result = analyzePRRisk(mockPR, prDetails);

      expect(result).toHaveProperty('riskLevel');
      expect(result).toHaveProperty('recommendedReview');
      expect(result).toHaveProperty('suspiciousPatterns');
      expect(Array.isArray(result.suspiciousPatterns)).toBe(true);
    });

    test('should return high risk for large PRs', () => {
      const prDetails = {
        files: Array.from({ length: 20 }, (_, i) => ({
          filename: `src/file${i}.js`,
          changes: 30
        })),
        filesChanged: 20,
        totalChanges: 600
      };

      const result = analyzePRRisk(mockPR, prDetails);

      expect(result.riskLevel).toBe('high');
    });

    test('should return high risk for migration files', () => {
      const prDetails = {
        files: [
          { filename: 'migrations/20240101_create_users.js', changes: 50 }
        ],
        filesChanged: 1,
        totalChanges: 50
      };

      const result = analyzePRRisk(mockPR, prDetails);

      expect(result.riskLevel).toBe('high');
    });

    test('should return high risk for auth files', () => {
      const prDetails = {
        files: [
          { filename: 'src/auth/login.js', changes: 50 }
        ],
        filesChanged: 1,
        totalChanges: 50
      };

      const result = analyzePRRisk(mockPR, prDetails);

      expect(result.riskLevel).toBe('high');
    });

    test('should return medium risk for medium-sized PRs', () => {
      const prDetails = {
        files: Array.from({ length: 5 }, (_, i) => ({
          filename: `src/file${i}.js`,
          changes: 25
        })),
        filesChanged: 5,
        totalChanges: 125
      };

      const result = analyzePRRisk(mockPR, prDetails);

      expect(result.riskLevel).toBe('medium');
    });

    test('should return low risk for small PRs', () => {
      const prDetails = {
        files: [
          { filename: 'src/utils/helper.js', changes: 10 }
        ],
        filesChanged: 1,
        totalChanges: 10
      };

      const result = analyzePRRisk(mockPR, prDetails);

      expect(result.riskLevel).toBe('low');
    });

    test('should return "review later" for draft PRs', () => {
      const draftPR = { ...mockPR, draft: true, title: 'WIP: feature' };
      const prDetails = {
        files: [{ filename: 'src/index.js', changes: 10 }],
        filesChanged: 1,
        totalChanges: 10
      };

      const result = analyzePRRisk(draftPR, prDetails);

      expect(result.recommendedReview).toBe('review later');
    });

    test('should return "review later" for WIP PRs', () => {
      const wipPR = { ...mockPR, title: '[WIP] new feature' };
      const prDetails = {
        files: [{ filename: 'src/index.js', changes: 10 }],
        filesChanged: 1,
        totalChanges: 10
      };

      const result = analyzePRRisk(wipPR, prDetails);

      expect(result.recommendedReview).toBe('review later');
    });

    test('should return "critical review" for high-risk security changes', () => {
      const prDetails = {
        files: [
          { filename: 'src/auth/password.js', changes: 50 }
        ],
        filesChanged: 1,
        totalChanges: 50
      };

      const result = analyzePRRisk(mockPR, prDetails);

      expect(result.recommendedReview).toBe('critical review');
    });

    test('should return "safe review" for low-risk changes', () => {
      const prDetails = {
        files: [
          { filename: 'src/utils/stringHelper.js', changes: 10 }
        ],
        filesChanged: 1,
        totalChanges: 10
      };

      const result = analyzePRRisk(mockPR, prDetails);

      expect(result.recommendedReview).toBe('safe review');
    });

    test('should detect database migration pattern', () => {
      const prDetails = {
        files: [
          { filename: 'migrations/20240101_add_users_table.js', changes: 50 }
        ],
        filesChanged: 1,
        totalChanges: 50
      };

      const result = analyzePRRisk(mockPR, prDetails);

      expect(result.suspiciousPatterns).toContain('database_migration');
    });

    test('should detect security changes pattern', () => {
      const prDetails = {
        files: [
          { filename: 'src/auth/jwt.js', changes: 50 }
        ],
        filesChanged: 1,
        totalChanges: 50
      };

      const result = analyzePRRisk(mockPR, prDetails);

      expect(result.suspiciousPatterns).toContain('security_changes');
    });

    test('should detect large file changes pattern', () => {
      const prDetails = {
        files: [
          { filename: 'src/largeFile.js', changes: 600 }
        ],
        filesChanged: 1,
        totalChanges: 600
      };

      const result = analyzePRRisk(mockPR, prDetails);

      expect(result.suspiciousPatterns).toContain('large_file_changes');
    });

    test('should detect config changes pattern', () => {
      const prDetails = {
        files: [
          { filename: 'config/app.config.js', changes: 10 }
        ],
        filesChanged: 1,
        totalChanges: 10
      };

      const result = analyzePRRisk(mockPR, prDetails);

      expect(result.suspiciousPatterns).toContain('config_changes');
    });

    test('should detect dependency update pattern', () => {
      const prDetails = {
        files: [
          { filename: 'package.json', changes: 10 }
        ],
        filesChanged: 1,
        totalChanges: 10
      };

      const result = analyzePRRisk(mockPR, prDetails);

      expect(result.suspiciousPatterns).toContain('dependency_update');
    });

    test('should detect test coverage reduced pattern', () => {
      const prDetails = {
        files: [
          {
            filename: 'tests/user.test.js',
            changes: 100,
            deletions: 80,
            additions: 20,
            status: 'modified'
          }
        ],
        filesChanged: 1,
        totalChanges: 100
      };

      const result = analyzePRRisk(mockPR, prDetails);

      expect(result.suspiciousPatterns).toContain('test_coverage_reduced');
    });

    test('should detect multiple suspicious patterns', () => {
      const prDetails = {
        files: [
          { filename: 'migrations/20240101_add_table.js', changes: 50 },
          { filename: 'src/auth/login.js', changes: 100 },
          { filename: 'package.json', changes: 20 }
        ],
        filesChanged: 3,
        totalChanges: 170
      };

      const result = analyzePRRisk(mockPR, prDetails);

      expect(result.suspiciousPatterns).toContain('database_migration');
      expect(result.suspiciousPatterns).toContain('security_changes');
      expect(result.suspiciousPatterns).toContain('dependency_update');
    });

    test('should return empty patterns when no suspicious files are changed', () => {
      const prDetails = {
        files: [
          { filename: 'src/utils/helper.js', changes: 10 }
        ],
        filesChanged: 1,
        totalChanges: 10
      };

      const result = analyzePRRisk(mockPR, prDetails);

      expect(result.suspiciousPatterns).toEqual([]);
    });
  });

  describe('edge cases and error handling', () => {
    const mockPR = {
      id: 123,
      number: 1,
      title: 'Test PR',
      description: 'Test',
      author: 'testuser'
    };

    test('should handle empty files array', () => {
      const prDetails = {
        files: [],
        filesChanged: 0,
        totalChanges: 0
      };

      const result = analyzePRRisk(mockPR, prDetails);

      expect(result.riskLevel).toBe('low');
      expect(result.recommendedReview).toBeDefined();
      expect(result.suspiciousPatterns).toEqual([]);
    });

    test('should handle missing PR description', () => {
      const prNoDesc = { ...mockPR, description: null };
      const prDetails = {
        files: [{ filename: 'src/index.js', changes: 10 }],
        filesChanged: 1,
        totalChanges: 10
      };

      expect(() => {
        analyzePRRisk(prNoDesc, prDetails);
      }).not.toThrow();
    });

    test('should handle missing PR title', () => {
      const prNoTitle = { ...mockPR, title: null };
      const prDetails = {
        files: [{ filename: 'src/index.js', changes: 10 }],
        filesChanged: 1,
        totalChanges: 10
      };

      expect(() => {
        analyzePRRisk(prNoTitle, prDetails);
      }).not.toThrow();
    });

    test('should handle files with missing properties', () => {
      const prDetails = {
        files: [{}],
        filesChanged: 1,
        totalChanges: 0
      };

      // Currently the code throws an error for undefined filename
      // This test documents that behavior
      expect(() => {
        analyzePRRisk(mockPR, prDetails);
      }).toThrow();
    });

    test('should handle files with null filename', () => {
      const prDetails = {
        files: [{ filename: null }],
        filesChanged: 1,
        totalChanges: 0
      };

      expect(() => {
        analyzePRRisk(mockPR, prDetails);
      }).toThrow();
    });
  });
});
