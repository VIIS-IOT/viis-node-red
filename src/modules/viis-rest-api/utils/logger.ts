/**
 * @fileoverview Logger utility for VIIS REST API
 * Provides consistent logging across the REST API module
 */

import { Node } from 'node-red';

/**
 * Log levels
 */
export enum LogLevel {
    ERROR = 0,
    WARN = 1,
    INFO = 2,
    DEBUG = 3
}

/**
 * Logger utility class
 */
export class Logger {
    private static instance: Logger;
    private logLevel: LogLevel = LogLevel.INFO;

    /**
     * Get singleton instance
     */
    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * Set log level
     */
    setLogLevel(level: LogLevel): void {
        this.logLevel = level;
    }

    /**
     * Log error message
     */
    error(node: Node, message: string, data?: any): void {
        if (this.logLevel >= LogLevel.ERROR) {
            const logMessage = this.formatMessage('ERROR', message, data);
            if (node && typeof node.error === 'function') {
                node.error(logMessage);
            } else {
                console.error(`[VIIS-REST-API][FALLBACK] ${logMessage}`);
            }
            console.error(`[VIIS-REST-API] ${logMessage}`);
        }
    }

    /**
     * Log warning message
     */
    warn(node: Node, message: string, data?: any): void {
        if (this.logLevel >= LogLevel.WARN) {
            const logMessage = this.formatMessage('WARN', message, data);
            if (node && typeof node.warn === 'function') {
                node.warn(logMessage);
            } else {
                console.warn(`[VIIS-REST-API][FALLBACK] ${logMessage}`);
            }
            console.warn(`[VIIS-REST-API] ${logMessage}`);
        }
    }

    /**
     * Log info message
     */
    info(node: Node, message: string, data?: any): void {
        if (this.logLevel >= LogLevel.INFO) {
            const logMessage = this.formatMessage('INFO', message, data);
            if (node && typeof node.log === 'function') {
                node.log(logMessage);
            } else {
                console.log(`[VIIS-REST-API][FALLBACK] ${logMessage}`);
            }
            console.log(`[VIIS-REST-API] ${logMessage}`);
        }
    }

    /**
     * Log debug message
     */
    debug(node: Node, message: string, data?: any): void {
        if (this.logLevel >= LogLevel.DEBUG) {
            const logMessage = this.formatMessage('DEBUG', message, data);
            if (node && typeof node.debug === 'function') {
                node.debug(logMessage);
            } else {
                console.debug(`[VIIS-REST-API][FALLBACK] ${logMessage}`);
            }
            console.debug(`[VIIS-REST-API] ${logMessage}`);
        }
    }

    /**
     * Log API request
     */
    apiRequest(node: Node, method: string, url: string, headers?: any, showDetails: boolean = false): void {
        const message = `API Request: ${method} ${url}`;
        if (showDetails && headers) {
            this.debug(node, message, { headers });
        } else {
            this.info(node, message);
        }
    }

    /**
     * Log API response
     */
    apiResponse(node: Node, method: string, url: string, statusCode: number, duration: number, showDetails: boolean = false): void {
        const message = `API Response: ${method} ${url} ${statusCode} ${duration}ms`;
        if (statusCode >= 400) {
            this.warn(node, message);
        } else {
            this.info(node, message);
        }
    }

    /**
     * Start a timer for performance measurement
     */
    startTimer(operation: string): { end: () => number } {
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
    private formatMessage(level: string, message: string, data?: any): string {
        const timestamp = new Date().toISOString();
        let formattedMessage = `[${timestamp}] [${level}] ${message}`;

        if (data) {
            if (typeof data === 'object') {
                try {
                    formattedMessage += ` | Data: ${JSON.stringify(data, null, 2)}`;
                } catch (error) {
                    formattedMessage += ` | Data: [Object - JSON stringify failed]`;
                }
            } else {
                formattedMessage += ` | Data: ${data}`;
            }
        }

        return formattedMessage;
    }
}

/**
 * Export singleton instance
 */
export const logger = Logger.getInstance();

// Set log level based on environment
const envLogLevel = process.env.VIIS_API_LOG_LEVEL?.toUpperCase();
switch (envLogLevel) {
    case 'ERROR':
        logger.setLogLevel(LogLevel.ERROR);
        break;
    case 'WARN':
        logger.setLogLevel(LogLevel.WARN);
        break;
    case 'INFO':
        logger.setLogLevel(LogLevel.INFO);
        break;
    case 'DEBUG':
        logger.setLogLevel(LogLevel.DEBUG);
        break;
    default:
        logger.setLogLevel(LogLevel.INFO);
}
