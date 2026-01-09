import { Node } from "node-red";

/**
 * Logger utility for consistent logging across automation node
 */
export class Logger {
    private node: Node;
    private prefix: string;

    constructor(node: Node, prefix: string = "AUTOMATION") {
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
        this.node.warn(`[${this.prefix}] ${message}`);
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
    debug(message: string, data?: any): void {
        if (process.env.NODE_ENV === 'development') {
            this.node.log(`[${this.prefix}:DEBUG] ${message}${data ? `: ${JSON.stringify(data)}` : ''}`);
        }
    }
}
