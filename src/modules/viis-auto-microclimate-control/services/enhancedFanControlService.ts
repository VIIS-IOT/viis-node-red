/**
 * Enhanced Fan Control Service
 * Integrates state machine, centralized state management, and synchronization
 */

import {
    IFanControlService,
    AutoControlConfig,
    SensorData,
    DeviceStatus,
    ControlAction,
    ServiceOptions,
    ILogger,
    FanControlState,
    FanControlMode,
    StateOperationResult
} from "../interfaces/types";
import { FanControlStateManager } from "./stateManager";
import { FanControlStateMachine } from "./fanStateMachine";
import { SynchronizationService } from "./synchronizationService";
import { FanControlCore, FanControlContext } from "./fanControlCore";
import { Logger } from "../utils/logger";
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
import { FAN_CONFIG, FAN_DAO_CONFIG, MODBUS_FUNCTION_CODES, CONTROL_CONFIG } from "../constants";

export class EnhancedFanControlService implements IFanControlService {
    private stateManager: FanControlStateManager;
    private stateMachine: FanControlStateMachine;
    private synchronizationService: SynchronizationService;
    private logger: ILogger;
    private flowContext: any;
    private globalContext: any;

    constructor(options: ServiceOptions) {
        this.flowContext = options.flowContext;
        this.globalContext = options.globalContext;
        this.logger = new Logger(options.node, options.nodeId);

        // Initialize services
        this.stateManager = new FanControlStateManager(this.flowContext, this.logger);
        this.stateMachine = new FanControlStateMachine(this.stateManager, this.logger);
        this.synchronizationService = new SynchronizationService(this.flowContext, this.logger);

        // Perform initial maintenance
        this.performMaintenance();
    }

    /**
     * Main fan control processing with enhanced state management
     */
    async processFanControl(
        config: AutoControlConfig,
        sensorData: SensorData,
        deviceStatus: DeviceStatus
    ): Promise<ControlAction[]> {
        return this.synchronizationService.withLock(
            'fan_control_main',
            async () => {
                try {
                    // Update control mode based on configuration
                    await this.updateControlMode(config);

                    // Process through state machine
                    const fanActions = await this.stateMachine.process(config, sensorData, deviceStatus);

                    // Process fan dao control (independent of main fan control)
                    const fanDaoActions = await this.processFanDaoControl(config);

                    return [...fanActions, ...fanDaoActions];

                } catch (error) {
                    this.logger.error(`Enhanced fan control processing error: ${(error as Error).message}`);
                    await this.stateManager.handleError((error as Error).message);
                    return [];
                }
            },
            { timeout: 10000, retryAttempts: 3 }
        );
    }

    /**
     * Process rotation mode with state machine integration
     */
    async processRotationMode(config: AutoControlConfig): Promise<ControlAction[]> {
        return this.synchronizationService.withLock(
            'fan_rotation',
            async () => {
                const state = this.stateManager.getState();

                if (state.currentState !== FanControlState.ROTATION_ACTIVE) {
                    this.logger.debug("Not in rotation active state, skipping rotation processing");
                    return [];
                }

                // Use core logic for rotation
                const coreContext: FanControlContext = {
                    config,
                    sensorData: { temp_indoor: 0, humi_indoor: 0, light_indoor: 0, ts: Date.now() }, // Not used in rotation
                    deviceStatus: { ts: Date.now() }, // Not used in rotation
                    currentRotationState: state.rotationState,
                    coilMapping: this.getCoilMapping(),
                    logger: this.logger
                };

                const result = FanControlCore.executeRotationMode(coreContext);

                // Update rotation state if changed
                if (result.newRotationState) {
                    const updateResult = await this.stateManager.updateRotationState(result.newRotationState);
                    if (!updateResult.success) {
                        this.logger.error(`Failed to update rotation state: ${updateResult.error}`);
                        return [];
                    }
                }

                // Handle transition requirement
                if (result.requiresTransition && result.transitionInfo && this.areTransitionsEnabled(config)) {
                    await this.stateManager.startTransition(
                        result.transitionInfo.previousGroup,
                        result.transitionInfo.nextGroup,
                        result.transitionInfo.reason
                    );
                    return []; // Transition will be handled by state machine
                }

                return result.actions;
            }
        );
    }

