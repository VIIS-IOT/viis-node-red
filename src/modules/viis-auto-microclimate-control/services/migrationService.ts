/**
 * Migration Service for Fan Control State Management
 * Handles migration from legacy scattered state to centralized state management
 */

import {
    CentralizedFanState,
    FanControlState,
    FanControlMode,
    FanRotationState,
    ILogger
} from "../interfaces/types";
import { CONTEXT_KEYS } from "../constants";
import { getCurrentTimestamp } from "../utils/timeUtils";

export interface MigrationResult {
    success: boolean;
    migratedKeys: string[];
    errors: string[];
    warnings: string[];
    backupCreated: boolean;
}

export class MigrationService {
    private flowContext: any;
    private logger: ILogger;
    private readonly MIGRATION_VERSION = 1;
    private readonly MIGRATION_KEY = "fan_control_migration_status";
    private readonly BACKUP_KEY = "fan_control_legacy_backup";

    constructor(flowContext: any, logger: ILogger) {
        this.flowContext = flowContext;
        this.logger = logger;
    }

    /**
     * Check if migration is needed
     */
    public needsMigration(): boolean {
        const migrationStatus = this.flowContext.get(this.MIGRATION_KEY);
        return !migrationStatus || migrationStatus.version < this.MIGRATION_VERSION;
    }

    /**
     * Perform migration from legacy state to centralized state
     */
    public async migrate(): Promise<MigrationResult> {
        const result: MigrationResult = {
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

        } catch (error) {
            result.errors.push((error as Error).message);
            this.logger.error(`Migration failed: ${(error as Error).message}`);
        }

        return result;
    }

    /**
     * Rollback migration (restore from backup)
     */
    public async rollback(): Promise<MigrationResult> {
        const result: MigrationResult = {
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
            this.flowContext.set(CONTEXT_KEYS.FAN_ROTATION_STATE + "_centralized", null);

            // Reset migration status
            this.flowContext.set(this.MIGRATION_KEY, null);

            result.success = true;
            this.logger.warn(`Rollback completed. Restored ${result.migratedKeys.length} keys.`);

        } catch (error) {
            result.errors.push((error as Error).message);
            this.logger.error(`Rollback failed: ${(error as Error).message}`);
        }

        return result;
    }

    /**
     * Get migration status
     */
    public getMigrationStatus(): {
        isMigrated: boolean;
        version: number;
        migratedAt: number;
        hasBackup: boolean;
    } {
        const migrationStatus = this.flowContext.get(this.MIGRATION_KEY);
        const hasBackup = !!this.flowContext.get(this.BACKUP_KEY);

        return {
            isMigrated: !!migrationStatus && migrationStatus.version >= this.MIGRATION_VERSION,
            version: migrationStatus?.version || 0,
            migratedAt: migrationStatus?.migratedAt || 0,
            hasBackup
        };
    }

