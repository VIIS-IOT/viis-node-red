/**
 * Group utility functions for VIIS Auto Microclimate Control Node
 * Handles fan grouping logic and rotation algorithms
 */

import { FAN_CONFIG } from "../constants";

/**
 * Get fan groups based on group size configuration
 * Updated to support 5-fan system with K1, K2, K3 alternating index logic
 */
export function getFanGroups(groupSize: number): string[][] {
    switch (groupSize) {
        case 1:
            return FAN_CONFIG.GROUPS.ONE_FAN.map(group => [...group]);
        case 2:
            return FAN_CONFIG.GROUPS.TWO_FANS.map(group => [...group]);
        case 3:
            return FAN_CONFIG.GROUPS.THREE_FANS.map(group => [...group]);
        case 4:
            return FAN_CONFIG.GROUPS.FOUR_FANS.map(group => [...group]);
        case 5:
            return FAN_CONFIG.GROUPS.FIVE_FANS.map(group => [...group]);
        case 6:
            return FAN_CONFIG.GROUPS.SIX_FANS.map(group => [...group]);
        default:
            // Default to 2-fan groups if invalid size
            return FAN_CONFIG.GROUPS.TWO_FANS.map(group => [...group]);
    }
}

/**
 * Get the next group index for rotation
 */
export function getNextGroupIndex(currentIndex: number, totalGroups: number): number {
    return (currentIndex + 1) % totalGroups;
}

/**
 * Get all fan keys
 */
export function getAllFanKeys(): string[] {
    return Object.keys(FAN_CONFIG.COIL_MAPPING);
}

/**
 * Get all fan dao keys
 */
export function getAllFanDaoKeys(): string[] {
    return ["quat_dao_1", "quat_dao_2", "quat_dao_3"];
}

/**
 * Check if a device key is a fan
 */
export function isFanKey(key: string): boolean {
    return key.startsWith("quat_") && !key.includes("dao");
}

/**
 * Check if a device key is a fan dao
 */
export function isFanDaoKey(key: string): boolean {
    return key.startsWith("quat_dao_");
}

/**
 * Check if a device key is a water pump
 */
export function isWaterPumpKey(key: string): boolean {
    return key.startsWith("bom_nuoc_");
}

/**
 * Check if a device key is a curtain (luoi)
 */
export function isCurtainKey(key: string): boolean {
    return key.startsWith("luoi_");
}

/**
 * Get active fans from device status
 */
export function getActiveFans(deviceStatus: Record<string, boolean>): string[] {
    return getAllFanKeys().filter(fanKey => deviceStatus[fanKey] === true);
}

/**
 * Get inactive fans from device status
 */
export function getInactiveFans(deviceStatus: Record<string, boolean>): string[] {
    return getAllFanKeys().filter(fanKey => deviceStatus[fanKey] !== true);
}

/**
 * Create fan control actions for a specific group
 * Optimized to avoid unnecessary on/off cycles
 */
