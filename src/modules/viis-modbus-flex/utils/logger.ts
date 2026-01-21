import { Node } from "node-red";

/**
 * Logger utility for VIIS Modbus Flex Node
 */
export class Logger {
    private node: Node;
    private nodeId: string;
    private enableLogging: boolean;

    constructor(node: Node, nodeId: string, enableLogging: boolean = false) {
        this.node = node;
        this.nodeId = nodeId;
        this.enableLogging = enableLogging;
    }

    /**
     * Log info message
     * Always logs basic info messages regardless of enableLogging setting
     */
    log(message: string): void {
        this.node.log(`[MODBUS-GETTER-${this.nodeId}] ${message}`);
    }

    /**
     * Log warning message
     * Always logs warnings regardless of enableLogging setting
     */
    warn(message: string): void {
        this.node.warn(`[MODBUS-GETTER-${this.nodeId}] ${message}`);
    }

    /**
     * Log error message
     * Always logs errors regardless of enableLogging setting
     */
    error(message: string): void {
        this.node.error(`[MODBUS-GETTER-${this.nodeId}] ${message}`);
    }

    /**
     * Log debug message
     * Only logs if enableLogging is true
     */
    debug(message: string): void {
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
    logModbusOperation(operation: string, address: number, quantity: number, fc: number): void {
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
    logModbusResult(operation: string, address: number, dataLength: number): void {
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
    logModbusError(operation: string, address: number, error: string): void {
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
    logRequest(payload: any): void {
        if (this.enableLogging) {
            this.debug(`Request: ${JSON.stringify(payload, null, 2)}`);
        }
    }

    /**
     * Log detailed response information
     * Only logs if enableLogging is true
     */
    logResponse(response: any): void {
        if (this.enableLogging) {
            this.debug(`Response: ${JSON.stringify(response, null, 2)}`);
        }
    }

    /**
     * Check if logging is enabled
     */
    isLoggingEnabled(): boolean {
        return this.enableLogging;
    }

    /**
     * Update logging state
     */
    setLoggingEnabled(enabled: boolean): void {
        this.enableLogging = enabled;
        this.log(`Logging ${enabled ? 'enabled' : 'disabled'}`);
    }
}
