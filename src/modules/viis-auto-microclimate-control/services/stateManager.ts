/**
 * Centralized State Manager for Fan Control
 * Provides atomic operations, validation, and cleanup for fan control state
 */

import {
    CentralizedFanState,
    FanControlState,
    FanControlMode,
    FanRotationState,
    FanGroupTransitionState,
    StateOperationResult,
    StateValidationResult,
    TransitionPhase,
    ILogger
} from "../interfaces/types";
import { CONTEXT_KEYS } from "../constants";
import { getCurrentTimestamp } from "../utils/timeUtils";

export class FanControlStateManager {
    private flowContext: any;
    private logger: ILogger;
    private readonly STATE_KEY = CONTEXT_KEYS.FAN_ROTATION_STATE + "_centralized";
    private readonly STATE_VERSION = 1;
    private readonly CLEANUP_INTERVAL_MS = 300000; // 5 minutes
    private readonly MAX_ERROR_COUNT = 10;

    constructor(flowContext: any, logger: ILogger) {
        this.flowContext = flowContext;
        this.logger = logger;
    }

    /**
     * Get current centralized state with validation
     */
    public getState(): CentralizedFanState {
        const saved = this.flowContext.get(this.STATE_KEY);

        if (saved && this.isValidState(saved)) {
            // Perform cleanup if needed
            if (this.shouldPerformCleanup(saved)) {
                return this.performCleanup(saved);
            }
            return saved;
        }

        // Initialize default state
        return this.initializeDefaultState();
    }

    /**
     * Atomic state update operation with rollback capability
     */
    public async atomicUpdate<T>(
        operation: (state: CentralizedFanState) => StateOperationResult<T>,
        description: string
    ): Promise<StateOperationResult<T>> {
        const currentState = this.getState();
        const backup = this.deepClone(currentState);

        try {
            const result = operation(currentState);

            if (result.success) {
                // Validate new state before saving
                const validation = this.validateState(currentState);
                if (!validation.isValid) {
                    this.logger.error(`State validation failed after ${description}: ${validation.errors.join(', ')}`);
                    this.restoreState(backup);
                    return {
                        success: false,
                        error: `State validation failed: ${validation.errors.join(', ')}`,
                        rollbackData: backup
                    };
                }

                // Update metadata
                currentState.lastStateChange = getCurrentTimestamp();
                currentState.version++;

                // Save updated state
                this.saveState(currentState);
                this.logger.debug(`State updated successfully: ${description}`);

                return result;
            } else {
                // Operation failed, restore backup
                this.restoreState(backup);
                this.logger.warn(`State operation failed, restored backup: ${description} - ${result.error}`);
                return result;
            }
        } catch (error) {
            // Exception occurred, restore backup
            this.restoreState(backup);
            this.logger.error(`Exception during state operation, restored backup: ${description} - ${(error as Error).message}`);

            return {
                success: false,
                error: (error as Error).message,
                rollbackData: backup
            };
        }
    }

    /**
     * Update control mode with proper state transitions
     */
    public async updateControlMode(newMode: FanControlMode): Promise<StateOperationResult<void>> {
        return this.atomicUpdate((state) => {
            if (state.controlMode === newMode) {
                return { success: true };
            }

            // Validate mode transition
            if (!this.isValidModeTransition(state.controlMode, newMode)) {
                return {
                    success: false,
                    error: `Invalid mode transition: ${state.controlMode} -> ${newMode}`
                };
            }

            // Clear mode-specific state when changing modes
            if (state.controlMode !== newMode) {
                this.clearModeSpecificState(state, state.controlMode);
            }

            state.controlMode = newMode;
            state.previousState = state.currentState;
            state.currentState = this.getStateForMode(newMode);

            return { success: true };
        }, `Update control mode to ${newMode}`);
    }

    /**
     * Update rotation state
     */
    public async updateRotationState(newRotationState: FanRotationState): Promise<StateOperationResult<void>> {
        return this.atomicUpdate((state) => {
            // Validate rotation state
            if (!this.isValidRotationState(newRotationState)) {
                return {
                    success: false,
                    error: "Invalid rotation state"
                };
            }

            state.rotationState = { ...newRotationState };
            return { success: true };
        }, "Update rotation state");
    }

