"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
/**
 * Logger utility for VIIS Modbus Getter Node
 */
class Logger {
    constructor(node, nodeId) {
        this.node = node;
        this.nodeId = nodeId;
    }
    /**
     * Log info message
     */
    log(message) {
        this.node.log(`[MODBUS-GETTER-${this.nodeId}] ${message}`);
    }
    /**
     * Log warning message
     */
    warn(message) {
        this.node.warn(`[MODBUS-GETTER-${this.nodeId}] ${message}`);
    }
    /**
     * Log error message
     */
    error(message) {
        this.node.error(`[MODBUS-GETTER-${this.nodeId}] ${message}`);
    }
    /**
     * Log debug message (only in development)
     */
    debug(message) {
        if (process.env.NODE_ENV === 'development') {
            this.node.log(`[DEBUG-MODBUS-GETTER-${this.nodeId}] ${message}`);
        }
    }
    /**
     * Log modbus operation
     */
    logModbusOperation(operation, address, quantity, fc) {
        this.debug(`${operation}: FC=${fc}, Address=${address}, Quantity=${quantity}`);
    }
    /**
     * Log modbus result
     */
    logModbusResult(operation, address, dataLength) {
        this.debug(`${operation} Success: Address=${address}, DataLength=${dataLength}`);
    }
    /**
     * Log modbus error
     */
    logModbusError(operation, address, error) {
        this.error(`${operation} Failed: Address=${address}, Error=${error}`);
    }
}
exports.Logger = Logger;
