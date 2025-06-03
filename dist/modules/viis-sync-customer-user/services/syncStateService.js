"use strict";
/**
 * @fileoverview Sync State Service for VIIS Sync Customer User module
 * Tracks and manages the state of customer user synchronization operations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncStateService = void 0;
/**
 * Service for tracking sync state
 */
class SyncStateService {
    /**
     * Creates a new sync state service
     * @param node - Node-RED node instance
     */
    constructor(node) {
        /** Whether a sync is currently in progress */
        this.syncInProgress = false;
        /** Timestamp of the last successful sync */
        this.lastSyncTimestamp = 0;
        /** Result of the last sync operation */
        this.lastSyncResult = null;
        /** Start time of the current sync operation */
        this.syncStartTime = 0;
        this.node = node;
    }
    /**
     * Records the start of a sync operation
     * @returns Timestamp of the sync start
     */
    startSync() {
        this.syncInProgress = true;
        this.syncStartTime = Date.now();
        return this.syncStartTime;
    }
    /**
     * Records the result of a sync operation
     * @param result - Result of the sync operation
     */
    recordSyncResult(result) {
        this.syncInProgress = false;
        this.lastSyncResult = result;
        if (result.success) {
            this.lastSyncTimestamp = result.timestamp || Date.now();
        }
    }
    /**
     * Gets a descriptive status message about the sync state
     * @returns Status message
     */
    getStatusMessage() {
        if (this.syncInProgress) {
            return 'Sync in progress...';
        }
        if (!this.lastSyncTimestamp) {
            return 'Never synced';
        }
        const timeSinceLastSync = Math.floor((Date.now() - this.lastSyncTimestamp) / 1000);
        let timeMessage = '';
        if (timeSinceLastSync < 60) {
            timeMessage = `${timeSinceLastSync} seconds ago`;
        }
        else if (timeSinceLastSync < 3600) {
            timeMessage = `${Math.floor(timeSinceLastSync / 60)} minutes ago`;
        }
        else if (timeSinceLastSync < 86400) {
            timeMessage = `${Math.floor(timeSinceLastSync / 3600)} hours ago`;
        }
        else {
            timeMessage = `${Math.floor(timeSinceLastSync / 86400)} days ago`;
        }
        if (this.lastSyncResult && this.lastSyncResult.success) {
            return `Last sync: ${timeMessage} (${this.lastSyncResult.totalUsers || 0} users)`;
        }
        else {
            return `Last sync failed: ${timeMessage}`;
        }
    }
    /**
     * Gets whether a sync is currently in progress
     * @returns True if sync is in progress, false otherwise
     */
    isSyncInProgress() {
        return this.syncInProgress;
    }
}
exports.SyncStateService = SyncStateService;
