const winston = require('winston');
const path = require('path');

/**
 * LoggerFactory - Centralized logger creation
 *
 * Provides a consistent way to create Winston logger instances
 * across the application with predefined formats and transports.
 */
class LoggerFactory {
  /**
   * Create a Winston logger instance
   *
   * @param {Object} options - Logger configuration options
   * @param {string} options.context - Context label for the logger (e.g., 'MCPService', 'TelegramBot')
   * @param {string} options.level - Log level (default: from process.env.LOG_LEVEL or 'info')
   * @param {string} options.dir - Directory for log files (default: 'logs')
   * @param {boolean} options.console - Enable console logging (default: true)
   * @param {boolean} options.file - Enable file logging (default: true)
   * @returns {Object} Winston logger instance
   */
  static create(options = {}) {
    const {
      context = 'App',
      level = process.env.LOG_LEVEL || 'info',
      dir = 'logs',
      console: enableConsole = true,
      file: enableFile = true
    } = options;

    // Define log format
    const logFormat = winston.format.combine(
      winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
      }),
      winston.format.label({ label: context }),
      winston.format.errors({ stack: true }),
      winston.format.splat(),
      winston.format.json()
    );

    // Console format (colorized for readability)
    const consoleFormat = winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({
        format: 'HH:mm:ss'
      }),
      winston.format.label({ label: context }),
      winston.format.printf(({ timestamp, label, level, message, ...meta }) => {
        let msg = `${timestamp} [${label}] ${level}: ${message}`;
        if (Object.keys(meta).length > 0 && meta.level !== undefined) {
          // Skip if it's just the level property
        } else if (Object.keys(meta).length > 0) {
          msg += ` ${JSON.stringify(meta)}`;
        }
        return msg;
      })
    );

    // Build transports array
    const transports = [];

    if (enableFile) {
      // Ensure log directory exists
      const fs = require('fs');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Error log file (errors only)
      transports.push(
        new winston.transports.File({
          filename: path.join(dir, 'error.log'),
          level: 'error',
          format: logFormat
        })
      );

      // Combined log file (all levels)
      transports.push(
        new winston.transports.File({
          filename: path.join(dir, 'combined.log'),
          format: logFormat
        })
      );
    }

    if (enableConsole) {
      transports.push(
        new winston.transports.Console({
          format: consoleFormat
        })
      );
    }

    // Create and return logger
    return winston.createLogger({
      level,
      transports,
      exitOnError: false
    });
  }

  /**
   * Create a child logger with a specific context
   * @param {Object} parentLogger - Parent Winston logger
   * @param {string} childContext - Child context label
   * @returns {Object} Child logger instance
   */
  static createChild(parentLogger, childContext) {
    return parentLogger.child({
      label: `${parentLogger.label || 'App'}:${childContext}`
    });
  }

  /**
   * Create a logger for a specific module/class
   * @param {string} moduleName - Name of the module
   * @param {Object} options - Additional logger options
   * @returns {Object} Winston logger instance
   */
  static forModule(moduleName, options = {}) {
    return this.create({
      ...options,
      context: moduleName
    });
  }

  /**
   * Get the default application logger
   * @returns {Object} Winston logger instance
   */
  static getDefault() {
    if (!this.defaultLogger) {
      this.defaultLogger = this.create({
        context: 'App'
      });
    }
    return this.defaultLogger;
  }
}

module.exports = LoggerFactory;
