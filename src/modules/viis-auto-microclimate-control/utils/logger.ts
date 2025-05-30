/**
 * Logger utility for VIIS Auto Microclimate Control Node
 * Provides consistent logging across all services
 */

import { ILogger } from "../interfaces/types";

export class Logger implements ILogger {
    private node: any;
    private nodeId: string;
    private debugMode: boolean;

    constructor(node: any, nodeId: string, debugMode: boolean = false) {
        this.node = node;
        this.nodeId = nodeId;
        this.debugMode = debugMode;
    }

    /**
     * Log informational message
     */
    log(message: string): void {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${this.nodeId}] ${message}`;
        
        if (this.node && this.node.log) {
            this.node.log(logMessage);
        } else {
            console.log(logMessage);
        }
    }

    /**
     * Log warning message
     */
    warn(message: string): void {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${this.nodeId}] WARNING: ${message}`;
        
        if (this.node && this.node.warn) {
            this.node.warn(logMessage);
        } else {
            console.warn(logMessage);
        }
    }

    /**
     * Log error message
     */
    error(message: string): void {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${this.nodeId}] ERROR: ${message}`;
        
        if (this.node && this.node.error) {
            this.node.error(logMessage);
        } else {
            console.error(logMessage);
        }
    }

    /**
     * Log debug message (only if debug mode is enabled)
     */
    debug(message: string): void {
        if (!this.debugMode) {
            return;
        }

        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${this.nodeId}] DEBUG: ${message}`;
        
        if (this.node && this.node.debug) {
            this.node.debug(logMessage);
        } else {
            console.debug(logMessage);
        }
    }

    /**
     * Enable or disable debug mode
     */
    setDebugMode(enabled: boolean): void {
        this.debugMode = enabled;
    }

    /**
     * Get current debug mode status
     */
    isDebugMode(): boolean {
        return this.debugMode;
    }
}
