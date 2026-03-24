"use strict";
/**
 * VIIS Device Protection Manager
 *
 * Handles Min/Max/Bypass/Force protection logic for devices
 *
 * Priority Flow:
 * 1. BYPASS - Skip all protections
 * 2. FORCE - Force ON/OFF (still respects Min/Max)
 * 3. MAX TIME - Auto OFF if exceeded
 * 4. MIN TIME - Block OFF if not met
 * 5. MIN OFF TIME - Block ON if not met
 * 6. UPPER/LOWER LIMITS - Auto control based on sensors
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProtectionManager = void 0;
class ProtectionManager {
    constructor() {
        this.states = new Map();
        this.sensorValues = new Map();
    }
    /**
     * Update sensor value for a device
     */
    updateSensorValue(deviceKey, value) {
        this.sensorValues.set(deviceKey, value);
    }
    /**
     * Get or create protection state for a device
     */
    getState(deviceKey) {
        let state = this.states.get(deviceKey);
        if (!state) {
            state = {
                stateStartTime: Date.now(),
                lastStateChangeTime: Date.now(),
                currentState: false,
                requestedState: null,
                isBypassed: false,
                isForced: false,
                forceState: null,
                maxTimeViolations: 0,
                minTimeViolations: 0,
                minOffTimeViolations: 0
            };
            this.states.set(deviceKey, state);
        }
        return state;
    }
    /**
     * Main protection logic - evaluates if a state change is allowed
     */
    evaluateProtection(deviceKey, currentState, config) {
        const state = this.getState(deviceKey);
        // Update current state if changed
        if (state.currentState !== currentState) {
            state.lastStateChangeTime = Date.now();
            state.stateStartTime = Date.now();
            state.currentState = currentState;
        }
        const elapsedOnTime = currentState ? (Date.now() - state.stateStartTime) / 1000 : 0;
        const elapsedOffTime = !currentState ? (Date.now() - state.stateStartTime) / 1000 : 0;
        // ========== LEVEL 1: BYPASS ==========
        if (config.bypass === true) {
            state.isBypassed = true;
            state.isForced = false;
            state.forceState = null;
            return {
                allowed: true,
                finalState: currentState,
                reason: 'Bypass active - all protections disabled',
                action: 'bypass',
                metadata: { elapsedOnTime, elapsedOffTime }
            };
        }
        state.isBypassed = false;
        // ========== LEVEL 2: FORCE ==========
        if (config.forceOn === true && config.forceOff === true) {
            // Both force on and off - prioritize force off for safety
            state.isForced = true;
            state.forceState = false;
            return {
                allowed: false,
                finalState: false,
                reason: 'Force ON and OFF both active - prioritizing OFF for safety',
                action: 'force_off',
                metadata: { elapsedOnTime, elapsedOffTime }
            };
        }
        if (config.forceOn === true) {
            state.isForced = true;
            state.forceState = true;
            // Still validate Max Time for safety
            if (config.maxTimeOn > 0 && elapsedOnTime > config.maxTimeOn) {
                state.maxTimeViolations++;
                return {
                    allowed: false,
                    finalState: false,
                    reason: `Max time ON exceeded (${config.maxTimeOn}s) - Force ON blocked for safety`,
                    action: 'block',
                    metadata: { elapsedOnTime, elapsedOffTime, violation: 'max_time' }
                };
            }
            return {
                allowed: true,
                finalState: true,
                reason: 'Force ON active',
                action: 'force_on',
                metadata: { elapsedOnTime, elapsedOffTime }
            };
        }
        if (config.forceOff === true) {
            state.isForced = true;
            state.forceState = false;
            // Still validate Min Time for safety
            if (config.minTimeOn > 0 && currentState && elapsedOnTime < config.minTimeOn) {
                state.minTimeViolations++;
                return {
                    allowed: false,
                    finalState: true,
                    reason: `Min time ON not met (${elapsedOnTime.toFixed(1)}s/${config.minTimeOn}s) - Force OFF blocked for safety`,
                    action: 'block',
                    metadata: { elapsedOnTime, elapsedOffTime, violation: 'min_time' }
                };
            }
            return {
                allowed: true,
                finalState: false,
                reason: 'Force OFF active',
                action: 'force_off',
                metadata: { elapsedOnTime, elapsedOffTime }
            };
        }
        state.isForced = false;
        state.forceState = null;
        // ========== LEVEL 3: MAX TIME ON ==========
        if (config.maxTimeOn > 0 && currentState) {
            if (elapsedOnTime > config.maxTimeOn) {
                state.maxTimeViolations++;
                return {
                    allowed: true,
                    finalState: false,
                    reason: `Max time ON exceeded (${elapsedOnTime.toFixed(1)}s/${config.maxTimeOn}s) - Auto OFF`,
                    action: 'auto_off',
                    metadata: { elapsedOnTime, elapsedOffTime, violation: 'max_time' }
                };
            }
        }
        // ========== LEVEL 4: MIN TIME ON (Prevent Rapid Cycling) ==========
        if (config.minTimeOn > 0 && currentState) {
            // Trying to turn OFF but haven't met minimum time
            if (elapsedOnTime < config.minTimeOn) {
                state.minTimeViolations++;
                return {
                    allowed: false,
                    finalState: true,
                    reason: `Min time ON not met (${elapsedOnTime.toFixed(1)}s/${config.minTimeOn}s) - Must stay ON`,
                    action: 'block',
                    metadata: { elapsedOnTime, elapsedOffTime, violation: 'min_time' }
                };
            }
        }
        // ========== LEVEL 5: MIN OFF TIME (Prevent Rapid Re-start) ==========
        if (config.minOffTime > 0 && !currentState) {
            // Trying to turn ON but haven't met minimum off time
            if (elapsedOffTime < config.minOffTime) {
                state.minOffTimeViolations++;
                return {
                    allowed: false,
                    finalState: false,
                    reason: `Min off time not met (${elapsedOffTime.toFixed(1)}s/${config.minOffTime}s) - Must stay OFF`,
                    action: 'block',
                    metadata: { elapsedOnTime, elapsedOffTime, violation: 'min_off_time' }
                };
            }
        }
        // ========== LEVEL 6: UPPER/LOWER LIMITS (Sensor-based) ==========
        const sensorValue = this.sensorValues.get(deviceKey);
        if (sensorValue !== undefined) {
            // Check upper limit
            if (config.upperLimit > 0 && sensorValue > config.upperLimit) {
                if (deviceKey.includes('cool') || deviceKey.includes('fan')) {
                    // For cooling/fan - turn ON when above upper limit
                    return {
                        allowed: true,
                        finalState: true,
                        reason: `Sensor (${sensorValue}) exceeded upper limit (${config.upperLimit}) - Auto ON`,
                        action: 'auto_on',
                        metadata: { elapsedOnTime, elapsedOffTime, sensorValue }
                    };
                }
                else if (deviceKey.includes('humid') || deviceKey.includes('dehumid')) {
                    // For humid/dehumid - depends on device type
                    if (deviceKey.includes('dehumid')) {
                        return {
                            allowed: true,
                            finalState: true,
                            reason: `Sensor (${sensorValue}) exceeded upper limit (${config.upperLimit}) - Auto ON`,
                            action: 'auto_on',
                            metadata: { elapsedOnTime, elapsedOffTime, sensorValue }
                        };
                    }
                }
            }
            // Check lower limit
            if (config.lowerLimit > 0 && sensorValue < config.lowerLimit) {
                if (deviceKey.includes('cool') || deviceKey.includes('fan')) {
                    // For cooling/fan - turn OFF when below lower limit
                    return {
                        allowed: true,
                        finalState: false,
                        reason: `Sensor (${sensorValue}) below lower limit (${config.lowerLimit}) - Auto OFF`,
                        action: 'auto_off',
                        metadata: { elapsedOnTime, elapsedOffTime, sensorValue }
                    };
                }
                else if (deviceKey.includes('humid')) {
                    // For humid - turn ON when below lower limit
                    return {
                        allowed: true,
                        finalState: true,
                        reason: `Sensor (${sensorValue}) below lower limit (${config.lowerLimit}) - Auto ON`,
                        action: 'auto_on',
                        metadata: { elapsedOnTime, elapsedOffTime, sensorValue }
                    };
                }
            }
        }
        // ========== ALL CHECKS PASSED ==========
        return {
            allowed: true,
            finalState: currentState,
            reason: 'All protection checks passed',
            action: 'allow',
            metadata: { elapsedOnTime, elapsedOffTime }
        };
    }
    /**
     * Get violation statistics for a device
     */
    getViolationStats(deviceKey) {
        const state = this.states.get(deviceKey);
        if (!state)
            return null;
        return {
            maxTime: state.maxTimeViolations,
            minTime: state.minTimeViolations,
            minOffTime: state.minOffTimeViolations
        };
    }
    /**
     * Reset violation counters for a device
     */
    resetViolations(deviceKey) {
        const state = this.states.get(deviceKey);
        if (state) {
            state.maxTimeViolations = 0;
            state.minTimeViolations = 0;
            state.minOffTimeViolations = 0;
        }
    }
    /**
     * Clear all protection states
     */
    clearAllStates() {
        this.states.clear();
        this.sensorValues.clear();
    }
}
exports.ProtectionManager = ProtectionManager;
