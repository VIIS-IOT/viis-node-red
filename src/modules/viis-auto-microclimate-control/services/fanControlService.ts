/**
 * Fan Control Service for VIIS Auto Microclimate Control Node
 * Handles fan control logic including rotation and threshold modes
 */

import {
    IFanControlService,
    AutoControlConfig,
    SensorData,
    DeviceStatus,
    ControlAction,
    ServiceOptions,
    ILogger,
    FanRotationState,
    FanGroupTransitionState,
    TransitionPhase
} from "../interfaces/types";
import {
    CONTEXT_KEYS,
    FAN_CONFIG,
    FAN_DAO_CONFIG,
    FAN_TREN_CONFIG,
    WATER_PUMP_CONFIG,
    MODBUS_FUNCTION_CODES,
    CONTROL_CONFIG
} from "../constants";
import { Logger } from "../utils/logger";
import {
    getFanGroups,
    getNextGroupIndex,
    createFanGroupActions,
    createOptimizedFanGroupActions,
    createDelayedFanGroupActions,
    createFanDaoActions,
    getRecommendedGroupSize,
    getAllFanKeys
} from "../utils/groupUtils";
import { minutesToMs, hasTimeElapsed, getCurrentTimestamp } from "../utils/timeUtils";

export class FanControlService implements IFanControlService {
    private flowContext: any;
    private globalContext: any;
    private logger: ILogger;

    constructor(options: ServiceOptions) {
        this.flowContext = options.flowContext;
        this.globalContext = options.globalContext;
        this.logger = new Logger(options.node, options.nodeId);
    }

