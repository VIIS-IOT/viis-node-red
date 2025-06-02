/**
 * @fileoverview Enhanced Logger utility for VIIS Sync Customer User module
 * Provides structured logging with detailed API and operation tracking
 */

import { Node } from 'node-red';
import { AxiosRequestConfig, AxiosResponse } from 'axios';

/**
 * Interface for API request logging data
 */
interface ApiRequestLog {
    method: string;
    url: string;
    headers?: Record<string, any>;
    params?: Record<string, any>;
    data?: any;
    timestamp: string;
}

/**
 * Interface for API response logging data
 */
interface ApiResponseLog {
    status: number;
    statusText: string;
    headers?: Record<string, any>;
    data?: any;
    duration: number;
    timestamp: string;
}

/**
 * Interface for operation timing
 */
interface OperationTimer {
    startTime: number;
    operation: string;
}

/**
 * Enhanced logger utility for customer user sync node
 */
export const logger = {
    /**
     * Logs an info message
     * @param node - Node-RED node instance (can be null)
     * @param message - Message to log
     */
    info(node: Node | null, message: string): void {
        const timestamp = new Date().toISOString();
        const logMessage = `[VIIS Sync Customer User] [${timestamp}] INFO: ${message}`;

        if (node && node.log) {
            node.log(logMessage);
        } else {
            console.log(logMessage);
        }
    },

    /**
     * Logs a warning message
     * @param node - Node-RED node instance (can be null)
     * @param message - Message to log
     */
    warn(node: Node | null, message: string): void {
        const timestamp = new Date().toISOString();
        const logMessage = `[VIIS Sync Customer User] [${timestamp}] WARNING: ${message}`;

        if (node && node.warn) {
            node.warn(logMessage);
        } else {
            console.warn(logMessage);
        }
    },

    /**
     * Logs an error message
     * @param node - Node-RED node instance (can be null)
     * @param message - Message to log
     */
    error(node: Node | null, message: string): void {
        const timestamp = new Date().toISOString();
        const logMessage = `[VIIS Sync Customer User] [${timestamp}] ERROR: ${message}`;

        if (node && node.error) {
            node.error(logMessage);
        } else {
            console.error(logMessage);
        }
    },

    /**
     * Logs a debug message if detailed logging is enabled
     * @param node - Node-RED node instance (can be null)
     * @param message - Message to log
     * @param showDetailedLogs - Whether to show detailed logs
     */
    debug(node: Node | null, message: string, showDetailedLogs: boolean): void {
        if (showDetailedLogs) {
            const timestamp = new Date().toISOString();
            const logMessage = `[VIIS Sync Customer User] [${timestamp}] DEBUG: ${message}`;

            if (node && node.debug) {
                node.debug(logMessage);
            } else {
                console.debug(logMessage);
            }
        }
    },

    /**
     * Logs an error with full stack trace
     * @param node - Node-RED node instance (can be null)
     * @param message - Error message
     * @param error - Error object
     * @param showDetailedLogs - Whether to show detailed logs
     */
    errorWithStack(node: Node | null, message: string, error: Error, showDetailedLogs: boolean = false): void {
        const timestamp = new Date().toISOString();
        const errorMessage = `[VIIS Sync Customer User] [${timestamp}] ERROR: ${message} - ${error.message}`;

        if (node && node.error) {
            node.error(errorMessage);
        } else {
            console.error(errorMessage);
        }

        if (showDetailedLogs && error.stack) {
            const stackMessage = `[VIIS Sync Customer User] [${timestamp}] STACK TRACE: ${error.stack}`;
            if (node && node.debug) {
                node.debug(stackMessage);
            } else {
                console.debug(stackMessage);
            }
        }
    },

    /**
     * Logs API request details
     * @param node - Node-RED node instance (can be null)
     * @param method - HTTP method
     * @param url - Request URL
     * @param config - Axios request config
     * @param showDetailedLogs - Whether to show detailed logs
     */
    apiRequest(node: Node | null, method: string, url: string, config?: AxiosRequestConfig, showDetailedLogs: boolean = false): void {
        const timestamp = new Date().toISOString();
        const requestLog: ApiRequestLog = {
            method: method.toUpperCase(),
            url,
            timestamp
        };

        if (showDetailedLogs && config) {
            requestLog.headers = config.headers;
            requestLog.params = config.params;
            requestLog.data = config.data;
        }

        const logMessage = `API REQUEST: ${requestLog.method} ${requestLog.url}`;
        this.info(node, logMessage);

        if (showDetailedLogs) {
            this.debug(node, `API REQUEST DETAILS: ${JSON.stringify(requestLog, null, 2)}`, true);
        }
    },

    /**
     * Logs API response details
     * @param node - Node-RED node instance (can be null)
     * @param response - Axios response
     * @param duration - Request duration in milliseconds
     * @param showDetailedLogs - Whether to show detailed logs
     */
    apiResponse(node: Node | null, response: AxiosResponse, duration: number, showDetailedLogs: boolean = false): void {
        const timestamp = new Date().toISOString();
        const responseLog: ApiResponseLog = {
            status: response.status,
            statusText: response.statusText,
            duration,
            timestamp
        };

        if (showDetailedLogs) {
            responseLog.headers = response.headers;
            responseLog.data = response.data;
        }

        const logMessage = `API RESPONSE: ${responseLog.status} ${responseLog.statusText} (${duration}ms)`;
        this.info(node, logMessage);

        if (showDetailedLogs) {
            this.debug(node, `API RESPONSE DETAILS: ${JSON.stringify(responseLog, null, 2)}`, true);
        }
    },

    /**
     * Logs API error details
     * @param node - Node-RED node instance (can be null)
     * @param error - Axios error
     * @param duration - Request duration in milliseconds
     * @param showDetailedLogs - Whether to show detailed logs
     */
    apiError(node: Node | null, error: any, duration: number, showDetailedLogs: boolean = false): void {
        const timestamp = new Date().toISOString();
        let errorMessage = `API ERROR after ${duration}ms: `;

        if (error.response) {
            // Server responded with error status
            errorMessage += `${error.response.status} ${error.response.statusText}`;
            this.error(node, errorMessage);

            if (showDetailedLogs) {
                this.debug(node, `API ERROR RESPONSE: ${JSON.stringify(error.response.data, null, 2)}`, true);
            }
        } else if (error.request) {
            // Request was made but no response received
            errorMessage += 'No response received';
            this.error(node, errorMessage);

            if (showDetailedLogs) {
                this.debug(node, `API ERROR REQUEST: ${JSON.stringify(error.request, null, 2)}`, true);
            }
        } else {
            // Something else happened
            errorMessage += error.message;
            this.error(node, errorMessage);
        }

        if (showDetailedLogs && error.config) {
            this.debug(node, `API ERROR CONFIG: ${JSON.stringify(error.config, null, 2)}`, true);
        }
    },

    /**
     * Starts timing an operation
     * @param operation - Name of the operation being timed
     * @returns Timer object
     */
    startTimer(operation: string): OperationTimer {
        return {
            startTime: Date.now(),
            operation
        };
    },

    /**
     * Ends timing an operation and logs the duration
     * @param node - Node-RED node instance (can be null)
     * @param timer - Timer object from startTimer
     * @param showDetailedLogs - Whether to show detailed logs
     */
    endTimer(node: Node | null, timer: OperationTimer, showDetailedLogs: boolean = false): number {
        const duration = Date.now() - timer.startTime;
        const message = `OPERATION TIMING: ${timer.operation} completed in ${duration}ms`;

        if (showDetailedLogs) {
            this.debug(node, message, true);
        } else {
            this.info(node, message);
        }

        return duration;
    },

    /**
     * Logs database operation details
     * @param node - Node-RED node instance (can be null)
     * @param operation - Database operation type
     * @param entity - Entity name
     * @param details - Operation details
     * @param showDetailedLogs - Whether to show detailed logs
     */
    dbOperation(node: Node | null, operation: string, entity: string, details?: any, showDetailedLogs: boolean = false): void {
        const message = `DB OPERATION: ${operation} on ${entity}`;
        this.info(node, message);

        if (showDetailedLogs && details) {
            this.debug(node, `DB OPERATION DETAILS: ${JSON.stringify(details, null, 2)}`, true);
        }
    },

    /**
     * Logs sync statistics
     * @param node - Node-RED node instance (can be null)
     * @param stats - Sync statistics object
     * @param showDetailedLogs - Whether to show detailed logs
     */
    syncStats(node: Node | null, stats: any, showDetailedLogs: boolean = false): void {
        const message = `SYNC STATS: ${JSON.stringify(stats)}`;
        this.info(node, message);

        if (showDetailedLogs) {
            this.debug(node, `DETAILED SYNC STATS: ${JSON.stringify(stats, null, 2)}`, true);
        }
    }
};
