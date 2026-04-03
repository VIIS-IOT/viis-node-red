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

import { logger } from './logger';
import { Node } from 'node-red';

export enum CircuitBreakerState {
    CLOSED = 'CLOSED',
    OPEN = 'OPEN',
    HALF_OPEN = 'HALF_OPEN'
}

export interface CircuitBreakerConfig {
    failureThreshold: number;     // Number of failures before opening circuit
    timeout: number;              // Time to wait before attempting recovery (ms)
    monitoringPeriod: number;     // Time window for failure counting (ms)
    halfOpenMaxCalls: number;     // Max calls allowed in HALF_OPEN state
}

export interface CircuitBreakerMetrics {
    state: CircuitBreakerState;
    failureCount: number;
    successCount: number;
    lastFailureTime: number;
    lastSuccessTime: number;
    totalCalls: number;
    totalFailures: number;
    totalSuccesses: number;
    circuitOpenCount: number;
}

export class CircuitBreakerError extends Error {
    constructor(message: string, public readonly state: CircuitBreakerState) {
        super(message);
        this.name = 'CircuitBreakerError';
    }
}

/**
 * Circuit Breaker implementation for protecting MQTT operations
 */
export class MqttCircuitBreaker {
    private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
    private failureCount = 0;
    private successCount = 0;
    private lastFailureTime = 0;
    private lastSuccessTime = 0;
    private halfOpenCalls = 0;
    private totalCalls = 0;
    private totalFailures = 0;
    private totalSuccesses = 0;
    private circuitOpenCount = 0;
    private monitoringWindowStart = Date.now();

    private readonly config: CircuitBreakerConfig;
    private readonly node: Node;
    private readonly name: string;

    constructor(
        config: Partial<CircuitBreakerConfig> = {},
        node: Node,
        name = 'MqttCircuitBreaker'
    ) {
        this.config = {
            failureThreshold: 5,
            timeout: 60000, // 1 minute
            monitoringPeriod: 300000, // 5 minutes
            halfOpenMaxCalls: 3,
            ...config
        };
        this.node = node;
        this.name = name;

        logger.info(this.node, `${this.name} initialized`, {
            config: this.config
        });
    }

    /**
     * Execute operation with circuit breaker protection
     */
    async execute<T>(operation: () => Promise<T>, operationName = 'operation'): Promise<T> {
        this.totalCalls++;
        this.resetMonitoringWindowIfNeeded();

        // Check circuit state before execution
        if (this.state === CircuitBreakerState.OPEN) {
            if (this.shouldAttemptReset()) {
                this.transitionToHalfOpen();
            } else {
                const error = new CircuitBreakerError(
                    `Circuit breaker is OPEN for ${this.name}. Last failure: ${new Date(this.lastFailureTime).toISOString()}`,
                    CircuitBreakerState.OPEN
                );
                logger.warn(this.node, `Circuit breaker blocked ${operationName}`, {
                    state: this.state,
                    failureCount: this.failureCount,
                    lastFailureTime: this.lastFailureTime
                });
                throw error;
            }
        }

        if (this.state === CircuitBreakerState.HALF_OPEN) {
            if (this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
                const error = new CircuitBreakerError(
                    `Circuit breaker in HALF_OPEN state has reached max calls limit`,
                    CircuitBreakerState.HALF_OPEN
                );
                logger.warn(this.node, `Circuit breaker HALF_OPEN limit reached for ${operationName}`);
                throw error;
            }
            this.halfOpenCalls++;
        }

        try {
            logger.debug(this.node, `Executing ${operationName} through circuit breaker`, {
                state: this.state,
                attempt: this.state === CircuitBreakerState.HALF_OPEN ? this.halfOpenCalls : 'N/A'
            });

            const result = await operation();
            this.onSuccess(operationName);
            return result;

        } catch (error) {
            this.onFailure(error as Error, operationName);
            throw error;
        }
    }

