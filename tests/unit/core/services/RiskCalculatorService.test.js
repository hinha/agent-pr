/**
 * Unit tests for RiskCalculatorService
 */

const RiskCalculatorService = require('../../../../src/core/services/RiskCalculatorService');

describe('RiskCalculatorService', () => {
  let calculator;

  beforeEach(() => {
    calculator = new RiskCalculatorService();
  });

  describe('calculateRisk', () => {
    describe('High risk scenarios', () => {
      it('should return high risk when files changed exceed threshold', () => {
        const result = calculator.calculateRisk(20, 100, []);
        expect(result).toBe('high');
      });

      it('should return high risk when total changes exceed threshold', () => {
        const result = calculator.calculateRisk(5, 600, []);
        expect(result).toBe('high');
      });

      it('should return high risk for migration files', () => {
        const files = [
          { filename: 'db/migrations/001_init.sql' }
        ];
        const result = calculator.calculateRisk(3, 50, files);
        expect(result).toBe('high');
      });

      it('should return high risk for auth files', () => {
        const files = [
          { filename: 'src/auth/jwt.js' }
        ];
        const result = calculator.calculateRisk(3, 50, files);
        expect(result).toBe('high');
      });

      it('should return high risk for security files', () => {
        const files = [
          { filename: 'src/security/password.js' }
        ];
        const result = calculator.calculateRisk(3, 50, files);
        expect(result).toBe('high');
      });
    });

    describe('Medium risk scenarios', () => {
      it('should return medium risk when files changed meet medium threshold', () => {
        const result = calculator.calculateRisk(5, 50, []);
        expect(result).toBe('medium');
      });

      it('should return medium risk when total changes meet medium threshold', () => {
        const result = calculator.calculateRisk(3, 100, []);
        expect(result).toBe('medium');
      });

      it('should return medium risk when both thresholds are met', () => {
        const result = calculator.calculateRisk(8, 150, []);
        expect(result).toBe('medium');
      });
    });

    describe('Low risk scenarios', () => {
      it('should return low risk for small changes', () => {
        const result = calculator.calculateRisk(2, 20, []);
        expect(result).toBe('low');
      });

      it('should return low risk for single file change', () => {
        const result = calculator.calculateRisk(1, 5, []);
        expect(result).toBe('low');
      });
    });
  });

  describe('isHighRiskFile', () => {
    it('should return true for migration files', () => {
      const file = { filename: 'db/migrations/001_init.sql' };
      expect(calculator.isHighRiskFile(file)).toBe(true);
    });

    it('should return true for auth files', () => {
      const file = { filename: 'src/auth/login.js' };
      expect(calculator.isHighRiskFile(file)).toBe(true);
    });

    it('should return true for security files', () => {
      const file = { filename: 'src/security/cipher.js' };
      expect(calculator.isHighRiskFile(file)).toBe(true);
    });

    it('should return true for password files', () => {
      const file = { filename: 'src/auth/password.js' };
      expect(calculator.isHighRiskFile(file)).toBe(true);
    });

    it('should return false for normal files', () => {
      const file = { filename: 'src/utils/helpers.js' };
      expect(calculator.isHighRiskFile(file)).toBe(false);
    });

    it('should be case insensitive', () => {
      const file = { filename: 'DB/Migrations/001.SQL' };
      expect(calculator.isHighRiskFile(file)).toBe(true);
    });
  });

  describe('isLargeFileChange', () => {
    it('should return true for files exceeding threshold', () => {
      const file = { changes: 600 };
      expect(calculator.isLargeFileChange(file)).toBe(true);
    });

    it('should return false for files below threshold', () => {
      const file = { changes: 400 };
      expect(calculator.isLargeFileChange(file)).toBe(false);
    });

    it('should return false when changes property is missing', () => {
      const file = { filename: 'test.js' };
      expect(calculator.isLargeFileChange(file)).toBe(false);
    });
  });

  describe('calculateRiskScore', () => {
    it('should return score from 0 to 100', () => {
      const score = calculator.calculateRiskScore(5, 100, []);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should return higher score for larger changes', () => {
      const lowScore = calculator.calculateRiskScore(2, 20, []);
      const highScore = calculator.calculateRiskScore(15, 400, []);
      expect(highScore).toBeGreaterThan(lowScore);
    });

    it('should include pattern risk in score', () => {
      const files = [{ filename: 'db/migrations/001.sql' }];
      const score = calculator.calculateRiskScore(3, 50, files);
      expect(score).toBeGreaterThan(0);
    });
  });

  describe('isValidRiskLevel', () => {
    it('should return true for valid risk levels', () => {
      expect(calculator.isValidRiskLevel('low')).toBe(true);
      expect(calculator.isValidRiskLevel('medium')).toBe(true);
      expect(calculator.isValidRiskLevel('high')).toBe(true);
    });

    it('should return false for invalid risk levels', () => {
      expect(calculator.isValidRiskLevel('critical')).toBe(false);
      expect(calculator.isValidRiskLevel('')).toBe(false);
      expect(calculator.isValidRiskLevel(null)).toBe(false);
    });
  });

  describe('getRiskWeight', () => {
    it('should return 0 for low risk', () => {
      expect(calculator.getRiskWeight('low')).toBe(0);
    });

    it('should return 1 for medium risk', () => {
      expect(calculator.getRiskWeight('medium')).toBe(1);
    });

    it('should return 2 for high risk', () => {
      expect(calculator.getRiskWeight('high')).toBe(2);
    });

    it('should return 0 for unknown risk', () => {
      expect(calculator.getRiskWeight('unknown')).toBe(0);
    });
  });

  describe('compareRisk', () => {
    it('should return negative when first risk is lower', () => {
      expect(calculator.compareRisk('low', 'high')).toBeLessThan(0);
    });

    it('should return positive when first risk is higher', () => {
      expect(calculator.compareRisk('high', 'low')).toBeGreaterThan(0);
    });

    it('should return zero when risks are equal', () => {
      expect(calculator.compareRisk('medium', 'medium')).toBe(0);
    });
  });

  describe('custom thresholds', () => {
    it('should use custom thresholds when provided', () => {
      const customCalculator = new RiskCalculatorService({
        thresholds: {
          HIGH_RISK_FILE_COUNT: 5,
          MEDIUM_RISK_FILE_COUNT: 2
        }
      });

      expect(customCalculator.calculateRisk(6, 50, [])).toBe('high');
      expect(customCalculator.calculateRisk(3, 50, [])).toBe('medium');
    });
  });
});
