/**
 * Unit tests for ReviewComment entity
 */

const ReviewComment = require('../../../../src/core/entities/ReviewComment');

describe('ReviewComment Entity', () => {
  describe('constructor', () => {
    it('should create ReviewComment with all fields', () => {
      const comment = new ReviewComment({
        file: 'src/app.js',
        line: 42,
        message: 'Bug here',
        severity: 'HIGH',
        suggestedCode: 'const x = 1;'
      });

      expect(comment.file).toBe('src/app.js');
      expect(comment.line).toBe(42);
      expect(comment.message).toBe('Bug here');
      expect(comment.severity).toBe('HIGH');
      expect(comment.suggestedCode).toBe('const x = 1;');
    });

    it('should default severity to LOW', () => {
      const comment = new ReviewComment({
        file: 'src/app.js',
        line: 42,
        message: 'Minor issue'
      });

      expect(comment.severity).toBe('LOW');
    });

    it('should default suggestedCode to null', () => {
      const comment = new ReviewComment({
        file: 'src/app.js',
        line: 42,
        message: 'Issue'
      });

      expect(comment.suggestedCode).toBeNull();
    });
  });

  describe('isHighSeverity', () => {
    it('should return true for HIGH severity', () => {
      const comment = new ReviewComment({
        file: 'a.js', line: 1, message: 'Bug', severity: 'HIGH'
      });
      expect(comment.isHighSeverity()).toBe(true);
    });

    it('should return false for non-HIGH severity', () => {
      const comment = new ReviewComment({
        file: 'a.js', line: 1, message: 'Bug', severity: 'MEDIUM'
      });
      expect(comment.isHighSeverity()).toBe(false);
    });
  });

  describe('isMediumSeverity', () => {
    it('should return true for MEDIUM severity', () => {
      const comment = new ReviewComment({
        file: 'a.js', line: 1, message: 'Bug', severity: 'MEDIUM'
      });
      expect(comment.isMediumSeverity()).toBe(true);
    });

    it('should return false for non-MEDIUM severity', () => {
      const comment = new ReviewComment({
        file: 'a.js', line: 1, message: 'Bug', severity: 'LOW'
      });
      expect(comment.isMediumSeverity()).toBe(false);
    });
  });

  describe('hasSuggestedCode', () => {
    it('should return true when suggestedCode exists', () => {
      const comment = new ReviewComment({
        file: 'a.js', line: 1, message: 'Bug',
        suggestedCode: 'fix()'
      });
      expect(comment.hasSuggestedCode()).toBe(true);
    });

    it('should return false when suggestedCode is null', () => {
      const comment = new ReviewComment({
        file: 'a.js', line: 1, message: 'Bug'
      });
      expect(comment.hasSuggestedCode()).toBe(false);
    });

    it('should return false when suggestedCode is empty string', () => {
      const comment = new ReviewComment({
        file: 'a.js', line: 1, message: 'Bug',
        suggestedCode: ''
      });
      expect(comment.hasSuggestedCode()).toBe(false);
    });
  });

  describe('validate', () => {
    it('should return valid for correct data', () => {
      const comment = new ReviewComment({
        file: 'src/app.js',
        line: 42,
        message: 'Bug here',
        severity: 'HIGH'
      });

      const result = comment.validate();
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should return error for missing file', () => {
      const comment = new ReviewComment({
        line: 42,
        message: 'Bug',
        severity: 'LOW'
      });

      const result = comment.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('file is required and must be a string');
    });

    it('should return error for non-string file', () => {
      const comment = new ReviewComment({
        file: 123,
        line: 42,
        message: 'Bug',
        severity: 'LOW'
      });

      const result = comment.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('file is required and must be a string');
    });

    it('should return error for missing line', () => {
      const comment = new ReviewComment({
        file: 'a.js',
        message: 'Bug',
        severity: 'LOW'
      });

      const result = comment.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('line is required and must be a number');
    });

    it('should return error for non-number line', () => {
      const comment = new ReviewComment({
        file: 'a.js',
        line: '42',
        message: 'Bug',
        severity: 'LOW'
      });

      const result = comment.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('line is required and must be a number');
    });

    it('should return error for missing message', () => {
      const comment = new ReviewComment({
        file: 'a.js',
        line: 1,
        severity: 'LOW'
      });

      const result = comment.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('message is required and must be a string');
    });

    it('should return error for invalid severity', () => {
      const comment = new ReviewComment({
        file: 'a.js',
        line: 1,
        message: 'Bug',
        severity: 'CRITICAL'
      });

      const result = comment.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('severity must be LOW, MEDIUM, or HIGH');
    });

    it('should collect multiple errors at once', () => {
      const comment = new ReviewComment({});

      const result = comment.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('toJSON', () => {
    it('should return plain object with all fields', () => {
      const comment = new ReviewComment({
        file: 'src/app.js',
        line: 42,
        message: 'Bug',
        severity: 'HIGH',
        suggestedCode: 'fix()'
      });

      const json = comment.toJSON();

      expect(json).toEqual({
        file: 'src/app.js',
        line: 42,
        message: 'Bug',
        severity: 'HIGH',
        suggestedCode: 'fix()'
      });
    });
  });
});
