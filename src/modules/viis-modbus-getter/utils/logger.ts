import { Node } from "node-red";

/**
 * Logger utility for VIIS Modbus Getter Node
 */
export class Logger {
    private node: Node;
    private nodeId: string;

    constructor(node: Node, nodeId: string) {
        this.node = node;
        this.nodeId = nodeId;
    }

    /**
     * Log info message
     */
    log(message: string): void {
        this.node.log(`[MODBUS-GETTER-${this.nodeId}] ${message}`);
    }

    /**
     * Log warning message
     */
    warn(message: string): void {
        this.node.warn(`[MODBUS-GETTER-${this.nodeId}] ${message}`);
    }

    /**
     * Log error message
     */
    error(message: string): void {
        this.node.error(`[MODBUS-GETTER-${this.nodeId}] ${message}`);
    }

    /**
     * Log debug message (only in development)
     */
    debug(message: string): void {
        if (process.env.NODE_ENV === 'development') {
            this.node.log(`[DEBUG-MODBUS-GETTER-${this.nodeId}] ${message}`);
        }
    }

    /**
     * Log modbus operation
     */
    logModbusOperation(operation: string, address: number, quantity: number, fc: number): void {
        this.debug(`${operation}: FC=${fc}, Address=${address}, Quantity=${quantity}`);
    }

    /**
     * Log modbus result
     */
    logModbusResult(operation: string, address: number, dataLength: number): void {
        this.debug(`${operation} Success: Address=${address}, DataLength=${dataLength}`);
    }

    /**
     * Log modbus error
     */
    logModbusError(operation: string, address: number, error: string): void {
        this.error(`${operation} Failed: Address=${address}, Error=${error}`);
    }
}
