"use strict";
/**
 * Unit Tests for ProtectionGateService
 *
 * Tests the core gate logic with 3-level config lookup and sensor binding.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const protection_gate_service_1 = require("../services/protection-gate-service");
describe('ProtectionGateService', () => {
    let service;
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    });
    afterEach(() => {
        jest.useRealTimers();
    });
    describe('OFF always allowed', () => {
        it('should allow OFF regardless of protection config', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_protect_all_max_time_on': 10,
                'lamp_protect_all_min_off_time': 20,
            });
            const result = service.checkGate('lamp_control_1', false, 'rpc');
            expect(result.allowed).toBe(true);
            expect(result.action).toBe('allow');
        });
    });
    describe('ON with no config', () => {
        it('should allow ON when no protection config exists', () => {
            service = new protection_gate_service_1.ProtectionGateService({});
            const result = service.checkGate('lamp_control_1', true, 'rpc');
            expect(result.allowed).toBe(true);
            expect(result.action).toBe('allow');
        });
    });
    describe('Max Time ON', () => {
        it('should allow ON within maxTimeOn limit', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_protect_all_max_time_on': 60,
            });
            // Set coil as ON for 30 seconds
            service.updateState('lamp_control_1', true);
            jest.advanceTimersByTime(30 * 1000);
            const result = service.checkGate('lamp_control_1', true, 'schedule');
            expect(result.allowed).toBe(true);
        });
        it('should block ON when maxTimeOn exceeded', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_protect_all_max_time_on': 60,
            });
            // Set coil as ON for 61 seconds
            service.updateState('lamp_control_1', true);
            jest.advanceTimersByTime(61 * 1000);
            const result = service.checkGate('lamp_control_1', true, 'schedule');
            expect(result.allowed).toBe(false);
            expect(result.action).toBe('block');
            expect(result.reason).toContain('Max time ON exceeded');
        });
    });
    describe('Min OFF Time', () => {
        it('should block ON during minOffTime', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_protect_all_min_off_time': 1200, // 20 minutes
            });
            // Set coil as OFF for 5 minutes
            service.updateState('lamp_control_1', true);
            service.updateState('lamp_control_1', false);
            jest.advanceTimersByTime(5 * 60 * 1000);
            const result = service.checkGate('lamp_control_1', true, 'rpc');
            expect(result.allowed).toBe(false);
            expect(result.action).toBe('block');
            expect(result.reason).toContain('Min off time not met');
        });
        it('should allow ON after minOffTime elapsed', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_protect_all_min_off_time': 1200, // 20 minutes
            });
            // Set coil as OFF for 21 minutes
            service.updateState('lamp_control_1', true);
            service.updateState('lamp_control_1', false);
            jest.advanceTimersByTime(21 * 60 * 1000);
            const result = service.checkGate('lamp_control_1', true, 'rpc');
            expect(result.allowed).toBe(true);
        });
    });
    describe('Upper Limit (sensor-based)', () => {
        it('should block ON when sensor exceeds upperLimit', () => {
            var _a;
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_protect_all_upper_limit': 35,
                'lamp_protect_all_sensor_id': 'temperature_1',
            });
            service.updateSensorValue('temperature_1', 36);
            const result = service.checkGate('lamp_control_1', true, 'intent');
            expect(result.allowed).toBe(false);
            expect(result.action).toBe('block');
            expect(result.reason).toContain('upper limit');
            expect((_a = result.metadata) === null || _a === void 0 ? void 0 : _a.sensorValue).toBe(36);
        });
        it('should allow ON when sensor within upperLimit', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_protect_all_upper_limit': 35,
                'lamp_protect_all_sensor_id': 'temperature_1',
            });
            service.updateSensorValue('temperature_1', 30);
            const result = service.checkGate('lamp_control_1', true, 'intent');
            expect(result.allowed).toBe(true);
        });
        it('should skip sensor check when no sensor_id configured', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_protect_all_upper_limit': 35,
                // No sensor_id
            });
            service.updateSensorValue('temperature_1', 40);
            const result = service.checkGate('lamp_control_1', true, 'intent');
            expect(result.allowed).toBe(true);
        });
        it('should skip sensor check when sensor value not found', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_protect_all_upper_limit': 35,
                'lamp_protect_all_sensor_id': 'temperature_1',
            });
            // No sensor value set
            const result = service.checkGate('lamp_control_1', true, 'intent');
            expect(result.allowed).toBe(true);
        });
    });
    describe('Lower Limit (sensor-based)', () => {
        it('should block ON when sensor below lowerLimit (non-cooling)', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_protect_all_lower_limit': 20,
                'lamp_protect_all_sensor_id': 'temperature_1',
            });
            service.updateSensorValue('temperature_1', 15);
            const result = service.checkGate('lamp_control_1', true, 'intent');
            expect(result.allowed).toBe(false);
            expect(result.action).toBe('block');
            expect(result.reason).toContain('lower limit');
        });
    });
    describe('Bypass', () => {
        it('should allow all checks when bypass is true', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_protect_all_bypass': true,
                'lamp_protect_all_max_time_on': 10,
                'lamp_protect_all_min_off_time': 1200,
                'lamp_protect_all_upper_limit': 30,
                'lamp_protect_all_sensor_id': 'temperature_1',
            });
            // Set up all violations
            service.updateState('lamp_control_1', true);
            jest.advanceTimersByTime(100 * 1000); // exceed maxTimeOn
            service.updateSensorValue('temperature_1', 50); // exceed upperLimit
            const result = service.checkGate('lamp_control_1', true, 'rpc');
            expect(result.allowed).toBe(true);
            expect(result.action).toBe('allow');
        });
    });
    describe('Force ON/OFF', () => {
        it('should allow ON when forceOn is true (falls through to all checks passed)', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_protect_all_force_on': true,
            });
            const result = service.checkGate('lamp_control_1', true, 'rpc');
            expect(result.allowed).toBe(true);
            expect(result.action).toBe('allow');
        });
        it('should block OFF when forceOn is true', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_protect_all_force_on': true,
            });
            const result = service.checkGate('lamp_control_1', false, 'rpc');
            expect(result.allowed).toBe(false);
            expect(result.action).toBe('force_on');
            expect(result.reason).toContain('Force ON active');
        });
        it('should block ON when forceOff is true', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_protect_all_force_off': true,
            });
            const result = service.checkGate('lamp_control_1', true, 'rpc');
            expect(result.allowed).toBe(false);
            expect(result.action).toBe('force_off');
        });
        it('should allow OFF when forceOff is true', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_protect_all_force_off': true,
            });
            const result = service.checkGate('lamp_control_1', false, 'rpc');
            expect(result.allowed).toBe(true);
            expect(result.action).toBe('allow');
        });
        it('should prioritize OFF when both forceOn and forceOff (ON request)', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_protect_all_force_on': true,
                'lamp_protect_all_force_off': true,
            });
            const result = service.checkGate('lamp_control_1', true, 'rpc');
            expect(result.allowed).toBe(false);
            expect(result.action).toBe('force_off');
        });
        it('should allow OFF when both forceOn and forceOff (OFF request)', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_protect_all_force_on': true,
                'lamp_protect_all_force_off': true,
            });
            const result = service.checkGate('lamp_control_1', false, 'rpc');
            expect(result.allowed).toBe(true);
            expect(result.action).toBe('force_off');
        });
    });
    describe('3-level config lookup', () => {
        it('should use specific coil config over all rule', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_protect_all_max_time_on': 60,
                'lamp_control_1_protect_max_time_on': 120,
            });
            // Set coil ON for 90 seconds
            service.updateState('lamp_control_1', true);
            jest.advanceTimersByTime(90 * 1000);
            // Should use specific (120s) not all (60s)
            const result = service.checkGate('lamp_control_1', true, 'schedule');
            expect(result.allowed).toBe(true);
        });
        it('should use all rule when no specific coil config', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_protect_all_max_time_on': 60,
            });
            // Set coil ON for 61 seconds
            service.updateState('lamp_control_1', true);
            jest.advanceTimersByTime(61 * 1000);
            const result = service.checkGate('lamp_control_1', true, 'schedule');
            expect(result.allowed).toBe(false);
        });
        it('should resolve sensor_id via 3-level lookup', () => {
            var _a;
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_protect_all_sensor_id': 'temperature_1',
                'lamp_protect_all_upper_limit': 35,
            });
            service.updateSensorValue('temperature_1', 36);
            const result = service.checkGate('lamp_control_1', true, 'intent');
            expect(result.allowed).toBe(false);
            expect((_a = result.metadata) === null || _a === void 0 ? void 0 : _a.sensorId).toBe('temperature_1');
        });
        it('should use specific coil sensor_id over all rule', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_protect_all_sensor_id': 'temperature_1',
                'lamp_control_1_protect_sensor_id': 'temperature_2',
                'lamp_protect_all_upper_limit': 35,
            });
            service.updateSensorValue('temperature_1', 40); // exceeds limit
            service.updateSensorValue('temperature_2', 20); // within limit
            // Should use temperature_2 (specific) not temperature_1 (all)
            const result = service.checkGate('lamp_control_1', true, 'intent');
            expect(result.allowed).toBe(true);
        });
    });
    describe('Multiple coils independent', () => {
        it('should track states independently per coil', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_protect_all_max_time_on': 60,
            });
            // Set lamp_1 ON for 61 seconds, lamp_2 ON for 30 seconds
            service.updateState('lamp_control_1', true);
            service.updateState('lamp_control_2', true);
            jest.advanceTimersByTime(61 * 1000);
            const result1 = service.checkGate('lamp_control_1', true, 'schedule');
            const result2 = service.checkGate('lamp_control_2', true, 'schedule');
            expect(result1.allowed).toBe(false); // exceeded
            expect(result2.allowed).toBe(false); // also exceeded (same time)
        });
        it('should allow coil_2 when coil_1 is blocked by minOffTime', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_control_1_protect_min_off_time': 1200,
                'lamp_control_2_protect_min_off_time': 0, // no min off time
            });
            // Both coils OFF
            service.updateState('lamp_control_1', true);
            service.updateState('lamp_control_1', false);
            service.updateState('lamp_control_2', true);
            service.updateState('lamp_control_2', false);
            jest.advanceTimersByTime(5 * 60 * 1000); // 5 minutes
            const result1 = service.checkGate('lamp_control_1', true, 'rpc');
            const result2 = service.checkGate('lamp_control_2', true, 'rpc');
            expect(result1.allowed).toBe(false); // minOffTime not met
            expect(result2.allowed).toBe(true); // no minOffTime
        });
    });
    describe('Sensor update affects gate', () => {
        it('should use latest sensor value for gate decision', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_protect_all_upper_limit': 35,
                'lamp_protect_all_sensor_id': 'temperature_1',
            });
            service.updateSensorValue('temperature_1', 30);
            const result1 = service.checkGate('lamp_control_1', true, 'intent');
            expect(result1.allowed).toBe(true);
            // Update sensor to exceed limit
            service.updateSensorValue('temperature_1', 36);
            const result2 = service.checkGate('lamp_control_1', true, 'intent');
            expect(result2.allowed).toBe(false);
        });
    });
    describe('syncCoilState', () => {
        it('should set initial state on first sync', () => {
            service = new protection_gate_service_1.ProtectionGateService({});
            service.syncCoilState('lamp_control_1', true);
            const state = service.getCoilState('lamp_control_1');
            expect(state === null || state === void 0 ? void 0 : state.on).toBe(true);
        });
        it('should update state on external change', () => {
            service = new protection_gate_service_1.ProtectionGateService({});
            service.syncCoilState('lamp_control_1', true);
            jest.advanceTimersByTime(5000);
            service.syncCoilState('lamp_control_1', false);
            const state = service.getCoilState('lamp_control_1');
            expect(state === null || state === void 0 ? void 0 : state.on).toBe(false);
        });
    });
    describe('refreshConfig', () => {
        it('should reload config and clear cache', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'lamp_protect_all_max_time_on': 60,
            });
            // Set coil ON for 61 seconds
            service.updateState('lamp_control_1', true);
            jest.advanceTimersByTime(61 * 1000);
            // Should block (maxTimeOn = 60)
            const result1 = service.checkGate('lamp_control_1', true, 'schedule');
            expect(result1.allowed).toBe(false);
            // Refresh config with higher limit
            service.refreshConfig({
                'lamp_protect_all_max_time_on': 120,
            });
            // Should allow now (maxTimeOn = 120)
            const result2 = service.checkGate('lamp_control_1', true, 'schedule');
            expect(result2.allowed).toBe(true);
        });
    });
    describe('Min Time ON (gate)', () => {
        it('should block OFF during minTimeOn', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'cool_protect_all_min_time_on': 300, // 5 minutes
            });
            // Set coil ON for 60 seconds
            service.updateState('cool_control_ac1', true);
            jest.advanceTimersByTime(60 * 1000);
            // Request OFF — should be blocked (minTimeOn not met)
            const result = service.checkGate('cool_control_ac1', false, 'rpc');
            expect(result.allowed).toBe(false);
            expect(result.action).toBe('block');
            expect(result.reason).toContain('Min time ON not met');
        });
        it('should allow OFF after minTimeOn elapsed', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'cool_protect_all_min_time_on': 300, // 5 minutes
            });
            // Set coil ON for 301 seconds
            service.updateState('cool_control_ac1', true);
            jest.advanceTimersByTime(301 * 1000);
            const result = service.checkGate('cool_control_ac1', false, 'rpc');
            expect(result.allowed).toBe(true);
        });
    });
    describe('3-level config lookup (level 3)', () => {
        it('should fall back to {deviceType}_protect_{field}', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'cool_protect_max_time_on': 60, // level 3: cool_protect_*
            });
            service.updateState('cool_control_ac1', true);
            jest.advanceTimersByTime(61 * 1000);
            const result = service.checkGate('cool_control_ac1', true, 'schedule');
            expect(result.allowed).toBe(false);
        });
        it('should prefer all rule over device type fallback', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'cool_protect_all_max_time_on': 120, // level 2
                'cool_protect_max_time_on': 60, // level 3
            });
            service.updateState('cool_control_ac1', true);
            jest.advanceTimersByTime(90 * 1000);
            // Should use level 2 (120s), not level 3 (60s)
            const result = service.checkGate('cool_control_ac1', true, 'schedule');
            expect(result.allowed).toBe(true);
        });
        it('should prefer specific coil over device type fallback', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'cool_control_ac1_protect_max_time_on': 120, // level 1
                'cool_protect_max_time_on': 60, // level 3
            });
            service.updateState('cool_control_ac1', true);
            jest.advanceTimersByTime(90 * 1000);
            // Should use level 1 (120s), not level 3 (60s)
            const result = service.checkGate('cool_control_ac1', true, 'schedule');
            expect(result.allowed).toBe(true);
        });
    });
    describe('Humidifier lower limit', () => {
        it('should auto ON humidifier when humidity below lower limit', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'humid_protect_all_lower_limit': 40,
                'humid_protect_all_sensor_id': 'humid_sensor_1',
            });
            service.updateSensorValue('humid_sensor_1', 30);
            const result = service.checkGate('humid_control_on', true, 'rpc');
            expect(result.allowed).toBe(true);
            expect(result.action).toBe('auto_on');
        });
        it('should block ON dehumidifier when humidity below lower limit', () => {
            service = new protection_gate_service_1.ProtectionGateService({
                'dehumid_protect_all_lower_limit': 40,
                'dehumid_protect_all_sensor_id': 'humid_sensor_1',
            });
            service.updateSensorValue('humid_sensor_1', 30);
            const result = service.checkGate('dehumid_control_1', true, 'rpc');
            expect(result.allowed).toBe(false);
            expect(result.action).toBe('block');
        });
    });
});
describe('resolveProtectionGate', () => {
    afterEach(() => {
        (0, protection_gate_service_1.setSharedProtectionGate)(null);
    });
    it('rejects a filesystem-restored plain object (no methods)', () => {
        const stale = { coilStates: {}, configKeyValues: {} };
        expect((0, protection_gate_service_1.isLiveProtectionGate)(stale)).toBe(false);
        expect((0, protection_gate_service_1.resolveProtectionGate)(stale)).toBeNull();
    });
    it('accepts a real ProtectionGateService instance', () => {
        const live = new protection_gate_service_1.ProtectionGateService({});
        expect((0, protection_gate_service_1.isLiveProtectionGate)(live)).toBe(true);
        expect((0, protection_gate_service_1.resolveProtectionGate)(live)).toBe(live);
    });
    it('prefers the in-process singleton over a stale global object', () => {
        const live = new protection_gate_service_1.ProtectionGateService({});
        (0, protection_gate_service_1.setSharedProtectionGate)(live);
        const stale = { checkGate: undefined };
        expect((0, protection_gate_service_1.resolveProtectionGate)(stale)).toBe(live);
    });
});
