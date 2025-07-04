"use strict";
/**
 * @fileoverview Circuit Breaker Pattern Implementation for MQTT Operations
 *
 * Implements the Circuit Breaker pattern to protect against cascading failures
 * and provide fast-fail behavior when MQTT broker is unavailable.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit is open, requests fail immediately
 * - HALF_OPEN: Testing if service has recovered
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MqttCircuitBreaker = exports.CircuitBreakerError = exports.CircuitBreakerState = void 0;
exports.createMqttCircuitBreaker = createMqttCircuitBreaker;
const logger_1 = require("./logger");
var CircuitBreakerState;
(function (CircuitBreakerState) {
    CircuitBreakerState["CLOSED"] = "CLOSED";
    CircuitBreakerState["OPEN"] = "OPEN";
    CircuitBreakerState["HALF_OPEN"] = "HALF_OPEN";
})(CircuitBreakerState || (exports.CircuitBreakerState = CircuitBreakerState = {}));
class CircuitBreakerError extends Error {
    constructor(message, state) {
        super(message);
        this.state = state;
        this.name = 'CircuitBreakerError';
    }
}
exports.CircuitBreakerError = CircuitBreakerError;
/**
 * Circuit Breaker implementation for protecting MQTT operations
 */
class MqttCircuitBreaker {
    constructor(config = {}, node, name = 'MqttCircuitBreaker') {
        this.state = CircuitBreakerState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = 0;
        this.lastSuccessTime = 0;
        this.halfOpenCalls = 0;
        this.totalCalls = 0;
        this.totalFailures = 0;
        this.totalSuccesses = 0;
        this.circuitOpenCount = 0;
        this.monitoringWindowStart = Date.now();
        this.config = Object.assign({ failureThreshold: 5, timeout: 60000, monitoringPeriod: 300000, halfOpenMaxCalls: 3 }, config);
        this.node = node;
        this.name = name;
        logger_1.logger.info(this.node, `${this.name} initialized`, {
            config: this.config
        });
    }
    /**
     * Execute operation with circuit breaker protection
     */
    async execute(operation, operationName = 'operation') {
        this.totalCalls++;
        this.resetMonitoringWindowIfNeeded();
        // Check circuit state before execution
        if (this.state === CircuitBreakerState.OPEN) {
            if (this.shouldAttemptReset()) {
                this.transitionToHalfOpen();
            }
            else {
                const error = new CircuitBreakerError(`Circuit breaker is OPEN for ${this.name}. Last failure: ${new Date(this.lastFailureTime).toISOString()}`, CircuitBreakerState.OPEN);
                logger_1.logger.warn(this.node, `Circuit breaker blocked ${operationName}`, {
                    state: this.state,
                    failureCount: this.failureCount,
                    lastFailureTime: this.lastFailureTime
                });
                throw error;
            }
        }
        if (this.state === CircuitBreakerState.HALF_OPEN) {
            if (this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
                const error = new CircuitBreakerError(`Circuit breaker in HALF_OPEN state has reached max calls limit`, CircuitBreakerState.HALF_OPEN);
                logger_1.logger.warn(this.node, `Circuit breaker HALF_OPEN limit reached for ${operationName}`);
                throw error;
            }
            this.halfOpenCalls++;
        }
        try {
            logger_1.logger.debug(this.node, `Executing ${operationName} through circuit breaker`, {
                state: this.state,
                attempt: this.state === CircuitBreakerState.HALF_OPEN ? this.halfOpenCalls : 'N/A'
            });
            const result = await operation();
            this.onSuccess(operationName);
            return result;
        }
        catch (error) {
            this.onFailure(error, operationName);
            throw error;
        }
    }
    /**
     * Handle successful operation
     */
    onSuccess(operationName) {
        this.successCount++;
        this.totalSuccesses++;
        this.lastSuccessTime = Date.now();
        if (this.state === CircuitBreakerState.HALF_OPEN) {
            logger_1.logger.info(this.node, `Circuit breaker recovery successful for ${operationName}`, {
                halfOpenCalls: this.halfOpenCalls,
                successCount: this.successCount
            });
            this.transitionToClosed();
        }
        else if (this.state === CircuitBreakerState.CLOSED) {
            // Reset failure count on success in CLOSED state
            this.failureCount = 0;
        }
        logger_1.logger.debug(this.node, `Circuit breaker success for ${operationName}`, {
            state: this.state,
            successCount: this.successCount
        });
    }
    /**
     * Handle failed operation
     */
    onFailure(error, operationName) {
        this.failureCount++;
        this.totalFailures++;
        this.lastFailureTime = Date.now();
        logger_1.logger.warn(this.node, `Circuit breaker failure for ${operationName}`, {
            state: this.state,
            failureCount: this.failureCount,
            error: error.message
        });
        if (this.state === CircuitBreakerState.HALF_OPEN) {
            // Any failure in HALF_OPEN immediately opens the circuit
            logger_1.logger.warn(this.node, `Circuit breaker opening due to failure in HALF_OPEN state`);
            this.transitionToOpen();
        }
        else if (this.state === CircuitBreakerState.CLOSED) {
            // Check if we should open the circuit
            if (this.failureCount >= this.config.failureThreshold) {
                logger_1.logger.warn(this.node, `Circuit breaker opening due to failure threshold reached`, {
                    failureCount: this.failureCount,
                    threshold: this.config.failureThreshold
                });
                this.transitionToOpen();
            }
        }
    }
    /**
     * Transition to CLOSED state
     */
    transitionToClosed() {
        const previousState = this.state;
        this.state = CircuitBreakerState.CLOSED;
        this.failureCount = 0;
        this.halfOpenCalls = 0;
        logger_1.logger.info(this.node, `Circuit breaker transitioned to CLOSED`, {
            previousState,
            successCount: this.successCount
        });
    }
    /**
     * Transition to OPEN state
     */
    transitionToOpen() {
        const previousState = this.state;
        this.state = CircuitBreakerState.OPEN;
        this.circuitOpenCount++;
        this.halfOpenCalls = 0;
        logger_1.logger.error(this.node, `Circuit breaker transitioned to OPEN`, {
            previousState,
            failureCount: this.failureCount,
            lastFailureTime: this.lastFailureTime,
            timeoutMs: this.config.timeout
        });
    }
    /**
     * Transition to HALF_OPEN state
     */
    transitionToHalfOpen() {
        const previousState = this.state;
        this.state = CircuitBreakerState.HALF_OPEN;
        this.halfOpenCalls = 0;
        logger_1.logger.info(this.node, `Circuit breaker transitioned to HALF_OPEN`, {
            previousState,
            timeSinceLastFailure: Date.now() - this.lastFailureTime
        });
    }
    /**
     * Check if circuit should attempt reset
     */
    shouldAttemptReset() {
        return Date.now() - this.lastFailureTime >= this.config.timeout;
    }
    /**
     * Reset monitoring window if needed
     */
    resetMonitoringWindowIfNeeded() {
        const now = Date.now();
        if (now - this.monitoringWindowStart >= this.config.monitoringPeriod) {
            logger_1.logger.debug(this.node, `Resetting circuit breaker monitoring window`);
            this.monitoringWindowStart = now;
            // Reset counters for new monitoring period
            if (this.state === CircuitBreakerState.CLOSED) {
                this.failureCount = 0;
                this.successCount = 0;
            }
        }
    }
    /**
     * Get current circuit breaker metrics
     */
    getMetrics() {
        return {
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            lastFailureTime: this.lastFailureTime,
            lastSuccessTime: this.lastSuccessTime,
            totalCalls: this.totalCalls,
            totalFailures: this.totalFailures,
            totalSuccesses: this.totalSuccesses,
            circuitOpenCount: this.circuitOpenCount
        };
    }
    /**
     * Get circuit breaker status for health checks
     */
    getHealthStatus() {
        const metrics = this.getMetrics();
        const now = Date.now();
        return {
            name: this.name,
            state: this.state,
            healthy: this.state !== CircuitBreakerState.OPEN,
            metrics,
            config: this.config,
            timeSinceLastFailure: this.lastFailureTime ? now - this.lastFailureTime : null,
            timeSinceLastSuccess: this.lastSuccessTime ? now - this.lastSuccessTime : null
        };
    }
    /**
     * Force reset circuit breaker (for testing/admin purposes)
     */
    reset() {
        logger_1.logger.info(this.node, `Circuit breaker manually reset`);
        this.state = CircuitBreakerState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.halfOpenCalls = 0;
        this.lastFailureTime = 0;
        this.lastSuccessTime = 0;
    }
}
exports.MqttCircuitBreaker = MqttCircuitBreaker;
/**
 * Factory function to create MQTT circuit breaker with default config
 */
function createMqttCircuitBreaker(node, config) {
    return new MqttCircuitBreaker(config, node, 'MQTT-CircuitBreaker');
}
