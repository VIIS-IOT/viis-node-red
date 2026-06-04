/**
 * Fan Control State Machine
 * Implements formal state machine pattern for fan control with clear transition rules
 */

import {
    FanControlState,
    FanControlMode,
    TransitionPhase,
    StateOperationResult,
    ILogger,
    AutoControlConfig,
    SensorData,
    DeviceStatus,
    ControlAction
} from "../interfaces/types";
import { FanControlStateManager } from "./stateManager";
import { FanControlCore, FanControlContext } from "./fanControlCore";
import { getCurrentTimestamp, hasTimeElapsed, minutesToMs } from "../utils/timeUtils";
import { FAN_CONFIG, FAN_DAO_CONFIG } from "../constants";

// State machine transition rules
interface StateTransition {
    from: FanControlState;
    to: FanControlState;
    condition?: (context: StateMachineContext) => boolean;
    action?: (context: StateMachineContext) => Promise<void>;
}

interface StateMachineContext {
    config: AutoControlConfig;
    sensorData: SensorData;
    deviceStatus: DeviceStatus;
    stateManager: FanControlStateManager;
    logger: ILogger;
}

export class FanControlStateMachine {
    private stateManager: FanControlStateManager;
    private logger: ILogger;
    private transitions: StateTransition[];

    constructor(stateManager: FanControlStateManager, logger: ILogger) {
        this.stateManager = stateManager;
        this.logger = logger;
        this.initializeTransitions();
    }

    /**
     * Process state machine with current context
     */
    public async process(
        config: AutoControlConfig,
        sensorData: SensorData,
        deviceStatus: DeviceStatus
    ): Promise<ControlAction[]> {
        const context: StateMachineContext = {
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

        } catch (error) {
            this.logger.error(`State machine error: ${(error as Error).message}`);
            await this.stateManager.handleError((error as Error).message);
            return [];
        }
    }

    /**
     * Force transition to specific state
     */
    public async forceTransition(
        targetState: FanControlState,
        reason: string
    ): Promise<StateOperationResult<void>> {
        const currentState = this.stateManager.getState();

        if (currentState.currentState === targetState) {
            return { success: true };
        }

        this.logger.warn(`Forcing state transition: ${currentState.currentState} -> ${targetState} (${reason})`);

        return await this.stateManager.atomicUpdate((state) => {
            state.previousState = state.currentState;
            state.currentState = targetState;

            // Clear transition state if forcing out of transitioning
            if (state.currentState !== FanControlState.TRANSITIONING) {
                state.transitionState = null;
            }

            return { success: true };
        }, `Force transition to ${targetState}`);
    }

    /**
     * Get available transitions from current state
     */
    public getAvailableTransitions(): FanControlState[] {
        const currentState = this.stateManager.getState().currentState;
        return this.transitions
            .filter(t => t.from === currentState)
            .map(t => t.to);
    }

    /**
     * Check if transition is valid
     */
    public isValidTransition(from: FanControlState, to: FanControlState): boolean {
        return this.transitions.some(t => t.from === from && t.to === to);
    }

