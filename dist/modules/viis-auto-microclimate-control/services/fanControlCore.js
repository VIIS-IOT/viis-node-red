"use strict";
/**
 * Fan Control Core Logic
 * Contains pure fan control logic without state management dependencies
 * Used by both StateMachine and EnhancedService to avoid circular dependencies
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FanControlCore = void 0;
const groupUtils_1 = require("../utils/groupUtils");
const timeUtils_1 = require("../utils/timeUtils");
const constants_1 = require("../constants");
class FanControlCore {
    /**
     * Execute rotation mode logic
     */
    static executeRotationMode(context) {
        const { config, currentRotationState, coilMapping, logger } = context;
        const groupSize = config.set_gr_alternate_fan || 2;
        const rotationInterval = (0, timeUtils_1.minutesToMs)(config.set_time_alternate_fan || 15);
        // Get fan groups
        const fanGroups = (0, groupUtils_1.getFanGroups)(groupSize);
        if (fanGroups.length === 0) {
            logger.warn("No fan groups available for rotation");
            return {
                actions: [],
                newRotationState: null,
                requiresTransition: false
            };
        }
        // Initialize rotation state if needed
        let rotationState = currentRotationState;
        if (!rotationState.activeGroup || rotationState.activeGroup.length === 0) {
            rotationState = {
                currentGroupIndex: 0,
                lastRotationTime: (0, timeUtils_1.getCurrentTimestamp)(),
                activeGroup: fanGroups[0]
            };
        }
        // Check if rotation is needed
        if ((0, timeUtils_1.hasTimeElapsed)(rotationState.lastRotationTime, rotationInterval)) {
            const previousGroup = [...rotationState.activeGroup];
            const nextGroupIndex = (0, groupUtils_1.getNextGroupIndex)(rotationState.currentGroupIndex, fanGroups.length);
            const nextGroup = fanGroups[nextGroupIndex];
            const newRotationState = {
                currentGroupIndex: nextGroupIndex,
                lastRotationTime: (0, timeUtils_1.getCurrentTimestamp)(),
                activeGroup: nextGroup
            };
            const reason = `Fan rotation: switching to group ${nextGroupIndex + 1}/${fanGroups.length} (${nextGroup.join(', ')})`;
            logger.warn(reason);
            // Check if transition is needed
            const requiresTransition = this.requiresGroupTransition(previousGroup, nextGroup);
            if (requiresTransition) {
                return {
                    actions: [],
                    newRotationState,
                    requiresTransition: true,
                    transitionInfo: {
                        previousGroup,
                        nextGroup,
                        reason
                    }
                };
            }
            else {
                // Direct switch
                const actions = (0, groupUtils_1.createFanGroupActions)(nextGroup, true, reason, coilMapping);
                return {
                    actions,
                    newRotationState,
                    requiresTransition: false
                };
            }
        }
        // No rotation needed, maintain current group
        const reason = `Rotation mode: maintaining group ${rotationState.currentGroupIndex + 1}/${fanGroups.length}`;
        const actions = (0, groupUtils_1.createFanGroupActions)(rotationState.activeGroup, true, reason, coilMapping);
        return {
            actions,
            newRotationState: null, // No change needed
            requiresTransition: false
        };
    }
    /**
     * Execute threshold mode logic
     */
    static executeThresholdMode(context) {
        const { config, sensorData, deviceStatus, coilMapping, logger } = context;
        const tempIndoor = sensorData.temp_indoor;
        const humiIndoor = sensorData.humi_indoor;
        if (tempIndoor === undefined || humiIndoor === undefined) {
            logger.warn("Missing temperature or humidity data for threshold mode");
            return {
                actions: [],
                targetGroup: [],
                requiredGroupSize: 0,
                requiresTransition: false,
                reason: "Missing sensor data"
            };
        }
        // Get temperature thresholds
        const thresholds = {
            k1: config.set_k1_fan || constants_1.FAN_CONFIG.DEFAULT_TEMPERATURE_THRESHOLDS.K1,
            k2: config.set_k2_fan || constants_1.FAN_CONFIG.DEFAULT_TEMPERATURE_THRESHOLDS.K2,
            k3: config.set_k3_fan || constants_1.FAN_CONFIG.DEFAULT_TEMPERATURE_THRESHOLDS.K3,
            k4: config.set_k4_fan || constants_1.FAN_CONFIG.DEFAULT_TEMPERATURE_THRESHOLDS.K4
        };
        // Determine required group size
        const requiredGroupSize = (0, groupUtils_1.getRecommendedGroupSize)(tempIndoor, humiIndoor, thresholds);
        const reason = this.getThresholdReason(tempIndoor, humiIndoor, thresholds);
        logger.debug(`Threshold mode: temp=${tempIndoor}°C, humidity=${humiIndoor}%, required group size=${requiredGroupSize}`);
        if (requiredGroupSize === 0) {
            // No fans needed
            const deviceStatusRecord = this.convertDeviceStatusToRecord(deviceStatus);
            const actions = (0, groupUtils_1.createOptimizedFanGroupActions)([], false, reason, coilMapping, deviceStatusRecord);
            return {
                actions,
                targetGroup: [],
                requiredGroupSize: 0,
                requiresTransition: false,
                reason
            };
        }
        // Get target group for required size
        const targetGroup = this.getTargetGroupForSize(requiredGroupSize);
        // Check if transition is needed
        const currentActiveFans = Object.keys(deviceStatus).filter(key => deviceStatus[key] === true && (0, groupUtils_1.getAllFanKeys)().includes(key));
        const requiresTransition = this.requiresStableGroupTransition(currentActiveFans, targetGroup, requiredGroupSize);
        if (requiresTransition) {
            return {
                actions: [],
                targetGroup,
                requiredGroupSize,
                requiresTransition: true,
                reason
            };
        }
        // Direct control
        const deviceStatusRecord = this.convertDeviceStatusToRecord(deviceStatus);
        const actions = (0, groupUtils_1.createOptimizedFanGroupActions)(targetGroup, true, reason, coilMapping, deviceStatusRecord);
        return {
            actions,
            targetGroup,
            requiredGroupSize,
            requiresTransition: false,
            reason
        };
    }
    /**
     * Execute fan dao control logic
     */
    static executeFanDaoControl(config, lastFanDaoTime, currentFanDaoState, coilMapping, logger) {
        // Check if fan dao control is enabled
        if (config.set_mode_fan_dao !== 1) {
            logger.debug("Fan dao control is disabled");
            return {
                actions: (0, groupUtils_1.createFanDaoActions)(false, "Fan dao control disabled", coilMapping)
            };
        }
        const alternateInterval = (0, timeUtils_1.minutesToMs)(config.set_time_fan_dao_on || 5);
        // Check if it's time to toggle fan dao state
        if ((0, timeUtils_1.hasTimeElapsed)(lastFanDaoTime, alternateInterval)) {
            const newState = !currentFanDaoState;
            const now = (0, timeUtils_1.getCurrentTimestamp)();
            logger.warn(`Fan dao alternating: switching to ${newState ? 'ON' : 'OFF'}`);
            return {
                actions: (0, groupUtils_1.createFanDaoActions)(newState, `Fan dao alternating mode: ${newState ? 'ON' : 'OFF'}`, coilMapping),
                newState: { time: now, state: newState }
            };
        }
        // No change needed
        return { actions: [] };
    }
    /**
     * Execute transition phase logic
     */
    static executeTransitionPhase(phase, previousGroup, nextGroup, transitionStartTime, offDelayStartTime, offDelayMs, transitionDelayMs, reason, coilMapping, logger) {
        const now = (0, timeUtils_1.getCurrentTimestamp)();
        switch (phase) {
            case 'off':
                // Turn off all fans for clean transition
                const offActions = this.createTurnOffAllFansActions(`Transition phase 1: Turn off all fans - ${reason}`, coilMapping);
                logger.warn(`Fan transition: All fans turned off, starting delay phase`);
                return {
                    actions: offActions,
                    nextPhase: 'delay'
                };
            case 'delay':
                // Check if delay period has elapsed
                if ((0, timeUtils_1.hasTimeElapsed)(offDelayStartTime, offDelayMs)) {
                    logger.warn(`Fan transition: Delay completed (${offDelayMs}ms), turning on new group`);
                    return {
                        actions: [],
                        nextPhase: 'on'
                    };
                }
                else {
                    const remaining = offDelayMs - (now - offDelayStartTime);
                    logger.debug(`Fan transition: Delay in progress, ${remaining}ms remaining`);
                    return { actions: [] };
                }
            case 'on':
                // Turn on new group
                let onActions;
                if (nextGroup.length > 0) {
                    onActions = (0, groupUtils_1.createFanGroupActions)(nextGroup, true, `Transition phase 2: Turn on new group - ${reason}`, coilMapping);
                }
                else {
                    onActions = this.createTurnOffAllFansActions(`Transition phase 2: No target group, turn off all fans - ${reason}`, coilMapping);
                }
                logger.warn(`Fan transition: New group activated, transition completing`);
                return {
                    actions: onActions,
                    nextPhase: 'complete'
                };
            case 'complete':
                // Check if overall transition delay has elapsed
                if ((0, timeUtils_1.hasTimeElapsed)(transitionStartTime, transitionDelayMs)) {
                    logger.warn(`Fan group transition completed successfully`);
                    return {
                        actions: [],
                        isComplete: true
                    };
                }
                else {
                    const remaining = transitionDelayMs - (now - transitionStartTime);
                    logger.debug(`Fan transition: Cooldown in progress, ${remaining}ms remaining`);
                    return { actions: [] };
                }
            default:
                return { actions: [] };
        }
    }
    // Helper methods
    static requiresGroupTransition(currentGroup, newGroup) {
        if (currentGroup.length !== newGroup.length) {
            return true;
        }
        const sortedCurrent = [...currentGroup].sort();
        const sortedNew = [...newGroup].sort();
        return !sortedCurrent.every((fan, index) => fan === sortedNew[index]);
    }
    static requiresStableGroupTransition(currentGroup, newGroup, requiredGroupSize) {
        // If current group size matches required and fans are valid, minimal transition logic
        if (currentGroup.length === requiredGroupSize && currentGroup.length > 0) {
            const allValidFans = currentGroup.every(fan => (0, groupUtils_1.getAllFanKeys)().includes(fan));
            if (allValidFans) {
                const isDifferentGroup = !this.arraysEqual(currentGroup.sort(), newGroup.sort());
                return isDifferentGroup;
            }
        }
        return this.requiresGroupTransition(currentGroup, newGroup);
    }
    static getTargetGroupForSize(requiredGroupSize) {
        if (requiredGroupSize === 6) {
            return (0, groupUtils_1.getAllFanKeys)();
        }
        const fanGroups = (0, groupUtils_1.getFanGroups)(requiredGroupSize);
        return fanGroups[0] || [];
    }
    static convertDeviceStatusToRecord(deviceStatus) {
        const result = {};
        Object.keys(deviceStatus).forEach(key => {
            if (key !== 'ts' && typeof deviceStatus[key] === 'boolean') {
                result[key] = deviceStatus[key];
            }
        });
        return result;
    }
    static createTurnOffAllFansActions(reason, coilMapping) {
        const actions = [];
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
    static getThresholdReason(temperature, humidity, thresholds) {
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
    static arraysEqual(a, b) {
        if (a.length !== b.length)
            return false;
        return a.every((val, index) => val === b[index]);
    }
}
exports.FanControlCore = FanControlCore;