    /**
     * Update threshold rotation state for specific group size
     */
    public async updateThresholdRotationState(
        groupSize: number,
        rotationState: FanRotationState
    ): Promise<StateOperationResult<void>> {
        return this.atomicUpdate((state) => {
            if (!this.isValidRotationState(rotationState)) {
                return {
                    success: false,
                    error: "Invalid threshold rotation state"
                };
            }

            if (!state.thresholdRotationStates) {
                state.thresholdRotationStates = new Map();
            }

            state.thresholdRotationStates.set(groupSize, { ...rotationState });
            return { success: true };
        }, `Update threshold rotation state for group size ${groupSize}`);
    }

    /**
     * Start transition with validation
     */
    public async startTransition(
        previousGroup: string[],
        nextGroup: string[],
        reason: string
    ): Promise<StateOperationResult<void>> {
        return this.atomicUpdate((state) => {
            // Check if already transitioning
            if (state.transitionState?.isTransitioning) {
                return {
                    success: false,
                    error: "Transition already in progress"
                };
            }

            // Validate groups
            if (!this.areValidFanGroups(previousGroup, nextGroup)) {
                return {
                    success: false,
                    error: "Invalid fan groups for transition"
                };
            }

            const now = getCurrentTimestamp();
            state.transitionState = {
                isTransitioning: true,
                phase: TransitionPhase.OFF,
                previousGroup: [...previousGroup],
                nextGroup: [...nextGroup],
                transitionStartTime: now,
                offDelayStartTime: 0,
                reason,
                retryCount: 0,
                maxRetries: 3
            };

            state.previousState = state.currentState;
            state.currentState = FanControlState.TRANSITIONING;

            return { success: true };
        }, `Start transition: [${previousGroup.join(', ')}] -> [${nextGroup.join(', ')}]`);
    }

    /**
     * Update transition phase
     */
    public async updateTransitionPhase(newPhase: TransitionPhase): Promise<StateOperationResult<void>> {
        return this.atomicUpdate((state) => {
            if (!state.transitionState?.isTransitioning) {
                return {
                    success: false,
                    error: "No active transition to update"
                };
            }

            // Validate phase transition
            if (!this.isValidPhaseTransition(state.transitionState.phase, newPhase)) {
                return {
                    success: false,
                    error: `Invalid phase transition: ${state.transitionState.phase} -> ${newPhase}`
                };
            }

            state.transitionState.phase = newPhase;

            // Set timing for specific phases
            if (newPhase === TransitionPhase.DELAY) {
                state.transitionState.offDelayStartTime = getCurrentTimestamp();
            }

            return { success: true };
        }, `Update transition phase to ${newPhase}`);
    }

    /**
     * Complete transition and cleanup
     */
    public async completeTransition(): Promise<StateOperationResult<void>> {
        return this.atomicUpdate((state) => {
            if (!state.transitionState?.isTransitioning) {
                return {
                    success: false,
                    error: "No active transition to complete"
                };
            }

            // Clear transition state
            state.transitionState = null;

            // Return to appropriate active state
            state.previousState = state.currentState;
            state.currentState = state.controlMode === FanControlMode.ROTATION
                ? FanControlState.ROTATION_ACTIVE
                : FanControlState.THRESHOLD_ACTIVE;

            return { success: true };
        }, "Complete transition");
    }

    /**
     * Handle error state with retry logic
     */
    public async handleError(error: string): Promise<StateOperationResult<void>> {
        return this.atomicUpdate((state) => {
            state.errorCount++;
            state.lastError = error;
            state.lastErrorTime = getCurrentTimestamp();

            // Check if we should enter error state
            if (state.errorCount >= this.MAX_ERROR_COUNT) {
                state.previousState = state.currentState;
                state.currentState = FanControlState.ERROR;

                // Clear transition state if in error
                if (state.transitionState?.isTransitioning) {
                    state.transitionState.retryCount++;
                    if (state.transitionState.retryCount >= state.transitionState.maxRetries) {
                        state.transitionState = null;
                    }
                }
            }

            return { success: true };
        }, `Handle error: ${error}`);
    }

