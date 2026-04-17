"use strict";
/**
 * Group utility functions for VIIS Auto Microclimate Control Node
 * Handles fan grouping logic and rotation algorithms
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFanGroups = getFanGroups;
exports.getNextGroupIndex = getNextGroupIndex;
exports.getAllFanKeys = getAllFanKeys;
exports.getFanKeysFromCoilMapping = getFanKeysFromCoilMapping;
exports.getAllFanDaoKeys = getAllFanDaoKeys;
exports.isFanKey = isFanKey;
exports.isFanDaoKey = isFanDaoKey;
exports.isWaterPumpKey = isWaterPumpKey;
exports.isCurtainKey = isCurtainKey;
exports.getActiveFans = getActiveFans;
exports.getInactiveFans = getInactiveFans;
exports.createFanGroupActions = createFanGroupActions;
exports.createOptimizedFanGroupActions = createOptimizedFanGroupActions;
exports.createFanDaoActions = createFanDaoActions;
exports.createDelayedFanGroupActions = createDelayedFanGroupActions;
exports.isValidFanGroupSize = isValidFanGroupSize;
exports.getRecommendedGroupSize = getRecommendedGroupSize;
const constants_1 = require("../constants");
/**
 * Get fan groups based on group size configuration
 * Updated to support 5-fan system
 */
function getFanGroups(groupSize) {
    switch (groupSize) {
        case 1:
            return constants_1.FAN_CONFIG.GROUPS.ONE_FAN.map(group => [...group]);
        case 2:
            return constants_1.FAN_CONFIG.GROUPS.TWO_FANS.map(group => [...group]);
        case 4:
            return constants_1.FAN_CONFIG.GROUPS.FOUR_FANS.map(group => [...group]);
        case 5:
            return constants_1.FAN_CONFIG.GROUPS.FIVE_FANS.map(group => [...group]);
        case 6:
            return constants_1.FAN_CONFIG.GROUPS.SIX_FANS.map(group => [...group]);
        default:
            // Default to 2-fan groups if invalid size
            return constants_1.FAN_CONFIG.GROUPS.TWO_FANS.map(group => [...group]);
    }
}
/**
 * Get the next group index for rotation
 */
function getNextGroupIndex(currentIndex, totalGroups) {
    return (currentIndex + 1) % totalGroups;
}
/**
 * Get all fan keys from the default fan mapping
 */
function getAllFanKeys() {
    return getFanKeysFromCoilMapping(constants_1.FAN_CONFIG.COIL_MAPPING);
}
/**
 * Get all fan keys from effective coil mapping (supports env-extended keys)
 */
function getFanKeysFromCoilMapping(coilMapping) {
    const combined = Object.assign(Object.assign({}, constants_1.FAN_CONFIG.COIL_MAPPING), coilMapping);
    return Object.keys(combined)
        .filter(isFanKey)
        .sort((a, b) => {
        const aMatch = a.match(/^quat_(\d+)$/);
        const bMatch = b.match(/^quat_(\d+)$/);
        if (!aMatch || !bMatch) {
            return a.localeCompare(b);
        }
        return Number(aMatch[1]) - Number(bMatch[1]);
    });
}
/**
 * Get all fan dao keys
 */
function getAllFanDaoKeys() {
    return ["quat_dao_1", "quat_dao_2", "quat_dao_3"];
}
/**
 * Check if a device key is a fan
 */
function isFanKey(key) {
    return key.startsWith("quat_") && !key.includes("dao");
}
/**
 * Check if a device key is a fan dao
 */
function isFanDaoKey(key) {
    return key.startsWith("quat_dao_");
}
/**
 * Check if a device key is a water pump
 */
function isWaterPumpKey(key) {
    return key.startsWith("bom_nuoc_");
}
/**
 * Check if a device key is a curtain (luoi)
 */
function isCurtainKey(key) {
    return key.startsWith("luoi_");
}
/**
 * Get active fans from device status
 */
function getActiveFans(deviceStatus) {
    return getAllFanKeys().filter(fanKey => deviceStatus[fanKey] === true);
}
/**
 * Get inactive fans from device status
 */
