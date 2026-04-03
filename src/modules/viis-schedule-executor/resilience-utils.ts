/**
 * Resilience utilities for VIIS Schedule Executor
 * Provides timeout protection, exponential backoff retry, and circuit breaker patterns
 */

export interface RetryOptions {
    maxRetries: number;
    baseDelay: number;
    maxDelay?: number;
    useJitter?: boolean;
    useExponentialBackoff?: boolean;
}

export interface TimeoutOptions {
    timeout: number;
    timeoutMessage?: string;
}

export interface CircuitBreakerState {
    failures: number;
    lastFailureTime: number;
    state: 'closed' | 'open' | 'half-open';
}

export interface CircuitBreakerOptions {
    failureThreshold: number;
    resetTimeout: number;
}

export interface ResilienceOptions extends RetryOptions, TimeoutOptions {
    circuitBreakerKey?: string;
    circuitBreakerThreshold?: number;
    circuitBreakerTimeout?: number;
}

/**
 * Circuit Breaker State Manager
 */
export class CircuitBreakerManager {
    private static instance: CircuitBreakerManager;
    private circuits: Map<string, CircuitBreakerState> = new Map();

    private constructor() {}

    static getInstance(): CircuitBreakerManager {
        if (!CircuitBreakerManager.instance) {
            CircuitBreakerManager.instance = new CircuitBreakerManager();
        }
        return CircuitBreakerManager.instance;
    }

    getState(key: string): CircuitBreakerState {
        if (!this.circuits.has(key)) {
            this.circuits.set(key, {
                failures: 0,
                lastFailureTime: 0,
                state: 'closed'
            });
        }
        return this.circuits.get(key)!;
    }

    updateState(key: string, state: Partial<CircuitBreakerState>): void {
        const current = this.getState(key);
        this.circuits.set(key, { ...current, ...state });
    }

    recordSuccess(key: string): void {
        this.updateState(key, {
            failures: 0,
            state: 'closed'
        });
    }

    recordFailure(key: string): void {
        const current = this.getState(key);
        this.updateState(key, {
            failures: current.failures + 1,
            lastFailureTime: Date.now()
        });
    }

    shouldAllowRequest(key: string, options: CircuitBreakerOptions): boolean {
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

    checkThreshold(key: string, threshold: number): void {
        const state = this.getState(key);
        if (state.failures >= threshold && state.state === 'closed') {
            this.updateState(key, { state: 'open' });
        }
    }
}

/**
 * Execute operation with timeout protection
 */
export async function executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    timeoutMessage?: string
): Promise<T> {
    return Promise.race([
        operation(),
        new Promise<T>((_, reject) => {
            setTimeout(() => {
                reject(new Error(timeoutMessage || `Operation timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        })
    ]);
}

/**
 * Calculate delay with exponential backoff and optional jitter
 */
export function calculateBackoffDelay(
    attempt: number,
    baseDelay: number,
    maxDelay: number = 30000,
    useJitter: boolean = false
): number {
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
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute operation with exponential backoff retry
 */
export async function executeWithExponentialBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number,
    baseDelay: number,
    maxDelay: number = 30000,
    useJitter: boolean = false
): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error as Error;
            
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
export async function executeWithCircuitBreaker<T>(
    operation: () => Promise<T>,
    circuitKey: string,
    options: CircuitBreakerOptions
): Promise<T> {
    const manager = CircuitBreakerManager.getInstance();
    
    // Check if circuit allows request
    if (!manager.shouldAllowRequest(circuitKey, options)) {
        throw new Error(`Circuit breaker is OPEN for ${circuitKey}`);
    }

    try {
        const result = await operation();
        manager.recordSuccess(circuitKey);
        return result;
    } catch (error) {
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
export async function executeWithResilience<T>(
    operation: () => Promise<T>,
    options: ResilienceOptions
): Promise<T> {
    const {
        maxRetries,
        baseDelay,
        maxDelay = 30000,
        useJitter = true,
        timeout,
        circuitBreakerKey,
        circuitBreakerThreshold = 5,
        circuitBreakerTimeout = 30000
    } = options;

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
        ? async () => executeWithCircuitBreaker(
            () => executeWithTimeout(operation, timeout),
            circuitBreakerKey,
            {
                failureThreshold: circuitBreakerThreshold,
                resetTimeout: circuitBreakerTimeout
            }
          )
        : async () => executeWithTimeout(operation, timeout);

    // Execute with retry and backoff
    return executeWithExponentialBackoff(
        wrappedOperation,
        maxRetries,
        baseDelay,
        maxDelay,
        useJitter
    );
}

/**
 * MQTT Queue for failed messages
 */
export interface MqttQueueItem {
    schedule?: any;
    configParam?: any;
    type: 'notification' | 'config';
    timestamp: number;
    attempts: number;
}

export class MqttFailedQueue {
    private static instance: MqttFailedQueue;
    private queue: MqttQueueItem[] = [];
    private readonly MAX_QUEUE_SIZE = 100;

    private constructor() {}

    static getInstance(): MqttFailedQueue {
        if (!MqttFailedQueue.instance) {
            MqttFailedQueue.instance = new MqttFailedQueue();
        }
        return MqttFailedQueue.instance;
    }

    add(item: Omit<MqttQueueItem, 'attempts'>): void {
        // Remove oldest items if queue is full
        if (this.queue.length >= this.MAX_QUEUE_SIZE) {
            this.queue.shift();
        }

        this.queue.push({
            ...item,
            attempts: 0
        });
    }

    getAll(): MqttQueueItem[] {
        return [...this.queue];
    }

    remove(index: number): void {
        this.queue.splice(index, 1);
    }

    clear(): void {
        this.queue = [];
    }

    size(): number {
        return this.queue.length;
    }

    incrementAttempts(index: number): void {
        if (this.queue[index]) {
            this.queue[index].attempts++;
        }
    }
}
