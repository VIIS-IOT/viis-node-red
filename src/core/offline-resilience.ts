/**
 * @fileoverview Offline Resilience Module
 * Provides utilities to ensure Node-RED continues running when internet is lost
 * and external services (HTTP backend, ThingsBoard MQTT) are unreachable.
 * 
 * Key principles:
 * 1. Never crash Node-RED process - catch and log all errors
 * 2. Degrade gracefully - local services (EMQX, MySQL, Modbus) continue working
 * 3. Auto-recovery - retry external services when internet returns
 * 4. Circuit breaker - prevent overwhelming external services with failed requests
 */

import { Node } from 'node-red';

/**
 * Configuration for offline-safe operation wrapper
 */
export interface OfflineSafeConfig {
    /** Operation name for logging */
    operationName: string;
    /** Node instance for logging */
    node?: Node;
    /** Whether to log errors (default: true) */
    logErrors?: boolean;
    /** Whether to warn instead of error (default: true for external services) */
    useWarning?: boolean;
    /** Fallback value to return on failure */
    fallbackValue?: any;
    /** Whether this is a critical operation that must succeed */
    critical?: boolean;
}

/**
 * Circuit breaker state for external services
 */
interface CircuitState {
    failures: number;
    lastFailureTime: number;
    state: 'closed' | 'open' | 'half-open';
    isOnline: boolean;
}

/**
 * Global circuit breaker manager for external services
 */
export class ExternalServiceCircuitBreaker {
    private static instance: ExternalServiceCircuitBreaker;
    private circuits: Map<string, CircuitState> = new Map();
    private readonly FAILURE_THRESHOLD = 3;
    private readonly OPEN_DURATION = 30000; // 30 seconds
    private readonly HALF_OPEN_DURATION = 60000; // 1 minute

    private constructor() {}

    static getInstance(): ExternalServiceCircuitBreaker {
        if (!ExternalServiceCircuitBreaker.instance) {
            ExternalServiceCircuitBreaker.instance = new ExternalServiceCircuitBreaker();
        }
        return ExternalServiceCircuitBreaker.instance;
    }

    /**
     * Get or create circuit state for a service
     */
    private getCircuit(serviceKey: string): CircuitState {
        if (!this.circuits.has(serviceKey)) {
            this.circuits.set(serviceKey, {
                failures: 0,
                lastFailureTime: 0,
                state: 'closed',
                isOnline: true
            });
        }
        return this.circuits.get(serviceKey)!;
    }

    /**
     * Check if request should be allowed
     */
    canAttempt(serviceKey: string): boolean {
        const circuit = this.getCircuit(serviceKey);
        const now = Date.now();

        if (circuit.state === 'closed') {
            return true;
        }

        if (circuit.state === 'open') {
            // Check if we should transition to half-open
            if (now - circuit.lastFailureTime >= this.OPEN_DURATION) {
                circuit.state = 'half-open';
                console.log(`[CIRCUIT-BREAKER] ${serviceKey}: OPEN -> HALF-OPEN (testing recovery)`);
                return true;
            }
            return false; // Circuit still open
        }

        // half-open: allow one request to test
        return true;
    }

    /**
     * Record successful operation
     */
    recordSuccess(serviceKey: string): void {
        const circuit = this.getCircuit(serviceKey);
        const wasOffline = !circuit.isOnline;
        
        circuit.failures = 0;
        circuit.state = 'closed';
        circuit.isOnline = true;

        if (wasOffline) {
            console.log(`[CIRCUIT-BREAKER] ✅ ${serviceKey}: ONLINE - Service recovered`);
        }
    }

    /**
     * Record failed operation
     */
    recordFailure(serviceKey: string, error: Error): void {
        const circuit = this.getCircuit(serviceKey);
        circuit.failures++;
        circuit.lastFailureTime = Date.now();

        if (circuit.failures >= this.FAILURE_THRESHOLD && circuit.state === 'closed') {
            circuit.state = 'open';
            circuit.isOnline = false;
            console.warn(
                `[CIRCUIT-BREAKER] ⚠️ ${serviceKey}: OFFLINE - ` +
                `Circuit opened after ${circuit.failures} failures. ` +
                `Last error: ${error.message}`
            );
        } else if (circuit.state === 'half-open') {
            // Test failed, go back to open
            circuit.state = 'open';
            circuit.isOnline = false;
            console.warn(`[CIRCUIT-BREAKER] ⚠️ ${serviceKey}: Recovery test failed, back to OPEN`);
        }
    }

    /**
     * Check if service is considered online
     */
    isServiceOnline(serviceKey: string): boolean {
        const circuit = this.getCircuit(serviceKey);
        return circuit.isOnline;
    }

    /**
     * Get all circuit states for monitoring
     */
    getAllStates(): Map<string, CircuitState> {
        return new Map(this.circuits);
    }

    /**
     * Manually reset a circuit (for testing or manual recovery)
     */
    reset(serviceKey: string): void {
        const circuit = this.getCircuit(serviceKey);
        circuit.failures = 0;
        circuit.state = 'closed';
        circuit.isOnline = true;
        console.log(`[CIRCUIT-BREAKER] ${serviceKey}: Manually reset to CLOSED`);
    }
}

