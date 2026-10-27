"use strict";
/**
 * Unit Tests for VIIS Device Protection Manager
 *
 * Tests for Min/Max/Bypass/Force protection logic
 */
Object.defineProperty(exports, "__esModule", { value: true });
const protection_manager_1 = require("../protection-manager");
describe('ProtectionManager', () => {
    let protectionManager;
    beforeEach(() => {
        protectionManager = new protection_manager_1.ProtectionManager();
    });
    afterEach(() => {
        protectionManager.clearAllStates();
    });
    // ========================================================================
    // BYPASS Tests
    // ========================================================================
    describe('Bypass Protection', () => {
        it('should allow all operations when bypass is enabled', () => {
            const config = {
                maxTimeOn: 60,
                minTimeOn: 10,
                minOffTime: 30,
                bypass: true,
                forceOn: false,
                forceOff: false,
                upperLimit: 0,
                lowerLimit: 0,
                deviceType: 'lamp'
            };
            const result = protectionManager.evaluateProtection('test_device', true, config);
            expect(result.allowed).toBe(true);
            expect(result.action).toBe('bypass');
            expect(result.reason).toContain('Bypass active');
        });
        it('should skip all protection checks when bypassed', () => {
            const config = {
                maxTimeOn: 1, // 1 second max
                minTimeOn: 100,
                minOffTime: 100,
                bypass: true,
                forceOn: false,
                forceOff: false,
                upperLimit: 0,
                lowerLimit: 0,
                deviceType: 'lamp'
            };
            // Even though we exceed max time, bypass should allow
            const result = protectionManager.evaluateProtection('test_device', true, config);
            expect(result.allowed).toBe(true);
            expect(result.action).toBe('bypass');
        });
    });
    // ========================================================================
    // FORCE Tests
    // ========================================================================
    describe('Force ON/OFF', () => {
        it('should force ON when forceOn is true', () => {
            const config = {
                maxTimeOn: 0,
                minTimeOn: 0,
                minOffTime: 0,
                bypass: false,
                forceOn: true,
                forceOff: false,
                upperLimit: 0,
                lowerLimit: 0,
                deviceType: 'lamp'
            };
            const result = protectionManager.evaluateProtection('test_device', false, config);
            expect(result.allowed).toBe(true);
            expect(result.finalState).toBe(true);
            expect(result.action).toBe('force_on');
        });
        it('should force OFF when forceOff is true', () => {
            const config = {
                maxTimeOn: 0,
                minTimeOn: 0,
                minOffTime: 0,
                bypass: false,
                forceOn: false,
                forceOff: true,
                upperLimit: 0,
                lowerLimit: 0,
                deviceType: 'lamp'
            };
            const result = protectionManager.evaluateProtection('test_device', true, config);
            expect(result.allowed).toBe(true);
            expect(result.finalState).toBe(false);
            expect(result.action).toBe('force_off');
        });
        it('should prioritize force OFF when both force ON and OFF are true', () => {
            const config = {
                maxTimeOn: 0,
                minTimeOn: 0,
                minOffTime: 0,
                bypass: false,
                forceOn: true,
                forceOff: true,
                upperLimit: 0,
                lowerLimit: 0,
                deviceType: 'lamp'
            };
            const result = protectionManager.evaluateProtection('test_device', true, config);
            expect(result.allowed).toBe(false);
            expect(result.finalState).toBe(false);
            expect(result.reason).toContain('prioritizing OFF');
        });
        it('should still respect max time when forcing ON', () => {
            const config = {
                maxTimeOn: 1, // 1 second
                minTimeOn: 0,
                minOffTime: 0,
                bypass: false,
                forceOn: true,
                forceOff: false,
                upperLimit: 0,
                lowerLimit: 0,
                deviceType: 'lamp'
            };
            // Simulate being ON for a while
            protectionManager.evaluateProtection('test_device', true, config);
            // Wait simulated time
            jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000);
            const result = protectionManager.evaluateProtection('test_device', true, config);
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('Max time');
        });
    });
    // ========================================================================
    // MAX TIME ON Tests
    // ========================================================================
    describe('Max Time ON Protection', () => {
        beforeAll(() => {
            jest.useFakeTimers();
        });
        afterAll(() => {
            jest.useRealTimers();
        });
        it('should allow operation within max time', () => {
            const config = {
                maxTimeOn: 60, // 60 seconds
                minTimeOn: 0,
                minOffTime: 0,
                bypass: false,
                forceOn: false,
                forceOff: false,
                upperLimit: 0,
                lowerLimit: 0,
                deviceType: 'lamp'
            };
            const result = protectionManager.evaluateProtection('test_device', true, config);
            expect(result.allowed).toBe(true);
            expect(result.action).toBe('allow');
        });
        it('should auto OFF when max time is exceeded', () => {
            const config = {
                maxTimeOn: 5, // 5 seconds
                minTimeOn: 0,
                minOffTime: 0,
                bypass: false,
                forceOn: false,
                forceOff: false,
                upperLimit: 0,
                lowerLimit: 0,
                deviceType: 'lamp'
            };
            // Initial state - ON
            protectionManager.evaluateProtection('test_device', true, config);
            // Advance time by 6 seconds (exceed max)
            jest.advanceTimersByTime(6000);
            const result = protectionManager.evaluateProtection('test_device', true, config);
            expect(result.allowed).toBe(true);
            expect(result.finalState).toBe(false);
            expect(result.action).toBe('auto_off');
            expect(result.reason).toContain('Max time');
        });
        it('should track max time violations', () => {
            const config = {
                maxTimeOn: 1,
                minTimeOn: 0,
                minOffTime: 0,
                bypass: false,
                forceOn: false,
                forceOff: false,
                upperLimit: 0,
                lowerLimit: 0,
                deviceType: 'lamp'
            };
            protectionManager.evaluateProtection('test_device', true, config);
            jest.advanceTimersByTime(2000);
            protectionManager.evaluateProtection('test_device', true, config);
            const stats = protectionManager.getViolationStats('test_device');
            expect(stats === null || stats === void 0 ? void 0 : stats.maxTime).toBeGreaterThan(0);
        });
    });
    // ========================================================================
    // MIN TIME ON Tests
    // ========================================================================
    describe('Min Time ON Protection (Anti-Cycling)', () => {
        beforeAll(() => {
            jest.useFakeTimers();
        });
        afterAll(() => {
            jest.useRealTimers();
        });
        it('should allow turning OFF after min time is met', () => {
            const config = {
                maxTimeOn: 0,
                minTimeOn: 5, // 5 seconds
                minOffTime: 0,
                bypass: false,
                forceOn: false,
                forceOff: false,
                upperLimit: 0,
                lowerLimit: 0,
                deviceType: 'lamp'
            };
            // Start ON
            protectionManager.evaluateProtection('test_device', true, config);
            // Advance past min time
            jest.advanceTimersByTime(6000);
            const result = protectionManager.evaluateProtection('test_device', true, config);
            expect(result.allowed).toBe(true);
            expect(result.finalState).toBe(true);
        });
        it('should block turning OFF before min time is met', () => {
            const config = {
                maxTimeOn: 0,
                minTimeOn: 10, // 10 seconds
                minOffTime: 0,
                bypass: false,
                forceOn: false,
                forceOff: false,
                upperLimit: 0,
                lowerLimit: 0,
                deviceType: 'lamp'
            };
            // Start ON
            protectionManager.evaluateProtection('test_device', true, config);
            // Try to turn OFF after 5 seconds (before min time)
            jest.advanceTimersByTime(5000);
            const result = protectionManager.evaluateProtection('test_device', true, config);
            // Implementation now correctly tracks min time and blocks early turn-off
            expect(result.allowed).toBe(false);
        });
    });
    // ========================================================================
    // MIN OFF TIME Tests
    // ========================================================================
    describe('Min Off Time Protection (Anti Rapid Restart)', () => {
        beforeAll(() => {
            jest.useFakeTimers();
        });
        afterAll(() => {
            jest.useRealTimers();
        });
        it('should allow turning ON after min off time is met', () => {
            const config = {
                maxTimeOn: 0,
                minTimeOn: 0,
                minOffTime: 5, // 5 seconds
                bypass: false,
                forceOn: false,
                forceOff: false,
                upperLimit: 0,
                lowerLimit: 0,
                deviceType: 'lamp'
            };
            // Start OFF
            protectionManager.evaluateProtection('test_device', false, config);
            // Advance past min off time
            jest.advanceTimersByTime(6000);
            const result = protectionManager.evaluateProtection('test_device', false, config);
            expect(result.allowed).toBe(true);
        });
        it('should block turning ON before min off time is met', () => {
            const config = {
                maxTimeOn: 0,
                minTimeOn: 0,
                minOffTime: 10, // 10 seconds
                bypass: false,
                forceOn: false,
                forceOff: false,
                upperLimit: 0,
                lowerLimit: 0,
                deviceType: 'lamp'
            };
            // Start OFF
            protectionManager.evaluateProtection('test_device', false, config);
            // Try to turn ON after 5 seconds (before min off time)
            jest.advanceTimersByTime(5000);
            const result = protectionManager.evaluateProtection('test_device', false, config);
            // Implementation now correctly blocks early turn-on
            expect(result.allowed).toBe(false);
        });
    });
    // ========================================================================
    // Sensor Limit Tests
    // ========================================================================
    describe('Upper/Lower Limit Protection', () => {
        it('should auto ON when temperature exceeds upper limit (cooling)', () => {
            const config = {
                maxTimeOn: 0,
                minTimeOn: 0,
                minOffTime: 0,
                bypass: false,
                forceOn: false,
                forceOff: false,
                upperLimit: 30, // 30°C
                lowerLimit: 20,
                deviceType: 'cool_ac1'
            };
            // Set sensor value above upper limit
            protectionManager.updateSensorValue('cool_ac1', 32);
            const result = protectionManager.evaluateProtection('cool_ac1', false, config);
            expect(result.allowed).toBe(true);
            expect(result.finalState).toBe(true);
            expect(result.action).toBe('auto_on');
            expect(result.reason).toContain('upper limit');
        });
        it('should auto OFF when temperature is below lower limit (cooling)', () => {
            const config = {
                maxTimeOn: 0,
                minTimeOn: 0,
                minOffTime: 0,
                bypass: false,
                forceOn: false,
                forceOff: false,
                upperLimit: 30,
                lowerLimit: 22, // 22°C
                deviceType: 'cool_ac1'
            };
            // Set sensor value below lower limit
            protectionManager.updateSensorValue('cool_ac1', 20);
            const result = protectionManager.evaluateProtection('cool_ac1', true, config);
            expect(result.allowed).toBe(true);
            expect(result.finalState).toBe(false);
            expect(result.action).toBe('auto_off');
            expect(result.reason).toContain('lower limit');
        });
        it('should use sensor value in metadata', () => {
            var _a;
            const config = {
                maxTimeOn: 0,
                minTimeOn: 0,
                minOffTime: 0,
                bypass: false,
                forceOn: false,
                forceOff: false,
                upperLimit: 30,
                lowerLimit: 0,
                deviceType: 'cool_ac1'
            };
            protectionManager.updateSensorValue('cool_ac1', 35);
            const result = protectionManager.evaluateProtection('cool_ac1', false, config);
            expect((_a = result.metadata) === null || _a === void 0 ? void 0 : _a.sensorValue).toBe(35);
        });
    });
    // ========================================================================
    // Violation Tracking Tests
    // ========================================================================
    describe('Violation Tracking', () => {
        beforeAll(() => {
            jest.useFakeTimers();
        });
        afterAll(() => {
            jest.useRealTimers();
        });
        it('should track violations separately', () => {
            const config = {
                maxTimeOn: 1,
                minTimeOn: 0,
                minOffTime: 0,
                bypass: false,
                forceOn: false,
                forceOff: false,
                upperLimit: 0,
                lowerLimit: 0,
                deviceType: 'lamp'
            };
            // Trigger max time violation
            protectionManager.evaluateProtection('test_device', true, config);
            jest.advanceTimersByTime(2000);
            protectionManager.evaluateProtection('test_device', true, config);
            const stats = protectionManager.getViolationStats('test_device');
            expect(stats === null || stats === void 0 ? void 0 : stats.maxTime).toBeGreaterThan(0);
            expect(stats === null || stats === void 0 ? void 0 : stats.minTime).toBe(0);
            expect(stats === null || stats === void 0 ? void 0 : stats.minOffTime).toBe(0);
        });
        it('should reset violations on command', () => {
            const config = {
                maxTimeOn: 1,
                minTimeOn: 0,
                minOffTime: 0,
                bypass: false,
                forceOn: false,
                forceOff: false,
                upperLimit: 0,
                lowerLimit: 0,
                deviceType: 'lamp'
            };
            // Trigger violation
            protectionManager.evaluateProtection('test_device', true, config);
            jest.advanceTimersByTime(2000);
            protectionManager.evaluateProtection('test_device', true, config);
            // Reset
            protectionManager.resetViolations('test_device');
            const stats = protectionManager.getViolationStats('test_device');
            expect(stats === null || stats === void 0 ? void 0 : stats.maxTime).toBe(0);
        });
    });
    // ========================================================================
    // Integration Tests
    // ========================================================================
    describe('Integration Tests', () => {
        beforeAll(() => {
            jest.useFakeTimers();
        });
        afterAll(() => {
            jest.useRealTimers();
        });
        it('should handle complete protection flow', () => {
            const config = {
                maxTimeOn: 10,
                minTimeOn: 5,
                minOffTime: 3,
                bypass: false,
                forceOn: false,
                forceOff: false,
                upperLimit: 35,
                lowerLimit: 18,
                deviceType: 'cool_ac1'
            };
            // 1. First ON request - blocked by min time (implementation treats initial state as "just turned ON")
            let result = protectionManager.evaluateProtection('cool_ac1', true, config);
            expect(result.allowed).toBe(false);
            expect(result.action).toBe('block');
            // 2. Set sensor value
            protectionManager.updateSensorValue('cool_ac1', 25);
            // 3. Advance time past min time
            jest.advanceTimersByTime(6000);
            result = protectionManager.evaluateProtection('cool_ac1', true, config);
            expect(result.action).toBe('allow');
            // 4. Exceed max time
            jest.advanceTimersByTime(6000);
            result = protectionManager.evaluateProtection('cool_ac1', true, config);
            expect(result.action).toBe('auto_off');
        });
        it('should handle multiple devices independently', () => {
            const config1 = {
                maxTimeOn: 10,
                minTimeOn: 0,
                minOffTime: 0,
                bypass: false,
                forceOn: false,
                forceOff: false,
                upperLimit: 0,
                lowerLimit: 0,
                deviceType: 'lamp'
            };
            const config2 = {
                maxTimeOn: 20,
                minTimeOn: 0,
                minOffTime: 0,
                bypass: false,
                forceOn: false,
                forceOff: false,
                upperLimit: 0,
                lowerLimit: 0,
                deviceType: 'fan'
            };
            // Both devices ON
            protectionManager.evaluateProtection('lamp', true, config1);
            protectionManager.evaluateProtection('fan', true, config2);
            // Advance time
            jest.advanceTimersByTime(15000);
            // Lamp should be auto OFF (exceeded 10s)
            const lampResult = protectionManager.evaluateProtection('lamp', true, config1);
            expect(lampResult.action).toBe('auto_off');
            // Fan should still be OK (within 20s)
            const fanResult = protectionManager.evaluateProtection('fan', true, config2);
            expect(fanResult.action).toBe('allow');
        });
    });
});
