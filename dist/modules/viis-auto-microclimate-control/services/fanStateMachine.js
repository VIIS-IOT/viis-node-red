"use strict";
/**
 * Fan Control State Machine
 * Implements formal state machine pattern for fan control with clear transition rules
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FanControlStateMachine = void 0;
const types_1 = require("../interfaces/types");
const fanControlCore_1 = require("./fanControlCore");
const timeUtils_1 = require("../utils/timeUtils");
const constants_1 = require("../constants");
class FanControlStateMachine {
    constructor(stateManager, logger) {
        this.stateManager = stateManager;
        this.logger = logger;
        this.initializeTransitions();
    }
    /**
     * Process state machine with current context
     */
    async process(config, sensorData, deviceStatus) {
        const context = {
            config,
            sensorData,
            deviceStatus,
            stateManager: this.stateManager,
            logger: this.logger
        };
        try {
            // Check for state transitions
            await this.checkTransitions(context);
            // Execute current state logic
            return await this.executeCurrentState(context);
        }
        catch (error) {
            this.logger.error(`State machine error: ${error.message}`);
            await this.stateManager.handleError(error.message);
            return [];
        }
    }
    /**
     * Force transition to specific state
     */
    async forceTransition(targetState, reason) {
        const currentState = this.stateManager.getState();
        if (currentState.currentState === targetState) {
            return { success: true };
        }
        this.logger.warn(`Forcing state transition: ${currentState.currentState} -> ${targetState} (${reason})`);
        return await this.stateManager.atomicUpdate((state) => {
            state.previousState = state.currentState;
            state.currentState = targetState;
            // Clear transition state if forcing out of transitioning
            if (state.currentState !== types_1.FanControlState.TRANSITIONING) {
                state.transitionState = null;
            }
            return { success: true };
        }, `Force transition to ${targetState}`);
    }
    /**
     * Get available transitions from current state
     */
    getAvailableTransitions() {
        const currentState = this.stateManager.getState().currentState;
        return this.transitions
            .filter(t => t.from === currentState)
            .map(t => t.to);
    }
    /**
     * Check if transition is valid
     */
    isValidTransition(from, to) {
        return this.transitions.some(t => t.from === from && t.to === to);
    }
    /**
     * Initialize state transition rules
     */
    initializeTransitions() {
        this.transitions = [
            // From IDLE
            {
                from: types_1.FanControlState.IDLE,
                to: types_1.FanControlState.ROTATION_ACTIVE,
                condition: (ctx) => this.isRotationModeEnabled(ctx.config)
            },
            {
                from: types_1.FanControlState.IDLE,
                to: types_1.FanControlState.THRESHOLD_ACTIVE,
                condition: (ctx) => this.isThresholdModeEnabled(ctx.config)
            },
            // From ROTATION_ACTIVE
            {
                from: types_1.FanControlState.ROTATION_ACTIVE,
                to: types_1.FanControlState.TRANSITIONING,
                condition: (ctx) => this.shouldStartRotationTransition(ctx)
            },
            {
                from: types_1.FanControlState.ROTATION_ACTIVE,
                to: types_1.FanControlState.THRESHOLD_ACTIVE,
                condition: (ctx) => this.isThresholdModeEnabled(ctx.config) && !this.isRotationModeEnabled(ctx.config)
            },
            {
                from: types_1.FanControlState.ROTATION_ACTIVE,
                to: types_1.FanControlState.IDLE,
                condition: (ctx) => !this.isFanControlEnabled(ctx.config)
            },
            // From THRESHOLD_ACTIVE
            {
                from: types_1.FanControlState.THRESHOLD_ACTIVE,
                to: types_1.FanControlState.TRANSITIONING,
                condition: (ctx) => this.shouldStartThresholdTransition(ctx)
            },
            {
                from: types_1.FanControlState.THRESHOLD_ACTIVE,
                to: types_1.FanControlState.ROTATION_ACTIVE,
                condition: (ctx) => this.isRotationModeEnabled(ctx.config) && !this.isThresholdModeEnabled(ctx.config)
            },
            {
                from: types_1.FanControlState.THRESHOLD_ACTIVE,
                to: types_1.FanControlState.IDLE,
                condition: (ctx) => !this.isFanControlEnabled(ctx.config)
            },
            // From TRANSITIONING
            {
                from: types_1.FanControlState.TRANSITIONING,
                to: types_1.FanControlState.ROTATION_ACTIVE,
                condition: (ctx) => this.isTransitionComplete(ctx) && this.isRotationModeEnabled(ctx.config)
            },
            {
                from: types_1.FanControlState.TRANSITIONING,
                to: types_1.FanControlState.THRESHOLD_ACTIVE,
                condition: (ctx) => this.isTransitionComplete(ctx) && this.isThresholdModeEnabled(ctx.config)
            },
            {
                from: types_1.FanControlState.TRANSITIONING,
                to: types_1.FanControlState.IDLE,
                condition: (ctx) => this.isTransitionComplete(ctx) && !this.isFanControlEnabled(ctx.config)
            },
            {
                from: types_1.FanControlState.TRANSITIONING,
                to: types_1.FanControlState.ERROR,
                condition: (ctx) => this.hasTransitionFailed(ctx)
            },
            // From ERROR
            {
                from: types_1.FanControlState.ERROR,
                to: types_1.FanControlState.IDLE,
                condition: (ctx) => this.canRecoverFromError(ctx),
                action: async (ctx) => await this.performErrorRecovery(ctx)
            },
            {
                from: types_1.FanControlState.ERROR,
                to: types_1.FanControlState.EMERGENCY_STOP,
                condition: (ctx) => this.shouldEmergencyStop(ctx)
            },
            // From EMERGENCY_STOP
            {
                from: types_1.FanControlState.EMERGENCY_STOP,
                to: types_1.FanControlState.IDLE,
                condition: (ctx) => this.canExitEmergencyStop(ctx),
                action: async (ctx) => await this.performEmergencyRecovery(ctx)
            },
            // Universal transitions (from any state)
            {
                from: types_1.FanControlState.IDLE,
                to: types_1.FanControlState.ERROR,
                condition: (ctx) => this.hasUnrecoverableError(ctx)
            },
            {
                from: types_1.FanControlState.ROTATION_ACTIVE,
                to: types_1.FanControlState.ERROR,
                condition: (ctx) => this.hasUnrecoverableError(ctx)
            },
            {
                from: types_1.FanControlState.THRESHOLD_ACTIVE,
                to: types_1.FanControlState.ERROR,
                condition: (ctx) => this.hasUnrecoverableError(ctx)
            }
        ];
    }
    /**
     * Check and execute valid transitions
     */
    async checkTransitions(context) {
        const currentState = this.stateManager.getState().currentState;
        for (const transition of this.transitions) {
            if (transition.from === currentState &&
                (!transition.condition || transition.condition(context))) {
                this.logger.debug(`State transition: ${transition.from} -> ${transition.to}`);
                // Execute transition action if defined
                if (transition.action) {
                    await transition.action(context);
                }
                // Update state
                await this.stateManager.atomicUpdate((state) => {
                    state.previousState = state.currentState;
                    state.currentState = transition.to;
                    return { success: true };
                }, `Transition to ${transition.to}`);
                break; // Only execute first valid transition
            }
        }
    }
    /**
     * Execute logic for current state
     */
    async executeCurrentState(context) {
        const currentState = this.stateManager.getState().currentState;
        switch (currentState) {
            case types_1.FanControlState.IDLE:
                return this.executeIdleState(context);
            case types_1.FanControlState.ROTATION_ACTIVE:
                return this.executeRotationState(context);
            case types_1.FanControlState.THRESHOLD_ACTIVE:
                return this.executeThresholdState(context);
            case types_1.FanControlState.TRANSITIONING:
                return this.executeTransitioningState(context);
            case types_1.FanControlState.ERROR:
                return this.executeErrorState(context);
            case types_1.FanControlState.EMERGENCY_STOP:
                return this.executeEmergencyStopState(context);
            default:
                this.logger.error(`Unknown state: ${currentState}`);
                return [];
        }
    }
    // State execution methods
    async executeIdleState(context) {
        // In idle state, ensure all fans are off
        const coilMapping = this.getCoilMapping(context);
        return fanControlCore_1.FanControlCore.createTurnOffAllFansActions("Idle state - all fans off", coilMapping);
    }
    async executeRotationState(context) {
        const state = this.stateManager.getState();
        const coilMapping = this.getCoilMapping(context);
        const coreContext = {
            config: context.config,
            sensorData: context.sensorData,
            deviceStatus: context.deviceStatus,
            currentRotationState: state.rotationState,
            coilMapping,
            logger: context.logger
        };
        const result = fanControlCore_1.FanControlCore.executeRotationMode(coreContext);
        // Update rotation state if changed
        if (result.newRotationState) {
            await this.stateManager.updateRotationState(result.newRotationState);
        }
        // Handle transition requirement
        if (result.requiresTransition && result.transitionInfo) {
            await this.stateManager.startTransition(result.transitionInfo.previousGroup, result.transitionInfo.nextGroup, result.transitionInfo.reason);
            return []; // Transition will be handled in next cycle
        }
        return result.actions;
    }
    async executeThresholdState(context) {
        const coilMapping = this.getCoilMapping(context);
        const coreContext = {
            config: context.config,
            sensorData: context.sensorData,
            deviceStatus: context.deviceStatus,
            currentRotationState: { currentGroupIndex: 0, lastRotationTime: 0, activeGroup: [] }, // Not used in threshold
            coilMapping,
            logger: context.logger
        };
        const result = fanControlCore_1.FanControlCore.executeThresholdMode(coreContext);
        // Handle transition requirement
        if (result.requiresTransition) {
            const currentActiveFans = Object.keys(context.deviceStatus).filter(key => context.deviceStatus[key] === true && key.startsWith('quat_') && !key.includes('dao'));
            await this.stateManager.startTransition(currentActiveFans, result.targetGroup, result.reason);
            return []; // Transition will be handled in next cycle
        }
        return result.actions;
    }
    async executeTransitioningState(context) {
        const transitionState = this.stateManager.getTransitionState();
        if (!transitionState) {
            // No transition state, complete transition
            await this.stateManager.completeTransition();
            return [];
        }
        const coilMapping = this.getCoilMapping(context);
        const offDelayMs = this.getOffDelayMs(context.config);
        const transitionDelayMs = this.getTransitionDelayMs(context.config);
        const result = fanControlCore_1.FanControlCore.executeTransitionPhase(transitionState.phase, transitionState.previousGroup, transitionState.nextGroup, transitionState.transitionStartTime, transitionState.offDelayStartTime, offDelayMs, transitionDelayMs, transitionState.reason, coilMapping, context.logger);
        // Update transition phase if needed
        if (result.nextPhase) {
            const phase = this.convertToTransitionPhase(result.nextPhase);
            await this.stateManager.updateTransitionPhase(phase);
        }
        // Complete transition if done
        if (result.isComplete) {
            await this.stateManager.completeTransition();
        }
        return result.actions;
    }
    async executeErrorState(context) {
        // In error state, turn off all fans and wait for recovery
        const coilMapping = this.getCoilMapping(context);
        return fanControlCore_1.FanControlCore.createTurnOffAllFansActions("Error state - safety shutdown", coilMapping);
    }
    async executeEmergencyStopState(context) {
        // Emergency stop - turn off all fans immediately
        const coilMapping = this.getCoilMapping(context);
        return fanControlCore_1.FanControlCore.createTurnOffAllFansActions("Emergency stop - immediate shutdown", coilMapping);
    }
    // Condition checking methods
    isFanControlEnabled(config) {
        return config.set_mode_fan === 1;
    }
    isRotationModeEnabled(config) {
        return this.isFanControlEnabled(config) && config.set_auto_mode_fan === 1;
    }
    isThresholdModeEnabled(config) {
        return this.isFanControlEnabled(config) && config.set_auto_mode_fan !== 1;
    }
    shouldStartRotationTransition(context) {
        // Check if rotation interval has elapsed and transitions are enabled
        const state = this.stateManager.getState();
        const rotationInterval = (0, timeUtils_1.minutesToMs)(context.config.set_time_alternate_fan || 15);
        return (0, timeUtils_1.hasTimeElapsed)(state.rotationState.lastRotationTime, rotationInterval) &&
            this.areTransitionsEnabled(context.config);
    }
    shouldStartThresholdTransition(context) {
        // Check if threshold conditions require a different fan group
        // This would be determined by comparing current active fans with required fans
        return this.areTransitionsEnabled(context.config);
    }
    isTransitionComplete(context) {
        const transitionState = this.stateManager.getTransitionState();
        if (!transitionState)
            return true;
        const transitionDelayMs = this.getTransitionDelayMs(context.config);
        return (0, timeUtils_1.hasTimeElapsed)(transitionState.transitionStartTime, transitionDelayMs);
    }
    hasTransitionFailed(_context) {
        const transitionState = this.stateManager.getTransitionState();
        if (!transitionState)
            return false;
        // Check if transition has exceeded maximum retries
        return transitionState.retryCount >= transitionState.maxRetries;
    }
    canRecoverFromError(_context) {
        const state = this.stateManager.getState();
        const fiveMinutesAgo = (0, timeUtils_1.getCurrentTimestamp)() - (5 * 60 * 1000);
        // Can recover if last error was more than 5 minutes ago and error count is low
        return state.lastErrorTime < fiveMinutesAgo && state.errorCount < 5;
    }
    shouldEmergencyStop(_context) {
        const state = this.stateManager.getState();
        // Emergency stop if too many errors in short time
        return state.errorCount >= 10;
    }
    canExitEmergencyStop(_context) {
        // Manual intervention required - this would be triggered externally
        return false;
    }
    hasUnrecoverableError(_context) {
        const state = this.stateManager.getState();
        // Check for critical errors that require immediate attention
        return state.errorCount >= 15;
    }
    areTransitionsEnabled(config) {
        const transitionDelayMs = this.getTransitionDelayMs(config);
        const offDelayMs = this.getOffDelayMs(config);
        return transitionDelayMs > 0 || offDelayMs > 0;
    }
    getTransitionDelayMs(config) {
        return (config.set_fan_group_transition_delay || 2) * 1000;
    }
    getOffDelayMs(config) {
        return (config.set_fan_group_off_delay || 1) * 1000;
    }
    // Recovery action methods
    async performErrorRecovery(context) {
        this.logger.warn("Performing error recovery");
        await context.stateManager.atomicUpdate((state) => {
            state.errorCount = 0;
            state.lastError = null;
            state.transitionState = null;
            return { success: true };
        }, "Error recovery");
    }
    async performEmergencyRecovery(context) {
        this.logger.warn("Performing emergency recovery");
        await context.stateManager.resetToSafeState();
    }
    // Helper methods
    getCoilMapping(_context) {
        // Extract coil mapping from context or use defaults
        return Object.assign(Object.assign({}, constants_1.FAN_CONFIG.COIL_MAPPING), constants_1.FAN_DAO_CONFIG.COIL_MAPPING);
    }
    convertToTransitionPhase(phase) {
        switch (phase) {
            case 'off': return types_1.TransitionPhase.OFF;
            case 'delay': return types_1.TransitionPhase.DELAY;
            case 'on': return types_1.TransitionPhase.ON;
            case 'complete': return types_1.TransitionPhase.COMPLETE;
            default: return types_1.TransitionPhase.OFF;
        }
    }
}
exports.FanControlStateMachine = FanControlStateMachine;
