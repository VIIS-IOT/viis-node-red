"use strict";
/**
 * Fan Control Service for VIIS Auto Microclimate Control Node
 * Handles fan control logic including rotation and threshold modes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FanControlService = void 0;
const constants_1 = require("../constants");
const logger_1 = require("../utils/logger");
const groupUtils_1 = require("../utils/groupUtils");
const timeUtils_1 = require("../utils/timeUtils");
class FanControlService {
    constructor(options) {
        this.flowContext = options.flowContext;
        this.globalContext = options.globalContext;
        this.logger = new logger_1.Logger(options.node, options.nodeId);
    }
    /**
     * Process fan control based on configuration and sensor data
     */
    async processFanControl(config, sensorData, deviceStatus) {
        const actions = [];
        try {
            // Check if fan control is enabled
            if (config.set_mode_fan !== 1) {
                this.logger.debug("Fan control is disabled");
                // Turn off all fans if control is disabled
                // return this.createTurnOffAllFansActions("Fan control disabled");
                // Do nothing
                return [];
            }
            // Process based on auto mode
            if (config.set_auto_mode_fan === 1) {
                // Rotation mode
                const rotationActions = await this.processRotationMode(config);
                actions.push(...rotationActions);
            }
            else {
                // Threshold mode (default)
                const thresholdActions = await this.processThresholdMode(config, sensorData, deviceStatus);
                actions.push(...thresholdActions);
            }
            // Process fan dao control
            const fanDaoActions = await this.processFanDaoControl(config);
            actions.push(...fanDaoActions);
            return actions;
        }
        catch (error) {
            this.logger.error(`Fan control processing error: ${error.message}`);
            return [];
        }
    }
    /**
     * Process rotation mode fan control
     */
    async processRotationMode(config) {
        try {
            const groupSize = config.set_gr_alternate_fan || 2;
            const rotationInterval = (0, timeUtils_1.minutesToMs)(config.set_time_alternate_fan || 15);
            // Get fan groups
            const fanGroups = this.getFanGroups(groupSize);
            if (fanGroups.length === 0) {
                this.logger.warn("No fan groups available for rotation");
                return [];
            }
            // Get current rotation state
            let rotationState = this.getRotationState();
            // Check if it's time to rotate
            if ((0, timeUtils_1.hasTimeElapsed)(rotationState.lastRotationTime, rotationInterval)) {
                // Move to next group
                rotationState.currentGroupIndex = (0, groupUtils_1.getNextGroupIndex)(rotationState.currentGroupIndex, fanGroups.length);
                rotationState.lastRotationTime = (0, timeUtils_1.getCurrentTimestamp)();
                rotationState.activeGroup = fanGroups[rotationState.currentGroupIndex];
                // Save updated state
                this.saveRotationState(rotationState);
                this.logger.log(`Fan rotation: switching to group ${rotationState.currentGroupIndex + 1}/${fanGroups.length} (${rotationState.activeGroup.join(', ')})`);
            }
            // Create actions for current active group
            const coilMapping = this.getCoilMapping();
            return (0, groupUtils_1.createFanGroupActions)(rotationState.activeGroup, true, `Rotation mode: group ${rotationState.currentGroupIndex + 1}`, coilMapping);
        }
        catch (error) {
            this.logger.error(`Rotation mode processing error: ${error.message}`);
            return [];
        }
    }
    /**
     * Process threshold mode fan control
     */
    async processThresholdMode(config, sensorData, deviceStatus) {
        try {
            const tempIndoor = sensorData.temp_indoor;
            const humiIndoor = sensorData.humi_indoor;
            if (tempIndoor === undefined || humiIndoor === undefined) {
                this.logger.warn("Missing temperature or humidity data for threshold mode");
                return [];
            }
            // Get temperature thresholds
            const thresholds = {
                k1: config.set_k1_fan || 25,
                k2: config.set_k2_fan || 30,
                k3: config.set_k3_fan || 35,
                k4: config.set_k4_fan || 40
            };
            // Determine required group size based on thresholds
            const requiredGroupSize = (0, groupUtils_1.getRecommendedGroupSize)(tempIndoor, humiIndoor, thresholds);
            this.logger.debug(`Threshold mode: temp=${tempIndoor}°C, humidity=${humiIndoor}%, required group size=${requiredGroupSize}`);
            if (requiredGroupSize === 0) {
                // No fans needed - use optimized function if device status available
                const reason = `Temperature below K1 threshold: ${tempIndoor}°C (<${thresholds.k1}°C), humidity=${humiIndoor}%`;
                if (deviceStatus) {
                    const coilMapping = this.getCoilMapping();
                    const deviceStatusRecord = this.convertDeviceStatusToRecord(deviceStatus);
                    return (0, groupUtils_1.createOptimizedFanGroupActions)([], false, reason, coilMapping, deviceStatusRecord);
                }
                return this.createTurnOffAllFansActions(reason);
            }
            // Get appropriate fan groups
            const fanGroups = this.getFanGroups(requiredGroupSize);
            if (fanGroups.length === 0) {
                this.logger.warn(`No fan groups available for size ${requiredGroupSize}`);
                return [];
            }
            // For threshold mode, determine target group based on requirements
            let targetGroup;
            if (requiredGroupSize === 6) {
                // K3 or K4: Use all 6 fans
                targetGroup = (0, groupUtils_1.getAllFanKeys)();
            }
            else {
                // K1 or K2: Use rotation logic for smaller groups
                targetGroup = this.getRotationTargetGroup(fanGroups, requiredGroupSize, config);
            }
            const reason = this.getThresholdReason(tempIndoor, humiIndoor, thresholds);
            const coilMapping = this.getCoilMapping();
            // Use optimized function if device status is available
            if (deviceStatus) {
                const deviceStatusRecord = this.convertDeviceStatusToRecord(deviceStatus);
                return (0, groupUtils_1.createOptimizedFanGroupActions)(targetGroup, true, reason, coilMapping, deviceStatusRecord);
            }
            return (0, groupUtils_1.createFanGroupActions)(targetGroup, true, reason, coilMapping);
        }
        catch (error) {
            this.logger.error(`Threshold mode processing error: ${error.message}`);
            return [];
        }
    }
    /**
     * Process fan dao (reverse fan) control
     */
    async processFanDaoControl(config) {
        try {
            // Check if fan dao control is enabled
            if (config.set_mode_fan_dao !== 1) {
                this.logger.debug("Fan dao control is disabled");
                const coilMapping = this.getCoilMapping();
                return (0, groupUtils_1.createFanDaoActions)(false, "Fan dao control disabled", coilMapping);
            }
            const alternateInterval = (0, timeUtils_1.minutesToMs)(config.set_time_alternate_fan_dao || 5);
            // Get last fan dao state change time
            const lastFanDaoTime = this.flowContext.get(`${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_dao_time`) || 0;
            const currentFanDaoState = this.flowContext.get(`${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_dao_state`) || false;
            // Check if it's time to toggle fan dao state
            if ((0, timeUtils_1.hasTimeElapsed)(lastFanDaoTime, alternateInterval)) {
                const newState = !currentFanDaoState;
                // Save new state
                this.flowContext.set(`${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_dao_time`, (0, timeUtils_1.getCurrentTimestamp)());
                this.flowContext.set(`${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_dao_state`, newState);
                this.logger.log(`Fan dao alternating: switching to ${newState ? 'ON' : 'OFF'}`);
                const coilMapping = this.getCoilMapping();
                return (0, groupUtils_1.createFanDaoActions)(newState, `Fan dao alternating mode: ${newState ? 'ON' : 'OFF'}`, coilMapping);
            }
            // No change needed
            return [];
        }
        catch (error) {
            this.logger.error(`Fan dao control processing error: ${error.message}`);
            return [];
        }
    }
    /**
     * Get fan groups based on group size
     */
    getFanGroups(groupSize) {
        return (0, groupUtils_1.getFanGroups)(groupSize);
    }
    /**
     * Get current rotation state
     */
    getRotationState() {
        const saved = this.flowContext.get(constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE);
        if (saved && typeof saved === 'object') {
            return saved;
        }
        // Initialize default state
        const defaultState = {
            currentGroupIndex: 0,
            lastRotationTime: 0,
            activeGroup: []
        };
        this.saveRotationState(defaultState);
        return defaultState;
    }
    /**
     * Save rotation state
     */
    saveRotationState(state) {
        this.flowContext.set(constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE, state);
    }
    /**
     * Convert DeviceStatus to Record<string, boolean> for compatibility
     */
    convertDeviceStatusToRecord(deviceStatus) {
        const result = {};
        // Extract only boolean properties, excluding 'ts'
        Object.keys(deviceStatus).forEach(key => {
            if (key !== 'ts' && typeof deviceStatus[key] === 'boolean') {
                result[key] = deviceStatus[key];
            }
        });
        return result;
    }
    /**
     * Get coil mapping from global context or fallback to constants
     */
    getCoilMapping() {
        const globalCoils = this.globalContext.get(constants_1.CONTEXT_KEYS.GLOBAL_MODBUS_COILS) || {};
        // Merge with default mappings
        return Object.assign(Object.assign(Object.assign({}, constants_1.FAN_CONFIG.COIL_MAPPING), constants_1.FAN_DAO_CONFIG.COIL_MAPPING), globalCoils);
    }
    /**
     * Create actions to turn off all fans
     */
    createTurnOffAllFansActions(reason) {
        const actions = [];
        const coilMapping = this.getCoilMapping();
        (0, groupUtils_1.getAllFanKeys)().forEach(fanKey => {
            const address = coilMapping[fanKey];
            if (address !== undefined) {
                actions.push({
                    deviceKey: fanKey,
                    value: false,
                    address: address,
                    fc: constants_1.MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,
                    reason: reason
                });
            }
        });
        return actions;
    }
    /**
     * Get rotation target group for threshold mode with smaller group sizes
     */
    getRotationTargetGroup(fanGroups, requiredGroupSize, config) {
        // For K1 and K2 thresholds, use rotation logic with same interval as rotation mode
        const rotationInterval = (0, timeUtils_1.minutesToMs)(config.set_time_alternate_fan || 15);
        // Get or initialize rotation state for threshold mode
        const contextKey = `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_${requiredGroupSize}`;
        let rotationState = this.flowContext.get(contextKey);
        if (!rotationState || typeof rotationState !== 'object') {
            rotationState = {
                currentGroupIndex: 0,
                lastRotationTime: 0,
                activeGroup: fanGroups[0] || []
            };
        }
        // Check if it's time to rotate
        if ((0, timeUtils_1.hasTimeElapsed)(rotationState.lastRotationTime, rotationInterval)) {
            // Move to next group
            rotationState.currentGroupIndex = (0, groupUtils_1.getNextGroupIndex)(rotationState.currentGroupIndex, fanGroups.length);
            rotationState.lastRotationTime = (0, timeUtils_1.getCurrentTimestamp)();
            rotationState.activeGroup = fanGroups[rotationState.currentGroupIndex];
            // Save updated state
            this.flowContext.set(contextKey, rotationState);
            this.logger.log(`Threshold rotation: switching to group ${rotationState.currentGroupIndex + 1}/${fanGroups.length} for size ${requiredGroupSize} (interval: ${config.set_time_alternate_fan || 15}min)`);
        }
        return rotationState.activeGroup || fanGroups[0] || [];
    }
    /**
     * Get reason string for threshold mode (temperature-based only)
     */
    getThresholdReason(temperature, humidity, thresholds) {
        if (temperature >= thresholds.k4) {
            return `K4 threshold: temp=${temperature}°C (≥${thresholds.k4}°C), humidity=${humidity}%`;
        }
        else if (temperature >= thresholds.k3) {
            return `K3 threshold: temp=${temperature}°C (≥${thresholds.k3}°C), humidity=${humidity}%`;
        }
        else if (temperature >= thresholds.k2) {
            return `K2 threshold: temp=${temperature}°C (≥${thresholds.k2}°C), humidity=${humidity}%`;
        }
        else if (temperature >= thresholds.k1) {
            return `K1 threshold: temp=${temperature}°C (≥${thresholds.k1}°C), humidity=${humidity}%`;
        }
        return `Below K1 threshold: temp=${temperature}°C (<${thresholds.k1}°C), humidity=${humidity}%`;
    }
}
exports.FanControlService = FanControlService;
