/**
 * Protection Gate Service
 *
 * Centralized protection logic shared across all control sources (Schedule, RPC, Intent).
 * Each source calls checkGate() BEFORE writing coils to Modbus.
 *
 * Key format (3-level lookup):
 *   Priority 1: {coilKey}_protect_{field}        (specific coil)
 *   Priority 2: {deviceType}_protect_all_{field}  (all coils of this type)
 *   Priority 3: {deviceType}_protect_{field}      (device type fallback)
 *
 * Sensor binding:
 *   {coilKey}_protect_sensor_id or {deviceType}_protect_all_sensor_id
 *   Links a coil to a sensor identifier for upper/lower limit checks.
 */

export interface ProtectionConfig {
  bypass: boolean;
  forceOn: boolean;
  forceOff: boolean;
  maxTimeOn: number;       // seconds, 0 = disabled
  minTimeOn: number;       // seconds, 0 = disabled
  minOffTime: number;      // seconds, 0 = disabled
  upperLimit: number;      // sensor threshold, 0 = disabled
  lowerLimit: number;      // sensor threshold, 0 = disabled
  sensorId: string | null; // sensor identifier for limit checks
  deviceType: string;
}

export interface GateResult {
  allowed: boolean;
  reason: string;
  action: 'allow' | 'block' | 'force_on' | 'force_off' | 'auto_off';
  metadata?: {
    elapsedOnTime?: number;
    elapsedOffTime?: number;
    sensorValue?: number;
    sensorId?: string;
    violation?: string;
  };
}

interface CoilState {
  on: boolean;
  since: number;  // timestamp when current state started
}

export class ProtectionGateService {
  private coilStates: Map<string, CoilState> = new Map();
  private lastOffTime: Map<string, number> = new Map();
  private configCache: Map<string, ProtectionConfig> = new Map();
  private sensorValues: Map<string, number> = new Map();
  private configKeyValues: Record<string, any> = {};

  constructor(configKeyValues?: Record<string, any>) {
    if (configKeyValues) {
      this.configKeyValues = configKeyValues;
    }
  }

  // =========================================================================
  // Config Management
  // =========================================================================

  /**
   * Reload config from configKeyValues (global context)
   */
  refreshConfig(configKeyValues: Record<string, any>): void {
    this.configKeyValues = configKeyValues;
    this.configCache.clear();
  }

  /**
   * 3-level config lookup for any field
   *
   * Priority:
   *   1. {coilKey}_protect_{field}        (specific coil)
   *   2. {deviceType}_protect_all_{field}  (all coils of this type)
   *   3. {deviceType}_protect_{field}      (device type fallback)
   */
  private resolveField(coilKey: string, field: string): any {
    const deviceType = this.extractDeviceType(coilKey);

    // Priority 1: specific coil
    const specificKey = `${coilKey}_protect_${field}`;
    if (Object.prototype.hasOwnProperty.call(this.configKeyValues, specificKey)) {
      return this.configKeyValues[specificKey];
    }

    // Priority 2: all rule
    const allKey = `${deviceType}_protect_all_${field}`;
    if (Object.prototype.hasOwnProperty.call(this.configKeyValues, allKey)) {
      return this.configKeyValues[allKey];
    }

    return undefined;
  }

  /**
   * Extract device type from coil key
   * "lamp_control_1" -> "lamp"
   * "fan_control_intake" -> "fan"
   * "cool_control_ac1" -> "cool"
   */
  private extractDeviceType(coilKey: string): string {
    const parts = coilKey.split('_');
    return parts[0] || coilKey;
  }

  /**
   * Get full protection config for a coil (with 3-level lookup)
   */
  getProtectionConfigForCoil(coilKey: string): ProtectionConfig {
    const cached = this.configCache.get(coilKey);
    if (cached) return cached;

    const getBool = (field: string): boolean => {
      const val = this.resolveField(coilKey, field);
      return Boolean(val);
    };

    const getNum = (field: string): number => {
      const val = this.resolveField(coilKey, field);
      return Number(val || 0);
    };

    const getString = (field: string): string | null => {
      const val = this.resolveField(coilKey, field);
      return val ? String(val) : null;
    };

    const config: ProtectionConfig = {
      bypass: getBool('bypass'),
      forceOn: getBool('force_on'),
      forceOff: getBool('force_off'),
      maxTimeOn: getNum('max_time_on'),
      minTimeOn: getNum('min_time_on'),
      minOffTime: getNum('min_off_time') || getNum('min_stop_time'),
      upperLimit: getNum('upper_limit') || getNum('upper_temp'),
      lowerLimit: getNum('lower_limit') || getNum('lower_temp'),
      sensorId: getString('sensor_id'),
      deviceType: this.extractDeviceType(coilKey),
    };

    this.configCache.set(coilKey, config);
    return config;
  }

  /**
   * Resolve sensor_id for a coil (3-level lookup)
   */
  getSensorIdForCoil(coilKey: string): string | null {
    const config = this.getProtectionConfigForCoil(coilKey);
    return config.sensorId;
  }

  // =========================================================================
  // State Tracking
  // =========================================================================

  /**
   * Update coil state after a successful write
   */
  updateState(coilKey: string, newState: boolean): void {
    const now = Date.now();
    const existing = this.coilStates.get(coilKey);

    if (existing && existing.on === newState) {
      return; // No change
    }

    if (existing && existing.on && !newState) {
      // Transitioning from ON to OFF
      this.lastOffTime.set(coilKey, now);
    }

    this.coilStates.set(coilKey, {
      on: newState,
      since: now,
    });
  }

