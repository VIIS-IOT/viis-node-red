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
            // Create actions for current active group with delay for smooth operation
            const coilMapping = this.getCoilMapping();
            const currentDeviceStatus = this.getCurrentDeviceStatus();
            return (0, groupUtils_1.createDelayedFanGroupActions)(rotationState.activeGroup, true, `Rotation mode: group ${rotationState.currentGroupIndex + 1} with 1s delay`, coilMapping, currentDeviceStatus, 1000 // 1 second delay
            );
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
            // For threshold mode, we need to allow rotation even if the fan count matches
            // This is the key difference from the original logic that was causing the rotation bug
            // We should only skip if we're in the exact same group AND it's not time to rotate
            if (currentActiveFanCount === requiredGroupSize && requiredGroupSize > 0) {
                // Check if we need to rotate within the same group size
                const fanGroups = this.getFanGroups(requiredGroupSize);
                if (fanGroups.length > 1) {
                    // Multiple groups available for this size - check if rotation is needed
                    const contextKey = `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold`;
                    let rotationState = this.flowContext.get(contextKey);
                    const legacyContextKey = `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_mode`;
                    // Backward compatibility: migrate legacy key if present
                    if (!rotationState) {
                        const legacyState = this.flowContext.get(legacyContextKey);
                        if (legacyState) {
                            rotationState = legacyState;
                            this.flowContext.set(contextKey, legacyState);
                            this.flowContext.set(legacyContextKey, null);
                        }
                    }
                    const rotationInterval = (0, timeUtils_1.minutesToMs)(config.set_time_alternate_fan || 15);
                    if (rotationState && (0, timeUtils_1.hasTimeElapsed)(rotationState.lastRotationTime, rotationInterval)) {
                        this.logger.debug(`Fan count matches but rotation is due: proceeding with rotation logic`);
                        // Continue with rotation logic below
                    }
                    else {
                        this.logger.debug(`No change needed: current fan count (${currentActiveFanCount}) matches required (${requiredGroupSize}) and no rotation due`);
                        return []; // No action needed - already in correct state and no rotation due
                    }
                }
                else {
                    this.logger.debug(`No change needed: current fan count (${currentActiveFanCount}) matches required (${requiredGroupSize}) and only one group available`);
                    return []; // No action needed - only one group available for this size
                }
            }
            if (requiredGroupSize === 0) {
                // No fans needed - use delayed turn off for smooth operation
                const reason = `Temperature below K1 threshold with hysteresis: ${tempIndoor}°C, humidity=${humiIndoor}%`;
                if (deviceStatus) {
                    const coilMapping = this.getCoilMapping();
                    const deviceStatusRecord = this.convertDeviceStatusToRecord(deviceStatus);
                    return (0, groupUtils_1.createDelayedFanGroupActions)([], false, reason, coilMapping, deviceStatusRecord, 1000);
                }
                return this.createTurnOffAllFansActionsWithDelay(reason);
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
                this.logger.debug(`K3/K4 threshold: using all 6 fans [${targetGroup.join(', ')}]`);
            }
            else if (requiredGroupSize === 5) {
                // Backward-compatibility path: use rotation for 5-fan group configurations
                targetGroup = this.getRotationTargetGroup(fanGroups, requiredGroupSize, config);
                this.logger.debug(`Compatibility threshold: using 5-fan group [${targetGroup.join(', ')}]`);
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
     * Modes: 1 = Synchronization (all 3 together), 2 = Scrolling (sequential Q1→Q2→Q3)
     */
    async processFanDaoControl(config) {
        try {
            // Check if fan dao control is enabled
            if (config.set_mode_fan_dao !== 1) {
                this.logger.debug("Fan dao control is disabled");
                return [];
            }
            const autoMode = config.set_auto_mode_fan_dao || 1; // Default: Synchronization
            const timeOn = (0, timeUtils_1.minutesToMs)(config.set_time_fan_dao_on || 5);
            const timeOff = (0, timeUtils_1.minutesToMs)(config.set_time_fan_dao_off || 30);
            if (autoMode === 1) {
                return this.processFanDaoSynchronization(timeOn, timeOff);
            }
            else if (autoMode === 2) {
                return this.processFanDaoScrolling(timeOn, timeOff);
            }
            return [];
        }
        catch (error) {
            this.logger.error(`Fan dao control processing error: ${error.message}`);
            return [];
        }
    }
    /**
     * Fan Dao Synchronization mode: all 3 fans ON together for T_on, OFF together for T_off
     */
    async processFanDaoSynchronization(timeOnMs, timeOffMs) {
        const stateKey = `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_dao_sync`;
        let state = this.flowContext.get(stateKey);
        if (!state || typeof state !== 'object') {
            state = { isOn: false, lastToggleTime: 0 };
            this.flowContext.set(stateKey, state);
        }
        const now = (0, timeUtils_1.getCurrentTimestamp)();
        const elapsed = now - state.lastToggleTime;
        const currentInterval = state.isOn ? timeOnMs : timeOffMs;
        if (elapsed >= currentInterval) {
            const newState = !state.isOn;
            this.flowContext.set(stateKey, { isOn: newState, lastToggleTime: now });
            this.logger.warn(`Fan dao sync: switching to ${newState ? 'ON' : 'OFF'} (T_${newState ? 'on' : 'off'}=${Math.round((newState ? timeOnMs : timeOffMs) / 60000)}min)`);
            const coilMapping = this.getCoilMapping();
            return (0, groupUtils_1.createFanDaoActions)(newState, `Fan dao sync: ${newState ? 'ON' : 'OFF'}`, coilMapping);
        }
        return [];
    }
    /**
     * Fan Dao Scrolling mode: sequential Q1→Q2→Q3, each runs T_on then rests T_off.
     * When current fan finishes T_on, find next fan that has rested enough (T_off).
     * If no fan is available, there's a gap (no fan runs) until next cycle.
     *
     * With 3 fixed fans: if T_off <= 2×T_on → always 1 fan running.
     * If T_off > 2×T_on → gaps where no fan runs (intentional for plant health).
     */
    async processFanDaoScrolling(timeOnMs, timeOffMs) {
        const stateKey = `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_dao_scroll`;
        let state = this.flowContext.get(stateKey);
        const fanDaoKeys = ["quat_dao_1", "quat_dao_2", "quat_dao_3"];
        const fanCount = fanDaoKeys.length;
        // Initialize state on first run
        if (!state || typeof state !== 'object' || !Array.isArray(state.lastStopTime)) {
            const now = (0, timeUtils_1.getCurrentTimestamp)();
            state = {
                currentIndex: 0,
                lastStopTime: new Array(fanCount).fill(0), // 0 = never ran → available immediately
                activeFanSince: now, // when current fan started
                isRunning: false // no fan running yet on first cycle
            };
            this.flowContext.set(stateKey, state);
        }
        const now = (0, timeUtils_1.getCurrentTimestamp)();
        const coilMapping = this.getCoilMapping();
        // First cycle: start the first fan immediately
        if (!state.isRunning) {
            const firstFanKey = fanDaoKeys[0];
            const address = coilMapping[firstFanKey];
            state.isRunning = true;
            state.currentIndex = 0;
            state.activeFanSince = now;
            this.flowContext.set(stateKey, state);
            if (address !== undefined) {
                this.logger.warn(`Fan dao scroll: ${firstFanKey} ON (first run, fan 1/${fanCount})`);
                return [{
                        deviceKey: firstFanKey,
                        value: true,
                        address: address,
                        fc: constants_1.MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,
                        reason: `Fan dao scroll: ${firstFanKey} starting T_on (first run)`
                    }];
            }
            return [];
        }
        // Check if current fan has finished T_on
        const elapsed = now - state.activeFanSince;
        if (elapsed < timeOnMs) {
            return []; // Current fan still running
        }
        // Current fan finished T_on → turn it OFF
        const actions = [];
        const currentFanKey = fanDaoKeys[state.currentIndex];
        const currentAddress = coilMapping[currentFanKey];
        if (currentAddress !== undefined) {
            actions.push({
                deviceKey: currentFanKey,
                value: false,
                address: currentAddress,
                fc: constants_1.MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,
                reason: `Fan dao scroll: ${currentFanKey} finished T_on, turning OFF`
            });
        }
        // Record stop time for current fan
        state.lastStopTime[state.currentIndex] = now;
        // Find next fan that has rested enough (lastStopTime + T_off <= now)
        let nextIndex = -1;
        for (let i = 1; i <= fanCount; i++) {
            const candidateIndex = (state.currentIndex + i) % fanCount;
            const candidateLastStop = state.lastStopTime[candidateIndex];
            const candidateRestTime = now - candidateLastStop;
            if (candidateRestTime >= timeOffMs) {
                nextIndex = candidateIndex;
                break;
            }
        }
        if (nextIndex === -1) {
            // No fan available → gap (no fan runs)
            state.isRunning = false;
            this.flowContext.set(stateKey, state);
            this.logger.warn(`Fan dao scroll: ${currentFanKey} OFF, no fan available (all resting). Gap until next cycle.`);
            return actions;
        }
        // Turn off all other fans (safety), then turn on next fan
        fanDaoKeys.forEach((fanKey, idx) => {
            if (idx !== nextIndex) {
                const addr = coilMapping[fanKey];
                if (addr !== undefined) {
                    actions.push({
                        deviceKey: fanKey,
                        value: false,
                        address: addr,
                        fc: constants_1.MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,
                        reason: `Fan dao scroll: turn off ${fanKey}`
                    });
                }
            }
        });
        const nextFanKey = fanDaoKeys[nextIndex];
        const nextAddress = coilMapping[nextFanKey];
        if (nextAddress !== undefined) {
            actions.push({
                deviceKey: nextFanKey,
                value: true,
                address: nextAddress,
                fc: constants_1.MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,
                reason: `Fan dao scroll: ${nextFanKey} starting T_on`
            });
        }
        // Update state
        state.currentIndex = nextIndex;
        state.activeFanSince = now;
        state.isRunning = true;
        this.flowContext.set(stateKey, state);
        this.logger.warn(`Fan dao scroll: ${currentFanKey} OFF → ${nextFanKey} ON (fan ${nextIndex + 1}/${fanCount})`);
        return actions;
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
        const fanKeys = (0, groupUtils_1.getAllFanKeys)();
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
     * Create actions to turn off all fans with delay
     */
    createTurnOffAllFansActionsWithDelay(reason, delayMs = 1000) {
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
                    reason: reason,
                    delay: delayMs
                });
            }
        });
        return actions;
    }
    /**
     * Get rotation target group for threshold mode - simplified and consistent with pure rotation
     * This method uses the same rotation logic as pure rotation mode but handles threshold-specific requirements
     */
    getRotationTargetGroup(fanGroups, requiredGroupSize, config) {
        var _a;
        // Use same rotation interval as pure rotation mode
        const rotationInterval = (0, timeUtils_1.minutesToMs)(config.set_time_alternate_fan || 15);
        // Use simplified context key for threshold mode rotation
        const contextKey = `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold`;
        let rotationState = this.flowContext.get(contextKey);
        // Clean up old context keys to prevent confusion
        this.cleanupOldThresholdRotationKeys();
        // Initialize rotation state if not exists or invalid (same as pure rotation)
        if (!rotationState || typeof rotationState !== 'object' || !Array.isArray(rotationState.activeGroup)) {
            rotationState = {
                currentGroupIndex: 0,
                lastRotationTime: (0, timeUtils_1.getCurrentTimestamp)(),
                activeGroup: fanGroups[0] || [],
                requiredGroupSize: requiredGroupSize
            };
            this.flowContext.set(contextKey, rotationState);
            this.logger.warn(`🔧 Initialized threshold rotation state for group size ${requiredGroupSize}: [${rotationState.activeGroup.join(', ')}]`);
        }
        // Handle threshold level changes (K1↔K2↔K3↔K4) - this is critical for correct behavior
        if (rotationState.requiredGroupSize !== requiredGroupSize) {
            this.logger.warn(`🔄 Threshold level change detected: ${rotationState.requiredGroupSize} → ${requiredGroupSize} fans`);
            // When threshold changes, we need to:
            // 1. Switch to appropriate fan groups for new size
            // 2. Preserve rotation timing to maintain schedule consistency
            // 3. Reset to first group of new size for predictable behavior
            rotationState = {
                currentGroupIndex: 0, // Start from first group of new size
                lastRotationTime: rotationState.lastRotationTime, // Preserve timing
                activeGroup: fanGroups[0] || [],
                requiredGroupSize: requiredGroupSize
            };
            this.flowContext.set(contextKey, rotationState);
            this.logger.warn(`✅ Updated to new threshold level: group 1/${fanGroups.length} [${rotationState.activeGroup.join(', ')}]`);
        }
        // Check if it's time to rotate (identical logic to pure rotation mode)
        const shouldRotate = (0, timeUtils_1.hasTimeElapsed)(rotationState.lastRotationTime, rotationInterval);
        const timeSinceLastRotation = (0, timeUtils_1.getCurrentTimestamp)() - rotationState.lastRotationTime;
        this.logger.debug(`Threshold rotation timing: ${Math.round(timeSinceLastRotation / 1000)}s elapsed, ${Math.round(rotationInterval / 1000)}s interval, rotate=${shouldRotate}`);
        if (shouldRotate) {
            const previousGroup = [...rotationState.activeGroup];
            // Move to next group (identical logic to pure rotation mode)
            rotationState.currentGroupIndex = (0, groupUtils_1.getNextGroupIndex)(rotationState.currentGroupIndex, fanGroups.length);
            rotationState.lastRotationTime = (0, timeUtils_1.getCurrentTimestamp)();
            rotationState.activeGroup = fanGroups[rotationState.currentGroupIndex];
            // Save updated state
            this.flowContext.set(contextKey, rotationState);
            this.logger.warn(`🔄 Threshold rotation: [${previousGroup.join(',')}] → [${rotationState.activeGroup.join(',')}] (${requiredGroupSize} fans)`);
            this.logger.warn(`📊 Group ${rotationState.currentGroupIndex + 1}/${fanGroups.length}, interval: ${config.set_time_alternate_fan || 15}min`);
        }
        else {
            this.logger.debug(`⏳ Threshold rotation: maintaining group [${rotationState.activeGroup.join(',')}]`);
        }
        // Validate and fix any inconsistencies
        if (!rotationState.activeGroup || rotationState.activeGroup.length !== requiredGroupSize) {
            this.logger.warn(`🔧 Fixing invalid group size: expected ${requiredGroupSize}, got ${((_a = rotationState.activeGroup) === null || _a === void 0 ? void 0 : _a.length) || 0}`);
            rotationState.activeGroup = fanGroups[rotationState.currentGroupIndex] || fanGroups[0] || [];
            this.flowContext.set(contextKey, rotationState);
        }
        if (rotationState.currentGroupIndex >= fanGroups.length) {
            this.logger.warn(`🔧 Fixing invalid group index: ${rotationState.currentGroupIndex} >= ${fanGroups.length}`);
            rotationState.currentGroupIndex = 0;
            rotationState.activeGroup = fanGroups[0] || [];
            this.flowContext.set(contextKey, rotationState);
        }
        return rotationState.activeGroup || fanGroups[0] || [];
    }
    /**
     * Clean up old threshold rotation context keys to prevent state confusion
     */
    cleanupOldThresholdRotationKeys() {
        const oldKeys = [
            `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_mode`,
            `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_1`,
            `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_2`,
            `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_4`,
            `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_5`,
            `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_6`
        ];
        let cleanedCount = 0;
        oldKeys.forEach(key => {
            if (this.flowContext.get(key)) {
                this.flowContext.set(key, null);
                cleanedCount++;
            }
        });
        if (cleanedCount > 0) {
            this.logger.debug(`🧹 Cleaned up ${cleanedCount} old threshold rotation keys`);
        }
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
                this.logger.debug(`K3/K4 threshold: using all fans [${targetGroup.join(', ')}]`);
            }
            else {
                // K1, K2, or other sizes: Use simplified rotation logic
                targetGroup = this.getRotationTargetGroup(fanGroups, requiredGroupSize, config);
                this.logger.debug(`Threshold (${requiredGroupSize} fans): using group [${targetGroup.join(', ')}]`);
            }
            // Get current active fans
            const currentActiveFans = Object.keys(deviceStatusRecord).filter(key => deviceStatusRecord[key] === true && (0, groupUtils_1.getAllFanKeys)().includes(key));
            // Add comprehensive logging for threshold mode transitions
            this.logger.warn(`🔄 Threshold Analysis: temp=${temperature}°C, required=${requiredGroupSize} fans, current=[${currentActiveFans.join(',')}], target=[${targetGroup.join(',')}]`);
            // Log rotation state for debugging and check for threshold level changes
            const contextKey = `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold`;
            const rotationState = this.flowContext.get(contextKey);
            if (rotationState) {
                this.logger.warn(`📊 Rotation State: savedGroupSize=${rotationState.requiredGroupSize}, currentGroupIndex=${rotationState.currentGroupIndex}, activeGroup=[${((_a = rotationState.activeGroup) === null || _a === void 0 ? void 0 : _a.join(',')) || 'none'}]`);
            }
            else {
                this.logger.warn(`📊 Rotation State: No saved state found`);
            }
            // Check if this is a threshold level change (K1↔K2↔K3↔K4) that requires special handling.
            // IMPORTANT: Do not trigger OFF/ON transition loop for K3/K4 (6-fan mode).
            // In 6-fan mode we apply delayed direct control instead of transition.
            const isThresholdLevelChange = rotationState &&
                rotationState.requiredGroupSize !== requiredGroupSize &&
                requiredGroupSize !== 6;
            if (isThresholdLevelChange) {
                // Threshold level changed - use transition for smooth change
                this.logger.warn(`🔄 Threshold level change: ${rotationState.requiredGroupSize} → ${requiredGroupSize} fans, using transition`);
                this.initiateFanGroupTransition(currentActiveFans, targetGroup, reason);
                return []; // Transition will be handled in next cycle
            }
            else {
                // Normal rotation within same threshold level - use delayed control for smooth operation
                this.logger.debug(`✅ Normal rotation: delayed control [${targetGroup.join(',')}] with 1s delay`);
                return (0, groupUtils_1.createDelayedFanGroupActions)(targetGroup, true, reason, coilMapping, deviceStatusRecord, 1000);
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
        const contextKey = `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold`;
        const rotationState = this.flowContext.get(contextKey);
        if (rotationState && typeof rotationState === 'object' && rotationState.requiredGroupSize !== requiredGroupSize) {
            this.logger.warn(`[TRANSITION] Threshold group size changed from ${rotationState.requiredGroupSize} to ${requiredGroupSize}, transition required`);
            return true; // Force transition when group size requirement changes
        }
        // Always allow transitions if the target group is different (this fixes the threshold mode bug)
        const isDifferentGroup = !this.arraysEqual(currentGroup.sort(), newGroup.sort());
        if (isDifferentGroup) {
            this.logger.debug(`Different target group detected: [${currentGroup.join(',')}] → [${newGroup.join(',')}], allowing transition`);
            return true;
        }
        // Same group, no transition needed
        return false;
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
        const contextKey = `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold`;
        const rotationState = this.flowContext.get(contextKey);
        if (rotationState) {
            this.logger.debug(`[${context}] Rotation state: group ${rotationState.currentGroupIndex + 1}, active=[${((_a = rotationState.activeGroup) === null || _a === void 0 ? void 0 : _a.join(',')) || 'none'}], size=${rotationState.requiredGroupSize}`);
        }
        else {
            this.logger.debug(`[${context}] No rotation state found`);
        }
    }
    /**
     * Force clear all rotation states - useful for debugging
     */
    clearAllRotationStates() {
        const allKeys = [
            `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold`,
            `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_mode`,
            `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_1`,
            `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_2`,
            `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_4`,
            `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_6`
        ];
        this.logger.warn(`🧹 Clearing all rotation states: ${allKeys.join(', ')}`);
        allKeys.forEach(key => {
            this.flowContext.set(key, null);
        });
        this.logger.warn("All rotation states cleared. Next execution will reinitialize state.");
    }
}
exports.FanControlService = FanControlService;
