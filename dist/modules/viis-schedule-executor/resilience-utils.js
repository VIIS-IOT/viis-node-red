"use strict";
/**
 * Resilience utilities for VIIS Schedule Executor
 * Provides timeout protection, exponential backoff retry, and circuit breaker patterns
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MqttFailedQueue = exports.CircuitBreakerManager = void 0;
exports.executeWithTimeout = executeWithTimeout;
exports.calculateBackoffDelay = calculateBackoffDelay;
exports.sleep = sleep;
exports.executeWithExponentialBackoff = executeWithExponentialBackoff;
exports.executeWithCircuitBreaker = executeWithCircuitBreaker;
exports.executeWithResilience = executeWithResilience;
/**
 * Circuit Breaker State Manager
 */
class CircuitBreakerManager {
    constructor() {
        this.circuits = new Map();
    }
    static getInstance() {
        if (!CircuitBreakerManager.instance) {
            CircuitBreakerManager.instance = new CircuitBreakerManager();
        }
        return CircuitBreakerManager.instance;
    }
    getState(key) {
        if (!this.circuits.has(key)) {
            this.circuits.set(key, {
                failures: 0,
                lastFailureTime: 0,
                state: 'closed'
            });
        }
        return this.circuits.get(key);
    }
    updateState(key, state) {
        const current = this.getState(key);
        this.circuits.set(key, Object.assign(Object.assign({}, current), state));
    }
    recordSuccess(key) {
        this.updateState(key, {
            failures: 0,
            state: 'closed'
        });
    }
    recordFailure(key) {
        const current = this.getState(key);
        this.updateState(key, {
            failures: current.failures + 1,
            lastFailureTime: Date.now()
        });
    }
    shouldAllowRequest(key, options) {
        const state = this.getState(key);
        if (state.state === 'closed') {
            return true;
        }
        if (state.state === 'open') {
            // Check if reset timeout has elapsed
            const timeSinceLastFailure = Date.now() - state.lastFailureTime;
            if (timeSinceLastFailure >= options.resetTimeout) {
                // Transition to half-open
                this.updateState(key, { state: 'half-open' });
                return true;
            }
            return false;
        }
        // half-open state - allow one test request
        return true;
    }
    checkThreshold(key, threshold) {
        const state = this.getState(key);
        if (state.failures >= threshold && state.state === 'closed') {
            this.updateState(key, { state: 'open' });
        }
    }
}
exports.CircuitBreakerManager = CircuitBreakerManager;
/**
 * Execute operation with timeout protection
 */
async function executeWithTimeout(operation, timeoutMs, timeoutMessage) {
    return Promise.race([
        operation(),
        new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error(timeoutMessage || `Operation timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        })
    ]);
}
/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateBackoffDelay(attempt, baseDelay, maxDelay = 30000, useJitter = false) {
    // Exponential backoff: baseDelay * 2^attempt
    let delay = baseDelay * Math.pow(2, attempt);
    // Cap at max delay
    delay = Math.min(delay, maxDelay);
    // Add jitter to prevent thundering herd (±25% random variation)
    if (useJitter) {
        const jitterRange = delay * 0.25;
        const jitter = (Math.random() * 2 - 1) * jitterRange;
        delay = Math.max(0, delay + jitter);
    }
    return delay;
}
/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Execute operation with exponential backoff retry
 */
async function executeWithExponentialBackoff(operation, maxRetries, baseDelay, maxDelay = 30000, useJitter = false) {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await operation();
        }
        catch (error) {
            lastError = error;
            // Don't delay after the last attempt
            if (attempt < maxRetries - 1) {
                const delay = calculateBackoffDelay(attempt, baseDelay, maxDelay, useJitter);
                await sleep(delay);
            }
        }
    }
    throw lastError || new Error('Operation failed after retries');
}
/**
 * Execute operation with circuit breaker protection
 */
async function executeWithCircuitBreaker(operation, circuitKey, options) {
    const manager = CircuitBreakerManager.getInstance();
    // Check if circuit allows request
    if (!manager.shouldAllowRequest(circuitKey, options)) {
        throw new Error(`Circuit breaker is OPEN for ${circuitKey}`);
    }
    try {
        const result = await operation();
        manager.recordSuccess(circuitKey);
        return result;
    }
    catch (error) {
        manager.recordFailure(circuitKey);
        manager.checkThreshold(circuitKey, options.failureThreshold);
        throw error;
    }
}
/**
 * Execute operation with combined resilience patterns:
 * - Timeout protection
 * - Exponential backoff retry
 * - Circuit breaker
 */
async function executeWithResilience(operation, options) {
    const { maxRetries, baseDelay, maxDelay = 30000, useJitter = true, timeout, circuitBreakerKey, circuitBreakerThreshold = 5, circuitBreakerTimeout = 30000 } = options;
    // Check circuit breaker state BEFORE attempting retries
    if (circuitBreakerKey) {
        const manager = CircuitBreakerManager.getInstance();
        const cbOptions = {
            failureThreshold: circuitBreakerThreshold,
            resetTimeout: circuitBreakerTimeout
        };
        if (!manager.shouldAllowRequest(circuitBreakerKey, cbOptions)) {
            throw new Error(`Circuit breaker is OPEN for ${circuitBreakerKey}`);
        }
    }
    // Wrap operation with circuit breaker if key provided
    const wrappedOperation = circuitBreakerKey
        ? async () => executeWithCircuitBreaker(() => executeWithTimeout(operation, timeout), circuitBreakerKey, {
            failureThreshold: circuitBreakerThreshold,
            resetTimeout: circuitBreakerTimeout
        })
        : async () => executeWithTimeout(operation, timeout);
    // Execute with retry and backoff
    return executeWithExponentialBackoff(wrappedOperation, maxRetries, baseDelay, maxDelay, useJitter);
}
class MqttFailedQueue {
    constructor() {
        this.queue = [];
        this.MAX_QUEUE_SIZE = 100;
    }
    static getInstance() {
        if (!MqttFailedQueue.instance) {
            MqttFailedQueue.instance = new MqttFailedQueue();
        }
        return MqttFailedQueue.instance;
    }
    add(item) {
        // Remove oldest items if queue is full
        if (this.queue.length >= this.MAX_QUEUE_SIZE) {
            this.queue.shift();
        }
        this.queue.push(Object.assign(Object.assign({}, item), { attempts: 0 }));
    }
    getAll() {
        return [...this.queue];
    }
    remove(index) {
        this.queue.splice(index, 1);
    }
    clear() {
        this.queue = [];
    }
    size() {
        return this.queue.length;
    }
    incrementAttempts(index) {
        if (this.queue[index]) {
            this.queue[index].attempts++;
        }
    }
}
exports.MqttFailedQueue = MqttFailedQueue;