function getInactiveFans(deviceStatus) {
    return getAllFanKeys().filter(fanKey => deviceStatus[fanKey] !== true);
}
/**
 * Create fan control actions for a specific group
 * Optimized to avoid unnecessary on/off cycles
 */
function createFanGroupActions(targetGroup, turnOn, reason, coilMapping) {
    const actions = [];
    const allFanKeys = getFanKeysFromCoilMapping(coilMapping);
    if (!turnOn) {
        // Turn off all fans when turnOn is false
        allFanKeys.forEach(fanKey => {
            const address = coilMapping[fanKey];
            if (address !== undefined) {
                actions.push({
                    deviceKey: fanKey,
                    value: false,
                    address: address,
                    fc: 5, // WRITE_SINGLE_COIL
                    reason: reason
                });
            }
        });
        return actions;
    }
    // When turning on, only change fans that need to change state
    // Turn off fans that should not be in the target group
    allFanKeys.forEach(fanKey => {
        const shouldBeOn = targetGroup.includes(fanKey);
        const address = coilMapping[fanKey];
        if (address !== undefined) {
            if (shouldBeOn) {
                // Turn on fans in target group
                actions.push({
                    deviceKey: fanKey,
                    value: true,
                    address: address,
                    fc: 5, // WRITE_SINGLE_COIL
                    reason: reason
                });
            }
            else {
                // Turn off fans not in target group
                actions.push({
                    deviceKey: fanKey,
                    value: false,
                    address: address,
                    fc: 5, // WRITE_SINGLE_COIL
                    reason: `Turn off ${fanKey} for group control`
                });
            }
        }
    });
    return actions;
}
/**
 * Create optimized fan control actions that only change state when necessary
 */
function createOptimizedFanGroupActions(targetGroup, turnOn, reason, coilMapping, currentDeviceStatus) {
    const actions = [];
    const allFanKeys = getFanKeysFromCoilMapping(coilMapping);
    if (!turnOn) {
        // Turn off all fans that are currently on
        allFanKeys.forEach(fanKey => {
            const address = coilMapping[fanKey];
            const currentState = currentDeviceStatus[fanKey] || false;
            if (address !== undefined && currentState === true) {
                actions.push({
                    deviceKey: fanKey,
                    value: false,
                    address: address,
                    fc: 5, // WRITE_SINGLE_COIL
                    reason: reason
                });
            }
        });
        return actions;
    }
    // When turning on, only change fans that need state change
    allFanKeys.forEach(fanKey => {
        const shouldBeOn = targetGroup.includes(fanKey);
        const currentState = currentDeviceStatus[fanKey] || false;
        const address = coilMapping[fanKey];
        if (address !== undefined && shouldBeOn !== currentState) {
            actions.push({
                deviceKey: fanKey,
                value: shouldBeOn,
                address: address,
                fc: 5, // WRITE_SINGLE_COIL
                reason: shouldBeOn ? reason : `Turn off ${fanKey} for group control`
            });
        }
    });
    return actions;
}
/**
 * Create fan dao control actions
 */
function createFanDaoActions(turnOn, reason, coilMapping) {
    const actions = [];
    getAllFanDaoKeys().forEach(fanDaoKey => {
        const address = coilMapping[fanDaoKey];
        if (address !== undefined) {
            actions.push({
                deviceKey: fanDaoKey,
                value: turnOn,
                address: address,
                fc: 5, // WRITE_SINGLE_COIL
                reason: reason
            });
        }
    });
    return actions;
}
/**
 * Create optimized fan control actions with delay support
 * Adds 1 second delay before turning off fans and before turning on fans
 */
