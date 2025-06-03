"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
/**
 * Logger utility class for VIIS Modbus Poller Node
 */
class Logger {
    constructor(node, enableDebug = false) {
        this.node = node;
        this.enableDebug = enableDebug;
    }
    /**
     * Set debug logging enabled/disabled
     */
    setDebugEnabled(enabled) {
        this.enableDebug = enabled;
    }
    /**
     * Log info message
     */
    log(message) {
        this.node.log(`[VIIS-MODBUS-POLLER] ${message}`);
    }
    /**
     * Log warning message
     */
    warn(message) {
        this.node.warn(`[VIIS-MODBUS-POLLER] ${message}`);
    }
    /**
     * Log error message
     */
    error(message) {
        this.node.error(`[VIIS-MODBUS-POLLER] ${message}`);
    }
    /**
     * Log debug message (only if debug is enabled)
     */
    debug(message) {
        if (this.enableDebug) {
            this.node.warn(`[VIIS-MODBUS-POLLER-DEBUG] ${message}`);
        }
    }
    /**
     * Log with timestamp
     */
    logWithTimestamp(message) {
        const timestamp = new Date().toISOString();
        this.log(`[${timestamp}] ${message}`);
    }
    /**
     * Log error with stack trace
     */
    errorWithStack(message, error) {
        this.error(`${message}: ${error.message}`);
        if (this.enableDebug && error.stack) {
            this.error(`Stack trace: ${error.stack}`);
        }
    }
    /**
     * Log polling activity
     */
    logPolling(registerType, address, quantity) {
        this.debug(`Polling ${registerType} - Address: ${address}, Quantity: ${quantity}`);
    }
    /**
     * Log telemetry data
     */
    logTelemetry(data, action) {
        this.debug(`${action} telemetry: ${JSON.stringify(data)}`);
    }
    /**
     * Log threshold check result
     */
    logThresholdCheck(key, oldValue, newValue, threshold, changed) {
        this.debug(`Threshold check for ${key}: ${oldValue} -> ${newValue} (threshold: ${threshold}) = ${changed ? 'CHANGED' : 'NO CHANGE'}`);
    }
    /**
     * Log periodic snapshot
     */
    logPeriodicSnapshot(data) {
        this.debug(`Periodic snapshot: ${JSON.stringify(data)}`);
    }
}
exports.Logger = Logger;
