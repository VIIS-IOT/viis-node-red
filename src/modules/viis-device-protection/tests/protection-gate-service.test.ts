/**
 * Unit Tests for ProtectionGateService
 *
 * Tests the core gate logic with 3-level config lookup and sensor binding.
 */

import { ProtectionGateService, ProtectionConfig, GateResult } from '../services/protection-gate-service';

describe('ProtectionGateService', () => {
  let service: ProtectionGateService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('OFF always allowed', () => {
    it('should allow OFF regardless of protection config', () => {
      service = new ProtectionGateService({
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
      service = new ProtectionGateService({});

      const result = service.checkGate('lamp_control_1', true, 'rpc');
      expect(result.allowed).toBe(true);
      expect(result.action).toBe('allow');
    });
  });

  describe('Max Time ON', () => {
    it('should allow ON within maxTimeOn limit', () => {
      service = new ProtectionGateService({
        'lamp_protect_all_max_time_on': 60,
      });

      // Set coil as ON for 30 seconds
      service.updateState('lamp_control_1', true);
      jest.advanceTimersByTime(30 * 1000);

      const result = service.checkGate('lamp_control_1', true, 'schedule');
      expect(result.allowed).toBe(true);
    });

    it('should block ON when maxTimeOn exceeded', () => {
      service = new ProtectionGateService({
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
      service = new ProtectionGateService({
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
      service = new ProtectionGateService({
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
      service = new ProtectionGateService({
        'lamp_protect_all_upper_limit': 35,
        'lamp_protect_all_sensor_id': 'temperature_1',
      });

      service.updateSensorValue('temperature_1', 36);

      const result = service.checkGate('lamp_control_1', true, 'intent');
      expect(result.allowed).toBe(false);
      expect(result.action).toBe('block');
      expect(result.reason).toContain('upper limit');
      expect(result.metadata?.sensorValue).toBe(36);
    });

    it('should allow ON when sensor within upperLimit', () => {
      service = new ProtectionGateService({
        'lamp_protect_all_upper_limit': 35,
        'lamp_protect_all_sensor_id': 'temperature_1',
      });

      service.updateSensorValue('temperature_1', 30);

      const result = service.checkGate('lamp_control_1', true, 'intent');
      expect(result.allowed).toBe(true);
    });

    it('should skip sensor check when no sensor_id configured', () => {
      service = new ProtectionGateService({
        'lamp_protect_all_upper_limit': 35,
        // No sensor_id
      });

      service.updateSensorValue('temperature_1', 40);

      const result = service.checkGate('lamp_control_1', true, 'intent');
      expect(result.allowed).toBe(true);
    });

    it('should skip sensor check when sensor value not found', () => {
      service = new ProtectionGateService({
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
      service = new ProtectionGateService({
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
      service = new ProtectionGateService({
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
    it('should allow ON when forceOn is true', () => {
      service = new ProtectionGateService({
        'lamp_protect_all_force_on': true,
      });

      const result = service.checkGate('lamp_control_1', true, 'rpc');
      expect(result.allowed).toBe(true);
      expect(result.action).toBe('allow');
    });

    it('should block ON when forceOff is true', () => {
      service = new ProtectionGateService({
        'lamp_protect_all_force_off': true,
      });

      const result = service.checkGate('lamp_control_1', true, 'rpc');
      expect(result.allowed).toBe(false);
      expect(result.action).toBe('force_off');
    });

    it('should prioritize OFF when both forceOn and forceOff', () => {
      service = new ProtectionGateService({
        'lamp_protect_all_force_on': true,
        'lamp_protect_all_force_off': true,
      });

      const result = service.checkGate('lamp_control_1', true, 'rpc');
      expect(result.allowed).toBe(false);
      expect(result.action).toBe('force_off');
    });
  });

  describe('3-level config lookup', () => {
    it('should use specific coil config over all rule', () => {
      service = new ProtectionGateService({
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
      service = new ProtectionGateService({
        'lamp_protect_all_max_time_on': 60,
      });

      // Set coil ON for 61 seconds
      service.updateState('lamp_control_1', true);
      jest.advanceTimersByTime(61 * 1000);

      const result = service.checkGate('lamp_control_1', true, 'schedule');
      expect(result.allowed).toBe(false);
    });

    it('should resolve sensor_id via 3-level lookup', () => {
      service = new ProtectionGateService({
        'lamp_protect_all_sensor_id': 'temperature_1',
        'lamp_protect_all_upper_limit': 35,
      });

      service.updateSensorValue('temperature_1', 36);

      const result = service.checkGate('lamp_control_1', true, 'intent');
      expect(result.allowed).toBe(false);
      expect(result.metadata?.sensorId).toBe('temperature_1');
    });

    it('should use specific coil sensor_id over all rule', () => {
      service = new ProtectionGateService({
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
      service = new ProtectionGateService({
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
      service = new ProtectionGateService({
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
      expect(result2.allowed).toBe(true);  // no minOffTime
    });
  });

  describe('Sensor update affects gate', () => {
    it('should use latest sensor value for gate decision', () => {
      service = new ProtectionGateService({
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
      service = new ProtectionGateService({});

      service.syncCoilState('lamp_control_1', true);
      const state = service.getCoilState('lamp_control_1');

      expect(state?.on).toBe(true);
    });

    it('should update state on external change', () => {
      service = new ProtectionGateService({});

      service.syncCoilState('lamp_control_1', true);
      jest.advanceTimersByTime(5000);
      service.syncCoilState('lamp_control_1', false);

      const state = service.getCoilState('lamp_control_1');
      expect(state?.on).toBe(false);
    });
  });

  describe('refreshConfig', () => {
    it('should reload config and clear cache', () => {
      service = new ProtectionGateService({
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
});
