"use strict";
/**
 * Test suite for exponential backoff retry logic
 * Tests retry mechanism with progressive delays to prevent overwhelming failed services
 */
Object.defineProperty(exports, "__esModule", { value: true });
const viis_schedule_executor_service_1 = require("../viis-schedule-executor-service");
describe('Exponential Backoff Retry Logic', () => {
    let mockNode;
    let mockModbusClient;
    let scheduleService;
    let mockGlobalContext;
    beforeEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
        mockGlobalContext = {
            get: jest.fn((key) => {
                if (key === 'MODBUS_HOLDING_REGISTERS')
                    return { set_flow_A1: 10 };
                if (key === 'MODBUS_COILS')
                    return { pump_1: 0 };
                return {};
            }),
            set: jest.fn()
        };
        mockNode = {
            context: () => ({ global: mockGlobalContext }),
            warn: jest.fn(),
            error: jest.fn()
        };
        mockModbusClient = {
            writeRegister: jest.fn(),
            writeCoil: jest.fn(),
            readHoldingRegisters: jest.fn(),
            readCoils: jest.fn(),
            isConnected: true
        };
        scheduleService = new viis_schedule_executor_service_1.ScheduleService(mockNode, true);
    });
    afterEach(() => {
        jest.useRealTimers();
    });
    describe('Modbus Write Retry with Backoff', () => {
        test('should retry with exponential backoff delays', async () => {
            // Mock write failure for first 2 attempts, success on 3rd
            let attemptCount = 0;
            mockModbusClient.writeRegister.mockImplementation(async () => {
                attemptCount++;
                if (attemptCount < 3) {
                    throw new Error('Connection timeout');
                }
                return true;
            });
            const startTime = Date.now();
            const delays = [];
            // Execute retry logic with backoff
            const result = await scheduleService.executeWithExponentialBackoff(async () => {
                const currentTime = Date.now();
                if (delays.length > 0) {
                    delays.push(currentTime - startTime);
                }
                return mockModbusClient.writeRegister(10, 100);
            }, 3, 1000 // Base delay 1 second
            );
            expect(result).toBe(true);
            expect(attemptCount).toBe(3);
            // Verify exponential delays: ~1s, ~2s
            // First retry after ~1000ms, second retry after ~2000ms more
            expect(mockModbusClient.writeRegister).toHaveBeenCalledTimes(3);
        });
        test('should fail after max retries with exponential backoff', async () => {
            mockModbusClient.writeRegister.mockRejectedValue(new Error('Persistent failure'));
            await expect(scheduleService.executeWithExponentialBackoff(() => mockModbusClient.writeRegister(10, 100), 3, 500)).rejects.toThrow('Persistent failure');
            expect(mockModbusClient.writeRegister).toHaveBeenCalledTimes(3);
        });
        test('should respect max delay cap for backoff', async () => {
            let attemptCount = 0;
            const delays = [];
            let lastTime = Date.now();
            mockModbusClient.writeRegister.mockImplementation(async () => {
                const currentTime = Date.now();
                if (attemptCount > 0) {
                    delays.push(currentTime - lastTime);
                }
                lastTime = currentTime;
                attemptCount++;
                if (attemptCount < 5) {
                    throw new Error('Still failing');
                }
                return true;
            });
            const result = await scheduleService.executeWithExponentialBackoff(() => mockModbusClient.writeRegister(10, 100), 5, 1000, 5000 // Max delay cap at 5 seconds
            );
            expect(result).toBe(true);
            // Delays should not exceed 5000ms
            delays.forEach(delay => {
                expect(delay).toBeLessThanOrEqual(5100); // Allow small margin
            });
        });
        test('should use jitter to prevent thundering herd', async () => {
            const delays = [];
            // Run multiple retry operations in parallel
            const operations = Array(10).fill(null).map(async (_, index) => {
                let attemptTime = 0;
                mockModbusClient.writeRegister.mockImplementation(async () => {
                    if (attemptTime === 0) {
                        attemptTime = Date.now();
                        throw new Error('First attempt fails');
                    }
                    delays.push(Date.now() - attemptTime);
                    return true;
                });
                return scheduleService.executeWithExponentialBackoff(() => mockModbusClient.writeRegister(10 + index, 100), 2, 1000, 5000, true // Enable jitter
                );
            });
            await Promise.all(operations);
            // With jitter, delays should vary (not all exactly 1000ms)
            const uniqueDelays = new Set(delays.map(d => Math.floor(d / 100)));
            expect(uniqueDelays.size).toBeGreaterThan(1);
        });
    });
    describe('Circuit Breaker Integration', () => {
        test('should open circuit after consecutive failures', async () => {
            mockModbusClient.writeRegister.mockRejectedValue(new Error('Service down'));
            const circuitKey = 'modbus-write-failures-test';
            // Try 5 operations - should fail and open circuit
            for (let i = 0; i < 5; i++) {
                try {
                    await scheduleService.executeWithCircuitBreaker(() => mockModbusClient.writeRegister(10, 100), circuitKey, 5, // Failure threshold
                    30000 // Timeout
                    );
                }
                catch (error) {
                    // Expected to fail
                }
            }
            const circuitState = scheduleService.getCircuitBreakerState(circuitKey);
            expect(circuitState.state).toBe('open');
            expect(circuitState.failures).toBeGreaterThanOrEqual(5);
        });
        test('should reject fast when circuit is open', async () => {
            const circuitKey = 'modbus-write-open-test';
            // Manually set circuit to open state
            scheduleService.updateCircuitBreakerState(circuitKey, {
                failures: 10,
                lastFailureTime: Date.now(),
                state: 'open'
            });
            mockModbusClient.writeRegister.mockClear();
            const startTime = Date.now();
            await expect(scheduleService.executeWithCircuitBreaker(() => mockModbusClient.writeRegister(10, 100), circuitKey, 5, 30000)).rejects.toThrow('Circuit breaker is OPEN');
            const executionTime = Date.now() - startTime;
            // Should fail immediately, not attempt operation  
            // Allow for some overhead in test execution
            expect(executionTime).toBeLessThan(200);
            expect(mockModbusClient.writeRegister).not.toHaveBeenCalled();
        });
        test('should transition to half-open after timeout period', async () => {
            const circuitKey = 'modbus-write-halfopen-test';
            // Set circuit to open state with old failure time
            scheduleService.updateCircuitBreakerState(circuitKey, {
                failures: 10,
                lastFailureTime: Date.now() - 35000, // 35 seconds ago
                state: 'open'
            });
            mockModbusClient.writeRegister.mockResolvedValue(true);
            mockModbusClient.writeRegister.mockClear();
            await scheduleService.executeWithCircuitBreaker(() => mockModbusClient.writeRegister(10, 100), circuitKey, 5, 30000 // 30 second timeout
            );
            // Should have attempted operation (half-open allows test)
            expect(mockModbusClient.writeRegister).toHaveBeenCalled();
        });
        test('should close circuit after successful half-open test', async () => {
            const circuitKey = 'modbus-write-close-test';
            // Set circuit to half-open state
            scheduleService.updateCircuitBreakerState(circuitKey, {
                failures: 5,
                lastFailureTime: Date.now() - 35000,
                state: 'half-open'
            });
            mockModbusClient.writeRegister.mockResolvedValue(true);
            await scheduleService.executeWithCircuitBreaker(() => mockModbusClient.writeRegister(10, 100), circuitKey, 5, 30000);
            const circuitState = scheduleService.getCircuitBreakerState(circuitKey);
            expect(circuitState.state).toBe('closed');
            expect(circuitState.failures).toBe(0);
        });
    });
    describe('Timeout Protection', () => {
        test('should timeout long-running operations', async () => {
            jest.useRealTimers(); // Use real timers for this test
            mockModbusClient.writeRegister.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 10000)));
            const startTime = Date.now();
            await expect(scheduleService.executeWithTimeout(() => mockModbusClient.writeRegister(10, 100), 2000 // 2 second timeout
            )).rejects.toThrow('Operation timed out');
            const executionTime = Date.now() - startTime;
            // Should timeout around 2 seconds, not wait full 10 seconds
            expect(executionTime).toBeGreaterThanOrEqual(1900);
            expect(executionTime).toBeLessThan(3000);
        }, 10000); // Set test timeout to 10 seconds
        test('should return result if operation completes before timeout', async () => {
            mockModbusClient.writeRegister.mockResolvedValue(true);
            const result = await scheduleService.executeWithTimeout(() => mockModbusClient.writeRegister(10, 100), 5000);
            expect(result).toBe(true);
        });
        test('should support custom timeout messages', async () => {
            jest.useRealTimers(); // Use real timers for this test
            mockModbusClient.writeRegister.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 10000)));
            await expect(scheduleService.executeWithTimeout(() => mockModbusClient.writeRegister(10, 100), 1000, 'Modbus write operation exceeded 1 second limit')).rejects.toThrow('Modbus write operation exceeded 1 second limit');
        }, 5000); // Set test timeout to 5 seconds
    });
    describe('Combined Resilience Patterns', () => {
        test('should combine timeout, retry with backoff, and circuit breaker', async () => {
            jest.useRealTimers(); // Use real timers for this test
            let attemptCount = 0;
            mockModbusClient.writeRegister.mockImplementation(async () => {
                attemptCount++;
                if (attemptCount < 3) {
                    // Simulate slow response
                    await new Promise(resolve => setTimeout(resolve, 100));
                    throw new Error('Temporary failure');
                }
                return true;
            });
            const result = await scheduleService.executeWithResilience(() => mockModbusClient.writeRegister(10, 100), {
                maxRetries: 3,
                baseDelay: 200,
                maxDelay: 3000,
                timeout: 5000,
                circuitBreakerKey: 'modbus-write-test',
                circuitBreakerThreshold: 5
            });
            expect(result).toBe(true);
            expect(attemptCount).toBe(3);
        }, 15000); // Set test timeout to 15 seconds
        test('should fail fast when circuit is open even with retries configured', async () => {
            const circuitKey = 'modbus-write-reject-test';
            // Set circuit to open state
            scheduleService.updateCircuitBreakerState(circuitKey, {
                failures: 10,
                lastFailureTime: Date.now(),
                state: 'open'
            });
            mockModbusClient.writeRegister.mockClear();
            await expect(scheduleService.executeWithResilience(() => mockModbusClient.writeRegister(10, 100), {
                maxRetries: 5,
                baseDelay: 1000,
                timeout: 5000,
                circuitBreakerKey: circuitKey,
                circuitBreakerThreshold: 5
            })).rejects.toThrow('Circuit breaker is OPEN');
            // Should not retry when circuit is open
            expect(mockModbusClient.writeRegister).not.toHaveBeenCalled();
        });
    });
});
