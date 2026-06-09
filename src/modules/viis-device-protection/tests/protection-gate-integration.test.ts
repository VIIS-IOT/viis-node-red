/**
 * Integration Tests for Protection Gate Service
 *
 * Tests the complete flow with gate service across multiple control sources.
 * Simulates real-world scenarios with Schedule, RPC, and Intent sources.
 */

import { ProtectionGateService } from '../services/protection-gate-service';

describe('ProtectionGateService Integration', () => {
  let service: ProtectionGateService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Schedule ON, no protection', () => {
    it('should allow schedule coil write when no protection config', () => {
      service = new ProtectionGateService({});

      const result = service.checkGate('lamp_control_1', true, 'schedule');
      expect(result.allowed).toBe(true);
      expect(result.action).toBe('allow');
    });
  });

  describe('Schedule ON, maxTime exceeded', () => {
    it('should block schedule when maxTimeOn exceeded', () => {
      service = new ProtectionGateService({
        'lamp_protect_all_max_time_on': 3600, // 1 hour
      });

      // Simulate coil ON for 1 hour + 1 second
      service.updateState('lamp_control_1', true);
      jest.advanceTimersByTime(3601 * 1000);

      const result = service.checkGate('lamp_control_1', true, 'schedule');
      expect(result.allowed).toBe(false);
      expect(result.action).toBe('block');
      expect(result.reason).toContain('Max time ON exceeded');
    });
  });

  describe('RPC ON during minOffTime', () => {
    it('should block RPC during minOffTime cooldown', () => {
      service = new ProtectionGateService({
        'lamp_protect_all_min_off_time': 1200, // 20 minutes
      });

      // Coil was ON, then turned OFF (auto-OFF by protection)
      service.updateState('lamp_control_1', true);
      service.updateState('lamp_control_1', false);

      // 5 minutes later, user tries to turn ON via RPC
      jest.advanceTimersByTime(5 * 60 * 1000);

      const result = service.checkGate('lamp_control_1', true, 'rpc');
      expect(result.allowed).toBe(false);
      expect(result.action).toBe('block');
      expect(result.reason).toContain('Min off time not met');
    });
  });

  describe('Intent ON, sensor limit exceeded', () => {
    it('should block intent action when sensor exceeds upperLimit', () => {
      service = new ProtectionGateService({
        'lamp_protect_all_upper_limit': 35,
        'lamp_protect_all_sensor_id': 'temperature_1',
      });

      service.updateSensorValue('temperature_1', 36);

      const result = service.checkGate('lamp_control_1', true, 'intent');
      expect(result.allowed).toBe(false);
      expect(result.action).toBe('block');
      expect(result.reason).toContain('upper limit');
    });
  });

  describe('Auto-OFF triggers, then minOffTime blocks ON', () => {
    it('should block all sources during cooldown after auto-OFF', () => {
      service = new ProtectionGateService({
        'lamp_protect_all_max_time_on': 3600,
        'lamp_protect_all_min_off_time': 1200, // 20 minutes
      });

      // Coil ON for 1 hour
      service.updateState('lamp_control_1', true);
      jest.advanceTimersByTime(3600 * 1000);

      // Protection auto-OFF
      service.updateState('lamp_control_1', false);

      // 5 minutes later - all sources should be blocked
      jest.advanceTimersByTime(5 * 60 * 1000);

      // Schedule tries to turn ON
      const scheduleResult = service.checkGate('lamp_control_1', true, 'schedule');
      expect(scheduleResult.allowed).toBe(false);
      expect(scheduleResult.reason).toContain('Min off time not met');

      // RPC tries to turn ON
      const rpcResult = service.checkGate('lamp_control_1', true, 'rpc');
      expect(rpcResult.allowed).toBe(false);

      // Intent tries to turn ON
      const intentResult = service.checkGate('lamp_control_1', true, 'intent');
      expect(intentResult.allowed).toBe(false);

      // After 21 minutes - should be allowed
      jest.advanceTimersByTime(16 * 60 * 1000);

      const afterCooldown = service.checkGate('lamp_control_1', true, 'schedule');
      expect(afterCooldown.allowed).toBe(true);
    });
  });

  describe('Bypass overrides all blocks', () => {
    it('should allow all sources when bypass is true', () => {
      service = new ProtectionGateService({
        'lamp_protect_all_bypass': true,
        'lamp_protect_all_max_time_on': 10,
        'lamp_protect_all_min_off_time': 1200,
        'lamp_protect_all_upper_limit': 30,
        'lamp_protect_all_sensor_id': 'temperature_1',
      });

      // Set up all violations
      service.updateState('lamp_control_1', true);
      jest.advanceTimersByTime(100 * 1000);
      service.updateSensorValue('temperature_1', 50);

      // All sources should be allowed
      expect(service.checkGate('lamp_control_1', true, 'schedule').allowed).toBe(true);
      expect(service.checkGate('lamp_control_1', true, 'rpc').allowed).toBe(true);
      expect(service.checkGate('lamp_control_1', true, 'intent').allowed).toBe(true);
    });
  });

  describe('Per-coil config overrides all rule', () => {
    it('should use specific coil config over all rule', () => {
      service = new ProtectionGateService({
        'lamp_protect_all_max_time_on': 60,
        'lamp_control_1_protect_max_time_on': 3600,
      });

      // Coil 1 ON for 90 seconds (within specific, exceeds all)
      service.updateState('lamp_control_1', true);
      jest.advanceTimersByTime(90 * 1000);

      const result1 = service.checkGate('lamp_control_1', true, 'schedule');
      expect(result1.allowed).toBe(true); // Uses specific (3600s)

      // Coil 2 ON for 90 seconds (uses all rule)
      service.updateState('lamp_control_2', true);
      jest.advanceTimersByTime(90 * 1000);

      const result2 = service.checkGate('lamp_control_2', true, 'schedule');
      expect(result2.allowed).toBe(false); // Uses all (60s)
    });
  });

  describe('Multiple sources, same coil', () => {
    it('should maintain consistent state across sources', () => {
      service = new ProtectionGateService({
        'lamp_protect_all_min_off_time': 1200,
      });

      // Coil ON then OFF
      service.updateState('lamp_control_1', true);
      service.updateState('lamp_control_1', false);
      jest.advanceTimersByTime(5 * 60 * 1000);

      // All sources see the same state
      const scheduleResult = service.checkGate('lamp_control_1', true, 'schedule');
      const rpcResult = service.checkGate('lamp_control_1', true, 'rpc');
      const intentResult = service.checkGate('lamp_control_1', true, 'intent');

      // All should be blocked (same minOffTime)
      expect(scheduleResult.allowed).toBe(rpcResult.allowed);
      expect(rpcResult.allowed).toBe(intentResult.allowed);
      expect(scheduleResult.allowed).toBe(false);
    });
  });

  describe('Config change mid-operation', () => {
    it('should apply new limits after config refresh', () => {
      service = new ProtectionGateService({
        'lamp_protect_all_max_time_on': 60,
      });

      // Coil ON for 61 seconds
      service.updateState('lamp_control_1', true);
      jest.advanceTimersByTime(61 * 1000);

      // Should be blocked (maxTimeOn = 60)
      expect(service.checkGate('lamp_control_1', true, 'schedule').allowed).toBe(false);

      // Config change: increase limit
      service.refreshConfig({
        'lamp_protect_all_max_time_on': 120,
      });

      // Should be allowed now (maxTimeOn = 120)
      expect(service.checkGate('lamp_control_1', true, 'schedule').allowed).toBe(true);
    });
  });

  describe('Coil OFF always allowed', () => {
    it('should allow OFF from any source regardless of protection', () => {
      service = new ProtectionGateService({
        'lamp_protect_all_bypass': false,
        'lamp_protect_all_force_on': true,
        'lamp_protect_all_min_off_time': 999999,
      });

      // Even with forceOn and minOffTime, OFF should always be allowed
      expect(service.checkGate('lamp_control_1', false, 'schedule').allowed).toBe(true);
      expect(service.checkGate('lamp_control_1', false, 'rpc').allowed).toBe(true);
      expect(service.checkGate('lamp_control_1', false, 'intent').allowed).toBe(true);
    });
  });

  describe('Real-world microclimate scenario', () => {
    it('should protect lamp from overheating', () => {
      service = new ProtectionGateService({
        // All lamps: max 4h on, 30min off, 35°C upper limit
        'lamp_protect_all_max_time_on': 14400,
        'lamp_protect_all_min_off_time': 1800,
        'lamp_protect_all_upper_limit': 35,
        'lamp_protect_all_sensor_id': 'temperature_1',
      });

      // Lamp ON for 2 hours, temperature normal
      service.updateState('lamp_control_1', true);
      service.updateSensorValue('temperature_1', 28);
      jest.advanceTimersByTime(2 * 3600 * 1000);

      // Schedule wants to extend - should be allowed
      expect(service.checkGate('lamp_control_1', true, 'schedule').allowed).toBe(true);

      // Temperature spikes to 36°C
      service.updateSensorValue('temperature_1', 36);

      // Protection auto-OFFs the lamp
      service.updateState('lamp_control_1', false);

      // RPC tries to turn lamp back on immediately
      expect(service.checkGate('lamp_control_1', true, 'rpc').allowed).toBe(false);
      expect(service.checkGate('lamp_control_1', true, 'rpc').reason).toContain('Min off time');

      // Temperature drops, but still in cooldown
      service.updateSensorValue('temperature_1', 30);
      expect(service.checkGate('lamp_control_1', true, 'schedule').allowed).toBe(false);

      // After 31 minutes cooldown
      jest.advanceTimersByTime(31 * 60 * 1000);

      // Now it's safe to turn on again
      expect(service.checkGate('lamp_control_1', true, 'schedule').allowed).toBe(true);
    });
  });
});
