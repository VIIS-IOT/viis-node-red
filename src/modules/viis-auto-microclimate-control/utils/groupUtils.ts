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
 */
export function createFanGroupActions(
    targetGroup: string[],
    turnOn: boolean,
    reason: string,
    coilMapping: Record<string, number>
): Array<{ deviceKey: string, value: boolean, address: number, fc: number, reason: string }> {
    const actions: Array<{ deviceKey: string, value: boolean, address: number, fc: number, reason: string }> = [];

    // First, turn off all fans
    getAllFanKeys().forEach(fanKey => {
        const address = coilMapping[fanKey];
        if (address !== undefined) {
            actions.push({
                deviceKey: fanKey,
                value: false,
                address: address,
                fc: 5, // WRITE_SINGLE_COIL
                reason: `Turn off ${fanKey} for group control`
            });
        }
    });

    // Then, turn on fans in target group if requested
    if (turnOn) {
        targetGroup.forEach(fanKey => {
            const address = coilMapping[fanKey];
            if (address !== undefined) {
                actions.push({
                    deviceKey: fanKey,
                    value: true,
                    address: address,
                    fc: 5, // WRITE_SINGLE_COIL
                    reason: reason
                });
            }
        });
    }

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
    return [2, 4, 6].includes(groupSize);
}

/**
 * Get recommended group size based on temperature/humidity thresholds
 */
export function getRecommendedGroupSize(temperature: number, humidity: number, thresholds: {
    k1: number,
    k2: number,
    k3: number,
    k4: number
}): number {
    if (temperature >= thresholds.k4 || humidity < 75) {
        return 6; // All fans
    } else if (temperature >= thresholds.k3 || humidity < 55) {
        return 6; // All fans
    } else if (temperature >= thresholds.k2 || humidity < 65) {
        return 4; // 4 fans
    } else if (temperature >= thresholds.k1) {
        return 2; // 2 fans
    }

    return 0; // No fans needed
}
