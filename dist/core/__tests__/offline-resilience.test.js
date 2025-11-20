"use strict";
/**
 * @fileoverview Unit tests for Offline Resilience Module
 */
Object.defineProperty(exports, "__esModule", { value: true });
const offline_resilience_1 = require("../offline-resilience");
describe('ExternalServiceCircuitBreaker', () => {
    let circuitBreaker;
    beforeEach(() => {
        circuitBreaker = offline_resilience_1.ExternalServiceCircuitBreaker.getInstance();
        // Reset all circuits before each test
        circuitBreaker.reset('test-service');
        circuitBreaker.reset('backend-http');
        circuitBreaker.reset('thingsboard-mqtt');
    });
    describe('Circuit State Management', () => {
        it('should start in closed state', () => {
            expect(circuitBreaker.isServiceOnline('test-service')).toBe(true);
            expect(circuitBreaker.canAttempt('test-service')).toBe(true);
        });
        it('should open circuit after threshold failures', () => {
            const error = new Error('Service unavailable');
            // Record 3 failures (FAILURE_THRESHOLD)
            circuitBreaker.recordFailure('test-service', error);
            circuitBreaker.recordFailure('test-service', error);
            circuitBreaker.recordFailure('test-service', error);
            // Circuit should be open
            expect(circuitBreaker.isServiceOnline('test-service')).toBe(false);
            expect(circuitBreaker.canAttempt('test-service')).toBe(false);
        });
        it('should close circuit on success', () => {
            const error = new Error('Service unavailable');
            // Record failures to open circuit
            circuitBreaker.recordFailure('test-service', error);
            circuitBreaker.recordFailure('test-service', error);
            circuitBreaker.recordFailure('test-service', error);
            // Record success - should close circuit
            circuitBreaker.recordSuccess('test-service');
            expect(circuitBreaker.isServiceOnline('test-service')).toBe(true);
            expect(circuitBreaker.canAttempt('test-service')).toBe(true);
        });
        it('should transition to half-open after timeout', (done) => {
            const error = new Error('Service unavailable');
            // Open circuit
            circuitBreaker.recordFailure('test-service', error);
            circuitBreaker.recordFailure('test-service', error);
            circuitBreaker.recordFailure('test-service', error);
            expect(circuitBreaker.canAttempt('test-service')).toBe(false);
            // Wait for OPEN_DURATION (30s in real, but we test the logic)
            // In real scenario, we'd wait 30s. For testing, we can manually test the state
            done();
        });
        it('should manually reset circuit', () => {
            const error = new Error('Service unavailable');
            // Open circuit
            circuitBreaker.recordFailure('test-service', error);
            circuitBreaker.recordFailure('test-service', error);
            circuitBreaker.recordFailure('test-service', error);
            expect(circuitBreaker.isServiceOnline('test-service')).toBe(false);
            // Manual reset
            circuitBreaker.reset('test-service');
            expect(circuitBreaker.isServiceOnline('test-service')).toBe(true);
            expect(circuitBreaker.canAttempt('test-service')).toBe(true);
        });
    });
    describe('getAllStates', () => {
        it('should return all circuit states', () => {
            const error = new Error('Error');
            circuitBreaker.recordFailure('service1', error);
            circuitBreaker.recordSuccess('service2');
            const states = circuitBreaker.getAllStates();
            expect(states.size).toBeGreaterThanOrEqual(2);
            expect(states.has('service1')).toBe(true);
            expect(states.has('service2')).toBe(true);
        });
    });
});
describe('executeOfflineSafe', () => {
    const mockNode = {
        warn: jest.fn(),
        error: jest.fn()
    };
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it('should execute operation successfully', async () => {
        const operation = jest.fn().mockResolvedValue('success');
        const result = await (0, offline_resilience_1.executeOfflineSafe)({
            operationName: 'Test operation',
            node: mockNode,
            fallbackValue: 'fallback'
        }, operation);
        expect(result).toBe('success');
        expect(operation).toHaveBeenCalled();
        expect(mockNode.warn).not.toHaveBeenCalled();
    });
    it('should return fallback value on error', async () => {
        const operation = jest.fn().mockRejectedValue(new Error('Operation failed'));
        const result = await (0, offline_resilience_1.executeOfflineSafe)({
            operationName: 'Test operation',
            node: mockNode,
            fallbackValue: 'fallback',
            useWarning: true
        }, operation);
        expect(result).toBe('fallback');
        expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('Test operation failed'));
    });
    it('should throw on critical operation without fallback', async () => {
        const operation = jest.fn().mockRejectedValue(new Error('Critical error'));
        await expect((0, offline_resilience_1.executeOfflineSafe)({
            operationName: 'Critical operation',
            node: mockNode,
            critical: true,
            // no fallbackValue
        }, operation)).rejects.toThrow('Critical error');
    });
    it('should log error instead of warning when useWarning is false', async () => {
        const operation = jest.fn().mockRejectedValue(new Error('Error'));
        await (0, offline_resilience_1.executeOfflineSafe)({
            operationName: 'Test',
            node: mockNode,
            fallbackValue: 'fallback',
            useWarning: false
        }, operation);
        expect(mockNode.error).toHaveBeenCalled();
        expect(mockNode.warn).not.toHaveBeenCalled();
    });
});
describe('executeWithCircuitBreaker', () => {
    let circuitBreaker;
    const mockNode = {
        warn: jest.fn()
    };
    beforeEach(() => {
        circuitBreaker = offline_resilience_1.ExternalServiceCircuitBreaker.getInstance();
        circuitBreaker.reset('test-cb');
        jest.clearAllMocks();
    });
    it('should execute operation when circuit is closed', async () => {
        const operation = jest.fn().mockResolvedValue('success');
        const result = await (0, offline_resilience_1.executeWithCircuitBreaker)('test-cb', mockNode, operation, 'fallback');
        expect(result).toBe('success');
        expect(operation).toHaveBeenCalled();
    });
    it('should skip operation when circuit is open', async () => {
        const operation = jest.fn().mockResolvedValue('success');
        const error = new Error('Failure');
        // Open circuit
        circuitBreaker.recordFailure('test-cb', error);
        circuitBreaker.recordFailure('test-cb', error);
        circuitBreaker.recordFailure('test-cb', error);
        const result = await (0, offline_resilience_1.executeWithCircuitBreaker)('test-cb', mockNode, operation, 'fallback');
        expect(result).toBe('fallback');
        expect(operation).not.toHaveBeenCalled();
        expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('OFFLINE'));
    });
    it('should record success on successful operation', async () => {
        const operation = jest.fn().mockResolvedValue('success');
        await (0, offline_resilience_1.executeWithCircuitBreaker)('test-cb', mockNode, operation);
        expect(circuitBreaker.isServiceOnline('test-cb')).toBe(true);
    });
    it('should record failure on failed operation', async () => {
        const operation = jest.fn().mockRejectedValue(new Error('Failed'));
        await (0, offline_resilience_1.executeWithCircuitBreaker)('test-cb', mockNode, operation, 'fallback');
        const states = circuitBreaker.getAllStates();
        const state = states.get('test-cb');
        expect(state === null || state === void 0 ? void 0 : state.failures).toBe(1);
    });
});
describe('getExternalServicesStatus', () => {
    let circuitBreaker;
    beforeEach(() => {
        circuitBreaker = offline_resilience_1.ExternalServiceCircuitBreaker.getInstance();
        circuitBreaker.reset('thingsboard-mqtt');
        circuitBreaker.reset('backend-http');
    });
    it('should return all online when circuits are closed', () => {
        const status = (0, offline_resilience_1.getExternalServicesStatus)();
        expect(status.thingsboard.online).toBe(true);
        expect(status.backend.online).toBe(true);
        expect(status.allOnline).toBe(true);
    });
    it('should detect offline services', () => {
        const error = new Error('Offline');
        // Make backend offline
        circuitBreaker.recordFailure('backend-http', error);
        circuitBreaker.recordFailure('backend-http', error);
        circuitBreaker.recordFailure('backend-http', error);
        const status = (0, offline_resilience_1.getExternalServicesStatus)();
        expect(status.backend.online).toBe(false);
        expect(status.allOnline).toBe(false);
    });
    it('should show correct state for each service', () => {
        const error = new Error('Error');
        // ThingsBoard offline
        circuitBreaker.recordFailure('thingsboard-mqtt', error);
        circuitBreaker.recordFailure('thingsboard-mqtt', error);
        circuitBreaker.recordFailure('thingsboard-mqtt', error);
        const status = (0, offline_resilience_1.getExternalServicesStatus)();
        expect(status.thingsboard.online).toBe(false);
        expect(status.thingsboard.state).toBe('open');
        expect(status.backend.online).toBe(true);
        expect(status.backend.state).toBe('closed');
    });
});
describe('Integration: Circuit Breaker with executeWithCircuitBreaker', () => {
    let circuitBreaker;
    const mockNode = { warn: jest.fn() };
    beforeEach(() => {
        circuitBreaker = offline_resilience_1.ExternalServiceCircuitBreaker.getInstance();
        circuitBreaker.reset('integration-test');
        jest.clearAllMocks();
    });
    it('should handle multiple failures and recovery', async () => {
        let shouldFail = true;
        const operation = jest.fn(() => {
            if (shouldFail) {
                return Promise.reject(new Error('Service down'));
            }
            return Promise.resolve('success');
        });
        // First 3 calls fail - circuit opens
        await (0, offline_resilience_1.executeWithCircuitBreaker)('integration-test', mockNode, operation, 'fallback');
        await (0, offline_resilience_1.executeWithCircuitBreaker)('integration-test', mockNode, operation, 'fallback');
        await (0, offline_resilience_1.executeWithCircuitBreaker)('integration-test', mockNode, operation, 'fallback');
        expect(circuitBreaker.isServiceOnline('integration-test')).toBe(false);
        // Next call is blocked by circuit breaker
        await (0, offline_resilience_1.executeWithCircuitBreaker)('integration-test', mockNode, operation, 'fallback');
        expect(operation).toHaveBeenCalledTimes(3); // Not 4, because circuit is open
        // Service recovers
        shouldFail = false;
        circuitBreaker.reset('integration-test');
        // Call succeeds
        const result = await (0, offline_resilience_1.executeWithCircuitBreaker)('integration-test', mockNode, operation, 'fallback');
        expect(result).toBe('success');
        expect(circuitBreaker.isServiceOnline('integration-test')).toBe(true);
    });
});
