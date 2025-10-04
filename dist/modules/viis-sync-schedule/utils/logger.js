"use strict";
/**
 * @fileoverview Logger utility for the VIIS Sync Schedule module
 * Provides consistent logging throughout the module
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
/**
 * Logger utility for consistent logging
 */
exports.logger = {
    /**
     * Logs an info message
     * @param node - Node-RED node instance or null
     * @param message - Message to log
     */
    info: (node, message) => {
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
    warn: (node, message) => {
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
    error: (node, message) => {
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
    debug: (node, message) => {
        console.debug(`[VIIS-SYNC-SCHEDULE] DEBUG: ${message}`);
        if (node && node.debug) {
            node.debug(message);
        }
    }
};
