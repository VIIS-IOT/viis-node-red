"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
/**
 * Logger utility for VIIS Modbus Flex Node
 */
class Logger {
    constructor(node, nodeId, enableLogging = false) {
        this.node = node;
        this.nodeId = nodeId;
        this.enableLogging = enableLogging;
    }
    /**
     * Log info message
     * Always logs basic info messages regardless of enableLogging setting
     */
    log(message) {
        this.node.log(`[MODBUS-GETTER-${this.nodeId}] ${message}`);
    }
    /**
     * Log warning message
     * Always logs warnings regardless of enableLogging setting
     */
    warn(message) {
        this.node.warn(`[MODBUS-GETTER-${this.nodeId}] ${message}`);
    }
    /**
     * Log error message
     * Always logs errors regardless of enableLogging setting
     */
    error(message) {
        this.node.error(`[MODBUS-GETTER-${this.nodeId}] ${message}`);
    }
    /**
     * Log debug message
     * Only logs if enableLogging is true
     */
    debug(message) {
        if (this.enableLogging) {
            // Log to Node-RED debug panel
            this.node.debug(`[DEBUG-MODBUS-GETTER-${this.nodeId}] ${message}`);
            // Also log to terminal/console
            this.node.log(`[DEBUG-MODBUS-GETTER-${this.nodeId}] ${message}`);
        }
    }
    /**
     * Log modbus operation
     * Only logs if enableLogging is true
     */
    logModbusOperation(operation, address, quantity, fc) {
        if (this.enableLogging) {
            const message = `${operation}: FC=${fc}, Address=${address}, Quantity=${quantity}`;
            this.debug(message);
            // Send to debug panel as well
            this.node.send({
                topic: "modbus-operation",
                payload: {
                    operation,
                    functionCode: fc,
                    address,
                    quantity,
                    timestamp: Date.now(),
                    nodeId: this.nodeId
                }
            });
        }
    }
    /**
     * Log modbus result
     * Only logs if enableLogging is true
     */
    logModbusResult(operation, address, dataLength) {
        if (this.enableLogging) {
            const message = `${operation} Success: Address=${address}, DataLength=${dataLength}`;
            this.debug(message);
            // Send to debug panel as well
            this.node.send({
                topic: "modbus-result",
                payload: {
                    operation,
                    address,
                    dataLength,
                    status: "success",
                    timestamp: Date.now(),
                    nodeId: this.nodeId
                }
            });
        }
    }
    /**
     * Log modbus error
     * Always logs errors regardless of enableLogging setting
     */
    logModbusError(operation, address, error) {
        // Always log errors to terminal
        this.error(`${operation} Failed: Address=${address}, Error=${error}`);
        // Send to debug panel regardless of logging setting for errors
        this.node.send({
            topic: "modbus-error",
            payload: {
                operation,
                address,
                error,
                status: "error",
                timestamp: Date.now(),
                nodeId: this.nodeId
            }
        });
    }
    /**
     * Log detailed request information
     * Only logs if enableLogging is true
     */
    logRequest(payload) {
        if (this.enableLogging) {
            this.debug(`Request: ${JSON.stringify(payload, null, 2)}`);
        }
    }
    /**
     * Log detailed response information
     * Only logs if enableLogging is true
     */
    logResponse(response) {
        if (this.enableLogging) {
            this.debug(`Response: ${JSON.stringify(response, null, 2)}`);
        }
    }
    /**
     * Check if logging is enabled
     */
    isLoggingEnabled() {
        return this.enableLogging;
    }
    /**
     * Update logging state
     */
    setLoggingEnabled(enabled) {
        this.enableLogging = enabled;
        this.log(`Logging ${enabled ? 'enabled' : 'disabled'}`);
    }
}
exports.Logger = Logger;
