import { Node } from "node-red";

/**
 * Logger utility class for VIIS Modbus Poller Node
 */
export class Logger {
    private node: Node;
    private enableDebug: boolean;

    constructor(node: Node, enableDebug: boolean = false) {
        this.node = node;
        this.enableDebug = enableDebug;
    }

    /**
     * Set debug logging enabled/disabled
     */
    setDebugEnabled(enabled: boolean): void {
        this.enableDebug = enabled;
    }

    /**
     * Log info message
     */
    log(message: string): void {
        this.node.log(`[VIIS-MODBUS-POLLER] ${message}`);
    }

    /**
     * Log warning message
     */
    warn(message: string): void {
        this.node.warn(`[VIIS-MODBUS-POLLER] ${message}`);
    }

    /**
     * Log error message
     */
    error(message: string): void {
        this.node.error(`[VIIS-MODBUS-POLLER] ${message}`);
    }

    /**
     * Log debug message (only if debug is enabled)
     */
    debug(message: string): void {
        if (this.enableDebug) {
            this.node.warn(`[VIIS-MODBUS-POLLER-DEBUG] ${message}`);
        }
    }

    /**
     * Log with timestamp
     */
    logWithTimestamp(message: string): void {
        const timestamp = new Date().toISOString();
        this.log(`[${timestamp}] ${message}`);
    }

    /**
     * Log error with stack trace
     */
    errorWithStack(message: string, error: Error): void {
        this.error(`${message}: ${error.message}`);
        if (this.enableDebug && error.stack) {
            this.error(`Stack trace: ${error.stack}`);
        }
    }

    /**
     * Log polling activity
     */
    logPolling(registerType: string, address: number, quantity: number): void {
        this.debug(`Polling ${registerType} - Address: ${address}, Quantity: ${quantity}`);
    }

    /**
     * Log telemetry data
     */
    logTelemetry(data: any, action: string): void {
        this.debug(`${action} telemetry: ${JSON.stringify(data)}`);
    }

    /**
     * Log threshold check result
     */
    logThresholdCheck(key: string, oldValue: any, newValue: any, threshold: number, changed: boolean): void {
        this.debug(`Threshold check for ${key}: ${oldValue} -> ${newValue} (threshold: ${threshold}) = ${changed ? 'CHANGED' : 'NO CHANGE'}`);
    }

    /**
     * Log periodic snapshot
     */
    logPeriodicSnapshot(data: any): void {
        this.debug(`Periodic snapshot: ${JSON.stringify(data)}`);
    }
}
