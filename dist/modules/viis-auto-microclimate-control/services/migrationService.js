"use strict";
/**
 * Migration Service for Fan Control State Management
 * Handles migration from legacy scattered state to centralized state management
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MigrationService = void 0;
const types_1 = require("../interfaces/types");
const constants_1 = require("../constants");
const timeUtils_1 = require("../utils/timeUtils");
class MigrationService {
    constructor(flowContext, logger) {
        this.MIGRATION_VERSION = 1;
        this.MIGRATION_KEY = "fan_control_migration_status";
        this.BACKUP_KEY = "fan_control_legacy_backup";
        this.flowContext = flowContext;
        this.logger = logger;
    }
    /**
     * Check if migration is needed
     */
    needsMigration() {
        const migrationStatus = this.flowContext.get(this.MIGRATION_KEY);
        return !migrationStatus || migrationStatus.version < this.MIGRATION_VERSION;
    }
    /**
     * Perform migration from legacy state to centralized state
     */
    async migrate() {
        const result = {
            success: false,
            migratedKeys: [],
            errors: [],
            warnings: [],
            backupCreated: false
        };
        try {
            this.logger.warn("Starting fan control state migration");
            // Create backup of existing state
            const backupResult = this.createBackup();
            result.backupCreated = backupResult.success;
            if (!backupResult.success) {
                result.warnings.push("Failed to create backup: " + backupResult.error);
            }
            // Collect legacy state data
            const legacyState = this.collectLegacyState();
            result.migratedKeys = Object.keys(legacyState);
            // Convert to centralized state
            const centralizedState = this.convertToCentralizedState(legacyState);
            // Validate converted state
            const validation = this.validateMigratedState(centralizedState);
            if (!validation.isValid) {
                result.errors.push(...validation.errors);
                result.warnings.push(...validation.warnings);
                return result;
            }
            // Save centralized state
            this.saveCentralizedState(centralizedState);
            // Clean up legacy keys (optional, can be disabled for safety)
            if (this.shouldCleanupLegacyKeys()) {
                this.cleanupLegacyKeys(legacyState);
            }
            // Mark migration as complete
            this.markMigrationComplete();
            result.success = true;
            this.logger.warn(`Migration completed successfully. Migrated ${result.migratedKeys.length} keys.`);
        }
        catch (error) {
            result.errors.push(error.message);
            this.logger.error(`Migration failed: ${error.message}`);
        }
        return result;
    }
    /**
     * Rollback migration (restore from backup)
     */
    async rollback() {
        const result = {
            success: false,
            migratedKeys: [],
            errors: [],
            warnings: [],
            backupCreated: false
        };
        try {
            this.logger.warn("Starting migration rollback");
            const backup = this.flowContext.get(this.BACKUP_KEY);
            if (!backup) {
                result.errors.push("No backup found for rollback");
                return result;
            }
            // Restore legacy state
            Object.entries(backup.legacyState).forEach(([key, value]) => {
                this.flowContext.set(key, value);
                result.migratedKeys.push(key);
            });
            // Remove centralized state
            this.flowContext.set(constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE + "_centralized", null);
            // Reset migration status
            this.flowContext.set(this.MIGRATION_KEY, null);
            result.success = true;
            this.logger.warn(`Rollback completed. Restored ${result.migratedKeys.length} keys.`);
        }
        catch (error) {
            result.errors.push(error.message);
            this.logger.error(`Rollback failed: ${error.message}`);
        }
        return result;
    }
    /**
     * Get migration status
     */
    getMigrationStatus() {
        const migrationStatus = this.flowContext.get(this.MIGRATION_KEY);
        const hasBackup = !!this.flowContext.get(this.BACKUP_KEY);
        return {
            isMigrated: !!migrationStatus && migrationStatus.version >= this.MIGRATION_VERSION,
            version: (migrationStatus === null || migrationStatus === void 0 ? void 0 : migrationStatus.version) || 0,
            migratedAt: (migrationStatus === null || migrationStatus === void 0 ? void 0 : migrationStatus.migratedAt) || 0,
            hasBackup
        };
    }
    /**
     * Create backup of current state
     */
    createBackup() {
        try {
            const legacyState = this.collectLegacyState();
            const backup = {
                createdAt: (0, timeUtils_1.getCurrentTimestamp)(),
                version: this.MIGRATION_VERSION,
                legacyState
            };
            this.flowContext.set(this.BACKUP_KEY, backup);
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    }
    /**
     * Collect all legacy state keys and values
     */
    collectLegacyState() {
        const legacyKeys = [
            constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE,
            constants_1.CONTEXT_KEYS.FAN_ROTATION_TIMER,
            constants_1.CONTEXT_KEYS.FAN_GROUP_TRANSITION_STATE,
            constants_1.CONTEXT_KEYS.FAN_GROUP_TRANSITION_TIMER,
            // Dynamic threshold rotation states
            ...this.findThresholdRotationKeys(),
            // Fan dao states
            'fan_dao_last_time',
            'fan_dao_current_state',
            // Transition completion tracking
            constants_1.CONTEXT_KEYS.FAN_GROUP_TRANSITION_STATE + '_last_completion'
        ];
        const legacyState = {};
        legacyKeys.forEach(key => {
            const value = this.flowContext.get(key);
            if (value !== undefined && value !== null) {
                legacyState[key] = value;
            }
        });
        return legacyState;
    }
    /**
     * Find dynamic threshold rotation keys
     */
    findThresholdRotationKeys() {
        // In a real implementation, you would enumerate context keys
        // For now, we'll check common threshold rotation keys
        const possibleKeys = [
            `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_1`,
            `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_2`,
            `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_4`,
            `${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_6`
        ];
        return possibleKeys.filter(key => {
            const value = this.flowContext.get(key);
            return value !== undefined && value !== null;
        });
    }
    /**
     * Convert legacy state to centralized state format
     */
    convertToCentralizedState(legacyState) {
        var _a;
        const now = (0, timeUtils_1.getCurrentTimestamp)();
        // Extract main rotation state
        const legacyRotationState = legacyState[constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE] || {
            currentGroupIndex: 0,
            lastRotationTime: 0,
            activeGroup: []
        };
        // Extract transition state
        const legacyTransitionState = legacyState[constants_1.CONTEXT_KEYS.FAN_GROUP_TRANSITION_STATE];
        // Extract threshold rotation states
        const thresholdRotationStates = new Map();
        Object.entries(legacyState).forEach(([key, value]) => {
            const match = key.match(new RegExp(`${constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_(\\d+)`));
            if (match && value) {
                const groupSize = parseInt(match[1]);
                thresholdRotationStates.set(groupSize, value);
            }
        });
        // Determine current state and mode
        let currentState = types_1.FanControlState.IDLE;
        let controlMode = types_1.FanControlMode.DISABLED;
        if (legacyTransitionState === null || legacyTransitionState === void 0 ? void 0 : legacyTransitionState.isTransitioning) {
            currentState = types_1.FanControlState.TRANSITIONING;
        }
        else if (((_a = legacyRotationState.activeGroup) === null || _a === void 0 ? void 0 : _a.length) > 0) {
            // Assume rotation mode if active group exists
            currentState = types_1.FanControlState.ROTATION_ACTIVE;
            controlMode = types_1.FanControlMode.ROTATION;
        }
        const centralizedState = {
            currentState,
            previousState: types_1.FanControlState.IDLE,
            controlMode,
            lastStateChange: now,
            rotationState: legacyRotationState,
            thresholdRotationStates,
            transitionState: legacyTransitionState || null,
            errorCount: 0,
            lastError: null,
            lastErrorTime: 0,
            createdAt: now,
            lastCleanup: now,
            version: 1
        };
        return centralizedState;
    }
    /**
     * Validate migrated state
     */
    validateMigratedState(state) {
        const errors = [];
        const warnings = [];
        // Basic structure validation
        if (!state.currentState || !Object.values(types_1.FanControlState).includes(state.currentState)) {
            errors.push("Invalid current state in migrated data");
        }
        if (!state.controlMode || !Object.values(types_1.FanControlMode).includes(state.controlMode)) {
            errors.push("Invalid control mode in migrated data");
        }
        if (!state.rotationState || typeof state.rotationState !== 'object') {
            errors.push("Invalid rotation state in migrated data");
        }
        // Consistency checks
        if (state.currentState === types_1.FanControlState.TRANSITIONING && !state.transitionState) {
            warnings.push("State is transitioning but no transition state found");
        }
        if (state.thresholdRotationStates.size > 4) {
            warnings.push("Unusually high number of threshold rotation states");
        }
        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }
    /**
     * Save centralized state
     */
    saveCentralizedState(state) {
        const stateKey = constants_1.CONTEXT_KEYS.FAN_ROTATION_STATE + "_centralized";
        this.flowContext.set(stateKey, state);
    }
    /**
     * Check if legacy keys should be cleaned up
     */
    shouldCleanupLegacyKeys() {
        // For safety, don't cleanup by default
        // This can be enabled via configuration if needed
        return false;
    }
    /**
     * Clean up legacy keys
     */
    cleanupLegacyKeys(legacyState) {
        Object.keys(legacyState).forEach(key => {
            this.flowContext.set(key, null);
        });
        this.logger.debug(`Cleaned up ${Object.keys(legacyState).length} legacy keys`);
    }
    /**
     * Mark migration as complete
     */
    markMigrationComplete() {
        const migrationStatus = {
            version: this.MIGRATION_VERSION,
            migratedAt: (0, timeUtils_1.getCurrentTimestamp)(),
            success: true
        };
        this.flowContext.set(this.MIGRATION_KEY, migrationStatus);
    }
}
exports.MigrationService = MigrationService;