  /**
   * Sync coil state from Modbus read (called by protection node timer)
   */
  syncCoilState(coilKey: string, currentState: boolean): void {
    const existing = this.coilStates.get(coilKey);

    if (!existing) {
      // First time seeing this coil
      this.coilStates.set(coilKey, {
        on: currentState,
        since: Date.now(),
      });
      return;
    }

    if (existing.on !== currentState) {
      // State changed externally
      if (existing.on && !currentState) {
        this.lastOffTime.set(coilKey, Date.now());
      }
      this.coilStates.set(coilKey, {
        on: currentState,
        since: Date.now(),
      });
    }
  }

  /**
   * Update sensor value for limit checks
   */
  updateSensorValue(sensorKey: string, value: number): void {
    this.sensorValues.set(sensorKey, value);
  }

  /**
   * Get current coil state
   */
  getCoilState(coilKey: string): CoilState | undefined {
    return this.coilStates.get(coilKey);
  }

  // =========================================================================
  // Gate Logic
  // =========================================================================

  /**
   * Main gate check — called by each control source BEFORE writing coil
   *
   * @param coilKey - The coil identifier (e.g., "lamp_control_1")
   * @param requestedValue - The desired state (true=ON, false=OFF)
   * @param source - Which source is requesting ("rpc", "schedule", "intent")
   * @returns GateResult with allowed/reason/action
   */
  checkGate(coilKey: string, requestedValue: boolean, source: string): GateResult {
    const config = this.getProtectionConfigForCoil(coilKey);
    const state = this.coilStates.get(coilKey);
    const now = Date.now();

    const elapsedOnTime = (state && state.on) ? (now - state.since) / 1000 : 0;
    const elapsedOffTime = (state && !state.on) ? (now - state.since) / 1000 : 0;

    // ===== OFF is ALWAYS allowed =====
    if (!requestedValue) {
      return {
        allowed: true,
        reason: 'OFF is always allowed',
        action: 'allow',
        metadata: { elapsedOnTime, elapsedOffTime },
      };
    }

    // ===== BYPASS =====
    if (config.bypass) {
      return {
        allowed: true,
        reason: 'Bypass active',
        action: 'allow',
        metadata: { elapsedOnTime, elapsedOffTime },
      };
    }

    // ===== FORCE =====
    if (config.forceOn && config.forceOff) {
      // Both force on and off — prioritize off for safety
      return {
        allowed: false,
        reason: 'Force ON and OFF both active — prioritizing OFF for safety',
        action: 'force_off',
        metadata: { elapsedOnTime, elapsedOffTime },
      };
    }

    if (config.forceOff) {
      return {
        allowed: false,
        reason: 'Force OFF active',
        action: 'force_off',
        metadata: { elapsedOnTime, elapsedOffTime },
      };
    }

    // ===== REQUESTED ON — check all protections =====

    // Max Time ON
    if (config.maxTimeOn > 0 && state && state.on && elapsedOnTime > config.maxTimeOn) {
      return {
        allowed: false,
        reason: `Max time ON exceeded (${elapsedOnTime.toFixed(0)}s/${config.maxTimeOn}s)`,
        action: 'block',
        metadata: { elapsedOnTime, elapsedOffTime, violation: 'max_time' },
      };
    }

    // Min OFF Time — block ON if not met
    if (config.minOffTime > 0 && state && !state.on) {
      if (elapsedOffTime < config.minOffTime) {
        return {
          allowed: false,
          reason: `Min off time not met (${elapsedOffTime.toFixed(0)}s/${config.minOffTime}s) — must stay OFF`,
          action: 'block',
          metadata: { elapsedOnTime, elapsedOffTime, violation: 'min_off_time' },
        };
      }
    }

    // Upper Limit (sensor-based)
    if (config.upperLimit > 0 && config.sensorId) {
      const sensorValue = this.sensorValues.get(config.sensorId);
      if (sensorValue !== undefined && sensorValue > config.upperLimit) {
        return {
          allowed: false,
          reason: `Sensor ${config.sensorId}=${sensorValue} > upper limit ${config.upperLimit}`,
          action: 'block',
          metadata: { elapsedOnTime, elapsedOffTime, sensorValue, sensorId: config.sensorId, violation: 'upper_limit' },
        };
      }
    }

    // Lower Limit (sensor-based)
    if (config.lowerLimit > 0 && config.sensorId) {
      const sensorValue = this.sensorValues.get(config.sensorId);
      if (sensorValue !== undefined && sensorValue < config.lowerLimit) {
        // For cooling devices: lower limit means auto OFF (too cold)
        // For other devices: block ON (not enough conditions)
        const isCoolingDevice = config.deviceType.includes('cool') || config.deviceType.includes('ac');
        if (isCoolingDevice) {
          return {
            allowed: false,
            reason: `Sensor ${config.sensorId}=${sensorValue} < lower limit ${config.lowerLimit} — cooling not needed`,
            action: 'block',
            metadata: { elapsedOnTime, elapsedOffTime, sensorValue, sensorId: config.sensorId, violation: 'lower_limit' },
          };
        }
        // For non-cooling: lower limit violation blocks ON
        return {
          allowed: false,
          reason: `Sensor ${config.sensorId}=${sensorValue} < lower limit ${config.lowerLimit}`,
          action: 'block',
          metadata: { elapsedOnTime, elapsedOffTime, sensorValue, sensorId: config.sensorId, violation: 'lower_limit' },
        };
      }
    }

    // ===== ALL CHECKS PASSED =====
    return {
      allowed: true,
      reason: 'All protection checks passed',
      action: 'allow',
      metadata: { elapsedOnTime, elapsedOffTime },
    };
  }
}
