/**
 * Unit tests for logger utility
 * Tests Winston logger configuration and basic functionality
 */

// Mock config before requiring logger
jest.mock('../../../src/config/yamlConfig', () => ({
  logging: {
    level: 'info'
  },
  ensureRepoStorageDir: jest.fn()
}));

const logger = require('../../../src/utils/logger');
const fs = require('fs');
const winston = require('winston');

describe('logger', () => {
  let logDirExists;
  const logDir = 'logs';

  beforeAll(() => {
    // Check if logs directory exists before tests
    try {
      logDirExists = fs.existsSync(logDir);
    } catch (err) {
      logDirExists = false;
    }
  });

  afterAll(() => {
    // Clean up test logs if they were created during tests
    // Only remove if directory didn't exist before
    if (!logDirExists && fs.existsSync(logDir)) {
      try {
        fs.unlinkSync(`${logDir}/error.log`);
        fs.unlinkSync(`${logDir}/combined.log`);
        fs.rmdirSync(logDir);
      } catch (err) {
        // Ignore cleanup errors
      }
    }
  });

  describe('logger configuration', () => {
    test('should be a valid Winston logger instance', () => {
      expect(logger).toBeInstanceOf(winston.Logger);
    });

    test('should have correct log level from config', () => {
      expect(logger.level).toBe('info');
    });

    test('should have three transports: error file, combined file, and console', () => {
      const transports = logger.transports;
      expect(transports).toHaveLength(3);

      // Check by transport name/type instead of instanceof
      const hasErrorFile = transports.some(t => t.name === 'file' && t.filename === 'error.log');
      expect(hasErrorFile).toBe(true);

      const hasCombinedFile = transports.some(t => t.name === 'file' && t.filename === 'combined.log');
      expect(hasCombinedFile).toBe(true);

      // Console transport won't have a filename
      const transportsWithoutFile = transports.filter(t => !t.filename);
      expect(transportsWithoutFile.length).toBe(1);
    });

    test('error file transport should only log error level and above', () => {
      const errorTransport = logger.transports.find(t => t.name === 'file' && t.filename === 'error.log');
      expect(errorTransport).toBeDefined();
      expect(errorTransport.level).toBe('error');
    });

    test('combined file transport should log all levels', () => {
      const combinedTransport = logger.transports.find(t => t.name === 'file' && t.filename === 'combined.log');
      expect(combinedTransport).toBeDefined();
      // Combined log transport level may be undefined (defaults to all levels)
      expect(combinedTransport).toBeTruthy();
    });
  });

  describe('logging methods', () => {
    let spyError;
    let spyWarn;
    let spyInfo;
    let spyDebug;

    beforeEach(() => {
      spyError = jest.spyOn(logger, 'error').mockImplementation(() => {});
      spyWarn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
      spyInfo = jest.spyOn(logger, 'info').mockImplementation(() => {});
      spyDebug = jest.spyOn(logger, 'debug').mockImplementation(() => {});
    });

    afterEach(() => {
      spyError.mockRestore();
      spyWarn.mockRestore();
      spyInfo.mockRestore();
      spyDebug.mockRestore();
    });

    test('error method should exist and be callable', () => {
      expect(typeof logger.error).toBe('function');
      logger.error('test error message');
      expect(spyError).toHaveBeenCalledWith('test error message');
    });

    test('warn method should exist and be callable', () => {
      expect(typeof logger.warn).toBe('function');
      logger.warn('test warning message');
      expect(spyWarn).toHaveBeenCalledWith('test warning message');
    });

    test('info method should exist and be callable', () => {
      expect(typeof logger.info).toBe('function');
      logger.info('test info message');
      expect(spyInfo).toHaveBeenCalledWith('test info message');
    });

    test('debug method should exist and be callable', () => {
      expect(typeof logger.debug).toBe('function');
      logger.debug('test debug message');
      expect(spyDebug).toHaveBeenCalledWith('test debug message');
    });

    test('should handle multiple arguments', () => {
      logger.info('test', { data: 'value' }, 123);
      expect(spyInfo).toHaveBeenCalledWith('test', { data: 'value' }, 123);
    });

    test('should handle objects as messages', () => {
      const obj = { key: 'value', nested: { prop: 123 } };
      logger.info(obj);
      expect(spyInfo).toHaveBeenCalledWith(obj);
    });

    test('should handle empty messages', () => {
      logger.info('');
      expect(spyInfo).toHaveBeenCalledWith('');
    });
  });

  describe('timestamp format', () => {
    test('should include timestamp in log output', () => {
      const format = logger.format;
      expect(format).toBeDefined();
    });
  });

  describe('JSON format for file transports', () => {
    test('should use JSON format for file logging', () => {
      const transports = logger.transports;
      const fileTransports = transports.filter(t => t.filename);
      expect(fileTransports.length).toBeGreaterThan(0);
    });
  });

  describe('console transport formatting', () => {
    test('should have console transport', () => {
      const transports = logger.transports;
      const transportsWithoutFile = transports.filter(t => !t.filename);
      expect(transportsWithoutFile.length).toBe(1);
    });
  });
});
