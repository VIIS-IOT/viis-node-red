"use strict";
/**
 * Centralized State Manager for Fan Control
 * Provides atomic operations, validation, and cleanup for fan control state
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FanControlStateManager = void 0;
const types_1 = require("../interfaces/types");
const constants_1 = require("../constants");
const timeUtils_1 = require("../utils/timeUtils");
class FanControlStateManager {
    constructor(flowContext, logger) {
        this.STATE_KEY = constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE + "_centralized";
        this.STATE_VERSION = 1;
        this.CLEANUP_INTERVAL_MS = 300000; // 5 minutes
        this.MAX_ERROR_COUNT = 10;
        this.flowContext = flowContext;
        this.logger = logger;
    }
    /**
     * Get current centralized state with validation
     */
    getState() {
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
     * Atomic state update operation with optimistic locking and retry capability
     */
    async atomicUpdate(operation, description) {
        const maxRetries = 3;
        let attempt = 0;
        while (attempt < maxRetries) {
            attempt++;
            // Get current state with version
            const currentState = this.getState();
            const originalVersion = currentState.version;
            const backup = this.deepClone(currentState);
            try {
                // Execute operation on cloned state
                const workingState = this.deepClone(currentState);
                const result = operation(workingState);
                if (!result.success) {
                    this.logger.warn(`State operation failed: ${description} - ${result.error}`);
                    return result;
                }
                // Validate new state before saving
                const validation = this.validateState(workingState);
                if (!validation.isValid) {
                    this.logger.error(`State validation failed after ${description}: ${validation.errors.join(', ')}`);
                    return {
                        success: false,
                        error: `State validation failed: ${validation.errors.join(', ')}`,
                        rollbackData: backup
                    };
                }
                // Check for version conflicts (optimistic locking)
                const latestState = this.getState();
                if (latestState.version !== originalVersion) {
                    if (attempt < maxRetries) {
                        this.logger.debug(`Version conflict detected, retrying ${description} (attempt ${attempt}/${maxRetries})`);
                        await this.delay(100 * attempt); // Exponential backoff
                        continue;
                    }
                    else {
                        return {
                            success: false,
                            error: `Version conflict: state was modified during operation after ${maxRetries} attempts`,
                            rollbackData: backup
                        };
                    }
                }
                // Update metadata and version
                workingState.lastStateChange = (0, timeUtils_1.getCurrentTimestamp)();
                workingState.version = originalVersion + 1;
                // Atomic save with version check
                const saveSuccess = this.atomicSave(workingState, originalVersion);
                if (!saveSuccess) {
                    if (attempt < maxRetries) {
                        this.logger.debug(`Save conflict detected, retrying ${description} (attempt ${attempt}/${maxRetries})`);
                        await this.delay(100 * attempt);
                        continue;
                    }
                    else {
                        return {
                            success: false,
                            error: `Save conflict: state was modified during save after ${maxRetries} attempts`,
                            rollbackData: backup
                        };
                    }
                }
                this.logger.debug(`State updated successfully: ${description} (attempt ${attempt})`);
                return result;
            }
            catch (error) {
                this.logger.error(`Exception during state operation: ${description} - ${error.message}`);
                if (attempt >= maxRetries) {
                    return {
                        success: false,
                        error: error.message,
                        rollbackData: backup
                    };
                }
                await this.delay(100 * attempt);
            }
        }
        return {
            success: false,
            error: `Failed after ${maxRetries} attempts`,
            rollbackData: undefined
        };
    }
    /**
     * Update control mode with proper state transitions
     */
    async updateControlMode(newMode) {
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
    async updateRotationState(newRotationState) {
        return this.atomicUpdate((state) => {
            // Validate rotation state
            if (!this.isValidRotationState(newRotationState)) {
                return {
                    success: false,
                    error: "Invalid rotation state"
                };
            }
            state.rotationState = Object.assign({}, newRotationState);
            return { success: true };
        }, "Update rotation state");
    }
    /**
     * Update threshold rotation state for specific group size
     */
    async updateThresholdRotationState(groupSize, rotationState) {
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
            state.thresholdRotationStates.set(groupSize, Object.assign({}, rotationState));
            return { success: true };
        }, `Update threshold rotation state for group size ${groupSize}`);
    }
    /**
     * Start transition with validation
     */
    async startTransition(previousGroup, nextGroup, reason) {
        return this.atomicUpdate((state) => {
            var _a;
            // Check if already transitioning
            if ((_a = state.transitionState) === null || _a === void 0 ? void 0 : _a.isTransitioning) {
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
            const now = (0, timeUtils_1.getCurrentTimestamp)();
            state.transitionState = {
                isTransitioning: true,
                phase: types_1.TransitionPhase.OFF,
                previousGroup: [...previousGroup],
                nextGroup: [...nextGroup],
                transitionStartTime: now,
                offDelayStartTime: 0,
                reason,
                retryCount: 0,
                maxRetries: 3
            };
            state.previousState = state.currentState;
            state.currentState = types_1.FanControlState.TRANSITIONING;
            return { success: true };
        }, `Start transition: [${previousGroup.join(', ')}] -> [${nextGroup.join(', ')}]`);
    }
    /**
     * Update transition phase
     */
    async updateTransitionPhase(newPhase) {
        return this.atomicUpdate((state) => {
            var _a;
            if (!((_a = state.transitionState) === null || _a === void 0 ? void 0 : _a.isTransitioning)) {
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
            if (newPhase === types_1.TransitionPhase.DELAY) {
                state.transitionState.offDelayStartTime = (0, timeUtils_1.getCurrentTimestamp)();
            }
            return { success: true };
        }, `Update transition phase to ${newPhase}`);
    }
    /**
     * Complete transition and cleanup
     */
    async completeTransition() {
        return this.atomicUpdate((state) => {
            var _a;
            if (!((_a = state.transitionState) === null || _a === void 0 ? void 0 : _a.isTransitioning)) {
                return {
                    success: false,
                    error: "No active transition to complete"
                };
            }
            // Clear transition state
            state.transitionState = null;
            // Return to appropriate active state
            state.previousState = state.currentState;
            state.currentState = state.controlMode === types_1.FanControlMode.ROTATION
                ? types_1.FanControlState.ROTATION_ACTIVE
                : types_1.FanControlState.THRESHOLD_ACTIVE;
            return { success: true };
        }, "Complete transition");
    }
    /**
     * Handle error state with retry logic
     */
    async handleError(error) {
        return this.atomicUpdate((state) => {
            var _a;
            state.errorCount++;
            state.lastError = error;
            state.lastErrorTime = (0, timeUtils_1.getCurrentTimestamp)();
            // Check if we should enter error state
            if (state.errorCount >= this.MAX_ERROR_COUNT) {
                state.previousState = state.currentState;
                state.currentState = types_1.FanControlState.ERROR;
                // Clear transition state if in error
                if ((_a = state.transitionState) === null || _a === void 0 ? void 0 : _a.isTransitioning) {
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
    async resetToSafeState() {
        return this.atomicUpdate((state) => {
            state.previousState = state.currentState;
            state.currentState = types_1.FanControlState.IDLE;
            state.controlMode = types_1.FanControlMode.DISABLED;
            state.transitionState = null;
            state.errorCount = 0;
            state.lastError = null;
            return { success: true };
        }, "Reset to safe state");
    }
    /**
     * Get threshold rotation state for specific group size
     */
    getThresholdRotationState(groupSize) {
        var _a;
        const state = this.getState();
        return ((_a = state.thresholdRotationStates) === null || _a === void 0 ? void 0 : _a.get(groupSize)) || null;
    }
    /**
     * Check if transition is in progress
     */
    isTransitionInProgress() {
        var _a;
        const state = this.getState();
        return ((_a = state.transitionState) === null || _a === void 0 ? void 0 : _a.isTransitioning) === true;
    }
    /**
     * Get current transition state
     */
    getTransitionState() {
        const state = this.getState();
        return state.transitionState;
    }
    /**
     * Cleanup expired states and perform maintenance
     */
    performMaintenance() {
        try {
            const state = this.getState();
            const updated = this.performCleanup(state);
            this.saveState(updated);
            this.logger.debug("State maintenance completed");
        }
        catch (error) {
            this.logger.error(`State maintenance failed: ${error.message}`);
        }
    }
    /**
     * Initialize default state
     */
    initializeDefaultState() {
        const now = (0, timeUtils_1.getCurrentTimestamp)();
        const defaultState = {
            currentState: types_1.FanControlState.IDLE,
            previousState: types_1.FanControlState.IDLE,
            controlMode: types_1.FanControlMode.DISABLED,
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
    validateState(state) {
        const errors = [];
        const warnings = [];
        // Check required fields
        if (!state.currentState || !Object.values(types_1.FanControlState).includes(state.currentState)) {
            errors.push("Invalid current state");
        }
        if (!state.controlMode || !Object.values(types_1.FanControlMode).includes(state.controlMode)) {
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
            if (state.currentState !== types_1.FanControlState.TRANSITIONING) {
                warnings.push("Transition state exists but not in transitioning mode");
            }
            if (!this.isValidTransitionState(state.transitionState)) {
                errors.push("Invalid transition state");
            }
        }
        // Check error state consistency
        if (state.currentState === types_1.FanControlState.ERROR && state.errorCount === 0) {
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
    isValidState(state) {
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
    isValidRotationState(rotationState) {
        return rotationState &&
            typeof rotationState.currentGroupIndex === 'number' &&
            rotationState.currentGroupIndex >= 0 &&
            typeof rotationState.lastRotationTime === 'number' &&
            Array.isArray(rotationState.activeGroup);
    }
    /**
     * Validate transition state
     */
    isValidTransitionState(transitionState) {
        return transitionState &&
            typeof transitionState.isTransitioning === 'boolean' &&
            Object.values(types_1.TransitionPhase).includes(transitionState.phase) &&
            Array.isArray(transitionState.previousGroup) &&
            Array.isArray(transitionState.nextGroup) &&
            typeof transitionState.transitionStartTime === 'number' &&
            transitionState.transitionStartTime > 0;
    }
    /**
     * Validate fan groups
     */
    areValidFanGroups(group1, group2) {
        const validFanKeys = ['quat_1', 'quat_2', 'quat_3', 'quat_4', 'quat_5', 'quat_6'];
        const isValidGroup = (group) => Array.isArray(group) &&
            group.every(fan => validFanKeys.includes(fan));
        return isValidGroup(group1) && isValidGroup(group2);
    }
    /**
     * Check if mode transition is valid
     */
    isValidModeTransition(from, to) {
        // All transitions are valid, but some may require cleanup
        return true;
    }
    /**
     * Check if phase transition is valid
     */
    isValidPhaseTransition(from, to) {
        var _a;
        const validTransitions = {
            [types_1.TransitionPhase.OFF]: [types_1.TransitionPhase.DELAY],
            [types_1.TransitionPhase.DELAY]: [types_1.TransitionPhase.ON],
            [types_1.TransitionPhase.ON]: [types_1.TransitionPhase.COMPLETE],
            [types_1.TransitionPhase.COMPLETE]: [types_1.TransitionPhase.OFF] // Allow restart
        };
        return ((_a = validTransitions[from]) === null || _a === void 0 ? void 0 : _a.includes(to)) || false;
    }
    /**
     * Get appropriate state for control mode
     */
    getStateForMode(mode) {
        switch (mode) {
            case types_1.FanControlMode.ROTATION:
                return types_1.FanControlState.ROTATION_ACTIVE;
            case types_1.FanControlMode.THRESHOLD:
                return types_1.FanControlState.THRESHOLD_ACTIVE;
            case types_1.FanControlMode.DISABLED:
                return types_1.FanControlState.IDLE;
            default:
                return types_1.FanControlState.IDLE;
        }
    }
    /**
     * Clear mode-specific state when changing modes
     */
    clearModeSpecificState(state, oldMode) {
        switch (oldMode) {
            case types_1.FanControlMode.ROTATION:
                state.rotationState = {
                    currentGroupIndex: 0,
                    lastRotationTime: 0,
                    activeGroup: []
                };
                break;
            case types_1.FanControlMode.THRESHOLD:
                state.thresholdRotationStates.clear();
                break;
        }
    }
    /**
     * Check if cleanup should be performed
     */
    shouldPerformCleanup(state) {
        const now = (0, timeUtils_1.getCurrentTimestamp)();
        return (now - state.lastCleanup) > this.CLEANUP_INTERVAL_MS;
    }
    /**
     * Perform cleanup operations
     */
    performCleanup(state) {
        const now = (0, timeUtils_1.getCurrentTimestamp)();
        const cleanedState = Object.assign({}, state);
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
    deepClone(state) {
        return Object.assign(Object.assign({}, state), { rotationState: Object.assign({}, state.rotationState), thresholdRotationStates: new Map(state.thresholdRotationStates), transitionState: state.transitionState ? Object.assign({}, state.transitionState) : null });
    }
    /**
     * Save state to context
     */
    saveState(state) {
        this.flowContext.set(this.STATE_KEY, state);
    }
    /**
     * Restore state from backup
     */
    restoreState(backup) {
        this.saveState(backup);
    }
    /**
     * Atomic save with version checking
     */
    atomicSave(state, expectedVersion) {
        // In Node-RED's single-threaded environment, this is naturally atomic
        // But we still check version for consistency
        const currentState = this.flowContext.get(this.STATE_KEY);
        if (currentState && currentState.version !== expectedVersion) {
            return false; // Version mismatch
        }
        this.flowContext.set(this.STATE_KEY, state);
        return true;
    }
    /**
     * Delay helper for retry logic
     */
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.FanControlStateManager = FanControlStateManager;