    /**
     * Process threshold mode with state machine integration
     */
    async processThresholdMode(
        config: AutoControlConfig,
        sensorData: SensorData,
        deviceStatus?: DeviceStatus
    ): Promise<ControlAction[]> {
        return this.synchronizationService.withLock(
            'fan_threshold',
            async () => {
                const state = this.stateManager.getState();

                if (state.currentState !== FanControlState.THRESHOLD_ACTIVE) {
                    this.logger.debug("Not in threshold active state, skipping threshold processing");
                    return [];
                }

                if (!deviceStatus) {
                    this.logger.warn("Device status required for threshold mode");
                    return [];
                }

                // Use core logic for threshold mode
                const coreContext: FanControlContext = {
                    config,
                    sensorData,
                    deviceStatus,
                    currentRotationState: { currentGroupIndex: 0, lastRotationTime: 0, activeGroup: [] }, // Not used
                    coilMapping: this.getCoilMapping(),
                    logger: this.logger
                };

                const result = FanControlCore.executeThresholdMode(coreContext);

                // Handle transition requirement
                if (result.requiresTransition && this.areTransitionsEnabled(config)) {
                    const currentActiveFans = Object.keys(deviceStatus).filter(key =>
                        deviceStatus[key] === true && getAllFanKeys().includes(key)
                    );

                    await this.stateManager.startTransition(currentActiveFans, result.targetGroup, result.reason);
                    return []; // Transition will be handled by state machine
                }

                return result.actions;
            }
        );
    }

    /**
     * Get fan groups (delegated to utility)
     */
    getFanGroups(groupSize: number): string[][] {
        return getFanGroups(groupSize);
    }

    /**
     * Process fan dao control with synchronization
     */
    private async processFanDaoControl(config: AutoControlConfig): Promise<ControlAction[]> {
        return this.synchronizationService.withLock(
            'fan_dao_control',
            async () => {
                try {
                    // Get current fan dao state
                    const lastFanDaoTime = this.flowContext.get('fan_dao_last_time') || 0;
                    const currentFanDaoState = this.flowContext.get('fan_dao_current_state') || false;
                    const coilMapping = this.getCoilMapping();

                    // Use core logic for fan dao control
                    const result = FanControlCore.executeFanDaoControl(
                        config,
                        lastFanDaoTime,
                        currentFanDaoState,
                        coilMapping,
                        this.logger
                    );

                    // Update state if changed
                    if (result.newState) {
                        this.flowContext.set('fan_dao_last_time', result.newState.time);
                        this.flowContext.set('fan_dao_current_state', result.newState.state);
                    }

                    return result.actions;

                } catch (error) {
                    this.logger.error(`Fan dao control processing error: ${(error as Error).message}`);
                    return [];
                }
            }
        );
    }

    /**
     * Update control mode based on configuration
     */
    private async updateControlMode(config: AutoControlConfig): Promise<void> {
        let targetMode: FanControlMode;

        if (config.set_mode_fan !== 1) {
            targetMode = FanControlMode.DISABLED;
        } else if (config.set_auto_mode_fan === 1) {
            targetMode = FanControlMode.ROTATION;
        } else {
            targetMode = FanControlMode.THRESHOLD;
        }

        const result = await this.stateManager.updateControlMode(targetMode);
        if (!result.success) {
            this.logger.error(`Failed to update control mode: ${result.error}`);
        }
    }

    /**
     * Get threshold target group with rotation logic
     */
    private async getThresholdTargetGroup(requiredGroupSize: number, config: AutoControlConfig): Promise<string[]> {
        if (requiredGroupSize === 6) {
            // Use all fans for K3/K4
            return getAllFanKeys();
        }

        // For smaller groups, use rotation logic
        const fanGroups = getFanGroups(requiredGroupSize);
        if (fanGroups.length === 0) {
            return [];
        }

        // Get or create threshold rotation state for this group size
        let thresholdRotationState = this.stateManager.getThresholdRotationState(requiredGroupSize);

        if (!thresholdRotationState) {
            // Initialize new threshold rotation state
            thresholdRotationState = {
                currentGroupIndex: 0,
                lastRotationTime: getCurrentTimestamp(),
                activeGroup: fanGroups[0]
            };

            await this.stateManager.updateThresholdRotationState(requiredGroupSize, thresholdRotationState);
        }

        // Check if rotation is needed
        const rotationInterval = minutesToMs(config.set_time_alternate_fan || 15);
        if (hasTimeElapsed(thresholdRotationState.lastRotationTime, rotationInterval)) {
            const nextGroupIndex = getNextGroupIndex(
                thresholdRotationState.currentGroupIndex,
                fanGroups.length
            );

            const updatedState = {
                currentGroupIndex: nextGroupIndex,
                lastRotationTime: getCurrentTimestamp(),
                activeGroup: fanGroups[nextGroupIndex]
            };

            await this.stateManager.updateThresholdRotationState(requiredGroupSize, updatedState);

            this.logger.warn(`Threshold rotation: switching to group ${nextGroupIndex + 1}/${fanGroups.length} for size ${requiredGroupSize}`);

            return updatedState.activeGroup;
        }

        return thresholdRotationState.activeGroup;
    }

