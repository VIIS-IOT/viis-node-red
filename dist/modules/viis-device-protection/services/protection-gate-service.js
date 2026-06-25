"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProtectionGateService = void 0;
class ProtectionGateService {
    constructor(configKeyValues) {
        this.coilStates = new Map();
        this.lastOffTime = new Map();
        this.configCache = new Map();
        this.sensorValues = new Map();
        this.configKeyValues = {};
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
    refreshConfig(configKeyValues) {
        this.configKeyValues = configKeyValues;
        this.configCache.clear();
    }
    /**
     * 4-level config lookup for any field
     *
     * Priority:
     *   1. {coilKey}_protect_{field}        (specific coil)
     *   2. {deviceType}_protect_all_{field}  (all coils of this type)
     *   3. {subTypePrefix}_{field}           (sub-type: fan_protect_intake, cool_protect_1, etc.)
     *   4. {deviceType}_protect_{field}      (device type fallback)
     */
    resolveField(coilKey, field) {
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
        // Priority 3: sub-type lookup (matches ConfigService.getProtectionConfigByLabel)
        const subTypePrefix = this.getSubTypePrefix(coilKey);
        if (subTypePrefix) {
            const subTypeKey = `${subTypePrefix}_${field}`;
            if (Object.prototype.hasOwnProperty.call(this.configKeyValues, subTypeKey)) {
                return this.configKeyValues[subTypeKey];
            }
        }
        // Priority 4: device type fallback
        const typeKey = `${deviceType}_protect_${field}`;
        if (Object.prototype.hasOwnProperty.call(this.configKeyValues, typeKey)) {
            return this.configKeyValues[typeKey];
        }
        return undefined;
    }
    /**
     * Get sub-type prefix for devices with sub-types (fan, cool)
     *
     * fan_control_intake → fan_protect_intake
     * fan_control_circ   → fan_protect_circ
     * fan_control_dc     → fan_protect_dc
     * cool_control_ac1   → cool_protect_1
     * cool_control_ac2   → cool_protect_2
     * cool_control_freezer → cool_protect_freezer
     */
    getSubTypePrefix(coilKey) {
        if (coilKey.includes('fan_control_intake'))
            return 'fan_protect_intake';
        if (coilKey.includes('fan_control_circ'))
            return 'fan_protect_circ';
        if (coilKey.includes('fan_control_dc'))
            return 'fan_protect_dc';
        if (coilKey.includes('cool_control_ac1') || coilKey.includes('cool_ac1'))
            return 'cool_protect_1';
        if (coilKey.includes('cool_control_ac2') || coilKey.includes('cool_ac2'))
            return 'cool_protect_2';
        if (coilKey.includes('cool_control_freezer'))
            return 'cool_protect_freezer';
        return null;
    }
    /**
     * Extract device type from coil key
     * "lamp_control_1" -> "lamp"
     * "fan_control_intake" -> "fan"
     * "cool_control_ac1" -> "cool"
     */
    extractDeviceType(coilKey) {
        const parts = coilKey.split('_');
        return parts[0] || coilKey;
    }
    /**
     * Get full protection config for a coil (with 3-level lookup)
     */
    getProtectionConfigForCoil(coilKey) {
        const cached = this.configCache.get(coilKey);
        if (cached)
            return cached;
        const getBool = (field) => {
            const val = this.resolveField(coilKey, field);
            return Boolean(val);
        };
        const getNum = (field) => {
            const val = this.resolveField(coilKey, field);
            return Number(val || 0);
        };
        const getString = (field) => {
            const val = this.resolveField(coilKey, field);
            return val ? String(val) : null;
        };
        const config = {
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
    getSensorIdForCoil(coilKey) {
        const config = this.getProtectionConfigForCoil(coilKey);
        return config.sensorId;
    }
    // =========================================================================
    // State Tracking
    // =========================================================================
    /**
     * Update coil state after a successful write
     */
    updateState(coilKey, newState) {
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
    syncCoilState(coilKey, currentState) {
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
    updateSensorValue(sensorKey, value) {
        this.sensorValues.set(sensorKey, value);
    }
    /**
     * Get current coil state
     */
    getCoilState(coilKey) {
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
    checkGate(coilKey, requestedValue, source) {
        const config = this.getProtectionConfigForCoil(coilKey);
        const state = this.coilStates.get(coilKey);
        const now = Date.now();
        const elapsedOnTime = (state && state.on) ? (now - state.since) / 1000 : 0;
        const elapsedOffTime = (state && !state.on) ? (now - state.since) / 1000 : 0;
        // ===== BYPASS (before any force checks) =====
        if (config.bypass) {
            return {
                allowed: true,
                reason: 'Bypass active',
                action: 'allow',
                metadata: { elapsedOnTime, elapsedOffTime },
            };
        }
        // ===== FORCE: combined forceOn + forceOff =====
        if (config.forceOn && config.forceOff) {
            if (!requestedValue) {
                return {
                    allowed: true,
                    reason: 'Force OFF active (both flags set)',
                    action: 'force_off',
                    metadata: { elapsedOnTime, elapsedOffTime },
                };
            }
            return {
                allowed: false,
                reason: 'Force ON and OFF both active — prioritizing OFF for safety',
                action: 'force_off',
                metadata: { elapsedOnTime, elapsedOffTime },
            };
        }
        // ===== FORCE: forceOn blocks OFF =====
        if (config.forceOn) {
            if (!requestedValue) {
                return {
                    allowed: false,
                    reason: 'Force ON active — OFF blocked',
                    action: 'force_on',
                    metadata: { elapsedOnTime, elapsedOffTime },
                };
            }
            // ON request with forceOn — fall through to maxTimeOn safety check
        }
        // ===== FORCE: forceOff blocks ON =====
        if (config.forceOff) {
            if (requestedValue) {
                return {
                    allowed: false,
                    reason: 'Force OFF active',
                    action: 'force_off',
                    metadata: { elapsedOnTime, elapsedOffTime },
                };
            }
            // OFF request with forceOff — always allowed
            return {
                allowed: true,
                reason: 'OFF is always allowed',
                action: 'allow',
                metadata: { elapsedOnTime, elapsedOffTime },
            };
        }
        // ===== Min Time ON — block OFF if not met (compressor protection) =====
        if (config.minTimeOn > 0 && state && state.on && elapsedOnTime < config.minTimeOn) {
            if (!requestedValue) {
                return {
                    allowed: false,
                    reason: `Min time ON not met (${elapsedOnTime.toFixed(0)}s/${config.minTimeOn}s) — must stay ON`,
                    action: 'block',
                    metadata: { elapsedOnTime, elapsedOffTime, violation: 'min_time' },
                };
            }
        }
        // ===== OFF without force flags — always allowed =====
        if (!requestedValue) {
            return {
                allowed: true,
                reason: 'OFF is always allowed',
                action: 'allow',
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
                const isCoolingDevice = config.deviceType === 'cool' || config.deviceType === 'ac';
                const isHumidifier = config.deviceType === 'humid';
                if (isCoolingDevice) {
                    return {
                        allowed: false,
                        reason: `Sensor ${config.sensorId}=${sensorValue} < lower limit ${config.lowerLimit} — cooling not needed`,
                        action: 'block',
                        metadata: { elapsedOnTime, elapsedOffTime, sensorValue, sensorId: config.sensorId, violation: 'lower_limit' },
                    };
                }
                if (isHumidifier) {
                    // Low humidity → auto ON the humidifier
                    return {
                        allowed: true,
                        reason: `Sensor ${config.sensorId}=${sensorValue} < lower limit ${config.lowerLimit} — humidifier auto ON`,
                        action: 'auto_on',
                        metadata: { elapsedOnTime, elapsedOffTime, sensorValue, sensorId: config.sensorId, violation: 'lower_limit' },
                    };
                }
                // For other devices: block ON
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
exports.ProtectionGateService = ProtectionGateService;
