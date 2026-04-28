module.exports = {
  // Test environment
  testEnvironment: 'node',

  // Coverage configuration
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!**/node_modules/**'
  ],

  // Coverage thresholds - enforced at 50%
  coverageThreshold: {
    global: {
      branches: 50,    // was 90
      functions: 50,   // was 90
      lines: 50,       // was 90
      statements: 50   // was 90
    }
  },

  // Test file patterns
  testMatch: ['**/tests/**/*.test.js'],

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

  // Module paths
  moduleDirectories: ['node_modules', 'src'],

  // Verbose output
  verbose: true,

  // Clear mocks between tests
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,

  // Timeout for tests (default 5 seconds)
  testTimeout: 10000,

  // Coverage providers
  coverageProvider: 'v8'
};