function createDelayedFanGroupActions(targetGroup, turnOn, reason, coilMapping, currentDeviceStatus, delayMs = 1000 // Default 1 second delay
) {
    const actions = [];
    const allFanKeys = getFanKeysFromCoilMapping(coilMapping);
    if (turnOn) {
        // When turning on: first turn off fans not in target group, then turn on target group with delay
        allFanKeys.forEach(fanKey => {
            const shouldBeOn = targetGroup.includes(fanKey);
            const currentlyOn = currentDeviceStatus[fanKey] === true;
            const address = coilMapping[fanKey];
            if (address !== undefined) {
                if (!shouldBeOn && currentlyOn) {
                    // Turn off fans not in target group (with delay)
                    actions.push({
                        deviceKey: fanKey,
                        value: false,
                        address: address,
                        fc: 5, // WRITE_SINGLE_COIL
                        reason: `${reason} - Turn off ${fanKey}`,
                        delay: delayMs
                    });
                }
                else if (shouldBeOn && !currentlyOn) {
                    // Turn on target group fans (with delay)
                    actions.push({
                        deviceKey: fanKey,
                        value: true,
                        address: address,
                        fc: 5, // WRITE_SINGLE_COIL
                        reason: `${reason} - Turn on ${fanKey}`,
                        delay: delayMs
                    });
                }
                // Skip if fan is already in correct state
            }
        });
    }
    else {
        // When turning off: turn off all fans with delay
        allFanKeys.forEach(fanKey => {
            const currentlyOn = currentDeviceStatus[fanKey] === true;
            const address = coilMapping[fanKey];
            if (address !== undefined && currentlyOn) {
                actions.push({
                    deviceKey: fanKey,
                    value: false,
                    address: address,
                    fc: 5, // WRITE_SINGLE_COIL
                    reason: `${reason} - Turn off ${fanKey}`,
                    delay: delayMs
                });
            }
        });
    }
    return actions;
}
/**
 * Validate fan group configuration
 * Supports both legacy 5-fan and current 6-fan groups
 */
function isValidFanGroupSize(groupSize) {
    return [1, 2, 4, 5, 6].includes(groupSize);
}
/**
 * Get recommended group size based on temperature thresholds with hysteresis
 * 6-fan strategy: K1-K2: 1 fan luân phiên, K2-K3: 2 fans luân phiên, K3-K4: 6 fans, >K4: 6 fans + tường nước
 * Note: Humidity conditions are temporarily disabled but can be re-enabled via config
 */
function getRecommendedGroupSize(temperature, humidity, thresholds, options) {
    // For future humidity integration
    const enableHumidity = (options === null || options === void 0 ? void 0 : options.enableHumidityCheck) || false;
    const humidityThresholds = (options === null || options === void 0 ? void 0 : options.humidityThresholds) || {
        k2: 65,
        k3: 55,
        k4: 75
    };
    // Hysteresis configuration - prevents oscillation around threshold boundaries
    const currentGroupSize = (options === null || options === void 0 ? void 0 : options.currentGroupSize) || 0;
    const hysteresis = (options === null || options === void 0 ? void 0 : options.hysteresis) || 1.0; // Default 1°C hysteresis
    // Calculate thresholds with hysteresis based on current state
    const getEffectiveThreshold = (baseThreshold, targetGroupSize) => {
        if (currentGroupSize < targetGroupSize) {
            // Moving up - use normal threshold
            return baseThreshold;
        }
        else if (currentGroupSize > targetGroupSize) {
            // Moving down - use threshold minus hysteresis
            return baseThreshold - hysteresis;
        }
        else {
            // Same group size - use threshold with hysteresis buffer
            return baseThreshold - (hysteresis / 2);
        }
    };
    // Updated logic for 6-fan system
    const k4Threshold = getEffectiveThreshold(thresholds.k4, 6);
    const k3Threshold = getEffectiveThreshold(thresholds.k3, 6);
    const k2Threshold = getEffectiveThreshold(thresholds.k2, 2);
    const k1Threshold = getEffectiveThreshold(thresholds.k1, 1);
    if (temperature >= k4Threshold) {
        return 6; // 6 fans for K4 (+ water pump will be handled separately)
    }
    else if (temperature >= k3Threshold) {
        return 6; // 6 fans for K3
    }
    else if (temperature >= k2Threshold) {
        return 2; // 2 fans luân phiên for K2
    }
    else if (temperature >= k1Threshold) {
        return 1; // 1 fan luân phiên for K1
    }
    // Future humidity logic (currently disabled)
    if (enableHumidity) {
        if (humidity < humidityThresholds.k4) {
            return 6; // 6 fans for low humidity K4
        }
        else if (humidity < humidityThresholds.k3) {
            return 6; // 6 fans for low humidity K3
        }
        else if (humidity < humidityThresholds.k2) {
            return 2; // 2 fans for low humidity K2
        }
    }
    return 0; // No fans needed
}