    /**
     * Reset to safe state
     */
    public async resetToSafeState(): Promise<StateOperationResult<void>> {
        return this.atomicUpdate((state) => {
            state.previousState = state.currentState;
            state.currentState = FanControlState.IDLE;
            state.controlMode = FanControlMode.DISABLED;
            state.transitionState = null;
            state.errorCount = 0;
            state.lastError = null;

            return { success: true };
        }, "Reset to safe state");
    }

    /**
     * Get threshold rotation state for specific group size
     */
    public getThresholdRotationState(groupSize: number): FanRotationState | null {
        const state = this.getState();
        return state.thresholdRotationStates?.get(groupSize) || null;
    }

    /**
     * Check if transition is in progress
     */
    public isTransitionInProgress(): boolean {
        const state = this.getState();
        return state.transitionState?.isTransitioning === true;
    }

    /**
     * Get current transition state
     */
    public getTransitionState(): FanGroupTransitionState | null {
        const state = this.getState();
        return state.transitionState;
    }

    /**
     * Cleanup expired states and perform maintenance
     */
    public performMaintenance(): void {
        try {
            const state = this.getState();
            const updated = this.performCleanup(state);
            this.saveState(updated);
            this.logger.debug("State maintenance completed");
        } catch (error) {
            this.logger.error(`State maintenance failed: ${(error as Error).message}`);
        }
    }

    /**
     * Initialize default state
     */
    private initializeDefaultState(): CentralizedFanState {
        const now = getCurrentTimestamp();
        const defaultState: CentralizedFanState = {
            currentState: FanControlState.IDLE,
            previousState: FanControlState.IDLE,
            controlMode: FanControlMode.DISABLED,
            lastStateChange: now,

            rotationState: {
                currentGroupIndex: 0,
                lastRotationTime: 0,
                activeGroup: []
            },

            thresholdRotationStates: new Map(),
            transitionState: null,

            errorCount: 0,
            lastError: null,
            lastErrorTime: 0,

            createdAt: now,
            lastCleanup: now,
            version: this.STATE_VERSION
        };

        this.saveState(defaultState);
        this.logger.debug("Initialized default fan control state");
        return defaultState;
    }

    /**
     * Validate state structure and consistency
     */
    private validateState(state: CentralizedFanState): StateValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Check required fields
        if (!state.currentState || !Object.values(FanControlState).includes(state.currentState)) {
            errors.push("Invalid current state");
        }

        if (!state.controlMode || !Object.values(FanControlMode).includes(state.controlMode)) {
            errors.push("Invalid control mode");
        }

        // Check timestamps
        if (state.lastStateChange <= 0) {
            errors.push("Invalid last state change timestamp");
        }

        if (state.createdAt <= 0) {
            errors.push("Invalid created timestamp");
        }

        // Check rotation state
        if (!this.isValidRotationState(state.rotationState)) {
            errors.push("Invalid rotation state");
        }

        // Check transition state consistency
        if (state.transitionState) {
            if (state.currentState !== FanControlState.TRANSITIONING) {
                warnings.push("Transition state exists but not in transitioning mode");
            }

            if (!this.isValidTransitionState(state.transitionState)) {
                errors.push("Invalid transition state");
            }
        }

