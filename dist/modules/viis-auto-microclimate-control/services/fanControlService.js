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
            // First, process any ongoing fan group transitions
            const transitionActions = await this.processFanGroupTransition(config);
            actions.push(...transitionActions);
            // If a transition is in progress, don't start new fan control logic
            if (this.isTransitionInProgress()) {
                this.logger.debug("Fan group transition in progress, skipping new fan control logic");
                // Still process fan dao control as it's independent
                const fanDaoActions = await this.processFanDaoControl(config);
                actions.push(...fanDaoActions);
                return actions;
            }
            // Process based on auto mode
            if (config.set_auto_mode_fan === 1) {
                // Rotation mode
                const rotationActions = await this.processRotationModeWithTransition(config);
                actions.push(...rotationActions);
            }
            else {
                // Threshold mode (default)
                const thresholdActions = await this.processThresholdModeWithTransition(config, sensorData, deviceStatus);
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
    /**
     * Process rotation mode with transition support
     */
    async processRotationModeWithTransition(config) {
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
                const previousGroup = [...rotationState.activeGroup];
                // Move to next group
                rotationState.currentGroupIndex = (0, groupUtils_1.getNextGroupIndex)(rotationState.currentGroupIndex, fanGroups.length);
                rotationState.lastRotationTime = (0, timeUtils_1.getCurrentTimestamp)();
                rotationState.activeGroup = fanGroups[rotationState.currentGroupIndex];
                // Save updated state
                this.saveRotationState(rotationState);
                const reason = `Fan rotation: switching to group ${rotationState.currentGroupIndex + 1}/${fanGroups.length} (${rotationState.activeGroup.join(', ')})`;
                this.logger.log(reason);
                // Check if transition is needed
                if (this.requiresGroupTransition(previousGroup, rotationState.activeGroup)) {
                    this.initiateFanGroupTransition(previousGroup, rotationState.activeGroup, reason);
                    return []; // Transition will be handled in next cycle
                }
                else {
                    // No transition needed, create actions directly
                    const coilMapping = this.getCoilMapping();
                    return (0, groupUtils_1.createOptimizedFanGroupActions)(rotationState.activeGroup, true, reason, coilMapping, this.getCurrentDeviceStatus());
                }
            }
            // No rotation needed, maintain current group
            const coilMapping = this.getCoilMapping();
            return (0, groupUtils_1.createOptimizedFanGroupActions)(rotationState.activeGroup, true, `Rotation mode: maintaining group ${rotationState.currentGroupIndex + 1}/${fanGroups.length}`, coilMapping, this.getCurrentDeviceStatus());
        }
        catch (error) {
            this.logger.error(`Rotation mode processing error: ${error.message}`);
            return [];
        }
    }
    /**
     * Process threshold mode with transition support
     */
    async processThresholdModeWithTransition(config, sensorData, deviceStatus) {
        try {
            const temperature = sensorData.temp_indoor;
            const humidity = sensorData.humi_indoor;
            if (temperature === undefined || humidity === undefined) {
                this.logger.warn("Missing temperature or humidity data for threshold mode");
                return [];
            }
            // Get temperature thresholds
            const thresholds = {
                k1: config.set_k1_fan || constants_1.FAN_CONFIG.DEFAULT_TEMPERATURE_THRESHOLDS.K1,
                k2: config.set_k2_fan || constants_1.FAN_CONFIG.DEFAULT_TEMPERATURE_THRESHOLDS.K2,
                k3: config.set_k3_fan || constants_1.FAN_CONFIG.DEFAULT_TEMPERATURE_THRESHOLDS.K3,
                k4: config.set_k4_fan || constants_1.FAN_CONFIG.DEFAULT_TEMPERATURE_THRESHOLDS.K4
            };
            const reason = this.getThresholdReason(temperature, humidity, thresholds);
            const coilMapping = this.getCoilMapping();
            const deviceStatusRecord = this.convertDeviceStatusToRecord(deviceStatus);
            // Determine required group size and target group
            let targetGroup = [];
            let requiredGroupSize = 0;
            if (temperature >= thresholds.k4) {
                // K4: All fans (6 fans)
                requiredGroupSize = 6;
                const fanGroups = this.getFanGroups(requiredGroupSize);
                targetGroup = fanGroups[0] || [];
            }
            else if (temperature >= thresholds.k3) {
                // K3: 4 fans
                requiredGroupSize = 4;
                const fanGroups = this.getFanGroups(requiredGroupSize);
                targetGroup = this.getRotationTargetGroup(fanGroups, requiredGroupSize, config);
            }
            else if (temperature >= thresholds.k2) {
                // K2: 2 fans with rotation
                requiredGroupSize = 2;
                const fanGroups = this.getFanGroups(requiredGroupSize);
                targetGroup = this.getRotationTargetGroup(fanGroups, requiredGroupSize, config);
            }
            else if (temperature >= thresholds.k1) {
                // K1: 1 fan with rotation
                requiredGroupSize = 1;
                const fanGroups = this.getFanGroups(requiredGroupSize);
                targetGroup = this.getRotationTargetGroup(fanGroups, requiredGroupSize, config);
            }
            else {
                // Below K1: Turn off all fans
                return (0, groupUtils_1.createOptimizedFanGroupActions)([], false, reason, coilMapping, deviceStatusRecord);
            }
            // Get current active fans
            const currentActiveFans = Object.keys(deviceStatusRecord).filter(key => deviceStatusRecord[key] === true && (0, groupUtils_1.getAllFanKeys)().includes(key));
            // Check if transition is needed
            if (this.requiresGroupTransition(currentActiveFans, targetGroup)) {
                this.initiateFanGroupTransition(currentActiveFans, targetGroup, reason);
                return []; // Transition will be handled in next cycle
            }
            else {
                // No transition needed, create actions directly
                return (0, groupUtils_1.createOptimizedFanGroupActions)(targetGroup, true, reason, coilMapping, deviceStatusRecord);
            }
        }
        catch (error) {
            this.logger.error(`Threshold mode processing error: ${error.message}`);
            return [];
        }
    }
    /**
     * Get fan group transition delay configuration
     */
    getFanGroupTransitionDelayMs(config) {
        const delaySeconds = config.set_fan_group_transition_delay ||
            (constants_1.CONTROL_CONFIG.FAN_GROUP_TRANSITION_DELAY_MS / 1000);
        return delaySeconds * 1000;
    }
    /**
     * Get fan group off delay configuration
     */
    getFanGroupOffDelayMs(config) {
        const delaySeconds = config.set_fan_group_off_delay ||
            (constants_1.CONTROL_CONFIG.FAN_GROUP_OFF_DELAY_MS / 1000);
        return delaySeconds * 1000;
    }
    /**
     * Get current fan group transition state
     */
    getFanGroupTransitionState() {
        const state = this.flowContext.get(constants_1.CONTEXT_KEYS.FAN_GROUP_TRANSITION_STATE);
        return state || null;
    }
    /**
     * Save fan group transition state
     */
    saveFanGroupTransitionState(state) {
        this.flowContext.set(constants_1.CONTEXT_KEYS.FAN_GROUP_TRANSITION_STATE, state);
    }
    /**
     * Clear fan group transition state
     */
    clearFanGroupTransitionState() {
        this.flowContext.set(constants_1.CONTEXT_KEYS.FAN_GROUP_TRANSITION_STATE, null);
    }
    /**
     * Check if fan groups are different (requires transition)
     */
    requiresGroupTransition(currentGroup, newGroup) {
        if (currentGroup.length !== newGroup.length) {
            return true;
        }
        // Sort both arrays to compare content regardless of order
        const sortedCurrent = [...currentGroup].sort();
        const sortedNew = [...newGroup].sort();
        return !sortedCurrent.every((fan, index) => fan === sortedNew[index]);
    }
    /**
     * Initiate fan group transition with delay
     */
    initiateFanGroupTransition(previousGroup, nextGroup, reason) {
        const transitionState = {
            isTransitioning: true,
            phase: 'off',
            previousGroup: [...previousGroup],
            nextGroup: [...nextGroup],
            transitionStartTime: (0, timeUtils_1.getCurrentTimestamp)(),
            offDelayStartTime: 0,
            reason: reason
        };
        this.saveFanGroupTransitionState(transitionState);
        this.logger.log(`Initiated fan group transition: [${previousGroup.join(', ')}] → [${nextGroup.join(', ')}] - ${reason}`);
    }
    /**
     * Process ongoing fan group transition
     */
    async processFanGroupTransition(config) {
        const transitionState = this.getFanGroupTransitionState();
        if (!transitionState || !transitionState.isTransitioning) {
            return [];
        }
        const now = (0, timeUtils_1.getCurrentTimestamp)();
        const coilMapping = this.getCoilMapping();
        const actions = [];
        switch (transitionState.phase) {
            case 'off':
                // Turn off previous group
                if (transitionState.previousGroup.length > 0) {
                    const offActions = (0, groupUtils_1.createOptimizedFanGroupActions)(transitionState.previousGroup, false, `Transition phase 1: Turn off previous group - ${transitionState.reason}`, coilMapping, this.getCurrentDeviceStatus());
                    actions.push(...offActions);
                }
                // Move to delay phase
                transitionState.phase = 'delay';
                transitionState.offDelayStartTime = now;
                this.saveFanGroupTransitionState(transitionState);
                this.logger.log(`Fan transition: Previous group turned off, starting delay phase`);
                break;
            case 'delay':
                // Check if delay period has elapsed
                const offDelayMs = this.getFanGroupOffDelayMs(config);
                if ((0, timeUtils_1.hasTimeElapsed)(transitionState.offDelayStartTime, offDelayMs)) {
                    // Move to on phase
                    transitionState.phase = 'on';
                    this.saveFanGroupTransitionState(transitionState);
                    this.logger.log(`Fan transition: Delay completed (${offDelayMs}ms), turning on new group`);
                }
                else {
                    // Still in delay, no actions
                    const remaining = offDelayMs - (now - transitionState.offDelayStartTime);
                    this.logger.debug(`Fan transition: Delay in progress, ${remaining}ms remaining`);
                }
                break;
            case 'on':
                // Turn on new group
                if (transitionState.nextGroup.length > 0) {
                    const onActions = (0, groupUtils_1.createOptimizedFanGroupActions)(transitionState.nextGroup, true, `Transition phase 2: Turn on new group - ${transitionState.reason}`, coilMapping, this.getCurrentDeviceStatus());
                    actions.push(...onActions);
                }
                // Move to complete phase
                transitionState.phase = 'complete';
                this.saveFanGroupTransitionState(transitionState);
                this.logger.log(`Fan transition: New group turned on, transition completing`);
                break;
            case 'complete':
                // Check if overall transition delay has elapsed
                const transitionDelayMs = this.getFanGroupTransitionDelayMs(config);
                if ((0, timeUtils_1.hasTimeElapsed)(transitionState.transitionStartTime, transitionDelayMs)) {
                    // Transition complete, clear state
                    this.clearFanGroupTransitionState();
                    this.logger.log(`Fan group transition completed successfully`);
                }
                else {
                    // Still in cooldown period
                    const remaining = transitionDelayMs - (now - transitionState.transitionStartTime);
                    this.logger.debug(`Fan transition: Cooldown in progress, ${remaining}ms remaining`);
                }
                break;
        }
        return actions;
    }
    /**
     * Check if fan group transition is in progress
     */
    isTransitionInProgress() {
        const transitionState = this.getFanGroupTransitionState();
        return (transitionState === null || transitionState === void 0 ? void 0 : transitionState.isTransitioning) === true;
    }
    /**
     * Get current device status from global context
     */
    getCurrentDeviceStatus() {
        const coilData = this.globalContext.get(constants_1.CONTEXT_KEYS.GLOBAL_COIL_REGISTER_DATA) || {};
        const deviceStatus = {};
        // Map coil data to device status
        const coilMapping = this.getCoilMapping();
        Object.entries(coilMapping).forEach(([deviceKey, address]) => {
            deviceStatus[deviceKey] = coilData[address] === true;
        });
        return deviceStatus;
    }
}
exports.FanControlService = FanControlService;
