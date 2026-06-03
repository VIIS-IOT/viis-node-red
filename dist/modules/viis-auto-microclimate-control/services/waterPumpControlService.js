"use strict";
/**
 * Water Pump Control Service for VIIS Auto Microclimate Control Node
 * Handles water pump control logic based on humidity thresholds
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WaterPumpControlService = void 0;
const constants_1 = require("../constants");
const logger_1 = require("../utils/logger");
class WaterPumpControlService {
    constructor(options) {
        this.flowContext = options.flowContext;
        this.globalContext = options.globalContext;
        this.logger = new logger_1.Logger(options.node, options.nodeId);
    }
    /**
     * Process water pump control based on configuration and sensor data
     */
    async processWaterPumpControl(config, sensorData, deviceStatus) {
        try {
            // Check if water pump control is enabled
            if (config.set_mode_tuong_nuoc !== 1) {
                this.logger.debug("Water pump control is disabled");
                // return this.createWaterPumpAction(false, "Water pump control disabled");
                // do nothin
                return [];
            }
            const humiIndoor = sensorData.humi_indoor;
            if (humiIndoor === undefined) {
                this.logger.warn("Missing indoor humidity data for water pump control");
                return [];
            }
            // Get humidity thresholds
            const lowThreshold = config.set_threshold_low_water_bump || constants_1.WATER_PUMP_CONFIG.DEFAULT_THRESHOLDS.LOW_HUMIDITY;
            const highThreshold = config.set_threshold_high_water_bump || constants_1.WATER_PUMP_CONFIG.DEFAULT_THRESHOLDS.HIGH_HUMIDITY;
            // Validate thresholds
            if (lowThreshold >= highThreshold) {
                this.logger.warn(`Invalid water pump thresholds: low=${lowThreshold}% >= high=${highThreshold}%`);
                return [];
            }
            // Get current water pump state
            const currentPumpState = deviceStatus.bom_nuoc_1 || false;
            // Get water pump state from flow context (for hysteresis)
            const waterPumpState = this.getWaterPumpState();
            // Determine if pump should be on based on thresholds and hysteresis
            const shouldPumpBeOn = this.determinePumpState(humiIndoor, lowThreshold, highThreshold, currentPumpState, waterPumpState);
            // Check if state change is needed
            if (shouldPumpBeOn !== currentPumpState) {
                const reason = this.getPumpControlReason(humiIndoor, lowThreshold, highThreshold, shouldPumpBeOn);
                this.logger.warn(`Water pump control: ${shouldPumpBeOn ? 'ON' : 'OFF'} - ${reason}`);
                // Update state tracking
                this.updateWaterPumpState(shouldPumpBeOn, humiIndoor);
                return this.createWaterPumpAction(shouldPumpBeOn, reason);
            }
            // No change needed
            this.logger.debug(`Water pump state unchanged: ${currentPumpState ? 'ON' : 'OFF'} (humidity=${humiIndoor}%)`);
            return [];
        }
        catch (error) {
            this.logger.error(`Water pump control processing error: ${error.message}`);
            return [];
        }
    }
    /**
     * Determine if pump should be on based on thresholds and hysteresis
     */
    determinePumpState(humidity, lowThreshold, highThreshold, currentState, stateHistory) {
        // Simple threshold logic with hysteresis to prevent rapid switching
        if (humidity <= lowThreshold) {
            // Humidity is low, turn on pump
            return true;
        }
        if (humidity >= highThreshold) {
            // Humidity is high, turn off pump
            return false;
        }
        // Humidity is between thresholds, maintain current state (hysteresis)
        return currentState;
    }
    /**
     * Check for K4 priority override (from fan control)
     * This method can be called by the main control handler to check if K4 conditions
     * require the water pump to be turned on regardless of humidity thresholds
     */
    checkK4PriorityOverride(config, sensorData) {
        try {
            const tempIndoor = sensorData.temp_indoor;
            const humiIndoor = sensorData.humi_indoor;
            if (tempIndoor === undefined || humiIndoor === undefined) {
                return [];
            }
            const k4Threshold = config.set_k4_fan || 40;
            const currentSetModeFan = config.set_mode_fan;
            const currentSetAutoModeFan = config.set_auto_mode_fan;
            // Check K4 conditions: temperature >= K4 threshold only
            const k4TempCondition = tempIndoor >= k4Threshold;
            // Threshold mode is treated as any mode other than explicit rotation mode (2)
            const isThresholdMode = currentSetAutoModeFan !== 2;
            if (k4TempCondition && currentSetModeFan === 1 && isThresholdMode) {
                const reason = `K4 priority override: temp=${tempIndoor}°C (≥${k4Threshold})`;
                this.logger.warn(`Water pump K4 override: ON - ${reason}`);
                // Update state tracking
                this.updateWaterPumpState(true, humiIndoor, true);
                return this.createWaterPumpAction(true, reason);
            }
            return [];
        }
        catch (error) {
            this.logger.error(`K4 priority override check error: ${error.message}`);
            return [];
        }
    }
    /**
     * Create water pump control action
     */
    createWaterPumpAction(turnOn, reason) {
        const coilMapping = this.getCoilMapping();
        const pumpKey = "bom_nuoc_1";
        const address = coilMapping[pumpKey];
        if (address === undefined) {
            this.logger.error(`No coil address found for water pump: ${pumpKey}`);
            return [];
        }
        return [{
                deviceKey: pumpKey,
                value: turnOn,
                address: address,
                fc: constants_1.MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,
                reason: reason
            }];
    }
    /**
     * Get water pump state from flow context
     */
    getWaterPumpState() {
        return this.flowContext.get(constants_1.CONTEXT_KEYS.WATER_PUMP_STATE) || {
            lastChangeTime: 0,
            lastHumidity: 0,
            changeCount: 0,
            isK4Override: false
        };
    }
    /**
     * Update water pump state in flow context
     */
    updateWaterPumpState(isOn, humidity, isK4Override = false) {
        const currentState = this.getWaterPumpState();
        const newState = {
            isOn: isOn,
            lastChangeTime: Date.now(),
            lastHumidity: humidity,
            changeCount: currentState.changeCount + 1,
            isK4Override: isK4Override
        };
        this.flowContext.set(constants_1.CONTEXT_KEYS.WATER_PUMP_STATE, newState);
    }
    /**
     * Get coil mapping from global context or fallback to constants
     */
    getCoilMapping() {
        const globalCoils = this.globalContext.get(constants_1.CONTEXT_KEYS.GLOBAL_MODBUS_COILS) || {};
        // Merge with default mappings
        return Object.assign(Object.assign({}, constants_1.WATER_PUMP_CONFIG.COIL_MAPPING), globalCoils);
    }
    /**
     * Get reason string for pump control action
     */
    getPumpControlReason(humidity, lowThreshold, highThreshold, turnOn) {
        if (turnOn) {
            if (humidity <= lowThreshold) {
                return `Low humidity: ${humidity}% ≤ ${lowThreshold}%`;
            }
            else {
                return `Humidity control: ${humidity}% (between ${lowThreshold}%-${highThreshold}%, maintaining ON)`;
            }
        }
        else {
            if (humidity >= highThreshold) {
                return `High humidity: ${humidity}% ≥ ${highThreshold}%`;
            }
            else {
                return `Humidity control: ${humidity}% (between ${lowThreshold}%-${highThreshold}%, maintaining OFF)`;
            }
        }
    }
    /**
     * Get current water pump status for monitoring
     */
    getWaterPumpStatus() {
        const state = this.getWaterPumpState();
        return {
            isEnabled: true, // This would come from config in a real implementation
            currentState: state,
            lastAction: state.isOn ? 'ON' : 'OFF'
        };
    }
}
exports.WaterPumpControlService = WaterPumpControlService;