/**
 * Wrapper for external service calls that ensures offline resilience
 * 
 * @example
 * ```typescript
 * const result = await executeOfflineSafe({
 *     operationName: 'Fetch customers from backend',
 *     node: node,
 *     fallbackValue: { customers: [] }
 * }, async () => {
 *     return await apiService.getAllCustomers();
 * });
 * ```
 */
export async function executeOfflineSafe<T>(
    config: OfflineSafeConfig,
    operation: () => Promise<T>
): Promise<T | typeof config.fallbackValue> {
    const {
        operationName,
        node,
        logErrors = true,
        useWarning = true,
        fallbackValue = undefined,
        critical = false
    } = config;

    try {
        return await operation();
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Log appropriately based on configuration
        if (logErrors && node) {
            const logMessage = `[OFFLINE-SAFE] ${operationName} failed: ${errorMessage}`;
            if (useWarning) {
                node.warn(logMessage);
            } else {
                node.error(logMessage);
            }
        }

        // If critical and no fallback, we need to throw
        if (critical && fallbackValue === undefined) {
            throw error;
        }

        // Return fallback value
        return fallbackValue as T;
    }
}

/**
 * Wrapper for external service calls with circuit breaker
 * Prevents overwhelming external services when they're offline
 * 
 * @example
 * ```typescript
 * const success = await executeWithCircuitBreaker(
 *     'thingsboard-http',
 *     node,
 *     async () => {
 *         const response = await axios.post(url, data);
 *         return response.status === 200;
 *     }
 * );
 * ```
 */
export async function executeWithCircuitBreaker<T>(
    serviceKey: string,
    node: Node | undefined,
    operation: () => Promise<T>,
    fallbackValue?: T
): Promise<T | undefined> {
    const circuitBreaker = ExternalServiceCircuitBreaker.getInstance();

    // Check if circuit allows request
    if (!circuitBreaker.canAttempt(serviceKey)) {
        if (node) {
            node.warn(
                `[CIRCUIT-BREAKER] ⚠️ ${serviceKey} is OFFLINE - ` +
                `Skipping operation to prevent overwhelming service. ` +
                `Local operations continue normally.`
            );
        }
        return fallbackValue;
    }

    try {
        const result = await operation();
        circuitBreaker.recordSuccess(serviceKey);
        return result;
    } catch (error) {
        circuitBreaker.recordFailure(serviceKey, error as Error);
        
        if (node) {
            const isOffline = !circuitBreaker.isServiceOnline(serviceKey);
            const prefix = isOffline ? '🔴 OFFLINE' : '⚠️';
            node.warn(
                `[CIRCUIT-BREAKER] ${prefix} ${serviceKey}: ${(error as Error).message}`
            );
        }

        return fallbackValue;
    }
}

/**
 * Check connectivity status of all external services
 */
export function getExternalServicesStatus(): {
    thingsboard: { online: boolean; state: string };
    backend: { online: boolean; state: string };
    allOnline: boolean;
} {
    const circuitBreaker = ExternalServiceCircuitBreaker.getInstance();
    const states = circuitBreaker.getAllStates();

    const thingsboardState = states.get('thingsboard-mqtt') || { isOnline: true, state: 'closed' };
    const backendState = states.get('backend-http') || { isOnline: true, state: 'closed' };

    return {
        thingsboard: {
            online: thingsboardState.isOnline,
            state: thingsboardState.state
        },
        backend: {
            online: backendState.isOnline,
            state: backendState.state
        },
        allOnline: thingsboardState.isOnline && backendState.isOnline
    };
}

/**
 * Setup global error handlers to prevent Node-RED crashes
 * Call this once during Node-RED startup
 */
export function setupGlobalErrorHandlers(RED: any): void {
    // Prevent uncaught exceptions from crashing Node-RED
    process.on('uncaughtException', (error: Error) => {
        console.error('[GLOBAL-ERROR-HANDLER] Uncaught Exception:', error);
        console.error('Stack:', error.stack);
        // Log to Node-RED if available
        if (RED && RED.log) {
            RED.log.error(`[UNCAUGHT-EXCEPTION] ${error.message}`);
        }
        // Don't exit - keep Node-RED running
    });

    // Prevent unhandled promise rejections from crashing Node-RED
    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
        console.error('[GLOBAL-ERROR-HANDLER] Unhandled Promise Rejection:', reason);
        if (reason instanceof Error) {
            console.error('Stack:', reason.stack);
        }
        // Log to Node-RED if available
        if (RED && RED.log) {
            const message = reason instanceof Error ? reason.message : String(reason);
            RED.log.error(`[UNHANDLED-REJECTION] ${message}`);
        }
        // Don't exit - keep Node-RED running
    });

    console.log('[GLOBAL-ERROR-HANDLER] ✅ Registered global error handlers - Node-RED will not crash on unhandled errors');
}
