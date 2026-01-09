"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExternalServiceCircuitBreaker = void 0;
exports.executeOfflineSafe = executeOfflineSafe;
exports.executeWithCircuitBreaker = executeWithCircuitBreaker;
exports.getExternalServicesStatus = getExternalServicesStatus;
exports.setupGlobalErrorHandlers = setupGlobalErrorHandlers;
/**
 * Global circuit breaker manager for external services
 */
class ExternalServiceCircuitBreaker {
    constructor() {
        this.circuits = new Map();
        this.FAILURE_THRESHOLD = 3;
        this.OPEN_DURATION = 30000; // 30 seconds
        this.HALF_OPEN_DURATION = 60000; // 1 minute
    }
    static getInstance() {
        if (!ExternalServiceCircuitBreaker.instance) {
            ExternalServiceCircuitBreaker.instance = new ExternalServiceCircuitBreaker();
        }
        return ExternalServiceCircuitBreaker.instance;
    }
    /**
     * Get or create circuit state for a service
     */
    getCircuit(serviceKey) {
        if (!this.circuits.has(serviceKey)) {
            this.circuits.set(serviceKey, {
                failures: 0,
                lastFailureTime: 0,
                state: 'closed',
                isOnline: true
            });
        }
        return this.circuits.get(serviceKey);
    }
    /**
     * Check if request should be allowed
     */
    canAttempt(serviceKey) {
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
    recordSuccess(serviceKey) {
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
    recordFailure(serviceKey, error) {
        const circuit = this.getCircuit(serviceKey);
        circuit.failures++;
        circuit.lastFailureTime = Date.now();
        if (circuit.failures >= this.FAILURE_THRESHOLD && circuit.state === 'closed') {
            circuit.state = 'open';
            circuit.isOnline = false;
            console.warn(`[CIRCUIT-BREAKER] ⚠️ ${serviceKey}: OFFLINE - ` +
                `Circuit opened after ${circuit.failures} failures. ` +
                `Last error: ${error.message}`);
        }
        else if (circuit.state === 'half-open') {
            // Test failed, go back to open
            circuit.state = 'open';
            circuit.isOnline = false;
            console.warn(`[CIRCUIT-BREAKER] ⚠️ ${serviceKey}: Recovery test failed, back to OPEN`);
        }
    }
    /**
     * Check if service is considered online
     */
    isServiceOnline(serviceKey) {
        const circuit = this.getCircuit(serviceKey);
        return circuit.isOnline;
    }
    /**
     * Get all circuit states for monitoring
     */
    getAllStates() {
        return new Map(this.circuits);
    }
    /**
     * Manually reset a circuit (for testing or manual recovery)
     */
    reset(serviceKey) {
        const circuit = this.getCircuit(serviceKey);
        circuit.failures = 0;
        circuit.state = 'closed';
        circuit.isOnline = true;
        console.log(`[CIRCUIT-BREAKER] ${serviceKey}: Manually reset to CLOSED`);
    }
}
exports.ExternalServiceCircuitBreaker = ExternalServiceCircuitBreaker;
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
async function executeOfflineSafe(config, operation) {
    const { operationName, node, logErrors = true, useWarning = true, fallbackValue = undefined, critical = false } = config;
    try {
        return await operation();
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Log appropriately based on configuration
        if (logErrors && node) {
            const logMessage = `[OFFLINE-SAFE] ${operationName} failed: ${errorMessage}`;
            if (useWarning) {
                node.warn(logMessage);
            }
            else {
                node.error(logMessage);
            }
        }
        // If critical and no fallback, we need to throw
        if (critical && fallbackValue === undefined) {
            throw error;
        }
        // Return fallback value
        return fallbackValue;
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
async function executeWithCircuitBreaker(serviceKey, node, operation, fallbackValue) {
    const circuitBreaker = ExternalServiceCircuitBreaker.getInstance();
    // Check if circuit allows request
    if (!circuitBreaker.canAttempt(serviceKey)) {
        if (node) {
            node.warn(`[CIRCUIT-BREAKER] ⚠️ ${serviceKey} is OFFLINE - ` +
                `Skipping operation to prevent overwhelming service. ` +
                `Local operations continue normally.`);
        }
        return fallbackValue;
    }
    try {
        const result = await operation();
        circuitBreaker.recordSuccess(serviceKey);
        return result;
    }
    catch (error) {
        circuitBreaker.recordFailure(serviceKey, error);
        if (node) {
            const isOffline = !circuitBreaker.isServiceOnline(serviceKey);
            const prefix = isOffline ? '🔴 OFFLINE' : '⚠️';
            node.warn(`[CIRCUIT-BREAKER] ${prefix} ${serviceKey}: ${error.message}`);
        }
        return fallbackValue;
    }
}
/**
 * Check connectivity status of all external services
 */
function getExternalServicesStatus() {
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
function setupGlobalErrorHandlers(RED) {
    // Prevent uncaught exceptions from crashing Node-RED
    process.on('uncaughtException', (error) => {
        console.error('[GLOBAL-ERROR-HANDLER] Uncaught Exception:', error);
        console.error('Stack:', error.stack);
        // Log to Node-RED if available
        if (RED && RED.log) {
            RED.log.error(`[UNCAUGHT-EXCEPTION] ${error.message}`);
        }
        // Don't exit - keep Node-RED running
    });
    // Prevent unhandled promise rejections from crashing Node-RED
    process.on('unhandledRejection', (reason, promise) => {
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
