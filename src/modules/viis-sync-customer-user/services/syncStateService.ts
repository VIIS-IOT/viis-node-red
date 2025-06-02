/**
 * @fileoverview Sync State Service for VIIS Sync Customer User module
 * Tracks and manages the state of customer user synchronization operations
 */

import { Node } from 'node-red';

/**
 * Result of a synchronization operation
 */
export interface SyncResult {
    /** Whether the sync was successful */
    success: boolean;
    /** Number of customers created */
    customersCreated?: number;
    /** Number of customers updated */
    customersUpdated?: number;
    /** Number of users created */
    usersCreated?: number;
    /** Number of users updated */
    usersUpdated?: number;
    /** Number of credentials created */
    credentialsCreated?: number;
    /** Number of credentials updated */
    credentialsUpdated?: number;
    /** Total number of customers processed */
    totalCustomers?: number;
    /** Total number of users processed */
    totalUsers?: number;
    /** Timestamp of the sync operation */
    timestamp?: number;
    /** Error message if sync failed */
    errorMessage?: string;
}

/**
 * Service for tracking sync state
 */
export class SyncStateService {
    /** Node-RED node instance */
    private readonly node: Node;
    /** Whether a sync is currently in progress */
    private syncInProgress: boolean = false;
    /** Timestamp of the last successful sync */
    private lastSyncTimestamp: number = 0;
    /** Result of the last sync operation */
    private lastSyncResult: SyncResult | null = null;
    /** Start time of the current sync operation */
    private syncStartTime: number = 0;

    /**
     * Creates a new sync state service
     * @param node - Node-RED node instance
     */
    constructor(node: Node) {
        this.node = node;
    }

    /**
     * Records the start of a sync operation
     * @returns Timestamp of the sync start
     */
    startSync(): number {
        this.syncInProgress = true;
        this.syncStartTime = Date.now();
        return this.syncStartTime;
    }

    /**
     * Records the result of a sync operation
     * @param result - Result of the sync operation
     */
    recordSyncResult(result: SyncResult): void {
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
    getStatusMessage(): string {
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
        } else if (timeSinceLastSync < 3600) {
            timeMessage = `${Math.floor(timeSinceLastSync / 60)} minutes ago`;
        } else if (timeSinceLastSync < 86400) {
            timeMessage = `${Math.floor(timeSinceLastSync / 3600)} hours ago`;
        } else {
            timeMessage = `${Math.floor(timeSinceLastSync / 86400)} days ago`;
        }

        if (this.lastSyncResult && this.lastSyncResult.success) {
            return `Last sync: ${timeMessage} (${this.lastSyncResult.totalUsers || 0} users)`;
        } else {
            return `Last sync failed: ${timeMessage}`;
        }
    }

    /**
     * Gets whether a sync is currently in progress
     * @returns True if sync is in progress, false otherwise
     */
    isSyncInProgress(): boolean {
        return this.syncInProgress;
    }
}