    /**
     * Process fan control based on configuration and sensor data
     */
    async processFanControl(
        config: AutoControlConfig,
        sensorData: SensorData,
        deviceStatus: DeviceStatus
    ): Promise<ControlAction[]> {
        const actions: ControlAction[] = [];

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
                } else {
                    const rotationActions = await this.processRotationMode(config);
                    actions.push(...rotationActions);
                }
            } else {
                // Threshold mode (default)
                if (useTransitions) {
                    const thresholdActions = await this.processThresholdModeWithTransition(config, sensorData, deviceStatus);
                    actions.push(...thresholdActions);

                    // // Always process K4 water wall actions even during transitions
                    // // This ensures bom_nuoc_1 and quat_tren_1 work correctly in K4 mode
                    // const k4Actions = await this.createK4WaterWallActions(config, sensorData);
                    // actions.push(...k4Actions);
                } else {
                    const thresholdActions = await this.processThresholdMode(config, sensorData, deviceStatus);
                    actions.push(...thresholdActions);
                }
            }

            // Process fan dao control
            const fanDaoActions = await this.processFanDaoControl(config);
            actions.push(...fanDaoActions);

            return actions;

        } catch (error) {
            this.logger.error(`Fan control processing error: ${(error as Error).message}`);
            return [];
        }
    }

    /**
     * Process rotation mode fan control
     */
    async processRotationMode(config: AutoControlConfig): Promise<ControlAction[]> {
        try {
            const groupSize = config.set_gr_alternate_fan || 2;
            const rotationInterval = minutesToMs(config.set_time_alternate_fan || 15);

            // Get fan groups
            const fanGroups = this.getFanGroups(groupSize);
            if (fanGroups.length === 0) {
                this.logger.warn("No fan groups available for rotation");
                return [];
            }

            // Get current rotation state
            let rotationState = this.getRotationState();

            // Check if it's time to rotate
            if (hasTimeElapsed(rotationState.lastRotationTime, rotationInterval)) {
                // Move to next group
                rotationState.currentGroupIndex = getNextGroupIndex(
                    rotationState.currentGroupIndex,
                    fanGroups.length
                );
                rotationState.lastRotationTime = getCurrentTimestamp();
                rotationState.activeGroup = fanGroups[rotationState.currentGroupIndex];

                // Save updated state
                this.saveRotationState(rotationState);

                this.logger.warn(`Fan rotation: switching to group ${rotationState.currentGroupIndex + 1}/${fanGroups.length} (${rotationState.activeGroup.join(', ')})`);
            }

            // Create actions for current active group with delay for smooth operation
            const coilMapping = this.getCoilMapping();
            const currentDeviceStatus = this.getCurrentDeviceStatus();
            return createDelayedFanGroupActions(
                rotationState.activeGroup,
                true,
                `Rotation mode: group ${rotationState.currentGroupIndex + 1} with 1s delay`,
                coilMapping,
                currentDeviceStatus,
                1000 // 1 second delay
            );

        } catch (error) {
            this.logger.error(`Rotation mode processing error: ${(error as Error).message}`);
            return [];
        }
    }

    /**
     * Process threshold mode fan control with anti-oscillation mechanisms
     */
    async processThresholdMode(config: AutoControlConfig, sensorData: SensorData, deviceStatus?: DeviceStatus): Promise<ControlAction[]> {
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
            const requiredGroupSize = getRecommendedGroupSize(tempIndoor, humiIndoor, thresholds, {
                currentGroupSize: currentActiveFanCount,
                hysteresis: CONTROL_CONFIG.THRESHOLD_HYSTERESIS_CELSIUS
            });

            this.logger.debug(`Threshold mode: temp=${tempIndoor}°C, humidity=${humiIndoor}%, current fans=${currentActiveFanCount}, required group size=${requiredGroupSize}`);

            // For threshold mode, we need to allow rotation even if the fan count matches
            // This is the key difference from the original logic that was causing the rotation bug
            // We should only skip if we're in the exact same group AND it's not time to rotate
            // IMPORTANT: Never skip K4 (requiredGroupSize === -1) as it has special logic
            if (currentActiveFanCount === requiredGroupSize && requiredGroupSize > 0) {
                // Check if we need to rotate within the same group size
                const fanGroups = this.getFanGroups(requiredGroupSize);
                if (fanGroups.length > 1) {
                    // Multiple groups available for this size - check if rotation is needed
                    const contextKey = `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_mode`;
                    const rotationState = this.flowContext.get(contextKey);
                    const rotationInterval = minutesToMs(config.set_time_alternate_fan || 15);

                    if (rotationState && hasTimeElapsed(rotationState.lastRotationTime, rotationInterval)) {
                        this.logger.debug(`Fan count matches but rotation is due: proceeding with rotation logic`);
                        // Continue with rotation logic below
                    } else {
                        this.logger.debug(`No change needed: current fan count (${currentActiveFanCount}) matches required (${requiredGroupSize}) and no rotation due`);
                        return []; // No action needed - already in correct state and no rotation due
                    }
                } else {
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
                    return createDelayedFanGroupActions([], false, reason, coilMapping, deviceStatusRecord, 1000);
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
            let targetGroup: string[];
            let additionalActions: ControlAction[] = [];

            // Always check K4 water wall actions to handle both entering and exiting K4
            additionalActions = await this.createK4WaterWallActions(config, sensorData);

            if (requiredGroupSize === -1) {
                // K4: Only water wall + quạt trên, NO fans from quat_1 to quat_5
                targetGroup = []; // K4 does not use any fans from quat_1 to quat_5
                this.logger.debug(`K4 threshold: using water wall + quạt trên only, NO fans from quat_1 to quat_5`);
            } else if (requiredGroupSize === 6) {
                // Legacy support: Use all 6 fans (no rotation needed)
                targetGroup = getAllFanKeys();
                this.logger.debug(`Legacy K3/K4 threshold: using all 6 fans [${targetGroup.join(', ')}]`);
            } else if (requiredGroupSize === 4) {
                // Legacy K2: Use rotation logic for 4-fan groups
                targetGroup = this.getRotationTargetGroup(fanGroups, requiredGroupSize, config);
                this.logger.debug(`Legacy K2 threshold: using 4-fan group [${targetGroup.join(', ')}]`);
            } else if (requiredGroupSize === 3) {
                // K3: Use rotation logic for 3-fan groups
                targetGroup = this.getRotationTargetGroup(fanGroups, requiredGroupSize, config);
                this.logger.debug(`K3 threshold: using 3-fan group [${targetGroup.join(', ')}]`);
            } else if (requiredGroupSize === 2) {
                // K2: Use rotation logic for 2-fan groups
                targetGroup = this.getRotationTargetGroup(fanGroups, requiredGroupSize, config);
                this.logger.debug(`K2 threshold: using 2-fan group [${targetGroup.join(', ')}]`);
            } else if (requiredGroupSize === 1) {
                // K1: Use rotation logic for 1-fan groups
                targetGroup = this.getRotationTargetGroup(fanGroups, requiredGroupSize, config);
                this.logger.debug(`K1 threshold: using 1-fan group [${targetGroup.join(', ')}]`);
            } else {
                // Fallback: use rotation logic for any other group size (but NOT for K4 which is -1)
                if (requiredGroupSize === -1) {
                    // This should never happen as K4 is handled above, but add safety check
                    this.logger.error(`K4 (requiredGroupSize=-1) should not reach fallback logic!`);
                    targetGroup = []; // K4 uses no fans from quat_1 to quat_5
                } else {
                    targetGroup = this.getRotationTargetGroup(fanGroups, requiredGroupSize, config);
                    this.logger.debug(`Custom group size ${requiredGroupSize}: using group [${targetGroup.join(', ')}]`);
                }
            }

            const reason = this.getThresholdReason(tempIndoor, humiIndoor, thresholds);
            const coilMapping = this.getCoilMapping();

            // Create fan control actions
            let fanActions: ControlAction[];
            if (deviceStatus) {
                const deviceStatusRecord = this.convertDeviceStatusToRecord(deviceStatus);
                fanActions = createOptimizedFanGroupActions(targetGroup, true, reason, coilMapping, deviceStatusRecord);
            } else {
                fanActions = createFanGroupActions(targetGroup, true, reason, coilMapping);
            }

            // Combine fan actions with additional K4 actions
            return [...fanActions, ...additionalActions];

        } catch (error) {
            this.logger.error(`Threshold mode processing error: ${(error as Error).message}`);
            return [];
        }
    }

    /**
     * Process fan dao (reverse fan) control
     */
    async processFanDaoControl(config: AutoControlConfig): Promise<ControlAction[]> {
        try {
            // Check if fan dao control is enabled
            if (config.set_mode_fan_dao !== 1) {
                this.logger.debug("Fan dao control is disabled");
                const coilMapping = this.getCoilMapping();
                return createFanDaoActions(false, "Fan dao control disabled", coilMapping);
            }

            const alternateInterval = minutesToMs(config.set_time_alternate_fan_dao || 5);

            // Get last fan dao state change time
            const lastFanDaoTime = this.flowContext.get(`${CONTEXT_KEYS.FAN_ROTATION_STATE}_dao_time`) || 0;
            const currentFanDaoState = this.flowContext.get(`${CONTEXT_KEYS.FAN_ROTATION_STATE}_dao_state`) || false;

            // Check if it's time to toggle fan dao state
            if (hasTimeElapsed(lastFanDaoTime, alternateInterval)) {
                const newState = !currentFanDaoState;

                // Save new state
                this.flowContext.set(`${CONTEXT_KEYS.FAN_ROTATION_STATE}_dao_time`, getCurrentTimestamp());
                this.flowContext.set(`${CONTEXT_KEYS.FAN_ROTATION_STATE}_dao_state`, newState);

                this.logger.warn(`Fan dao alternating: switching to ${newState ? 'ON' : 'OFF'}`);

                const coilMapping = this.getCoilMapping();
                return createFanDaoActions(newState, `Fan dao alternating mode: ${newState ? 'ON' : 'OFF'}`, coilMapping);
            }

            // No change needed
            return [];

        } catch (error) {
            this.logger.error(`Fan dao control processing error: ${(error as Error).message}`);
            return [];
        }
    }

    /**
     * Get fan groups based on group size
     */
    getFanGroups(groupSize: number): string[][] {
        return getFanGroups(groupSize);
    }

    /**
     * Get current rotation state
     */
    private getRotationState(): FanRotationState {
        const saved = this.flowContext.get(CONTEXT_KEYS.FAN_ROTATION_STATE);

        if (saved && typeof saved === 'object') {
            return saved;
        }

        // Initialize default state
        const defaultState: FanRotationState = {
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
    private saveRotationState(state: FanRotationState): void {
        this.flowContext.set(CONTEXT_KEYS.FAN_ROTATION_STATE, state);
    }

    /**
     * Convert DeviceStatus to Record<string, boolean> for compatibility
     */
    private convertDeviceStatusToRecord(deviceStatus: DeviceStatus): Record<string, boolean> {
        const result: Record<string, boolean> = {};

        // Extract only boolean properties, excluding 'ts'
        Object.keys(deviceStatus).forEach(key => {
            if (key !== 'ts' && typeof deviceStatus[key] === 'boolean') {
                result[key] = deviceStatus[key] as boolean;
            }
        });

        return result;
    }

    /**
     * Get coil mapping from global context or fallback to constants
     */
    private getCoilMapping(): Record<string, number> {
        const globalCoils = this.globalContext.get(CONTEXT_KEYS.GLOBAL_MODBUS_COILS) || {};

        // Merge with default mappings
        return {
            ...FAN_CONFIG.COIL_MAPPING,
            ...FAN_DAO_CONFIG.COIL_MAPPING,
            ...globalCoils
        };
    }

    /**
     * Get current active fan count from device status
     */
    private getCurrentActiveFanCount(deviceStatus?: DeviceStatus): number {
        if (!deviceStatus) {
            return 0;
        }

        let count = 0;
        const fanKeys = ['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'] as const;

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
    private createTurnOffAllFansActions(reason: string): ControlAction[] {
        const actions: ControlAction[] = [];
        const coilMapping = this.getCoilMapping();

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

    /**
     * Create actions to turn off all fans with delay
     */
    private createTurnOffAllFansActionsWithDelay(reason: string, delayMs: number = 1000): ControlAction[] {
        const actions: ControlAction[] = [];
        const coilMapping = this.getCoilMapping();

        getAllFanKeys().forEach(fanKey => {
            const address = coilMapping[fanKey];
            if (address !== undefined) {
                actions.push({
                    deviceKey: fanKey,
                    value: false,
                    address: address,
                    fc: MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,
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
    private getRotationTargetGroup(fanGroups: string[][], requiredGroupSize: number, config: AutoControlConfig): string[] {
        // Use same rotation interval as pure rotation mode
        const rotationInterval = minutesToMs(config.set_time_alternate_fan || 15);

        // Use simplified context key for threshold mode rotation
        const contextKey = `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold`;
        let rotationState = this.flowContext.get(contextKey);

        // Clean up old context keys to prevent confusion
        this.cleanupOldThresholdRotationKeys();

        // Initialize rotation state if not exists or invalid (same as pure rotation)
        if (!rotationState || typeof rotationState !== 'object' || !Array.isArray(rotationState.activeGroup)) {
            rotationState = {
                currentGroupIndex: 0,
                lastRotationTime: getCurrentTimestamp(),
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
        const shouldRotate = hasTimeElapsed(rotationState.lastRotationTime, rotationInterval);
        const timeSinceLastRotation = getCurrentTimestamp() - rotationState.lastRotationTime;

        this.logger.debug(`Threshold rotation timing: ${Math.round(timeSinceLastRotation / 1000)}s elapsed, ${Math.round(rotationInterval / 1000)}s interval, rotate=${shouldRotate}`);

        if (shouldRotate) {
            const previousGroup = [...rotationState.activeGroup];

            // Move to next group (identical logic to pure rotation mode)
            rotationState.currentGroupIndex = getNextGroupIndex(
                rotationState.currentGroupIndex,
                fanGroups.length
            );
            rotationState.lastRotationTime = getCurrentTimestamp();
            rotationState.activeGroup = fanGroups[rotationState.currentGroupIndex];

            // Save updated state
            this.flowContext.set(contextKey, rotationState);

            this.logger.warn(`🔄 Threshold rotation: [${previousGroup.join(',')}] → [${rotationState.activeGroup.join(',')}] (${requiredGroupSize} fans)`);
            this.logger.warn(`📊 Group ${rotationState.currentGroupIndex + 1}/${fanGroups.length}, interval: ${config.set_time_alternate_fan || 15}min`);
        } else {
            this.logger.debug(`⏳ Threshold rotation: maintaining group [${rotationState.activeGroup.join(',')}]`);
        }

        // Validate and fix any inconsistencies (skip validation for K4 which has requiredGroupSize = -1)
        if (requiredGroupSize !== -1 && (!rotationState.activeGroup || rotationState.activeGroup.length !== requiredGroupSize)) {
            this.logger.warn(`🔧 Fixing invalid group size: expected ${requiredGroupSize}, got ${rotationState.activeGroup?.length || 0}`);
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
    private cleanupOldThresholdRotationKeys(): void {
        const oldKeys = [
            `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_mode`,
            `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_1`,
            `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_2`,
            `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_4`,
            `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_6`
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
    private arraysEqual(a: string[], b: string[]): boolean {
        if (a.length !== b.length) return false;
        return a.every((val, index) => val === b[index]);
    }

    /**
     * Get reason string for threshold mode (temperature-based only)
     */
    private getThresholdReason(temperature: number, humidity: number, thresholds: any): string {
        if (temperature >= thresholds.k4) {
            return `K4 threshold: temp=${temperature}°C (≥${thresholds.k4}°C), humidity=${humidity}%`;
        } else if (temperature >= thresholds.k3) {
            return `K3 threshold: temp=${temperature}°C (≥${thresholds.k3}°C), humidity=${humidity}%`;
        } else if (temperature >= thresholds.k2) {
            return `K2 threshold: temp=${temperature}°C (≥${thresholds.k2}°C), humidity=${humidity}%`;
        } else if (temperature >= thresholds.k1) {
            return `K1 threshold: temp=${temperature}°C (≥${thresholds.k1}°C), humidity=${humidity}%`;
        }

        return `Below K1 threshold: temp=${temperature}°C (<${thresholds.k1}°C), humidity=${humidity}%`;
    }

    /**
     * Process rotation mode with transition support
     */
    async processRotationModeWithTransition(config: AutoControlConfig): Promise<ControlAction[]> {
        try {
            const groupSize = config.set_gr_alternate_fan || 2;
            const rotationInterval = minutesToMs(config.set_time_alternate_fan || 15);

            // Get fan groups
            const fanGroups = this.getFanGroups(groupSize);
            if (fanGroups.length === 0) {
                this.logger.warn("No fan groups available for rotation");
                return [];
            }

            // Get current rotation state
            let rotationState = this.getRotationState();

            // Check if it's time to rotate
            if (hasTimeElapsed(rotationState.lastRotationTime, rotationInterval)) {
                const previousGroup = [...rotationState.activeGroup];

                // Move to next group
                rotationState.currentGroupIndex = getNextGroupIndex(
                    rotationState.currentGroupIndex,
                    fanGroups.length
                );
                rotationState.lastRotationTime = getCurrentTimestamp();
                rotationState.activeGroup = fanGroups[rotationState.currentGroupIndex];

                // Save updated state
                this.saveRotationState(rotationState);

                const reason = `Fan rotation: switching to group ${rotationState.currentGroupIndex + 1}/${fanGroups.length} (${rotationState.activeGroup.join(', ')})`;
                this.logger.warn(reason);

                // Check if transition is needed
                if (this.requiresGroupTransition(previousGroup, rotationState.activeGroup)) {
                    this.initiateFanGroupTransition(previousGroup, rotationState.activeGroup, reason);
                    return []; // Transition will be handled in next cycle
                } else {
                    // No transition needed, create actions directly
                    const coilMapping = this.getCoilMapping();
                    return createFanGroupActions(
                        rotationState.activeGroup,
                        true,
                        reason,
                        coilMapping
                    );
                }
            }

            // No rotation needed, maintain current group
            const coilMapping = this.getCoilMapping();
            return createFanGroupActions(
                rotationState.activeGroup,
                true,
                `Rotation mode: maintaining group ${rotationState.currentGroupIndex + 1}/${fanGroups.length}`,
                coilMapping
            );

        } catch (error) {
            this.logger.error(`Rotation mode processing error: ${(error as Error).message}`);
            return [];
        }
    }

    /**
     * Process threshold mode with transition support
     */
    async processThresholdModeWithTransition(config: AutoControlConfig, sensorData: SensorData, deviceStatus: DeviceStatus): Promise<ControlAction[]> {
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
                k1: config.set_k1_fan || FAN_CONFIG.DEFAULT_TEMPERATURE_THRESHOLDS.K1,
                k2: config.set_k2_fan || FAN_CONFIG.DEFAULT_TEMPERATURE_THRESHOLDS.K2,
                k3: config.set_k3_fan || FAN_CONFIG.DEFAULT_TEMPERATURE_THRESHOLDS.K3,
                k4: config.set_k4_fan || FAN_CONFIG.DEFAULT_TEMPERATURE_THRESHOLDS.K4
            };

            const reason = this.getThresholdReason(temperature, humidity, thresholds);
            const coilMapping = this.getCoilMapping();
            const deviceStatusRecord = this.convertDeviceStatusToRecord(deviceStatus);

            // Get current active fan count for hysteresis calculation
            const currentActiveFanCount = this.getCurrentActiveFanCount(deviceStatus);

            // Determine required group size with hysteresis to prevent oscillation
            const requiredGroupSize = getRecommendedGroupSize(temperature, humidity, thresholds, {
                currentGroupSize: currentActiveFanCount,
                hysteresis: CONTROL_CONFIG.THRESHOLD_HYSTERESIS_CELSIUS
            });

            this.logger.debug(`Threshold mode with transition: temp=${temperature}°C, humidity=${humidity}%, current fans=${currentActiveFanCount}, required group size=${requiredGroupSize}`);

            if (requiredGroupSize === 0) {
                // No fans needed - turn off all fans
                return createOptimizedFanGroupActions([], false, reason, coilMapping, deviceStatusRecord);
            }

            // Get appropriate fan groups and target group
            const fanGroups = this.getFanGroups(requiredGroupSize);
            if (fanGroups.length === 0) {
                this.logger.warn(`No fan groups available for size ${requiredGroupSize}`);
                return [];
            }

            let targetGroup: string[];

            if (requiredGroupSize === -1) {
                // K4: Special case - no fans from quat_1 to quat_5, only water wall + quat_tren_1
                targetGroup = [];
                this.logger.debug(`K4 threshold: no fans from quat_1 to quat_5, using water wall + quat_tren_1 only`);
            } else if (requiredGroupSize === 6) {
                // K3 or legacy K4: Use all 6 fans (no rotation needed)
                targetGroup = getAllFanKeys();
                this.logger.debug(`K3/legacy K4 threshold: using all fans [${targetGroup.join(', ')}]`);
            } else {
                // K1, K2, or other sizes: Use simplified rotation logic
                targetGroup = this.getRotationTargetGroup(fanGroups, requiredGroupSize, config);
                this.logger.debug(`Threshold (${requiredGroupSize} fans): using group [${targetGroup.join(', ')}]`);
            }

            // Get current active fans
            const currentActiveFans = Object.keys(deviceStatusRecord).filter(key =>
                deviceStatusRecord[key] === true && getAllFanKeys().includes(key)
            );

            // Add comprehensive logging for threshold mode transitions
            this.logger.warn(`🔄 Threshold Analysis: temp=${temperature}°C, required=${requiredGroupSize} fans, current=[${currentActiveFans.join(',')}], target=[${targetGroup.join(',')}]`);

            // Log rotation state for debugging and check for threshold level changes
            const contextKey = `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold`;
            const rotationState = this.flowContext.get(contextKey);
            if (rotationState) {
                this.logger.warn(`📊 Rotation State: savedGroupSize=${rotationState.requiredGroupSize}, currentGroupIndex=${rotationState.currentGroupIndex}, activeGroup=[${rotationState.activeGroup?.join(',') || 'none'}]`);
            } else {
                this.logger.warn(`📊 Rotation State: No saved state found`);
            }

            // Check if this is a threshold level change (K1↔K2↔K3↔K4) that requires special handling
            const isThresholdLevelChange = rotationState && rotationState.requiredGroupSize !== requiredGroupSize;

            // Handle K4 special case - add water wall actions
            let additionalActions: ControlAction[] = [];
            if (requiredGroupSize === -1) {
                // K4: Add water wall and quat_tren_1 actions
                additionalActions = await this.createK4WaterWallActions(config, { temp_indoor: temperature, humi_indoor: humidity, ts: Date.now() });
            }

            if (isThresholdLevelChange) {
                // Threshold level changed - use transition for smooth change
                this.logger.warn(`🔄 Threshold level change: ${rotationState.requiredGroupSize} → ${requiredGroupSize} fans, using transition`);
                this.initiateFanGroupTransition(currentActiveFans, targetGroup, reason);
                return []; // K4 actions will be handled separately in main control flow
            } else {
                // Normal rotation within same threshold level - use delayed control for smooth operation
                this.logger.debug(`✅ Normal rotation: delayed control [${targetGroup.join(',')}] with 1s delay`);
                const fanActions = createDelayedFanGroupActions(targetGroup, true, reason, coilMapping, deviceStatusRecord, 1000);
                return [...fanActions, ...additionalActions];
            }

        } catch (error) {
            this.logger.error(`Threshold mode processing error: ${(error as Error).message}`);
            return [];
        }
    }

    /**
     * Get fan group transition delay configuration
     */
    private getFanGroupTransitionDelayMs(config: AutoControlConfig): number {
        const delaySeconds = config.set_fan_group_transition_delay !== undefined ?
            config.set_fan_group_transition_delay :
            (CONTROL_CONFIG.FAN_GROUP_TRANSITION_DELAY_MS / 1000);
        return delaySeconds * 1000;
    }

    /**
     * Get fan group off delay configuration
     */
    private getFanGroupOffDelayMs(config: AutoControlConfig): number {
        const delaySeconds = config.set_fan_group_off_delay !== undefined ?
            config.set_fan_group_off_delay :
            (CONTROL_CONFIG.FAN_GROUP_OFF_DELAY_MS / 1000);
        return delaySeconds * 1000;
    }

    /**
     * Get current fan group transition state
     */
    private getFanGroupTransitionState(): FanGroupTransitionState | null {
        const state = this.flowContext.get(CONTEXT_KEYS.FAN_GROUP_TRANSITION_STATE);
        return state || null;
    }

    /**
     * Save fan group transition state
     */
    private saveFanGroupTransitionState(state: FanGroupTransitionState): void {
        this.flowContext.set(CONTEXT_KEYS.FAN_GROUP_TRANSITION_STATE, state);
    }

    /**
     * Clear fan group transition state
     */
    private clearFanGroupTransitionState(): void {
        this.flowContext.set(CONTEXT_KEYS.FAN_GROUP_TRANSITION_STATE, null);
    }

    /**
     * Check if fan groups are different (requires transition)
     */
    private requiresGroupTransition(currentGroup: string[], newGroup: string[]): boolean {
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
    private requiresStableGroupTransition(currentGroup: string[], newGroup: string[], requiredGroupSize: number, config?: AutoControlConfig): boolean {
        // If we're already in a transition, don't start another one
        if (this.isTransitionInProgress()) {
            return false;
        }

        // Check if we have a recent transition completion (cooldown period)
        const lastTransitionKey = `${CONTEXT_KEYS.FAN_GROUP_TRANSITION_STATE}_last_completion`;
        const lastTransitionTime = this.flowContext.get(lastTransitionKey) || 0;
        const cooldownMs = 3000; // 3 second cooldown after transition completion

        if (hasTimeElapsed(lastTransitionTime, cooldownMs) === false) {
            this.logger.debug(`Transition cooldown active, skipping new transition (${cooldownMs - (getCurrentTimestamp() - lastTransitionTime)}ms remaining)`);
            return false;
        }

        // Check if the required group size has changed (e.g., K1 → K2 threshold change)
        // This is critical for proper threshold mode transitions
        const contextKey = `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold`;
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
    private initiateFanGroupTransition(
        previousGroup: string[],
        nextGroup: string[],
        reason: string
    ): void {
        const transitionState: FanGroupTransitionState = {
            isTransitioning: true,
            phase: TransitionPhase.OFF,
            previousGroup: [...previousGroup],
            nextGroup: [...nextGroup],
            transitionStartTime: getCurrentTimestamp(),
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
    async processFanGroupTransition(config: AutoControlConfig): Promise<ControlAction[]> {
        const transitionState = this.getFanGroupTransitionState();
        if (!transitionState || !transitionState.isTransitioning) {
            return [];
        }

        const now = getCurrentTimestamp();
        const coilMapping = this.getCoilMapping();
        const actions: ControlAction[] = [];

        switch (transitionState.phase) {
            case TransitionPhase.OFF:
                // Turn off ALL fans to ensure clean slate for transition
                // This prevents accumulation of active fans from previous transitions
                const offActions = this.createTurnOffAllFansActions(
                    `Transition phase 1: Turn off all fans for clean transition - ${transitionState.reason}`
                );
                actions.push(...offActions);

                // Move to delay phase
                transitionState.phase = TransitionPhase.DELAY;
                transitionState.offDelayStartTime = now;
                this.saveFanGroupTransitionState(transitionState);
                this.logger.warn(`Fan transition: All fans turned off, starting delay phase`);
                break;

            case TransitionPhase.DELAY:
                // Check if delay period has elapsed
                const offDelayMs = this.getFanGroupOffDelayMs(config);
                if (hasTimeElapsed(transitionState.offDelayStartTime, offDelayMs)) {
                    // Move to on phase
                    transitionState.phase = TransitionPhase.ON;
                    this.saveFanGroupTransitionState(transitionState);
                    this.logger.warn(`Fan transition: Delay completed (${offDelayMs}ms), turning on new group`);
                } else {
                    // Still in delay, no actions
                    const remaining = offDelayMs - (now - transitionState.offDelayStartTime);
                    this.logger.debug(`Fan transition: Delay in progress, ${remaining}ms remaining`);
                }
                break;

            case TransitionPhase.ON:
                // Turn on new group using non-optimized function to ensure proper fan control
                // This ensures that only the target group is on and all others are explicitly off
                if (transitionState.nextGroup.length > 0) {
                    const onActions = createFanGroupActions(
                        transitionState.nextGroup,
                        true,
                        `Transition phase 2: Turn on new group - ${transitionState.reason}`,
                        coilMapping
                    );
                    actions.push(...onActions);
                } else {
                    // If no target group, ensure all fans are off
                    const offActions = this.createTurnOffAllFansActions(
                        `Transition phase 2: No target group, turn off all fans - ${transitionState.reason}`
                    );
                    actions.push(...offActions);
                }

                // Move to complete phase
                transitionState.phase = TransitionPhase.COMPLETE;
                this.saveFanGroupTransitionState(transitionState);
                this.logger.warn(`Fan transition: New group activated, transition completing`);
                break;

            case TransitionPhase.COMPLETE:
                // Check if overall transition delay has elapsed
                const transitionDelayMs = this.getFanGroupTransitionDelayMs(config);
                if (hasTimeElapsed(transitionState.transitionStartTime, transitionDelayMs)) {
                    // Transition complete, clear state and set cooldown timestamp
                    this.clearFanGroupTransitionState();

                    // Set last completion time for cooldown logic
                    const lastTransitionKey = `${CONTEXT_KEYS.FAN_GROUP_TRANSITION_STATE}_last_completion`;
                    this.flowContext.set(lastTransitionKey, getCurrentTimestamp());

                    this.logger.warn(`Fan group transition completed successfully`);
                } else {
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
    private isTransitionInProgress(): boolean {
        const transitionState = this.getFanGroupTransitionState();
        return transitionState?.isTransitioning === true;
    }

    /**
     * Get current device status from global context
     */
    public getCurrentDeviceStatus(): Record<string, boolean> {
        const coilData = this.globalContext.get(CONTEXT_KEYS.GLOBAL_COIL_REGISTER_DATA) || {};
        const deviceStatus: Record<string, boolean> = {};

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
    private logRotationState(context: string): void {
        const contextKey = `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold`;
        const rotationState = this.flowContext.get(contextKey);

        if (rotationState) {
            this.logger.debug(`[${context}] Rotation state: group ${rotationState.currentGroupIndex + 1}, active=[${rotationState.activeGroup?.join(',') || 'none'}], size=${rotationState.requiredGroupSize}`);
        } else {
            this.logger.debug(`[${context}] No rotation state found`);
        }
    }

    /**
     * Force clear all rotation states - useful for debugging
     */
    public clearAllRotationStates(): void {
        const allKeys = [
            `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold`,
            `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_mode`,
            `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_1`,
            `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_2`,
            `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_4`,
            `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_6`
        ];

        this.logger.warn(`🧹 Clearing all rotation states: ${allKeys.join(', ')}`);

        allKeys.forEach(key => {
            this.flowContext.set(key, null);
        });

        this.logger.warn("All rotation states cleared. Next execution will reinitialize state.");
    }

    /**
     * Create K4 water wall actions (water pump + quạt trên)
     */
    private async createK4WaterWallActions(config: AutoControlConfig, sensorData: SensorData): Promise<ControlAction[]> {
        try {
            const actions: ControlAction[] = [];
            const coilMapping = this.getCoilMapping();
            const tempIndoor = sensorData.temp_indoor;
            const k4Threshold = config.set_k4_fan || 40;

            // Check if we're still in K4 conditions
            const isK4Active = tempIndoor >= k4Threshold;

            if (!isK4Active) {
                // Temperature dropped below K4, turn off water wall components and all fans
                this.logger.debug(`Temperature ${tempIndoor}°C below K4 threshold ${k4Threshold}°C, turning off water wall and all fans`);

                // Turn off water pump
                const pumpAddress = coilMapping["bom_nuoc_1"];
                if (pumpAddress !== undefined) {
                    actions.push({
                        deviceKey: "bom_nuoc_1",
                        value: false,
                        address: pumpAddress,
                        fc: MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,
                        reason: `K4 ended: temp=${tempIndoor}°C < ${k4Threshold}°C`
                    });
                }

                // Turn off quạt trên
                const fanTrenAddress = coilMapping["quat_tren_1"];
                if (fanTrenAddress !== undefined) {
                    actions.push({
                        deviceKey: "quat_tren_1",
                        value: false,
                        address: fanTrenAddress,
                        fc: MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,
                        reason: `K4 ended: temp=${tempIndoor}°C < ${k4Threshold}°C`
                    });
                }

                // Turn off all fans from quat_1 to quat_5 (K4 should not use these fans)
                const fanKeys = ["quat_1", "quat_2", "quat_3", "quat_4", "quat_5"];
                fanKeys.forEach(fanKey => {
                    const fanAddress = coilMapping[fanKey];
                    if (fanAddress !== undefined) {
                        actions.push({
                            deviceKey: fanKey,
                            value: false,
                            address: fanAddress,
                            fc: MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,
                            reason: `K4 ended: turn off ${fanKey} (K4 does not use quat_1 to quat_5)`
                        });
                    }
                });

                // Clear K4 state
                this.flowContext.set(`${CONTEXT_KEYS.FAN_ROTATION_STATE}_k4_state`, null);

                return actions;
            }

            // K4 is active, manage water wall sequence
            const k4State = this.flowContext.get(`${CONTEXT_KEYS.FAN_ROTATION_STATE}_k4_state`) || {};
            const now = getCurrentTimestamp();

            if (!k4State.waterWallStarted) {
                // Start water wall sequence
                this.logger.warn(`K4 activated: temp=${tempIndoor}°C ≥ ${k4Threshold}°C, starting water wall sequence`);

                // Turn on water pump for 20 seconds
                const pumpAddress = coilMapping["bom_nuoc_1"];
                if (pumpAddress !== undefined) {
                    actions.push({
                        deviceKey: "bom_nuoc_1",
                        value: true,
                        address: pumpAddress,
                        fc: MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,
                        reason: `K4 water wall: start 20s pump cycle`
                    });
                }

                // Update state
                k4State.waterWallStarted = true;
                k4State.pumpStartTime = now;
                k4State.pumpRunning = true;
                k4State.fanTrenRunning = false;
                this.flowContext.set(`${CONTEXT_KEYS.FAN_ROTATION_STATE}_k4_state`, k4State);

            } else if (k4State.pumpRunning && hasTimeElapsed(k4State.pumpStartTime, WATER_PUMP_CONFIG.WATER_WALL_DURATION)) {
                // 20 seconds elapsed, turn off pump and turn on quạt trên
                this.logger.warn(`K4 water wall: 20s pump cycle completed, turning on quạt trên`);

                // Turn off water pump
                const pumpAddress = coilMapping["bom_nuoc_1"];
                if (pumpAddress !== undefined) {
                    actions.push({
                        deviceKey: "bom_nuoc_1",
                        value: false,
                        address: pumpAddress,
                        fc: MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,
                        reason: `K4 water wall: 20s pump cycle completed`
                    });
                }

                // Turn on quạt trên (no delay as requested)
                const fanTrenAddress = coilMapping["quat_tren_1"];
                if (fanTrenAddress !== undefined) {
                    actions.push({
                        deviceKey: "quat_tren_1",
                        value: true,
                        address: fanTrenAddress,
                        fc: MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,
                        reason: `K4 water wall: start quạt trên continuous operation`
                    });
                }

                // Update state
                k4State.pumpRunning = false;
                k4State.fanTrenRunning = true;
                k4State.fanTrenStartTime = now;
                this.flowContext.set(`${CONTEXT_KEYS.FAN_ROTATION_STATE}_k4_state`, k4State);

            } else if (k4State.fanTrenRunning) {
                // Quạt trên is running continuously, no action needed
                // It will continue until temperature drops below K4 threshold
                this.logger.debug(`K4 water wall: quạt trên running continuously, temp=${tempIndoor}°C`);
            }

            return actions;

        } catch (error) {
            this.logger.error(`K4 water wall actions error: ${(error as Error).message}`);
            return [];
        }
    }
}