        // Check error state consistency
        if (state.currentState === FanControlState.ERROR && state.errorCount === 0) {
            warnings.push("In error state but error count is zero");
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Check if state is valid (basic check)
     */
    private isValidState(state: any): state is CentralizedFanState {
        return state &&
            typeof state === 'object' &&
            state.version === this.STATE_VERSION &&
            state.currentState &&
            state.controlMode &&
            state.rotationState;
    }

    /**
     * Validate rotation state
     */
    private isValidRotationState(rotationState: FanRotationState): boolean {
        return rotationState &&
            typeof rotationState.currentGroupIndex === 'number' &&
            rotationState.currentGroupIndex >= 0 &&
            typeof rotationState.lastRotationTime === 'number' &&
            Array.isArray(rotationState.activeGroup);
    }

    /**
     * Validate transition state
     */
    private isValidTransitionState(transitionState: FanGroupTransitionState): boolean {
        return transitionState &&
            typeof transitionState.isTransitioning === 'boolean' &&
            Object.values(TransitionPhase).includes(transitionState.phase) &&
            Array.isArray(transitionState.previousGroup) &&
            Array.isArray(transitionState.nextGroup) &&
            typeof transitionState.transitionStartTime === 'number' &&
            transitionState.transitionStartTime > 0;
    }

    /**
     * Validate fan groups
     */
    private areValidFanGroups(group1: string[], group2: string[]): boolean {
        const validFanKeys = ['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'];

        const isValidGroup = (group: string[]) =>
            Array.isArray(group) &&
            group.every(fan => validFanKeys.includes(fan));

        return isValidGroup(group1) && isValidGroup(group2);
    }

    /**
     * Check if mode transition is valid
     */
    private isValidModeTransition(from: FanControlMode, to: FanControlMode): boolean {
        // All transitions are valid, but some may require cleanup
        return true;
    }

    /**
     * Check if phase transition is valid
     */
    private isValidPhaseTransition(from: TransitionPhase, to: TransitionPhase): boolean {
        const validTransitions: Record<TransitionPhase, TransitionPhase[]> = {
            [TransitionPhase.OFF]: [TransitionPhase.DELAY],
            [TransitionPhase.DELAY]: [TransitionPhase.ON],
            [TransitionPhase.ON]: [TransitionPhase.COMPLETE],
            [TransitionPhase.COMPLETE]: [TransitionPhase.OFF] // Allow restart
        };

        return validTransitions[from]?.includes(to) || false;
    }

    /**
     * Get appropriate state for control mode
     */
    private getStateForMode(mode: FanControlMode): FanControlState {
        switch (mode) {
            case FanControlMode.ROTATION:
                return FanControlState.ROTATION_ACTIVE;
            case FanControlMode.THRESHOLD:
                return FanControlState.THRESHOLD_ACTIVE;
            case FanControlMode.DISABLED:
                return FanControlState.IDLE;
            default:
                return FanControlState.IDLE;
        }
    }

    /**
     * Clear mode-specific state when changing modes
     */
    private clearModeSpecificState(state: CentralizedFanState, oldMode: FanControlMode): void {
        switch (oldMode) {
            case FanControlMode.ROTATION:
                state.rotationState = {
                    currentGroupIndex: 0,
                    lastRotationTime: 0,
                    activeGroup: []
                };
                break;
            case FanControlMode.THRESHOLD:
                state.thresholdRotationStates.clear();
                break;
        }
    }

    /**
     * Check if cleanup should be performed
     */
    private shouldPerformCleanup(state: CentralizedFanState): boolean {
        const now = getCurrentTimestamp();
        return (now - state.lastCleanup) > this.CLEANUP_INTERVAL_MS;
    }

    /**
     * Perform cleanup operations
     */
    private performCleanup(state: CentralizedFanState): CentralizedFanState {
        const now = getCurrentTimestamp();
        const cleanedState = { ...state };

        // Clear old threshold rotation states (older than 1 hour)
        const oneHourAgo = now - (60 * 60 * 1000);
        for (const [groupSize, rotationState] of cleanedState.thresholdRotationStates.entries()) {
            if (rotationState.lastRotationTime < oneHourAgo) {
                cleanedState.thresholdRotationStates.delete(groupSize);
            }
        }

        // Reset error count if no recent errors (older than 10 minutes)
        const tenMinutesAgo = now - (10 * 60 * 1000);
        if (cleanedState.lastErrorTime < tenMinutesAgo) {
            cleanedState.errorCount = 0;
            cleanedState.lastError = null;
        }

        cleanedState.lastCleanup = now;
        return cleanedState;
    }

    /**
     * Deep clone state for backup
     */
    private deepClone(state: CentralizedFanState): CentralizedFanState {
        return {
            ...state,
            rotationState: { ...state.rotationState },
            thresholdRotationStates: new Map(state.thresholdRotationStates),
            transitionState: state.transitionState ? { ...state.transitionState } : null
        };
    }

    /**
     * Save state to context
     */
    private saveState(state: CentralizedFanState): void {
        this.flowContext.set(this.STATE_KEY, state);
    }

    /**
     * Restore state from backup
     */
    private restoreState(backup: CentralizedFanState): void {
        this.saveState(backup);
    }
}
