"use strict";
/**
 * Logger utility for VIIS RPC Control Node
 * Provides consistent logging interface
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
class Logger {
    constructor(node, prefix = "VIIS-RPC-CONTROL") {
        this.node = node;
        this.prefix = prefix;
    }
    /**
     * Log informational message
     */
    log(message) {
        this.node.log(`[${this.prefix}] ${message}`);
    }
    /**
     * Log warning message
     */
    warn(message) {
        // this.node.warn(`[${this.prefix}] ${message}`);
    }
    /**
     * Log error message
     */
    error(message) {
        this.node.error(`[${this.prefix}] ${message}`);
    }
    /**
     * Log debug message (only in development)
     */
    debug(message) {
        if (process.env.NODE_ENV === "development") {
            this.node.log(`[${this.prefix}][DEBUG] ${message}`);
        }
    }
    /**
     * Log with custom prefix
     */
    logWithPrefix(prefix, message) {
        this.node.log(`[${this.prefix}][${prefix}] ${message}`);
    }
    /**
     * Log object as JSON string
     */
    logObject(label, obj) {
        this.log(`${label}: ${JSON.stringify(obj)}`);
    }
    /**
     * Log error with stack trace
     */
    logError(message, error) {
        this.error(`${message}: ${error.message}`);
        if (error.stack && process.env.NODE_ENV === "development") {
            this.error(`Stack trace: ${error.stack}`);
        }
    }
    /**
     * Create a child logger with additional prefix
     */
    createChild(childPrefix) {
        return new Logger(this.node, `${this.prefix}:${childPrefix}`);
    }
}
exports.Logger = Logger;
