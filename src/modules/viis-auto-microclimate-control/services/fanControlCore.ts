/**
 * Fan Control Core Logic
 * Contains pure fan control logic without state management dependencies
 * Used by both StateMachine and EnhancedService to avoid circular dependencies
 */

import {
    AutoControlConfig,
    SensorData,
    DeviceStatus,
    ControlAction,
    FanRotationState,
    ILogger
} from "../interfaces/types";
import {
    getFanGroups,
    getNextGroupIndex,
    createFanGroupActions,
    createOptimizedFanGroupActions,
    createFanDaoActions,
    getRecommendedGroupSize,
    getAllFanKeys
} from "../utils/groupUtils";
import { minutesToMs, hasTimeElapsed, getCurrentTimestamp } from "../utils/timeUtils";
import { FAN_CONFIG, FAN_DAO_CONFIG, MODBUS_FUNCTION_CODES } from "../constants";

export interface FanControlContext {
    config: AutoControlConfig;
    sensorData: SensorData;
    deviceStatus: DeviceStatus;
    currentRotationState: FanRotationState;
    coilMapping: Record<string, number>;
    logger: ILogger;
}

export interface RotationResult {
    actions: ControlAction[];
    newRotationState: FanRotationState | null;
    requiresTransition: boolean;
    transitionInfo?: {
        previousGroup: string[];
        nextGroup: string[];
        reason: string;
    };
}

export interface ThresholdResult {
    actions: ControlAction[];
    targetGroup: string[];
    requiredGroupSize: number;
    requiresTransition: boolean;
    reason: string;
}

