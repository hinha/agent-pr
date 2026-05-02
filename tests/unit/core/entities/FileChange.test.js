/**
 * Unit tests for FileChange entity
 */

const FileChange = require('../../../../src/core/entities/FileChange');

describe('FileChange Entity', () => {
  describe('constructor', () => {
    it('should create FileChange with all fields', () => {
      const fc = new FileChange({
        filename: 'src/app.js',
        additions: 10,
        deletions: 5,
        changes: 15,
        status: 'modified'
      });

      expect(fc.filename).toBe('src/app.js');
      expect(fc.additions).toBe(10);
      expect(fc.deletions).toBe(5);
      expect(fc.changes).toBe(15);
      expect(fc.status).toBe('modified');
    });

    it('should default additions, deletions, changes to 0', () => {
      const fc = new FileChange({ filename: 'src/app.js' });

      expect(fc.additions).toBe(0);
      expect(fc.deletions).toBe(0);
      expect(fc.changes).toBe(0);
    });

    it('should default status to modified', () => {
      const fc = new FileChange({ filename: 'src/app.js' });

      expect(fc.status).toBe('modified');
    });
  });

  describe('isTestFile', () => {
    it.each([
      'src/app.test.js',
      'src/app_test.go',
      'src/app_test.ts',
      'tests/e2e_test/foo.go',
      'tests/e2e/bar.js',
      'src/__tests__/app.js',
      'src/test/helper.js',
      'src/tests/foo.js',
      'src/spec/bar.js',
      'src/app_spec.ts',
      'src/app.spec.ts',
      'docs/swagger.json',
      'docs/swagger.yaml',
      'docs/swagger.yml',
      'docs/openapi.json',
      'docs/openapi.yaml',
      'docs/openapi.yml'
    ])('should return true for %s', (filename) => {
      const fc = new FileChange({ filename });
      expect(fc.isTestFile()).toBe(true);
    });

    it('should return false for non-test files', () => {
      const fc = new FileChange({ filename: 'src/app.js' });
      expect(fc.isTestFile()).toBe(false);
    });

    it('should return false for production code', () => {
      const fc = new FileChange({ filename: 'src/services/UserService.js' });
      expect(fc.isTestFile()).toBe(false);
    });
  });

  describe('getExtension', () => {
    it('should return extension with dot', () => {
      expect(new FileChange({ filename: 'app.js' }).getExtension()).toBe('.js');
      expect(new FileChange({ filename: 'app.ts' }).getExtension()).toBe('.ts');
      expect(new FileChange({ filename: 'app.test.py' }).getExtension()).toBe('.py');
    });

    it('should return empty string for no extension', () => {
      expect(new FileChange({ filename: 'Makefile' }).getExtension()).toBe('');
    });

    it('should handle path with dots in directories', () => {
      expect(new FileChange({ filename: 'src/v2.0/app.js' }).getExtension()).toBe('.js');
    });
  });

  describe('isModified', () => {
    it('should return true for modified status', () => {
      const fc = new FileChange({ filename: 'a.js', status: 'modified' });
      expect(fc.isModified()).toBe(true);
    });

    it('should return false for other statuses', () => {
      const fc = new FileChange({ filename: 'a.js', status: 'added' });
      expect(fc.isModified()).toBe(false);
    });
  });

  describe('isAdded', () => {
    it('should return true for added status', () => {
      const fc = new FileChange({ filename: 'a.js', status: 'added' });
      expect(fc.isAdded()).toBe(true);
    });

    it('should return false for other statuses', () => {
      const fc = new FileChange({ filename: 'a.js', status: 'modified' });
      expect(fc.isAdded()).toBe(false);
    });
  });

  describe('isDeleted', () => {
    it('should return true for deleted status', () => {
      const fc = new FileChange({ filename: 'a.js', status: 'deleted' });
      expect(fc.isDeleted()).toBe(true);
    });

    it('should return false for other statuses', () => {
      const fc = new FileChange({ filename: 'a.js', status: 'modified' });
      expect(fc.isDeleted()).toBe(false);
    });
  });

  describe('getChangeRatio', () => {
    it('should return additions when deletions is 0', () => {
      const fc = new FileChange({ filename: 'a.js', additions: 10, deletions: 0 });
      expect(fc.getChangeRatio()).toBe(10);
    });

    it('should return ratio when both are non-zero', () => {
      const fc = new FileChange({ filename: 'a.js', additions: 10, deletions: 5 });
      expect(fc.getChangeRatio()).toBe(2);
    });

    it('should handle fractional ratio', () => {
      const fc = new FileChange({ filename: 'a.js', additions: 5, deletions: 10 });
      expect(fc.getChangeRatio()).toBe(0.5);
    });
  });

  describe('toJSON', () => {
    it('should return plain object with computed isTestFile', () => {
      const fc = new FileChange({
        filename: 'app.test.js',
        additions: 10,
        deletions: 5,
        changes: 15,
        status: 'modified'
      });

      const json = fc.toJSON();

      expect(json).toEqual({
        filename: 'app.test.js',
        additions: 10,
        deletions: 5,
        changes: 15,
        status: 'modified',
        isTestFile: true
      });
    });
  });
});
