"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
/**
 * Logger utility for consistent logging across automation node
 */
class Logger {
    constructor(node, prefix = "AUTOMATION") {
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
        this.node.warn(`[${this.prefix}] ${message}`);
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
    debug(message, data) {
        if (process.env.NODE_ENV === 'development') {
            this.node.log(`[${this.prefix}:DEBUG] ${message}${data ? `: ${JSON.stringify(data)}` : ''}`);
        }
    }
}
exports.Logger = Logger;
