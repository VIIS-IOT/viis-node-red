"use strict";
/**
 * @fileoverview Logger utility for VIIS REST API
 * Provides consistent logging across the REST API module
 */
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.Logger = exports.LogLevel = void 0;
/**
 * Log levels
 */
var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["ERROR"] = 0] = "ERROR";
    LogLevel[LogLevel["WARN"] = 1] = "WARN";
    LogLevel[LogLevel["INFO"] = 2] = "INFO";
    LogLevel[LogLevel["DEBUG"] = 3] = "DEBUG";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
/**
 * Logger utility class
 */
class Logger {
    constructor() {
        this.logLevel = LogLevel.INFO;
    }
    /**
     * Get singleton instance
     */
    static getInstance() {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }
    /**
     * Set log level
     */
    setLogLevel(level) {
        this.logLevel = level;
    }
    /**
     * Log error message
     */
    error(node, message, data) {
        if (this.logLevel >= LogLevel.ERROR) {
            const logMessage = this.formatMessage('ERROR', message, data);
            if (node && typeof node.error === 'function') {
                node.error(logMessage);
            }
            else {
                console.error(`[VIIS-REST-API][FALLBACK] ${logMessage}`);
            }
        }
    }
    /**
     * Log warning message
     */
    warn(node, message, data) {
        if (this.logLevel >= LogLevel.WARN) {
            const logMessage = this.formatMessage('WARN', message, data);
            if (node && typeof node.warn === 'function') {
                node.warn(logMessage);
            }
            else {
                console.warn(`[VIIS-REST-API][FALLBACK] ${logMessage}`);
            }
        }
    }
    /**
     * Log info message
     */
    info(node, message, data) {
        if (this.logLevel >= LogLevel.INFO) {
            const logMessage = this.formatMessage('INFO', message, data);
            if (node && typeof node.log === 'function') {
                node.log(logMessage);
            }
            else {
                console.log(`[VIIS-REST-API][FALLBACK] ${logMessage}`);
            }
        }
    }
    /**
     * Log debug message
     */
    debug(node, message, data) {
        if (this.logLevel >= LogLevel.DEBUG) {
            const logMessage = this.formatMessage('DEBUG', message, data);
            if (node && typeof node.debug === 'function') {
                node.debug(logMessage);
            }
            else {
                console.debug(`[VIIS-REST-API][FALLBACK] ${logMessage}`);
            }
        }
    }
    /**
     * Log API request
     */
    apiRequest(node, method, url, headers, showDetails = false) {
        const message = `API Request: ${method} ${url}`;
        if (showDetails && headers) {
            this.debug(node, message, { headers });
        }
        else {
            this.info(node, message);
        }
    }
    /**
     * Log API response
     */
    apiResponse(node, method, url, statusCode, duration, showDetails = false) {
        const message = `API Response: ${method} ${url} ${statusCode} ${duration}ms`;
        if (statusCode >= 400) {
            this.warn(node, message);
        }
        else {
            this.info(node, message);
        }
    }
    /**
     * Start a timer for performance measurement
     */
    startTimer(operation) {
        const start = Date.now();
        return {
            end: () => {
                const duration = Date.now() - start;
                return duration;
            }
        };
    }
    /**
     * Format log message
     */
    formatMessage(level, message, data) {
        const timestamp = new Date().toISOString();
        let formattedMessage = `[${timestamp}] [${level}] ${message}`;
        if (data) {
            if (typeof data === 'object') {
                try {
                    formattedMessage += ` | Data: ${JSON.stringify(data, null, 2)}`;
                }
                catch (error) {
                    formattedMessage += ` | Data: [Object - JSON stringify failed]`;
                }
            }
            else {
                formattedMessage += ` | Data: ${data}`;
            }
        }
        return formattedMessage;
    }
}
exports.Logger = Logger;
/**
 * Export singleton instance
 */
exports.logger = Logger.getInstance();
// Set log level based on environment
const envLogLevel = (_a = process.env.VIIS_API_LOG_LEVEL) === null || _a === void 0 ? void 0 : _a.toUpperCase();
switch (envLogLevel) {
    case 'ERROR':
        exports.logger.setLogLevel(LogLevel.ERROR);
        break;
    case 'WARN':
        exports.logger.setLogLevel(LogLevel.WARN);
        break;
    case 'INFO':
        exports.logger.setLogLevel(LogLevel.INFO);
        break;
    case 'DEBUG':
        exports.logger.setLogLevel(LogLevel.DEBUG);
        break;
    default:
        exports.logger.setLogLevel(LogLevel.INFO);
}
