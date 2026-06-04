"use strict";
/**
 * Enhanced Fan Control Service
 * Integrates state machine, centralized state management, and synchronization
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnhancedFanControlService = void 0;
const types_1 = require("../interfaces/types");
const stateManager_1 = require("./stateManager");
const fanStateMachine_1 = require("./fanStateMachine");
const synchronizationService_1 = require("./synchronizationService");
const fanControlCore_1 = require("./fanControlCore");
const logger_1 = require("../utils/logger");
const groupUtils_1 = require("../utils/groupUtils");
const timeUtils_1 = require("../utils/timeUtils");
const constants_1 = require("../constants");
class EnhancedFanControlService {
    constructor(options) {
        this.flowContext = options.flowContext;
        this.globalContext = options.globalContext;
        this.logger = new logger_1.Logger(options.node, options.nodeId);
        // Initialize services
        this.stateManager = new stateManager_1.FanControlStateManager(this.flowContext, this.logger);
        this.stateMachine = new fanStateMachine_1.FanControlStateMachine(this.stateManager, this.logger);
        this.synchronizationService = new synchronizationService_1.SynchronizationService(this.flowContext, this.logger);
        // Perform initial maintenance
        this.performMaintenance();
    }
    /**
     * Main fan control processing with enhanced state management
     */
    async processFanControl(config, sensorData, deviceStatus) {
        return this.synchronizationService.withLock('fan_control_main', async () => {
            try {
                // Update control mode based on configuration
                await this.updateControlMode(config);
                // Process through state machine
                const fanActions = await this.stateMachine.process(config, sensorData, deviceStatus);
                // Process fan dao control (independent of main fan control)
                const fanDaoActions = await this.processFanDaoControl(config);
                return [...fanActions, ...fanDaoActions];
            }
            catch (error) {
                this.logger.error(`Enhanced fan control processing error: ${error.message}`);
                await this.stateManager.handleError(error.message);
                return [];
            }
        }, { timeout: 10000, retryAttempts: 3 });
    }
    /**
     * Process rotation mode with state machine integration
     */
    async processRotationMode(config) {
        return this.synchronizationService.withLock('fan_rotation', async () => {
            const state = this.stateManager.getState();
            if (state.currentState !== types_1.FanControlState.ROTATION_ACTIVE) {
                this.logger.debug("Not in rotation active state, skipping rotation processing");
                return [];
            }
            // Use core logic for rotation
            const coreContext = {
                config,
                sensorData: { temp_indoor: 0, humi_indoor: 0, light_indoor: 0, ts: Date.now() }, // Not used in rotation
                deviceStatus: { ts: Date.now() }, // Not used in rotation
                currentRotationState: state.rotationState,
                coilMapping: this.getCoilMapping(),
                logger: this.logger
            };
            const result = fanControlCore_1.FanControlCore.executeRotationMode(coreContext);
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
                await this.stateManager.startTransition(result.transitionInfo.previousGroup, result.transitionInfo.nextGroup, result.transitionInfo.reason);
                return []; // Transition will be handled by state machine
            }
            return result.actions;
        });
    }
    /**
     * Process threshold mode with state machine integration
     */
    async processThresholdMode(config, sensorData, deviceStatus) {
        return this.synchronizationService.withLock('fan_threshold', async () => {
            const state = this.stateManager.getState();
            if (state.currentState !== types_1.FanControlState.THRESHOLD_ACTIVE) {
                this.logger.debug("Not in threshold active state, skipping threshold processing");
                return [];
            }
            if (!deviceStatus) {
                this.logger.warn("Device status required for threshold mode");
                return [];
            }
            // Use core logic for threshold mode
            const coreContext = {
                config,
                sensorData,
                deviceStatus,
                currentRotationState: { currentGroupIndex: 0, lastRotationTime: 0, activeGroup: [] }, // Not used
                coilMapping: this.getCoilMapping(),
                logger: this.logger
            };
            const result = fanControlCore_1.FanControlCore.executeThresholdMode(coreContext);
            // Handle transition requirement
            if (result.requiresTransition && this.areTransitionsEnabled(config)) {
                const currentActiveFans = Object.keys(deviceStatus).filter(key => deviceStatus[key] === true && (0, groupUtils_1.getAllFanKeys)().includes(key));
                await this.stateManager.startTransition(currentActiveFans, result.targetGroup, result.reason);
                return []; // Transition will be handled by state machine
            }
            return result.actions;
        });
    }
    /**
     * Get fan groups (delegated to utility)
     */
    getFanGroups(groupSize) {
        return (0, groupUtils_1.getFanGroups)(groupSize);
    }
    /**
     * Process fan dao control with synchronization
     */
    async processFanDaoControl(config) {
        return this.synchronizationService.withLock('fan_dao_control', async () => {
            try {
                // Get current fan dao state
                const lastFanDaoTime = this.flowContext.get('fan_dao_last_time') || 0;
                const currentFanDaoState = this.flowContext.get('fan_dao_current_state') || false;
                const coilMapping = this.getCoilMapping();
                // Use core logic for fan dao control
                const result = fanControlCore_1.FanControlCore.executeFanDaoControl(config, lastFanDaoTime, currentFanDaoState, coilMapping, this.logger);
                // Update state if changed
                if (result.newState) {
                    this.flowContext.set('fan_dao_last_time', result.newState.time);
                    this.flowContext.set('fan_dao_current_state', result.newState.state);
                }
                return result.actions;
            }
            catch (error) {
                this.logger.error(`Fan dao control processing error: ${error.message}`);
                return [];
            }
        });
    }
    /**
     * Update control mode based on configuration
     */
    async updateControlMode(config) {
        let targetMode;
        if (config.set_mode_fan !== 1) {
            targetMode = types_1.FanControlMode.DISABLED;
        }
        else if (config.set_auto_mode_fan === 1) {
            targetMode = types_1.FanControlMode.ROTATION;
        }
        else {
            targetMode = types_1.FanControlMode.THRESHOLD;
        }
        const result = await this.stateManager.updateControlMode(targetMode);
        if (!result.success) {
            this.logger.error(`Failed to update control mode: ${result.error}`);
        }
    }
    /**
     * Get threshold target group with rotation logic
     */
    async getThresholdTargetGroup(requiredGroupSize, config) {
        if (requiredGroupSize === 6) {
            // Use all fans for K3/K4
            return (0, groupUtils_1.getAllFanKeys)();
        }
        // For smaller groups, use rotation logic
        const fanGroups = (0, groupUtils_1.getFanGroups)(requiredGroupSize);
        if (fanGroups.length === 0) {
            return [];
        }
        // Get or create threshold rotation state for this group size
        let thresholdRotationState = this.stateManager.getThresholdRotationState(requiredGroupSize);
        if (!thresholdRotationState) {
            // Initialize new threshold rotation state
            thresholdRotationState = {
                currentGroupIndex: 0,
                lastRotationTime: (0, timeUtils_1.getCurrentTimestamp)(),
                activeGroup: fanGroups[0]
            };
            await this.stateManager.updateThresholdRotationState(requiredGroupSize, thresholdRotationState);
        }
        // Check if rotation is needed
        const rotationInterval = (0, timeUtils_1.minutesToMs)(config.set_time_alternate_fan || 15);
        if ((0, timeUtils_1.hasTimeElapsed)(thresholdRotationState.lastRotationTime, rotationInterval)) {
            const nextGroupIndex = (0, groupUtils_1.getNextGroupIndex)(thresholdRotationState.currentGroupIndex, fanGroups.length);
            const updatedState = {
                currentGroupIndex: nextGroupIndex,
                lastRotationTime: (0, timeUtils_1.getCurrentTimestamp)(),
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
    requiresGroupTransition(currentGroup, newGroup) {
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
    requiresStableGroupTransition(currentGroup, newGroup, requiredGroupSize, config) {
        // If already transitioning, don't start another
        if (this.stateManager.isTransitionInProgress()) {
            return false;
        }
        // If current group size matches required and fans are valid, check rotation timing
        if (currentGroup.length === requiredGroupSize && currentGroup.length > 0) {
            const allValidFans = currentGroup.every(fan => (0, groupUtils_1.getAllFanKeys)().includes(fan));
            if (allValidFans) {
                const isDifferentGroup = !this.arraysEqual(currentGroup.sort(), newGroup.sort());
                if (!isDifferentGroup) {
                    return false; // Same group, no transition needed
                }
                // Check rotation timing to prevent premature transitions
                const rotationInterval = (0, timeUtils_1.minutesToMs)(config.set_time_alternate_fan || 15);
                const thresholdRotationState = this.stateManager.getThresholdRotationState(requiredGroupSize);
                if (thresholdRotationState) {
                    const timeSinceLastRotation = (0, timeUtils_1.getCurrentTimestamp)() - thresholdRotationState.lastRotationTime;
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
    areTransitionsEnabled(config) {
        const transitionDelayMs = (config.set_fan_group_transition_delay || 0) * 1000;
        const offDelayMs = (config.set_fan_group_off_delay || 0) * 1000;
        return transitionDelayMs > 0 || offDelayMs > 0;
    }
    /**
     * Get coil mapping from global context
     */
    getCoilMapping() {
        const globalCoils = this.globalContext.get('modbusCoils') || {};
        return Object.assign(Object.assign(Object.assign({}, constants_1.FAN_CONFIG.COIL_MAPPING), constants_1.FAN_DAO_CONFIG.COIL_MAPPING), globalCoils);
    }
    /**
     * Convert DeviceStatus to Record<string, boolean>
     */
    convertDeviceStatusToRecord(deviceStatus) {
        const result = {};
        Object.keys(deviceStatus).forEach(key => {
            if (key !== 'ts' && typeof deviceStatus[key] === 'boolean') {
                result[key] = deviceStatus[key];
            }
        });
        return result;
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
     * Get threshold reason string
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
     * Helper method to compare arrays
     */
    arraysEqual(a, b) {
        if (a.length !== b.length)
            return false;
        return a.every((val, index) => val === b[index]);
    }
    /**
     * Perform maintenance on all services
     */
    performMaintenance() {
        try {
            this.stateManager.performMaintenance();
            this.synchronizationService.performMaintenance();
        }
        catch (error) {
            this.logger.error(`Maintenance error: ${error.message}`);
        }
    }
    /**
     * Get service status for monitoring
     */
    getServiceStatus() {
        var _a;
        const state = this.stateManager.getState();
        const queueStatus = this.synchronizationService.getQueueStatus();
        const isHealthy = state.currentState !== types_1.FanControlState.ERROR &&
            state.currentState !== types_1.FanControlState.EMERGENCY_STOP &&
            queueStatus.queueLength < 50;
        return {
            state: {
                currentState: state.currentState,
                controlMode: state.controlMode,
                errorCount: state.errorCount,
                isTransitioning: ((_a = state.transitionState) === null || _a === void 0 ? void 0 : _a.isTransitioning) || false
            },
            queueStatus,
            isHealthy
        };
    }
    /**
     * Emergency stop - force all fans off and reset state
     */
    async emergencyStop() {
        await this.synchronizationService.executeCritical(async () => {
            this.logger.warn("Emergency stop initiated");
            // Force state to emergency stop
            await this.stateMachine.forceTransition(types_1.FanControlState.EMERGENCY_STOP, "Emergency stop requested");
            // Clear all locks
            await this.synchronizationService.forceReleaseAllLocks();
            // Reset state manager
            await this.stateManager.resetToSafeState();
        });
    }
}
exports.EnhancedFanControlService = EnhancedFanControlService;