    /**
     * Create backup of current state
     */
    private createBackup(): { success: boolean; error?: string } {
        try {
            const legacyState = this.collectLegacyState();
            const backup = {
                createdAt: getCurrentTimestamp(),
                version: this.MIGRATION_VERSION,
                legacyState
            };

            this.flowContext.set(this.BACKUP_KEY, backup);
            return { success: true };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }

    /**
     * Collect all legacy state keys and values
     */
    private collectLegacyState(): Record<string, any> {
        const legacyKeys = [
            CONTEXT_KEYS.FAN_ROTATION_STATE,
            CONTEXT_KEYS.FAN_ROTATION_TIMER,
            CONTEXT_KEYS.FAN_GROUP_TRANSITION_STATE,
            CONTEXT_KEYS.FAN_GROUP_TRANSITION_TIMER,
            // Dynamic threshold rotation states
            ...this.findThresholdRotationKeys(),
            // Fan dao states
            'fan_dao_last_time',
            'fan_dao_current_state',
            // Transition completion tracking
            CONTEXT_KEYS.FAN_GROUP_TRANSITION_STATE + '_last_completion'
        ];

        const legacyState: Record<string, any> = {};
        
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
    private findThresholdRotationKeys(): string[] {
        // In a real implementation, you would enumerate context keys
        // For now, we'll check common threshold rotation keys
        const possibleKeys = [
            `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_1`,
            `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_2`,
            `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_4`,
            `${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_6`
        ];

        return possibleKeys.filter(key => {
            const value = this.flowContext.get(key);
            return value !== undefined && value !== null;
        });
    }

    /**
     * Convert legacy state to centralized state format
     */
    private convertToCentralizedState(legacyState: Record<string, any>): CentralizedFanState {
        const now = getCurrentTimestamp();

        // Extract main rotation state
        const legacyRotationState = legacyState[CONTEXT_KEYS.FAN_ROTATION_STATE] || {
            currentGroupIndex: 0,
            lastRotationTime: 0,
            activeGroup: []
        };

        // Extract transition state
        const legacyTransitionState = legacyState[CONTEXT_KEYS.FAN_GROUP_TRANSITION_STATE];

        // Extract threshold rotation states
        const thresholdRotationStates = new Map<number, FanRotationState>();
        Object.entries(legacyState).forEach(([key, value]) => {
            const match = key.match(new RegExp(`${CONTEXT_KEYS.FAN_ROTATION_STATE}_threshold_(\\d+)`));
            if (match && value) {
                const groupSize = parseInt(match[1]);
                thresholdRotationStates.set(groupSize, value as FanRotationState);
            }
        });

        // Determine current state and mode
        let currentState = FanControlState.IDLE;
        let controlMode = FanControlMode.DISABLED;

        if (legacyTransitionState?.isTransitioning) {
            currentState = FanControlState.TRANSITIONING;
        } else if (legacyRotationState.activeGroup?.length > 0) {
            // Assume rotation mode if active group exists
            currentState = FanControlState.ROTATION_ACTIVE;
            controlMode = FanControlMode.ROTATION;
        }

        const centralizedState: CentralizedFanState = {
            currentState,
            previousState: FanControlState.IDLE,
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
    private validateMigratedState(state: CentralizedFanState): {
        isValid: boolean;
        errors: string[];
        warnings: string[];
    } {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Basic structure validation
        if (!state.currentState || !Object.values(FanControlState).includes(state.currentState)) {
            errors.push("Invalid current state in migrated data");
        }

        if (!state.controlMode || !Object.values(FanControlMode).includes(state.controlMode)) {
            errors.push("Invalid control mode in migrated data");
        }

        if (!state.rotationState || typeof state.rotationState !== 'object') {
            errors.push("Invalid rotation state in migrated data");
        }

        // Consistency checks
        if (state.currentState === FanControlState.TRANSITIONING && !state.transitionState) {
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
    private saveCentralizedState(state: CentralizedFanState): void {
        const stateKey = CONTEXT_KEYS.FAN_ROTATION_STATE + "_centralized";
        this.flowContext.set(stateKey, state);
    }

    /**
     * Check if legacy keys should be cleaned up
     */
    private shouldCleanupLegacyKeys(): boolean {
        // For safety, don't cleanup by default
        // This can be enabled via configuration if needed
        return false;
    }

    /**
     * Clean up legacy keys
     */
    private cleanupLegacyKeys(legacyState: Record<string, any>): void {
        Object.keys(legacyState).forEach(key => {
            this.flowContext.set(key, null);
        });
        this.logger.debug(`Cleaned up ${Object.keys(legacyState).length} legacy keys`);
    }

    /**
     * Mark migration as complete
     */
    private markMigrationComplete(): void {
        const migrationStatus = {
            version: this.MIGRATION_VERSION,
            migratedAt: getCurrentTimestamp(),
            success: true
        };
        this.flowContext.set(this.MIGRATION_KEY, migrationStatus);
    }
}
