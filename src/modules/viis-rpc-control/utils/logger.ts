/**
 * Logger utility for VIIS RPC Control Node
 * Provides consistent logging interface
 */

import { Node } from "node-red";
import { ILogger } from "../interfaces/types";

export class Logger implements ILogger {
    private node: Node;
    private prefix: string;

    constructor(node: Node, prefix: string = "VIIS-RPC-CONTROL") {
        this.node = node;
        this.prefix = prefix;
    }

    /**
     * Log informational message
     */
    log(message: string): void {
        this.node.log(`[${this.prefix}] ${message}`);
    }

    /**
     * Log warning message
     */
    warn(message: string): void {
        // this.node.warn(`[${this.prefix}] ${message}`);
    }

    /**
     * Log error message
     */
    error(message: string): void {
        this.node.error(`[${this.prefix}] ${message}`);
    }

    /**
     * Log debug message (only in development)
     */
    debug(message: string): void {
        if (process.env.NODE_ENV === "development") {
            this.node.log(`[${this.prefix}][DEBUG] ${message}`);
        }
    }

    /**
     * Log with custom prefix
     */
    logWithPrefix(prefix: string, message: string): void {
        this.node.log(`[${this.prefix}][${prefix}] ${message}`);
    }

    /**
     * Log object as JSON string
     */
    logObject(label: string, obj: any): void {
        this.log(`${label}: ${JSON.stringify(obj)}`);
    }

    /**
     * Log error with stack trace
     */
    logError(message: string, error: Error): void {
        this.error(`${message}: ${error.message}`);
        if (error.stack && process.env.NODE_ENV === "development") {
            this.error(`Stack trace: ${error.stack}`);
        }
    }

    /**
     * Create a child logger with additional prefix
     */
    createChild(childPrefix: string): Logger {
        return new Logger(this.node, `${this.prefix}:${childPrefix}`);
    }
}