    /**
     * Check if group transition is required
     */
    private requiresGroupTransition(currentGroup: string[], newGroup: string[]): boolean {
        if (currentGroup.length !== newGroup.length) {
            return true;
        }

        const sortedCurrent = [...currentGroup].sort();
        const sortedNew = [...newGroup].sort();

        return !sortedCurrent.every((fan, index) => fan === sortedNew[index]);
    }

    /**
     * Check if stable group transition is required (prevents unnecessary transitions)
     */
    private requiresStableGroupTransition(
        currentGroup: string[],
        newGroup: string[],
        requiredGroupSize: number,
        config: AutoControlConfig
    ): boolean {
        // If already transitioning, don't start another
        if (this.stateManager.isTransitionInProgress()) {
            return false;
        }

        // If current group size matches required and fans are valid, check rotation timing
        if (currentGroup.length === requiredGroupSize && currentGroup.length > 0) {
            const allValidFans = currentGroup.every(fan => getAllFanKeys().includes(fan));
            if (allValidFans) {
                const isDifferentGroup = !this.arraysEqual(currentGroup.sort(), newGroup.sort());
                if (!isDifferentGroup) {
                    return false; // Same group, no transition needed
                }

                // Check rotation timing to prevent premature transitions
                const rotationInterval = minutesToMs(config.set_time_alternate_fan || 15);
                const thresholdRotationState = this.stateManager.getThresholdRotationState(requiredGroupSize);

                if (thresholdRotationState) {
                    const timeSinceLastRotation = getCurrentTimestamp() - thresholdRotationState.lastRotationTime;
                    if (timeSinceLastRotation < rotationInterval * 0.9) {
                        return false; // Too soon to rotate
                    }
                }
            }
        }

        return this.requiresGroupTransition(currentGroup, newGroup);
    }

    /**
     * Check if transitions are enabled
     */
    private areTransitionsEnabled(config: AutoControlConfig): boolean {
        const transitionDelayMs = (config.set_fan_group_transition_delay || 0) * 1000;
        const offDelayMs = (config.set_fan_group_off_delay || 0) * 1000;
        return transitionDelayMs > 0 || offDelayMs > 0;
    }

    /**
     * Get coil mapping from global context
     */
    private getCoilMapping(): Record<string, number> {
        const globalCoils = this.globalContext.get('modbusCoils') || {};
        return {
            ...FAN_CONFIG.COIL_MAPPING,
            ...FAN_DAO_CONFIG.COIL_MAPPING,
            ...globalCoils
        };
    }

    /**
     * Convert DeviceStatus to Record<string, boolean>
     */
    private convertDeviceStatusToRecord(deviceStatus: DeviceStatus): Record<string, boolean> {
        const result: Record<string, boolean> = {};
        Object.keys(deviceStatus).forEach(key => {
            if (key !== 'ts' && typeof deviceStatus[key] === 'boolean') {
                result[key] = deviceStatus[key] as boolean;
            }
        });
        return result;
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
     * Get threshold reason string
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
     * Helper method to compare arrays
     */
    private arraysEqual(a: string[], b: string[]): boolean {
        if (a.length !== b.length) return false;
        return a.every((val, index) => val === b[index]);
    }

    /**
     * Perform maintenance on all services
     */
    private performMaintenance(): void {
        try {
            this.stateManager.performMaintenance();
            this.synchronizationService.performMaintenance();
        } catch (error) {
            this.logger.error(`Maintenance error: ${(error as Error).message}`);
        }
    }

    /**
     * Get service status for monitoring
     */
    public getServiceStatus(): {
        state: any;
        queueStatus: any;
        isHealthy: boolean;
    } {
        const state = this.stateManager.getState();
        const queueStatus = this.synchronizationService.getQueueStatus();

        const isHealthy = state.currentState !== FanControlState.ERROR &&
            state.currentState !== FanControlState.EMERGENCY_STOP &&
            queueStatus.queueLength < 50;

        return {
            state: {
                currentState: state.currentState,
                controlMode: state.controlMode,
                errorCount: state.errorCount,
                isTransitioning: state.transitionState?.isTransitioning || false
            },
            queueStatus,
            isHealthy
        };
    }

    /**
     * Emergency stop - force all fans off and reset state
     */
    public async emergencyStop(): Promise<void> {
        await this.synchronizationService.executeCritical(async () => {
            this.logger.warn("Emergency stop initiated");

            // Force state to emergency stop
            await this.stateMachine.forceTransition(FanControlState.EMERGENCY_STOP, "Emergency stop requested");

            // Clear all locks
            await this.synchronizationService.forceReleaseAllLocks();

            // Reset state manager
            await this.stateManager.resetToSafeState();
        });
    }
}