    /**
     * Initialize state transition rules
     */
    private initializeTransitions(): void {
        this.transitions = [
            // From IDLE
            {
                from: FanControlState.IDLE,
                to: FanControlState.ROTATION_ACTIVE,
                condition: (ctx) => this.isRotationModeEnabled(ctx.config)
            },
            {
                from: FanControlState.IDLE,
                to: FanControlState.THRESHOLD_ACTIVE,
                condition: (ctx) => this.isThresholdModeEnabled(ctx.config)
            },

            // From ROTATION_ACTIVE
            {
                from: FanControlState.ROTATION_ACTIVE,
                to: FanControlState.TRANSITIONING,
                condition: (ctx) => this.shouldStartRotationTransition(ctx)
            },
            {
                from: FanControlState.ROTATION_ACTIVE,
                to: FanControlState.THRESHOLD_ACTIVE,
                condition: (ctx) => this.isThresholdModeEnabled(ctx.config) && !this.isRotationModeEnabled(ctx.config)
            },
            {
                from: FanControlState.ROTATION_ACTIVE,
                to: FanControlState.IDLE,
                condition: (ctx) => !this.isFanControlEnabled(ctx.config)
            },

            // From THRESHOLD_ACTIVE
            {
                from: FanControlState.THRESHOLD_ACTIVE,
                to: FanControlState.TRANSITIONING,
                condition: (ctx) => this.shouldStartThresholdTransition(ctx)
            },
            {
                from: FanControlState.THRESHOLD_ACTIVE,
                to: FanControlState.ROTATION_ACTIVE,
                condition: (ctx) => this.isRotationModeEnabled(ctx.config) && !this.isThresholdModeEnabled(ctx.config)
            },
            {
                from: FanControlState.THRESHOLD_ACTIVE,
                to: FanControlState.IDLE,
                condition: (ctx) => !this.isFanControlEnabled(ctx.config)
            },

            // From TRANSITIONING
            {
                from: FanControlState.TRANSITIONING,
                to: FanControlState.ROTATION_ACTIVE,
                condition: (ctx) => this.isTransitionComplete(ctx) && this.isRotationModeEnabled(ctx.config)
            },
            {
                from: FanControlState.TRANSITIONING,
                to: FanControlState.THRESHOLD_ACTIVE,
                condition: (ctx) => this.isTransitionComplete(ctx) && this.isThresholdModeEnabled(ctx.config)
            },
            {
                from: FanControlState.TRANSITIONING,
                to: FanControlState.IDLE,
                condition: (ctx) => this.isTransitionComplete(ctx) && !this.isFanControlEnabled(ctx.config)
            },
            {
                from: FanControlState.TRANSITIONING,
                to: FanControlState.ERROR,
                condition: (ctx) => this.hasTransitionFailed(ctx)
            },

            // From ERROR
            {
                from: FanControlState.ERROR,
                to: FanControlState.IDLE,
                condition: (ctx) => this.canRecoverFromError(ctx),
                action: async (ctx) => await this.performErrorRecovery(ctx)
            },
            {
                from: FanControlState.ERROR,
                to: FanControlState.EMERGENCY_STOP,
                condition: (ctx) => this.shouldEmergencyStop(ctx)
            },

            // From EMERGENCY_STOP
            {
                from: FanControlState.EMERGENCY_STOP,
                to: FanControlState.IDLE,
                condition: (ctx) => this.canExitEmergencyStop(ctx),
                action: async (ctx) => await this.performEmergencyRecovery(ctx)
            },

            // Universal transitions (from any state)
            {
                from: FanControlState.IDLE,
                to: FanControlState.ERROR,
                condition: (ctx) => this.hasUnrecoverableError(ctx)
            },
            {
                from: FanControlState.ROTATION_ACTIVE,
                to: FanControlState.ERROR,
                condition: (ctx) => this.hasUnrecoverableError(ctx)
            },
            {
                from: FanControlState.THRESHOLD_ACTIVE,
                to: FanControlState.ERROR,
                condition: (ctx) => this.hasUnrecoverableError(ctx)
            }
        ];
    }

