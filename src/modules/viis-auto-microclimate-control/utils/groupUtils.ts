/**
 * Group utility functions for VIIS Auto Microclimate Control Node
 * Handles fan grouping logic and rotation algorithms
 */

import { FAN_CONFIG } from "../constants";

/**
 * Get fan groups based on group size configuration
 */
export function getFanGroups(groupSize: number): string[][] {
    switch (groupSize) {
        case 1:
            return FAN_CONFIG.GROUPS.ONE_FAN.map(group => [...group]);
        case 2:
            return FAN_CONFIG.GROUPS.TWO_FANS.map(group => [...group]);
        case 4:
            return FAN_CONFIG.GROUPS.FOUR_FANS.map(group => [...group]);
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
 * Validate fan group configuration
 */
export function isValidFanGroupSize(groupSize: number): boolean {
    return [1, 2, 4, 6].includes(groupSize);
}

/**
 * Get recommended group size based on temperature thresholds
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
        }
    }
): number {
    // For future humidity integration
    const enableHumidity = options?.enableHumidityCheck || false;
    const humidityThresholds = options?.humidityThresholds || {
        k2: 65,
        k3: 55,
        k4: 75
    };

    // Temperature-only logic (current implementation)
    if (temperature >= thresholds.k4) {
        return 6; // All fans for K4
    } else if (temperature >= thresholds.k3) {
        return 6; // All fans for K3
    } else if (temperature >= thresholds.k2) {
        return 4; // 4 fans for K2
    } else if (temperature >= thresholds.k1) {
        return 2; // 2 fans for K1
    }

    // Future humidity logic (currently disabled)
    if (enableHumidity) {
        if (humidity < humidityThresholds.k4) {
            return 6; // All fans for low humidity K4
        } else if (humidity < humidityThresholds.k3) {
            return 6; // All fans for low humidity K3
        } else if (humidity < humidityThresholds.k2) {
            return 4; // 4 fans for low humidity K2
        }
    }

    return 0; // No fans needed
}