export function createFanGroupActions(
    targetGroup: string[],
    turnOn: boolean,
    reason: string,
    coilMapping: Record<string, number>
): Array<{ deviceKey: string, value: boolean, address: number, fc: number, reason: string }> {
    const actions: Array<{ deviceKey: string, value: boolean, address: number, fc: number, reason: string }> = [];
    const allFanKeys = getAllFanKeys();

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
            } else {
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
export function createOptimizedFanGroupActions(
    targetGroup: string[],
    turnOn: boolean,
    reason: string,
    coilMapping: Record<string, number>,
    currentDeviceStatus: Record<string, boolean>
): Array<{ deviceKey: string, value: boolean, address: number, fc: number, reason: string }> {
    const actions: Array<{ deviceKey: string, value: boolean, address: number, fc: number, reason: string }> = [];
    const allFanKeys = getAllFanKeys();

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
export function createFanDaoActions(
    turnOn: boolean,
    reason: string,
    coilMapping: Record<string, number>
): Array<{ deviceKey: string, value: boolean, address: number, fc: number, reason: string }> {
    const actions: Array<{ deviceKey: string, value: boolean, address: number, fc: number, reason: string }> = [];

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
export function createDelayedFanGroupActions(
    targetGroup: string[],
    turnOn: boolean,
    reason: string,
    coilMapping: Record<string, number>,
    currentDeviceStatus: Record<string, boolean>,
    delayMs: number = 1000 // Default 1 second delay
): Array<{ deviceKey: string, value: boolean, address: number, fc: number, reason: string, delay?: number }> {
    const actions: Array<{ deviceKey: string, value: boolean, address: number, fc: number, reason: string, delay?: number }> = [];
    const allFanKeys = getAllFanKeys();

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
                } else if (shouldBeOn && !currentlyOn) {
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
    } else {
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
 * Updated to support 5-fan system
 */
export function isValidFanGroupSize(groupSize: number): boolean {
    return [1, 2, 4, 5, 6].includes(groupSize);
}

/**
 * Get recommended group size based on temperature thresholds with hysteresis
 * Updated for 5-fan system: K1: 1 fan luân phiên, K2: 2 fans luân phiên, K3: 3 fans luân phiên, K4: 5 fans + tường nước + quạt trên
 * Note: Humidity conditions are temporarily disabled but can be re-enabled via config
 */
export function getRecommendedGroupSize(
    temperature: number,
    humidity: number,
    thresholds: {
        k1: number,
        k2: number,
        k3: number,
        k4: number
    },
    options?: {
        enableHumidityCheck?: boolean,
        humidityThresholds?: {
            k2: number,
            k3: number,
            k4: number
        },
        currentGroupSize?: number,
        hysteresis?: number
    }
): number {
    // For future humidity integration
    const enableHumidity = options?.enableHumidityCheck || false;
    const humidityThresholds = options?.humidityThresholds || {
        k2: 65,
        k3: 55,
        k4: 75
    };

    // Hysteresis configuration - prevents oscillation around threshold boundaries
    const currentGroupSize = options?.currentGroupSize || 0;
    const hysteresis = options?.hysteresis || 1.0; // Default 1°C hysteresis

    // Calculate thresholds with hysteresis based on current state
    const getEffectiveThreshold = (baseThreshold: number, targetGroupSize: number): number => {
        if (currentGroupSize < targetGroupSize) {
            // Moving up - use normal threshold
            return baseThreshold;
        } else if (currentGroupSize > targetGroupSize) {
            // Moving down - use threshold minus hysteresis
            return baseThreshold - hysteresis;
        } else {
            // Same group size - use threshold with hysteresis buffer
            return baseThreshold - (hysteresis / 2);
        }
    };

    // Updated logic for 5-fan system
    const k4Threshold = getEffectiveThreshold(thresholds.k4, 5);
    const k3Threshold = getEffectiveThreshold(thresholds.k3, 3);
    const k2Threshold = getEffectiveThreshold(thresholds.k2, 2);
    const k1Threshold = getEffectiveThreshold(thresholds.k1, 1);

    if (temperature >= k4Threshold) {
        return -1; // Special K4 mode: water wall + quat_tren_1 only (NO quat_1 to quat_5)
    } else if (temperature >= k3Threshold) {
        return 3; // 3 fans luân phiên for K3
    } else if (temperature >= k2Threshold) {
        return 2; // 2 fans luân phiên for K2
    } else if (temperature >= k1Threshold) {
        return 1; // 1 fan luân phiên for K1
    }

    // Future humidity logic (currently disabled)
    if (enableHumidity) {
        if (humidity < humidityThresholds.k4) {
            return 5; // 5 fans for low humidity K4
        } else if (humidity < humidityThresholds.k3) {
            return 5; // 5 fans for low humidity K3
        } else if (humidity < humidityThresholds.k2) {
            return 2; // 2 fans for low humidity K2
        }
    }

    return 0; // No fans needed
}