export class FanControlCore {
    /**
     * Execute rotation mode logic
     */
    public static executeRotationMode(context: FanControlContext): RotationResult {
        const { config, currentRotationState, coilMapping, logger } = context;

        const groupSize = config.set_gr_alternate_fan || 2;
        const rotationInterval = minutesToMs(config.set_time_alternate_fan || 15);

        // Get fan groups
        const fanGroups = getFanGroups(groupSize);
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
                lastRotationTime: getCurrentTimestamp(),
                activeGroup: fanGroups[0]
            };
        }

        // Check if rotation is needed
        if (hasTimeElapsed(rotationState.lastRotationTime, rotationInterval)) {
            const previousGroup = [...rotationState.activeGroup];
            const nextGroupIndex = getNextGroupIndex(
                rotationState.currentGroupIndex,
                fanGroups.length
            );
            const nextGroup = fanGroups[nextGroupIndex];

            const newRotationState: FanRotationState = {
                currentGroupIndex: nextGroupIndex,
                lastRotationTime: getCurrentTimestamp(),
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
            } else {
                // Direct switch
                const actions = createFanGroupActions(nextGroup, true, reason, coilMapping);
                return {
                    actions,
                    newRotationState,
                    requiresTransition: false
                };
            }
        }

        // No rotation needed, maintain current group
        const reason = `Rotation mode: maintaining group ${rotationState.currentGroupIndex + 1}/${fanGroups.length}`;
        const actions = createFanGroupActions(rotationState.activeGroup, true, reason, coilMapping);

        return {
            actions,
            newRotationState: null, // No change needed
            requiresTransition: false
        };
    }

    /**
     * Execute threshold mode logic
     */
    public static executeThresholdMode(context: FanControlContext): ThresholdResult {
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
            k1: config.set_k1_fan || FAN_CONFIG.DEFAULT_TEMPERATURE_THRESHOLDS.K1,
            k2: config.set_k2_fan || FAN_CONFIG.DEFAULT_TEMPERATURE_THRESHOLDS.K2,
            k3: config.set_k3_fan || FAN_CONFIG.DEFAULT_TEMPERATURE_THRESHOLDS.K3,
            k4: 99
            // k4: config.set_k4_fan || FAN_CONFIG.DEFAULT_TEMPERATURE_THRESHOLDS.K4
        };

        // Determine required group size
        const requiredGroupSize = getRecommendedGroupSize(tempIndoor, humiIndoor, thresholds);
        const reason = this.getThresholdReason(tempIndoor, humiIndoor, thresholds);

        logger.debug(`Threshold mode: temp=${tempIndoor}°C, humidity=${humiIndoor}%, required group size=${requiredGroupSize}`);

        if (requiredGroupSize === 0) {
            // No fans needed
            const deviceStatusRecord = this.convertDeviceStatusToRecord(deviceStatus);
            const actions = createOptimizedFanGroupActions([], false, reason, coilMapping, deviceStatusRecord);

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
        const currentActiveFans = Object.keys(deviceStatus).filter(key =>
            deviceStatus[key] === true && getAllFanKeys().includes(key)
        );

        const requiresTransition = this.requiresStableGroupTransition(
            currentActiveFans,
            targetGroup,
            requiredGroupSize
        );

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
        let actions = createOptimizedFanGroupActions(targetGroup, true, reason, coilMapping, deviceStatusRecord);

        // Handle K4 special case - add water wall actions
        // Note: This is a simplified version. Full K4 logic should be handled by the calling service
        // that has access to createK4WaterWallActions method
        if (requiredGroupSize === -1) {
            logger.warn("K4 threshold detected in FanControlCore - water wall logic should be handled by calling service");
        }

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
    public static executeFanDaoControl(
        config: AutoControlConfig,
        lastFanDaoTime: number,
        currentFanDaoState: boolean,
        coilMapping: Record<string, number>,
        logger: ILogger
    ): { actions: ControlAction[]; newState?: { time: number; state: boolean } } {
        // Check if fan dao control is enabled
        if (config.set_mode_fan_dao !== 1) {
            logger.debug("Fan dao control is disabled");
            return {
                actions: createFanDaoActions(false, "Fan dao control disabled", coilMapping)
            };
        }

        const alternateInterval = minutesToMs(config.set_time_alternate_fan_dao || 5);

        // Check if it's time to toggle fan dao state
        if (hasTimeElapsed(lastFanDaoTime, alternateInterval)) {
            const newState = !currentFanDaoState;
            const now = getCurrentTimestamp();

            logger.warn(`Fan dao alternating: switching to ${newState ? 'ON' : 'OFF'}`);

            return {
                actions: createFanDaoActions(newState, `Fan dao alternating mode: ${newState ? 'ON' : 'OFF'}`, coilMapping),
                newState: { time: now, state: newState }
            };
        }

        // No change needed
        return { actions: [] };
    }

    /**
     * Execute transition phase logic
     */
    public static executeTransitionPhase(
        phase: 'off' | 'delay' | 'on' | 'complete',
        previousGroup: string[],
        nextGroup: string[],
        transitionStartTime: number,
        offDelayStartTime: number,
        offDelayMs: number,
        transitionDelayMs: number,
        reason: string,
        coilMapping: Record<string, number>,
        logger: ILogger
    ): { actions: ControlAction[]; nextPhase?: 'off' | 'delay' | 'on' | 'complete'; isComplete?: boolean } {
        const now = getCurrentTimestamp();

        switch (phase) {
            case 'off':
                // Turn off all fans for clean transition
                const offActions = this.createTurnOffAllFansActions(
                    `Transition phase 1: Turn off all fans - ${reason}`,
                    coilMapping
                );

                logger.warn(`Fan transition: All fans turned off, starting delay phase`);

                return {
                    actions: offActions,
                    nextPhase: 'delay'
                };

            case 'delay':
                // Check if delay period has elapsed
                if (hasTimeElapsed(offDelayStartTime, offDelayMs)) {
                    logger.warn(`Fan transition: Delay completed (${offDelayMs}ms), turning on new group`);
                    return {
                        actions: [],
                        nextPhase: 'on'
                    };
                } else {
                    const remaining = offDelayMs - (now - offDelayStartTime);
                    logger.debug(`Fan transition: Delay in progress, ${remaining}ms remaining`);
                    return { actions: [] };
                }

            case 'on':
                // Turn on new group
                let onActions: ControlAction[];
                if (nextGroup.length > 0) {
                    onActions = createFanGroupActions(
                        nextGroup,
                        true,
                        `Transition phase 2: Turn on new group - ${reason}`,
                        coilMapping
                    );
                } else {
                    onActions = this.createTurnOffAllFansActions(
                        `Transition phase 2: No target group, turn off all fans - ${reason}`,
                        coilMapping
                    );
                }

                logger.warn(`Fan transition: New group activated, transition completing`);

                return {
                    actions: onActions,
                    nextPhase: 'complete'
                };

            case 'complete':
                // Check if overall transition delay has elapsed
                if (hasTimeElapsed(transitionStartTime, transitionDelayMs)) {
                    logger.warn(`Fan group transition completed successfully`);
                    return {
                        actions: [],
                        isComplete: true
                    };
                } else {
                    const remaining = transitionDelayMs - (now - transitionStartTime);
                    logger.debug(`Fan transition: Cooldown in progress, ${remaining}ms remaining`);
                    return { actions: [] };
                }

            default:
                return { actions: [] };
        }
    }

    // Helper methods
    private static requiresGroupTransition(currentGroup: string[], newGroup: string[]): boolean {
        if (currentGroup.length !== newGroup.length) {
            return true;
        }

        const sortedCurrent = [...currentGroup].sort();
        const sortedNew = [...newGroup].sort();

        return !sortedCurrent.every((fan, index) => fan === sortedNew[index]);
    }

    private static requiresStableGroupTransition(
        currentGroup: string[],
        newGroup: string[],
        requiredGroupSize: number
    ): boolean {
        // If current group size matches required and fans are valid, minimal transition logic
        if (currentGroup.length === requiredGroupSize && currentGroup.length > 0) {
            const allValidFans = currentGroup.every(fan => getAllFanKeys().includes(fan));
            if (allValidFans) {
                const isDifferentGroup = !this.arraysEqual(currentGroup.sort(), newGroup.sort());
                return isDifferentGroup;
            }
        }

        return this.requiresGroupTransition(currentGroup, newGroup);
    }

    private static getTargetGroupForSize(requiredGroupSize: number): string[] {
        // K4 logic removed - no special case for -1
        if (requiredGroupSize === 6) {
            return getAllFanKeys();
        }

        const fanGroups = getFanGroups(requiredGroupSize);
        return fanGroups[0] || [];
    }

    private static convertDeviceStatusToRecord(deviceStatus: DeviceStatus): Record<string, boolean> {
        const result: Record<string, boolean> = {};
        Object.keys(deviceStatus).forEach(key => {
            if (key !== 'ts' && typeof deviceStatus[key] === 'boolean') {
                result[key] = deviceStatus[key] as boolean;
            }
        });
        return result;
    }

    public static createTurnOffAllFansActions(reason: string, coilMapping: Record<string, number>): ControlAction[] {
        const actions: ControlAction[] = [];

        getAllFanKeys().forEach(fanKey => {
            const address = coilMapping[fanKey];
            if (address !== undefined) {
                actions.push({
                    deviceKey: fanKey,
                    value: false,
                    address: address,
                    fc: MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,
                    reason: reason
                });
            }
        });

        return actions;
    }

    private static getThresholdReason(temperature: number, humidity: number, thresholds: any): string {
        // K4 logic removed - threshold set to 99°C (never triggers)
        if (temperature >= thresholds.k3) {
            return `K3 threshold: temp=${temperature}°C (≥${thresholds.k3}°C), humidity=${humidity}%`;
        } else if (temperature >= thresholds.k2) {
            return `K2 threshold: temp=${temperature}°C (≥${thresholds.k2}°C), humidity=${humidity}%`;
        } else if (temperature >= thresholds.k1) {
            return `K1 threshold: temp=${temperature}°C (≥${thresholds.k1}°C), humidity=${humidity}%`;
        }

        return `Below K1 threshold: temp=${temperature}°C (<${thresholds.k1}°C), humidity=${humidity}%`;
    }

    private static arraysEqual(a: string[], b: string[]): boolean {
        if (a.length !== b.length) return false;
        return a.every((val, index) => val === b[index]);
    }
}