    /**
     * Handle successful operation
     */
    private onSuccess(operationName: string): void {
        this.successCount++;
        this.totalSuccesses++;
        this.lastSuccessTime = Date.now();

        if (this.state === CircuitBreakerState.HALF_OPEN) {
            logger.info(this.node, `Circuit breaker recovery successful for ${operationName}`, {
                halfOpenCalls: this.halfOpenCalls,
                successCount: this.successCount
            });
            this.transitionToClosed();
        } else if (this.state === CircuitBreakerState.CLOSED) {
            // Reset failure count on success in CLOSED state
            this.failureCount = 0;
        }

        logger.debug(this.node, `Circuit breaker success for ${operationName}`, {
            state: this.state,
            successCount: this.successCount
        });
    }

    /**
     * Handle failed operation
     */
    private onFailure(error: Error, operationName: string): void {
        this.failureCount++;
        this.totalFailures++;
        this.lastFailureTime = Date.now();

        logger.warn(this.node, `Circuit breaker failure for ${operationName}`, {
            state: this.state,
            failureCount: this.failureCount,
            error: error.message
        });

        if (this.state === CircuitBreakerState.HALF_OPEN) {
            // Any failure in HALF_OPEN immediately opens the circuit
            logger.warn(this.node, `Circuit breaker opening due to failure in HALF_OPEN state`);
            this.transitionToOpen();
        } else if (this.state === CircuitBreakerState.CLOSED) {
            // Check if we should open the circuit
            if (this.failureCount >= this.config.failureThreshold) {
                logger.warn(this.node, `Circuit breaker opening due to failure threshold reached`, {
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
    private transitionToClosed(): void {
        const previousState = this.state;
        this.state = CircuitBreakerState.CLOSED;
        this.failureCount = 0;
        this.halfOpenCalls = 0;

        logger.info(this.node, `Circuit breaker transitioned to CLOSED`, {
            previousState,
            successCount: this.successCount
        });
    }

    /**
     * Transition to OPEN state
     */
    private transitionToOpen(): void {
        const previousState = this.state;
        this.state = CircuitBreakerState.OPEN;
        this.circuitOpenCount++;
        this.halfOpenCalls = 0;

        logger.error(this.node, `Circuit breaker transitioned to OPEN`, {
            previousState,
            failureCount: this.failureCount,
            lastFailureTime: this.lastFailureTime,
            timeoutMs: this.config.timeout
        });
    }

    /**
     * Transition to HALF_OPEN state
     */
    private transitionToHalfOpen(): void {
        const previousState = this.state;
        this.state = CircuitBreakerState.HALF_OPEN;
        this.halfOpenCalls = 0;

        logger.info(this.node, `Circuit breaker transitioned to HALF_OPEN`, {
            previousState,
            timeSinceLastFailure: Date.now() - this.lastFailureTime
        });
    }

    /**
     * Check if circuit should attempt reset
     */
    private shouldAttemptReset(): boolean {
        return Date.now() - this.lastFailureTime >= this.config.timeout;
    }

    /**
     * Reset monitoring window if needed
     */
    private resetMonitoringWindowIfNeeded(): void {
        const now = Date.now();
        if (now - this.monitoringWindowStart >= this.config.monitoringPeriod) {
            logger.debug(this.node, `Resetting circuit breaker monitoring window`);
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
    getMetrics(): CircuitBreakerMetrics {
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
    getHealthStatus(): any {
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
    reset(): void {
        logger.info(this.node, `Circuit breaker manually reset`);
        this.state = CircuitBreakerState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.halfOpenCalls = 0;
        this.lastFailureTime = 0;
        this.lastSuccessTime = 0;
    }
}

/**
 * Factory function to create MQTT circuit breaker with default config
 */
export function createMqttCircuitBreaker(
    node: Node,
    config?: Partial<CircuitBreakerConfig>
): MqttCircuitBreaker {
    return new MqttCircuitBreaker(config, node, 'MQTT-CircuitBreaker');
}