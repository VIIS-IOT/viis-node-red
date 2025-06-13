"use strict";
/**
 * Fan Control Service for VIIS Auto Microclimate Control Node
 * Handles fan control logic including rotation and threshold modes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FanControlService = void 0;
const types_1 = require("../interfaces/types");
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
            // Check if transition delays are configured
            const transitionDelayMs = this.getFanGroupTransitionDelayMs(config);
            const offDelayMs = this.getFanGroupOffDelayMs(config);
            const useTransitions = transitionDelayMs > 0 || offDelayMs > 0;
            // Process based on auto mode
            if (config.set_auto_mode_fan === 1) {
                // Rotation mode
                if (useTransitions) {
                    const rotationActions = await this.processRotationModeWithTransition(config);
                    actions.push(...rotationActions);
                }
                else {
                    const rotationActions = await this.processRotationMode(config);
                    actions.push(...rotationActions);
                }
            }
            else {
                // Threshold mode (default)
                if (useTransitions) {
                    const thresholdActions = await this.processThresholdModeWithTransition(config, sensorData, deviceStatus);
                    actions.push(...thresholdActions);
                }
                else {
                    const thresholdActions = await this.processThresholdMode(config, sensorData, deviceStatus);
                    actions.push(...thresholdActions);
                }
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
                this.logger.warn(`Fan rotation: switching to group ${rotationState.currentGroupIndex + 1}/${fanGroups.length} (${rotationState.activeGroup.join(', ')})`);
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
     * Process threshold mode fan control with anti-oscillation mechanisms
     */
    async processThresholdMode(config, sensorData, deviceStatus) {
        try {
            const tempIndoor = sensorData.temp_indoor;
            const humiIndoor = sensorData.humi_indoor;
            if (tempIndoor === undefined || humiIndoor === undefined ||
                typeof tempIndoor !== 'number' || typeof humiIndoor !== 'number' ||
                isNaN(tempIndoor) || isNaN(humiIndoor)) {
                this.logger.warn("Missing or invalid temperature or humidity data for threshold mode");
                return [];
            }
            // Get temperature thresholds
            const thresholds = {
                k1: config.set_k1_fan || 25,
                k2: config.set_k2_fan || 30,
                k3: config.set_k3_fan || 35,
                k4: config.set_k4_fan || 40
            };
            // Get current active fan count for hysteresis calculation
            const currentActiveFanCount = this.getCurrentActiveFanCount(deviceStatus);
            // Determine required group size with hysteresis to prevent oscillation
            const requiredGroupSize = (0, groupUtils_1.getRecommendedGroupSize)(tempIndoor, humiIndoor, thresholds, {
                currentGroupSize: currentActiveFanCount,
                hysteresis: constants_1.CONTROL_CONFIG.THRESHOLD_HYSTERESIS_CELSIUS
            });
            this.logger.debug(`Threshold mode: temp=${tempIndoor}°C, humidity=${humiIndoor}%, current fans=${currentActiveFanCount}, required group size=${requiredGroupSize}`);
            // Check if change is actually needed (anti-oscillation)
            if (currentActiveFanCount === requiredGroupSize) {
                this.logger.debug(`No change needed: current fan count (${currentActiveFanCount}) matches required (${requiredGroupSize})`);
                return []; // No action needed - already in correct state
            }
            if (requiredGroupSize === 0) {
                // No fans needed - use optimized function if device status available
                const reason = `Temperature below K1 threshold with hysteresis: ${tempIndoor}°C, humidity=${humiIndoor}%`;
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
                // K3 or K4: Use all 6 fans (no rotation needed)
                targetGroup = (0, groupUtils_1.getAllFanKeys)();
                this.logger.debug(`K3/K4 threshold: using all fans [${targetGroup.join(', ')}]`);
            }
            else if (requiredGroupSize === 4) {
                // K2: Use rotation logic for 4-fan groups
                targetGroup = this.getRotationTargetGroup(fanGroups, requiredGroupSize, config);
                this.logger.debug(`K2 threshold: using 4-fan group [${targetGroup.join(', ')}]`);
            }
            else if (requiredGroupSize === 2) {
                // K1: Use rotation logic for 2-fan groups
                targetGroup = this.getRotationTargetGroup(fanGroups, requiredGroupSize, config);
                this.logger.debug(`K1 threshold: using 2-fan group [${targetGroup.join(', ')}]`);
            }
            else if (requiredGroupSize === 1) {
                // Single fan mode: Use rotation logic for 1-fan groups
                targetGroup = this.getRotationTargetGroup(fanGroups, requiredGroupSize, config);
                this.logger.debug(`Single fan mode: using 1-fan group [${targetGroup.join(', ')}]`);
            }
            else {
                // Fallback: use rotation logic for any other group size
                targetGroup = this.getRotationTargetGroup(fanGroups, requiredGroupSize, config);
                this.logger.debug(`Custom group size ${requiredGroupSize}: using group [${targetGroup.join(', ')}]`);
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
                this.logger.warn(`Fan dao alternating: switching to ${newState ? 'ON' : 'OFF'}`);
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
     * Get current active fan count from device status
     */
    getCurrentActiveFanCount(deviceStatus) {
        if (!deviceStatus) {
            return 0;
        }
        let count = 0;
        const fanKeys = ['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'];
        for (const fanKey of fanKeys) {
            if (deviceStatus[fanKey] === true) {
                count++;
            }
        }
        return count;
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
     * Get rotation target group for threshold mode with improved consistency
     */
    getRotationTargetGroup(fanGroups, requiredGroupSize, config) {
        var _a;
        // For K1 and K2 thresholds, use rotation logic with same interval as rotation mode
        const rotationInterval = (0, timeUtils_1.minutesToMs)(config.set_time_alternate_fan || 15);
        // Use consistent context key for threshold mode rotation
        const contextKey = `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_mode`;
        let rotationState = this.flowContext.get(contextKey);
        // Migration: Check for old context keys and migrate to new unified key
        if (!rotationState) {
            const oldContextKeys = [
                `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_${requiredGroupSize}`,
                `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_1`,
                `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_2`,
                `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_4`,
                `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_6`
            ];
            for (const oldKey of oldContextKeys) {
                const oldState = this.flowContext.get(oldKey);
                if (oldState && typeof oldState === 'object') {
                    this.logger.warn(`Migrating rotation state from old key ${oldKey} to ${contextKey}`);
                    rotationState = Object.assign(Object.assign({}, oldState), { requiredGroupSize: requiredGroupSize });
                    this.flowContext.set(contextKey, rotationState);
                    // Clear old key
                    this.flowContext.set(oldKey, null);
                    break;
                }
            }
        }
        // Initialize rotation state if not exists or invalid
        if (!rotationState || typeof rotationState !== 'object' || !Array.isArray(rotationState.activeGroup)) {
            rotationState = {
                currentGroupIndex: 0,
                lastRotationTime: (0, timeUtils_1.getCurrentTimestamp)(),
                activeGroup: fanGroups[0] || [],
                requiredGroupSize: requiredGroupSize // Track group size for consistency
            };
            this.flowContext.set(contextKey, rotationState);
            this.logger.warn(`Initialized threshold rotation state for group size ${requiredGroupSize}: [${rotationState.activeGroup.join(', ')}]`);
        }
        // If the required group size changed, reinitialize with appropriate groups
        if (rotationState.requiredGroupSize !== requiredGroupSize) {
            const newFanGroups = this.getFanGroups(requiredGroupSize);
            rotationState = {
                currentGroupIndex: 0,
                lastRotationTime: (0, timeUtils_1.getCurrentTimestamp)(),
                activeGroup: newFanGroups[0] || [],
                requiredGroupSize: requiredGroupSize
            };
            this.flowContext.set(contextKey, rotationState);
            this.logger.warn(`Group size changed from ${rotationState.requiredGroupSize} to ${requiredGroupSize}, reinitialized rotation state`);
        }
        // Check if it's time to rotate
        const timeSinceLastRotation = (0, timeUtils_1.getCurrentTimestamp)() - rotationState.lastRotationTime;
        const shouldRotate = (0, timeUtils_1.hasTimeElapsed)(rotationState.lastRotationTime, rotationInterval);
        this.logger.debug(`Rotation check: time since last = ${Math.round(timeSinceLastRotation / 1000)}s, interval = ${Math.round(rotationInterval / 1000)}s, should rotate = ${shouldRotate}`);
        if (shouldRotate) {
            const previousGroup = [...rotationState.activeGroup];
            // Move to next group in sequence
            rotationState.currentGroupIndex = (0, groupUtils_1.getNextGroupIndex)(rotationState.currentGroupIndex, fanGroups.length);
            rotationState.lastRotationTime = (0, timeUtils_1.getCurrentTimestamp)();
            rotationState.activeGroup = fanGroups[rotationState.currentGroupIndex];
            // Save updated state
            this.flowContext.set(contextKey, rotationState);
            this.logger.warn(`🔄 Threshold rotation (size ${requiredGroupSize}): [${previousGroup.join(',')}] → [${rotationState.activeGroup.join(',')}]`);
            this.logger.warn(`Current group: ${rotationState.currentGroupIndex + 1}/${fanGroups.length} (interval: ${config.set_time_alternate_fan || 15}min)`);
            this.logger.warn(`Time since last rotation: ${Math.round(timeSinceLastRotation / 60000)} minutes`);
        }
        // Validate active group consistency
        if (!rotationState.activeGroup || rotationState.activeGroup.length !== requiredGroupSize) {
            this.logger.warn(`Invalid active group size, fixing: expected ${requiredGroupSize}, got ${((_a = rotationState.activeGroup) === null || _a === void 0 ? void 0 : _a.length) || 0}`);
            rotationState.activeGroup = fanGroups[rotationState.currentGroupIndex] || fanGroups[0] || [];
            this.flowContext.set(contextKey, rotationState);
        }
        // Ensure currentGroupIndex is valid
        if (rotationState.currentGroupIndex >= fanGroups.length) {
            this.logger.warn(`Invalid currentGroupIndex ${rotationState.currentGroupIndex}, resetting to 0`);
            rotationState.currentGroupIndex = 0;
            rotationState.activeGroup = fanGroups[0] || [];
            this.flowContext.set(contextKey, rotationState);
        }
        this.logger.debug(`Final rotation target: [${rotationState.activeGroup.join(',')}] (group ${rotationState.currentGroupIndex + 1}/${fanGroups.length})`);
        return rotationState.activeGroup || fanGroups[0] || [];
    }
    /**
     * Get stable rotation target group that prevents unnecessary transitions
     */
    getStableRotationTargetGroup(fanGroups, requiredGroupSize, config, deviceStatusRecord) {
        var _a;
        // Check if we're currently in a transition - if so, don't change target
        if (this.isTransitionInProgress()) {
            const transitionState = this.getFanGroupTransitionState();
            if ((transitionState === null || transitionState === void 0 ? void 0 : transitionState.nextGroup) && transitionState.nextGroup.length > 0) {
                this.logger.debug(`Transition in progress, maintaining target group: [${transitionState.nextGroup.join(', ')}]`);
                return transitionState.nextGroup;
            }
        }
        // Get current active fans of the required type
        const currentActiveFans = Object.keys(deviceStatusRecord).filter(key => deviceStatusRecord[key] === true && (0, groupUtils_1.getAllFanKeys)().includes(key)).sort(); // Sort for consistent comparison
        // Use consistent context key like the main rotation function
        const contextKey = `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_mode`;
        let rotationState = this.flowContext.get(contextKey);
        // Migration: Check for old context keys and migrate to new unified key
        if (!rotationState) {
            const oldContextKeys = [
                `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_${requiredGroupSize}`,
                `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_1`,
                `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_2`,
                `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_4`,
                `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_6`
            ];
            for (const oldKey of oldContextKeys) {
                const oldState = this.flowContext.get(oldKey);
                if (oldState && typeof oldState === 'object') {
                    this.logger.warn(`[STABLE] Migrating rotation state from old key ${oldKey} to ${contextKey}`);
                    rotationState = Object.assign(Object.assign({}, oldState), { requiredGroupSize: requiredGroupSize });
                    this.flowContext.set(contextKey, rotationState);
                    // Clear old key
                    this.flowContext.set(oldKey, null);
                    break;
                }
            }
        }
        // Check if the required group size has changed from the saved rotation state
        // This is the key fix for K1 → K2 transitions
        if (rotationState && rotationState.requiredGroupSize !== requiredGroupSize) {
            this.logger.warn(`[STABLE] Threshold group size changed from ${rotationState.requiredGroupSize} to ${requiredGroupSize}, forcing transition to new group size`);
            // Force immediate transition to new group size by using standard rotation logic
            return this.getRotationTargetGroup(fanGroups, requiredGroupSize, config);
        }
        // If we already have the correct number of fans active, check if we should rotate
        if (currentActiveFans.length === requiredGroupSize) {
            // Check if current fans match any of the valid groups
            const currentGroupIndex = fanGroups.findIndex(group => this.arraysEqual(currentActiveFans, group.sort()));
            if (currentGroupIndex >= 0) {
                // Current group is valid, sync rotation state with current reality
                if (!rotationState || typeof rotationState !== 'object') {
                    rotationState = {
                        currentGroupIndex: currentGroupIndex,
                        lastRotationTime: (0, timeUtils_1.getCurrentTimestamp)(),
                        activeGroup: [...currentActiveFans],
                        requiredGroupSize: requiredGroupSize
                    };
                    this.flowContext.set(contextKey, rotationState);
                    this.logger.debug(`Synced rotation state with current active fans: [${currentActiveFans.join(', ')}]`);
                }
                else {
                    // Update rotation state to match reality if different
                    if (!this.arraysEqual(((_a = rotationState.activeGroup) === null || _a === void 0 ? void 0 : _a.sort()) || [], currentActiveFans)) {
                        rotationState.currentGroupIndex = currentGroupIndex;
                        rotationState.activeGroup = [...currentActiveFans];
                        rotationState.requiredGroupSize = requiredGroupSize;
                        this.flowContext.set(contextKey, rotationState);
                        this.logger.debug(`Updated rotation state to match current active fans: [${currentActiveFans.join(', ')}]`);
                    }
                }
                // Check if it's time to rotate
                const rotationInterval = (0, timeUtils_1.minutesToMs)(config.set_time_alternate_fan || 15);
                if ((0, timeUtils_1.hasTimeElapsed)(rotationState.lastRotationTime, rotationInterval)) {
                    return this.getRotationTargetGroup(fanGroups, requiredGroupSize, config);
                }
                else {
                    // Not time to rotate yet, keep current group
                    return currentActiveFans;
                }
            }
        }
        // If we don't have the right number of fans or they don't match a valid group,
        // use the standard rotation logic
        return this.getRotationTargetGroup(fanGroups, requiredGroupSize, config);
    }
    /**
     * Helper method to compare arrays for equality
     */
    arraysEqual(a, b) {
        if (a.length !== b.length)
            return false;
        return a.every((val, index) => val === b[index]);
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
                this.logger.warn(reason);
                // Check if transition is needed
                if (this.requiresGroupTransition(previousGroup, rotationState.activeGroup)) {
                    this.initiateFanGroupTransition(previousGroup, rotationState.activeGroup, reason);
                    return []; // Transition will be handled in next cycle
                }
                else {
                    // No transition needed, create actions directly
                    const coilMapping = this.getCoilMapping();
                    return (0, groupUtils_1.createFanGroupActions)(rotationState.activeGroup, true, reason, coilMapping);
                }
            }
            // No rotation needed, maintain current group
            const coilMapping = this.getCoilMapping();
            return (0, groupUtils_1.createFanGroupActions)(rotationState.activeGroup, true, `Rotation mode: maintaining group ${rotationState.currentGroupIndex + 1}/${fanGroups.length}`, coilMapping);
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
        var _a;
        try {
            const temperature = sensorData.temp_indoor;
            const humidity = sensorData.humi_indoor;
            if (temperature === undefined || humidity === undefined ||
                typeof temperature !== 'number' || typeof humidity !== 'number' ||
                isNaN(temperature) || isNaN(humidity)) {
                this.logger.warn("Missing or invalid temperature or humidity data for threshold mode");
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
            // Get current active fan count for hysteresis calculation
            const currentActiveFanCount = this.getCurrentActiveFanCount(deviceStatus);
            // Determine required group size with hysteresis to prevent oscillation
            const requiredGroupSize = (0, groupUtils_1.getRecommendedGroupSize)(temperature, humidity, thresholds, {
                currentGroupSize: currentActiveFanCount,
                hysteresis: constants_1.CONTROL_CONFIG.THRESHOLD_HYSTERESIS_CELSIUS
            });
            this.logger.debug(`Threshold mode with transition: temp=${temperature}°C, humidity=${humidity}%, current fans=${currentActiveFanCount}, required group size=${requiredGroupSize}`);
            if (requiredGroupSize === 0) {
                // No fans needed - turn off all fans
                return (0, groupUtils_1.createOptimizedFanGroupActions)([], false, reason, coilMapping, deviceStatusRecord);
            }
            // Get appropriate fan groups and target group
            const fanGroups = this.getFanGroups(requiredGroupSize);
            if (fanGroups.length === 0) {
                this.logger.warn(`No fan groups available for size ${requiredGroupSize}`);
                return [];
            }
            let targetGroup;
            if (requiredGroupSize === 6) {
                // K3 or K4: Use all 6 fans (no rotation needed)
                targetGroup = (0, groupUtils_1.getAllFanKeys)();
                this.logger.debug(`K3/K4 threshold with transition: using all fans [${targetGroup.join(', ')}]`);
            }
            else if (requiredGroupSize === 4) {
                // K2: Use rotation logic for 4-fan groups
                targetGroup = this.getStableRotationTargetGroup(fanGroups, requiredGroupSize, config, deviceStatusRecord);
                this.logger.debug(`K2 threshold with transition: using 4-fan group [${targetGroup.join(', ')}]`);
            }
            else if (requiredGroupSize === 2) {
                // K1: Use rotation logic for 2-fan groups
                targetGroup = this.getStableRotationTargetGroup(fanGroups, requiredGroupSize, config, deviceStatusRecord);
                this.logger.debug(`K1 threshold with transition: using 2-fan group [${targetGroup.join(', ')}]`);
            }
            else if (requiredGroupSize === 1) {
                // Single fan mode: Use rotation logic for 1-fan groups
                targetGroup = this.getStableRotationTargetGroup(fanGroups, requiredGroupSize, config, deviceStatusRecord);
                this.logger.debug(`Single fan with transition: using 1-fan group [${targetGroup.join(', ')}]`);
            }
            else {
                // Fallback: use rotation logic for any other group size
                targetGroup = this.getStableRotationTargetGroup(fanGroups, requiredGroupSize, config, deviceStatusRecord);
                this.logger.debug(`Custom group size ${requiredGroupSize} with transition: using group [${targetGroup.join(', ')}]`);
            }
            // Get current active fans
            const currentActiveFans = Object.keys(deviceStatusRecord).filter(key => deviceStatusRecord[key] === true && (0, groupUtils_1.getAllFanKeys)().includes(key));
            // Add comprehensive logging for threshold mode transitions
            this.logger.warn(`🔄 Threshold Analysis: temp=${temperature}°C, required=${requiredGroupSize} fans, current=[${currentActiveFans.join(',')}], target=[${targetGroup.join(',')}]`);
            // Log rotation state for debugging
            const contextKey = `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_mode`;
            const rotationState = this.flowContext.get(contextKey);
            if (rotationState) {
                this.logger.warn(`📊 Rotation State: savedGroupSize=${rotationState.requiredGroupSize}, currentGroupIndex=${rotationState.currentGroupIndex}, activeGroup=[${((_a = rotationState.activeGroup) === null || _a === void 0 ? void 0 : _a.join(',')) || 'none'}]`);
            }
            else {
                this.logger.warn(`📊 Rotation State: No saved state found`);
            }
            // Check if transition is needed with improved logic
            if (this.requiresStableGroupTransition(currentActiveFans, targetGroup, requiredGroupSize, config)) {
                this.logger.warn(`🚀 Initiating transition: [${currentActiveFans.join(',')}] → [${targetGroup.join(',')}] (${reason})`);
                this.initiateFanGroupTransition(currentActiveFans, targetGroup, reason);
                return []; // Transition will be handled in next cycle
            }
            else {
                this.logger.debug(`✅ No transition needed: maintaining current state`);
                // No transition needed, create actions directly using non-optimized function for consistency
                return (0, groupUtils_1.createFanGroupActions)(targetGroup, true, reason, coilMapping);
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
        const delaySeconds = config.set_fan_group_transition_delay !== undefined ?
            config.set_fan_group_transition_delay :
            (constants_1.CONTROL_CONFIG.FAN_GROUP_TRANSITION_DELAY_MS / 1000);
        return delaySeconds * 1000;
    }
    /**
     * Get fan group off delay configuration
     */
    getFanGroupOffDelayMs(config) {
        const delaySeconds = config.set_fan_group_off_delay !== undefined ?
            config.set_fan_group_off_delay :
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
     * Check if fan group transition is needed with stability logic
     * This prevents unnecessary transitions when the fan count requirement is already met
     */
    requiresStableGroupTransition(currentGroup, newGroup, requiredGroupSize, config) {
        // If we're already in a transition, don't start another one
        if (this.isTransitionInProgress()) {
            return false;
        }
        // Check if we have a recent transition completion (cooldown period)
        const lastTransitionKey = `${constants_1.CONTEXT_KEYS.FAN_GROUP_TRANSITION_STATE}_last_completion`;
        const lastTransitionTime = this.flowContext.get(lastTransitionKey) || 0;
        const cooldownMs = 3000; // 3 second cooldown after transition completion
        if ((0, timeUtils_1.hasTimeElapsed)(lastTransitionTime, cooldownMs) === false) {
            this.logger.debug(`Transition cooldown active, skipping new transition (${cooldownMs - ((0, timeUtils_1.getCurrentTimestamp)() - lastTransitionTime)}ms remaining)`);
            return false;
        }
        // Check if the required group size has changed (e.g., K1 → K2 threshold change)
        // This is critical for proper threshold mode transitions
        const contextKey = `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_mode`;
        const rotationState = this.flowContext.get(contextKey);
        if (rotationState && typeof rotationState === 'object' && rotationState.requiredGroupSize !== requiredGroupSize) {
            this.logger.warn(`[TRANSITION] Threshold group size changed from ${rotationState.requiredGroupSize} to ${requiredGroupSize}, transition required`);
            return true; // Force transition when group size requirement changes
        }
        // If current group size matches required size and fans are valid, no transition needed
        if (currentGroup.length === requiredGroupSize && currentGroup.length > 0) {
            // Check if all current fans are valid fan keys
            const allValidFans = currentGroup.every(fan => (0, groupUtils_1.getAllFanKeys)().includes(fan));
            if (allValidFans) {
                // Only transition if the new group is significantly different
                // For same-size groups, only transition if it's a planned rotation
                const isDifferentGroup = !this.arraysEqual(currentGroup.sort(), newGroup.sort());
                if (!isDifferentGroup) {
                    return false; // Same group, no transition needed
                }
                // For different groups of same size, check if this is a planned rotation
                // by verifying the rotation interval has elapsed
                // Use config parameter if available, otherwise read from global config
                const configuredInterval = (config === null || config === void 0 ? void 0 : config.set_time_alternate_fan) ||
                    (this.globalContext.get(constants_1.CONTEXT_KEYS.GLOBAL_CONFIG_VALUES) || {}).set_time_alternate_fan || 15;
                const rotationInterval = (0, timeUtils_1.minutesToMs)(configuredInterval);
                if (rotationState && typeof rotationState === 'object') {
                    const timeSinceLastRotation = (0, timeUtils_1.getCurrentTimestamp)() - (rotationState.lastRotationTime || 0);
                    if (timeSinceLastRotation < rotationInterval * 0.9) { // 90% of interval to prevent premature rotation
                        this.logger.debug(`Rotation interval not met, skipping transition (${Math.round(timeSinceLastRotation / 1000)}s < ${Math.round(rotationInterval * 0.9 / 1000)}s) - configured: ${configuredInterval}min`);
                        return false;
                    }
                }
            }
        }
        // Use the standard transition check for other cases
        return this.requiresGroupTransition(currentGroup, newGroup);
    }
    /**
     * Initiate fan group transition with delay
     */
    initiateFanGroupTransition(previousGroup, nextGroup, reason) {
        const transitionState = {
            isTransitioning: true,
            phase: types_1.TransitionPhase.OFF,
            previousGroup: [...previousGroup],
            nextGroup: [...nextGroup],
            transitionStartTime: (0, timeUtils_1.getCurrentTimestamp)(),
            offDelayStartTime: 0,
            reason: reason,
            retryCount: 0,
            maxRetries: 3
        };
        this.saveFanGroupTransitionState(transitionState);
        this.logger.warn(`Initiated fan group transition: [${previousGroup.join(', ')}] → [${nextGroup.join(', ')}] - ${reason}`);
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
            case types_1.TransitionPhase.OFF:
                // Turn off ALL fans to ensure clean slate for transition
                // This prevents accumulation of active fans from previous transitions
                const offActions = this.createTurnOffAllFansActions(`Transition phase 1: Turn off all fans for clean transition - ${transitionState.reason}`);
                actions.push(...offActions);
                // Move to delay phase
                transitionState.phase = types_1.TransitionPhase.DELAY;
                transitionState.offDelayStartTime = now;
                this.saveFanGroupTransitionState(transitionState);
                this.logger.warn(`Fan transition: All fans turned off, starting delay phase`);
                break;
            case types_1.TransitionPhase.DELAY:
                // Check if delay period has elapsed
                const offDelayMs = this.getFanGroupOffDelayMs(config);
                if ((0, timeUtils_1.hasTimeElapsed)(transitionState.offDelayStartTime, offDelayMs)) {
                    // Move to on phase
                    transitionState.phase = types_1.TransitionPhase.ON;
                    this.saveFanGroupTransitionState(transitionState);
                    this.logger.warn(`Fan transition: Delay completed (${offDelayMs}ms), turning on new group`);
                }
                else {
                    // Still in delay, no actions
                    const remaining = offDelayMs - (now - transitionState.offDelayStartTime);
                    this.logger.debug(`Fan transition: Delay in progress, ${remaining}ms remaining`);
                }
                break;
            case types_1.TransitionPhase.ON:
                // Turn on new group using non-optimized function to ensure proper fan control
                // This ensures that only the target group is on and all others are explicitly off
                if (transitionState.nextGroup.length > 0) {
                    const onActions = (0, groupUtils_1.createFanGroupActions)(transitionState.nextGroup, true, `Transition phase 2: Turn on new group - ${transitionState.reason}`, coilMapping);
                    actions.push(...onActions);
                }
                else {
                    // If no target group, ensure all fans are off
                    const offActions = this.createTurnOffAllFansActions(`Transition phase 2: No target group, turn off all fans - ${transitionState.reason}`);
                    actions.push(...offActions);
                }
                // Move to complete phase
                transitionState.phase = types_1.TransitionPhase.COMPLETE;
                this.saveFanGroupTransitionState(transitionState);
                this.logger.warn(`Fan transition: New group activated, transition completing`);
                break;
            case types_1.TransitionPhase.COMPLETE:
                // Check if overall transition delay has elapsed
                const transitionDelayMs = this.getFanGroupTransitionDelayMs(config);
                if ((0, timeUtils_1.hasTimeElapsed)(transitionState.transitionStartTime, transitionDelayMs)) {
                    // Transition complete, clear state and set cooldown timestamp
                    this.clearFanGroupTransitionState();
                    // Set last completion time for cooldown logic
                    const lastTransitionKey = `${constants_1.CONTEXT_KEYS.FAN_GROUP_TRANSITION_STATE}_last_completion`;
                    this.flowContext.set(lastTransitionKey, (0, timeUtils_1.getCurrentTimestamp)());
                    this.logger.warn(`Fan group transition completed successfully`);
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
    /**
 * Debug helper to log rotation state information
 */
    logRotationState(context) {
        var _a;
        const contextKey = `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_mode`;
        const rotationState = this.flowContext.get(contextKey);
        if (rotationState) {
            this.logger.debug(`[${context}] Rotation state: group ${rotationState.currentGroupIndex + 1}, active=[${((_a = rotationState.activeGroup) === null || _a === void 0 ? void 0 : _a.join(',')) || 'none'}], size=${rotationState.requiredGroupSize}`);
        }
        else {
            this.logger.debug(`[${context}] No rotation state found`);
        }
    }
    /**
     * Force clear all old context keys and reset rotation state
     * This can be called manually to fix stuck rotation states
     */
    clearAllRotationStates() {
        const allOldKeys = [
            `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_1`,
            `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_2`,
            `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_4`,
            `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_6`,
            `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_mode`
        ];
        this.logger.warn(`🧹 Clearing all rotation states: ${allOldKeys.join(', ')}`);
        allOldKeys.forEach(key => {
            this.flowContext.set(key, null);
        });
        this.logger.warn("All rotation states cleared. Next execution will reinitialize state.");
    }
}
exports.FanControlService = FanControlService;
