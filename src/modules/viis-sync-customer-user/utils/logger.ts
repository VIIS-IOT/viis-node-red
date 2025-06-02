/**
 * @fileoverview Logger utility for VIIS Sync Customer User module
 * Provides structured logging for the node
 */

import { Node } from 'node-red';

/**
 * Logger utility for customer user sync node
 */
export const logger = {
    /**
     * Logs an info message
     * @param node - Node-RED node instance
     * @param message - Message to log
     */
    info(node: Node, message: string): void {
        node.log(`[VIIS Sync Customer User] INFO: ${message}`);
    },

    /**
     * Logs a warning message
     * @param node - Node-RED node instance
     * @param message - Message to log
     */
    warn(node: Node, message: string): void {
        node.warn(`[VIIS Sync Customer User] WARNING: ${message}`);
    },

    /**
     * Logs an error message
     * @param node - Node-RED node instance
     * @param message - Message to log
     */
    error(node: Node, message: string): void {
        node.error(`[VIIS Sync Customer User] ERROR: ${message}`);
    },

    /**
     * Logs a debug message if detailed logging is enabled
     * @param node - Node-RED node instance
     * @param message - Message to log
     * @param showDetailedLogs - Whether to show detailed logs
     */
    debug(node: Node, message: string, showDetailedLogs: boolean): void {
        if (showDetailedLogs) {
            node.debug(`[VIIS Sync Customer User] DEBUG: ${message}`);
        }
    }
};
