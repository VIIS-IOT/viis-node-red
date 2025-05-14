/**
 * @fileoverview Logger utility for the VIIS Sync Schedule module
 * Provides consistent logging throughout the module
 */

import { Node } from 'node-red';

/**
 * Logger utility for consistent logging
 */
export const logger = {
    /**
     * Logs an info message
     * @param node - Node-RED node instance or null
     * @param message - Message to log
     */
    info: (node: Node | null, message: string): void => {
        console.info(`[VIIS-SYNC-SCHEDULE] INFO: ${message}`);
        if (node) {
            node.log(message);
        }
    },

    /**
     * Logs a warning message
     * @param node - Node-RED node instance or null
     * @param message - Message to log
     */
    warn: (node: Node | null, message: string): void => {
        console.warn(`[VIIS-SYNC-SCHEDULE] WARNING: ${message}`);
        if (node) {
            node.warn(message);
        }
    },

    /**
     * Logs an error message
     * @param node - Node-RED node instance or null
     * @param message - Message to log
     */
    error: (node: Node | null, message: string): void => {
        console.error(`[VIIS-SYNC-SCHEDULE] ERROR: ${message}`);
        if (node) {
            node.error(message);
        }
    },

    /**
     * Logs a debug message
     * @param node - Node-RED node instance or null
     * @param message - Message to log
     */
    debug: (node: Node | null, message: string): void => {
        console.debug(`[VIIS-SYNC-SCHEDULE] DEBUG: ${message}`);
        if (node && (node as any).debug) {
            (node as any).debug(message);
        }
    }
};
