"use strict";
/**
 * @fileoverview Sync State Service for VIIS Sync Schedule module
 * Tracks synchronization state and history
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncStateService = void 0;
const logger_1 = require("../utils/logger");
/**
 * Service for tracking synchronization state and history
 */
class SyncStateService {
    /**
     * Creates a new sync state service
     * @param node - Node-RED node instance or null
     */
    constructor(node = null) {
        /** Maximum number of history records to keep */
        this.maxHistorySize = 10;
        /** Last synchronization record */
        this.lastSyncRecord = null;
        /** Synchronization history */
        this.syncHistory = [];
        /** Whether a sync is currently in progress */
        this.syncInProgress = false;
        this.node = node;
        logger_1.logger.info(node, 'SyncStateService initialized');
    }
    /**
     * Records the start of a synchronization
     * @returns Current timestamp
     */
    startSync() {
        if (this.syncInProgress) {
            logger_1.logger.warn(this.node, 'Sync already in progress');
        }
        this.syncInProgress = true;
        logger_1.logger.info(this.node, 'Sync started');
        const timestamp = Date.now();
        return timestamp;
    }
    /**
     * Records the result of a synchronization
     * @param result - Sync result details
     */
    recordSyncResult(result) {
        if (!this.syncInProgress) {
            logger_1.logger.warn(this.node, 'Recording sync result but no sync was in progress');
        }
        const record = {
            timestamp: result.timestamp,
            success: result.success,
            errorMessage: result.errorMessage,
            recordsCount: result.totalPlans + result.totalSchedules
        };
        // Update last sync record
        this.lastSyncRecord = record;
        // Add to history and maintain size limit
        this.syncHistory.unshift(record);
        if (this.syncHistory.length > this.maxHistorySize) {
            this.syncHistory = this.syncHistory.slice(0, this.maxHistorySize);
        }
        this.syncInProgress = false;
        const logMessage = result.success
            ? `Sync completed successfully. Processed ${result.totalPlans} plans and ${result.totalSchedules} schedules.`
            : `Sync failed: ${result.errorMessage}`;
        logger_1.logger.info(this.node, logMessage);
    }
    /**
     * Gets the status of the last synchronization
     * @returns Last sync record or null if no sync has been performed
     */
    getLastSyncStatus() {
        return this.lastSyncRecord;
    }
    /**
     * Gets the synchronization history
     * @returns Array of sync records
     */
    getSyncHistory() {
        return [...this.syncHistory];
    }
    /**
     * Checks if a sync is currently in progress
     * @returns True if sync is in progress, false otherwise
     */
    isSyncInProgress() {
        return this.syncInProgress;
    }
    /**
     * Formats a user-friendly status message based on sync state
     * @returns Status message describing current sync state
     */
    getStatusMessage() {
        if (this.syncInProgress) {
            return 'Sync in progress...';
        }
        if (!this.lastSyncRecord) {
            return 'No sync performed yet';
        }
        const timeAgo = this.getTimeAgo(this.lastSyncRecord.timestamp);
        if (this.lastSyncRecord.success) {
            return `Last sync: ${timeAgo} (${this.lastSyncRecord.recordsCount || 0} records)`;
        }
        else {
            return `Last sync failed: ${timeAgo}`;
        }
    }
    /**
     * Creates a human-readable time ago string
     * @param timestamp - Timestamp in milliseconds
     * @returns Human-readable time ago string
     */
    getTimeAgo(timestamp) {
        const now = Date.now();
        const seconds = Math.floor((now - timestamp) / 1000);
        if (seconds < 60) {
            return `${seconds} sec ago`;
        }
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) {
            return `${minutes} min ago`;
        }
        const hours = Math.floor(minutes / 60);
        if (hours < 24) {
            return `${hours} hr ago`;
        }
        const days = Math.floor(hours / 24);
        return `${days} day${days > 1 ? 's' : ''} ago`;
    }
}
exports.SyncStateService = SyncStateService;