    /**
     * Check and execute valid transitions
     */
    private async checkTransitions(context: StateMachineContext): Promise<void> {
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
    private async executeCurrentState(context: StateMachineContext): Promise<ControlAction[]> {
        const currentState = this.stateManager.getState().currentState;

        switch (currentState) {
            case FanControlState.IDLE:
                return this.executeIdleState(context);

            case FanControlState.ROTATION_ACTIVE:
                return this.executeRotationState(context);

            case FanControlState.THRESHOLD_ACTIVE:
                return this.executeThresholdState(context);

            case FanControlState.TRANSITIONING:
                return this.executeTransitioningState(context);

            case FanControlState.ERROR:
                return this.executeErrorState(context);

            case FanControlState.EMERGENCY_STOP:
                return this.executeEmergencyStopState(context);

            default:
                this.logger.error(`Unknown state: ${currentState}`);
                return [];
        }
    }

    // State execution methods
    private async executeIdleState(context: StateMachineContext): Promise<ControlAction[]> {
        // In idle state, ensure all fans are off
        const coilMapping = this.getCoilMapping(context);
        return FanControlCore.createTurnOffAllFansActions("Idle state - all fans off", coilMapping);
    }

    private async executeRotationState(context: StateMachineContext): Promise<ControlAction[]> {
        const state = this.stateManager.getState();
        const coilMapping = this.getCoilMapping(context);

        const coreContext: FanControlContext = {
            config: context.config,
            sensorData: context.sensorData,
            deviceStatus: context.deviceStatus,
            currentRotationState: state.rotationState,
            coilMapping,
            logger: context.logger
        };

        const result = FanControlCore.executeRotationMode(coreContext);

        // Update rotation state if changed
        if (result.newRotationState) {
            await this.stateManager.updateRotationState(result.newRotationState);
        }

        // Handle transition requirement
        if (result.requiresTransition && result.transitionInfo) {
            await this.stateManager.startTransition(
                result.transitionInfo.previousGroup,
                result.transitionInfo.nextGroup,
                result.transitionInfo.reason
            );
            return []; // Transition will be handled in next cycle
        }

        return result.actions;
    }

    private async executeThresholdState(context: StateMachineContext): Promise<ControlAction[]> {
        const coilMapping = this.getCoilMapping(context);

        const coreContext: FanControlContext = {
            config: context.config,
            sensorData: context.sensorData,
            deviceStatus: context.deviceStatus,
            currentRotationState: { currentGroupIndex: 0, lastRotationTime: 0, activeGroup: [] }, // Not used in threshold
            coilMapping,
            logger: context.logger
        };

        const result = FanControlCore.executeThresholdMode(coreContext);

        // Handle transition requirement
        if (result.requiresTransition) {
            const currentActiveFans = Object.keys(context.deviceStatus).filter(key =>
                context.deviceStatus[key] === true && key.startsWith('quat_') && !key.includes('dao')
            );

            await this.stateManager.startTransition(
                currentActiveFans,
                result.targetGroup,
                result.reason
            );
            return []; // Transition will be handled in next cycle
        }

        return result.actions;
    }

    private async executeTransitioningState(context: StateMachineContext): Promise<ControlAction[]> {
        const transitionState = this.stateManager.getTransitionState();
        if (!transitionState) {
            // No transition state, complete transition
            await this.stateManager.completeTransition();
            return [];
        }

        const coilMapping = this.getCoilMapping(context);
        const offDelayMs = this.getOffDelayMs(context.config);
        const transitionDelayMs = this.getTransitionDelayMs(context.config);

        const result = FanControlCore.executeTransitionPhase(
            transitionState.phase,
            transitionState.previousGroup,
            transitionState.nextGroup,
            transitionState.transitionStartTime,
            transitionState.offDelayStartTime,
            offDelayMs,
            transitionDelayMs,
            transitionState.reason,
            coilMapping,
            context.logger
        );

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

    private async executeErrorState(context: StateMachineContext): Promise<ControlAction[]> {
        // In error state, turn off all fans and wait for recovery
        const coilMapping = this.getCoilMapping(context);
        return FanControlCore.createTurnOffAllFansActions("Error state - safety shutdown", coilMapping);
    }

    private async executeEmergencyStopState(context: StateMachineContext): Promise<ControlAction[]> {
        // Emergency stop - turn off all fans immediately
        const coilMapping = this.getCoilMapping(context);
        return FanControlCore.createTurnOffAllFansActions("Emergency stop - immediate shutdown", coilMapping);
    }

    // Condition checking methods
    private isFanControlEnabled(config: AutoControlConfig): boolean {
        return config.set_mode_fan === 1;
    }

    private isRotationModeEnabled(config: AutoControlConfig): boolean {
        return this.isFanControlEnabled(config) && config.set_auto_mode_fan === 1;
    }

    private isThresholdModeEnabled(config: AutoControlConfig): boolean {
        return this.isFanControlEnabled(config) && config.set_auto_mode_fan !== 1;
    }

    private shouldStartRotationTransition(context: StateMachineContext): boolean {
        // Check if rotation interval has elapsed and transitions are enabled
        const state = this.stateManager.getState();
        const rotationInterval = minutesToMs(context.config.set_time_alternate_fan || 15);

        return hasTimeElapsed(state.rotationState.lastRotationTime, rotationInterval) &&
            this.areTransitionsEnabled(context.config);
    }

    private shouldStartThresholdTransition(context: StateMachineContext): boolean {
        // Check if threshold conditions require a different fan group
        // This would be determined by comparing current active fans with required fans
        return this.areTransitionsEnabled(context.config);
    }

    private isTransitionComplete(context: StateMachineContext): boolean {
        const transitionState = this.stateManager.getTransitionState();
        if (!transitionState) return true;

        const transitionDelayMs = this.getTransitionDelayMs(context.config);
        return hasTimeElapsed(transitionState.transitionStartTime, transitionDelayMs);
    }

    private hasTransitionFailed(_context: StateMachineContext): boolean {
        const transitionState = this.stateManager.getTransitionState();
        if (!transitionState) return false;

        // Check if transition has exceeded maximum retries
        return transitionState.retryCount >= transitionState.maxRetries;
    }

    private canRecoverFromError(_context: StateMachineContext): boolean {
        const state = this.stateManager.getState();
        const fiveMinutesAgo = getCurrentTimestamp() - (5 * 60 * 1000);

        // Can recover if last error was more than 5 minutes ago and error count is low
        return state.lastErrorTime < fiveMinutesAgo && state.errorCount < 5;
    }

    private shouldEmergencyStop(_context: StateMachineContext): boolean {
        const state = this.stateManager.getState();

        // Emergency stop if too many errors in short time
        return state.errorCount >= 10;
    }

    private canExitEmergencyStop(_context: StateMachineContext): boolean {
        // Manual intervention required - this would be triggered externally
        return false;
    }

    private hasUnrecoverableError(_context: StateMachineContext): boolean {
        const state = this.stateManager.getState();

        // Check for critical errors that require immediate attention
        return state.errorCount >= 15;
    }

    private areTransitionsEnabled(config: AutoControlConfig): boolean {
        const transitionDelayMs = this.getTransitionDelayMs(config);
        const offDelayMs = this.getOffDelayMs(config);
        return transitionDelayMs > 0 || offDelayMs > 0;
    }

    private getTransitionDelayMs(config: AutoControlConfig): number {
        return (config.set_fan_group_transition_delay || 2) * 1000;
    }

    private getOffDelayMs(config: AutoControlConfig): number {
        return (config.set_fan_group_off_delay || 1) * 1000;
    }

    // Recovery action methods
    private async performErrorRecovery(context: StateMachineContext): Promise<void> {
        this.logger.warn("Performing error recovery");

        await context.stateManager.atomicUpdate((state) => {
            state.errorCount = 0;
            state.lastError = null;
            state.transitionState = null;
            return { success: true };
        }, "Error recovery");
    }

    private async performEmergencyRecovery(context: StateMachineContext): Promise<void> {
        this.logger.warn("Performing emergency recovery");

        await context.stateManager.resetToSafeState();
    }

    // Helper methods
    private getCoilMapping(_context: StateMachineContext): Record<string, number> {
        // Extract coil mapping from context or use defaults
        return {
            ...FAN_CONFIG.COIL_MAPPING,
            ...FAN_DAO_CONFIG.COIL_MAPPING
        };
    }

    private convertToTransitionPhase(phase: 'off' | 'delay' | 'on' | 'complete'): TransitionPhase {
        switch (phase) {
            case 'off': return TransitionPhase.OFF;
            case 'delay': return TransitionPhase.DELAY;
            case 'on': return TransitionPhase.ON;
            case 'complete': return TransitionPhase.COMPLETE;
            default: return TransitionPhase.OFF;
        }
    }
}
