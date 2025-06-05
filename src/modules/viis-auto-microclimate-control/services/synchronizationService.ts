/**
 * Synchronization Service for Fan Control
 * Prevents race conditions and ensures thread-safe operations
 */

import { ILogger } from "../interfaces/types";
import { getCurrentTimestamp } from "../utils/timeUtils";

interface LockInfo {
    id: string;
    acquiredAt: number;
    expiresAt: number;
    owner: string;
}

interface OperationQueue {
    id: string;
    operation: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
    priority: number;
    createdAt: number;
}

export class SynchronizationService {
    private flowContext: any;
    private logger: ILogger;
    private readonly LOCK_PREFIX = "fan_control_lock_";
    private readonly DEFAULT_LOCK_TIMEOUT = 30000; // 30 seconds
    private readonly OPERATION_QUEUE_KEY = "fan_control_operation_queue";
    private readonly MAX_QUEUE_SIZE = 100;
    private operationQueue: OperationQueue[] = [];
    private isProcessingQueue = false;
    private queueProcessorId: string;

    constructor(flowContext: any, logger: ILogger) {
        this.flowContext = flowContext;
        this.logger = logger;
        this.queueProcessorId = `queue_processor_${Date.now()}_${Math.random()}`;
    }

    /**
     * Execute operation with exclusive lock
     */
    public async withLock<T>(
        lockKey: string,
        operation: () => Promise<T>,
        options: {
            timeout?: number;
            retryAttempts?: number;
            retryDelay?: number;
            priority?: number;
        } = {}
    ): Promise<T> {
        const {
            timeout = this.DEFAULT_LOCK_TIMEOUT,
            retryAttempts = 3,
            retryDelay = 1000,
            priority = 0
        } = options;

        const lockId = this.generateLockId();
        const owner = `${this.queueProcessorId}_${lockId}`;

        // Try to acquire lock with retries
        let lockAcquired = false;
        for (let attempt = 0; attempt < retryAttempts; attempt++) {
            lockAcquired = await this.acquireLock(lockKey, lockId, owner, timeout);
            if (lockAcquired) break;

            if (attempt < retryAttempts - 1) {
                await this.delay(retryDelay);
            }
        }

        if (!lockAcquired) {
            throw new Error(`Failed to acquire lock '${lockKey}' after ${retryAttempts} attempts`);
        }

        try {
            this.logger.debug(`Lock acquired: ${lockKey} by ${owner}`);
            return await operation();
        } finally {
            await this.releaseLock(lockKey, lockId, owner);
            this.logger.debug(`Lock released: ${lockKey} by ${owner}`);
        }
    }

    /**
     * Queue operation for sequential execution
     */
    public async queueOperation<T>(
        operation: () => Promise<T>,
        priority: number = 0
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            const operationId = this.generateOperationId();
            
            const queuedOperation: OperationQueue = {
                id: operationId,
                operation,
                resolve,
                reject,
                priority,
                createdAt: getCurrentTimestamp()
            };

            // Check queue size limit
            if (this.operationQueue.length >= this.MAX_QUEUE_SIZE) {
                reject(new Error("Operation queue is full"));
                return;
            }

            // Add to queue with priority ordering
            this.operationQueue.push(queuedOperation);
            this.operationQueue.sort((a, b) => b.priority - a.priority);

            this.logger.debug(`Operation queued: ${operationId} (priority: ${priority})`);

            // Start processing if not already running
            this.processQueue();
        });
    }

    /**
     * Execute critical operation with highest priority and immediate processing
     */
    public async executeCritical<T>(
        operation: () => Promise<T>,
        lockKey?: string
    ): Promise<T> {
        if (lockKey) {
            return this.withLock(lockKey, operation, { priority: 1000, retryAttempts: 5 });
        } else {
            return this.queueOperation(operation, 1000);
        }
    }

    /**
     * Check if lock exists and is valid
     */
    public isLocked(lockKey: string): boolean {
        const lockInfo = this.getLockInfo(lockKey);
        if (!lockInfo) return false;

        const now = getCurrentTimestamp();
        if (now > lockInfo.expiresAt) {
            // Lock expired, clean it up
            this.cleanupExpiredLock(lockKey);
            return false;
        }

        return true;
    }

    /**
     * Get lock owner information
     */
    public getLockOwner(lockKey: string): string | null {
        const lockInfo = this.getLockInfo(lockKey);
        if (!lockInfo || this.isLockExpired(lockInfo)) {
            return null;
        }
        return lockInfo.owner;
    }

    /**
     * Force release all locks (emergency cleanup)
     */
    public async forceReleaseAllLocks(): Promise<void> {
        const contextKeys = this.getAllContextKeys();
        let releasedCount = 0;

        for (const key of contextKeys) {
            if (key.startsWith(this.LOCK_PREFIX)) {
                this.flowContext.set(key, null);
                releasedCount++;
            }
        }

        this.logger.warn(`Force released ${releasedCount} locks`);
    }

    /**
     * Get queue status
     */
    public getQueueStatus(): {
        queueLength: number;
        isProcessing: boolean;
        oldestOperation: number | null;
    } {
        const oldestOperation = this.operationQueue.length > 0 
            ? Math.min(...this.operationQueue.map(op => op.createdAt))
            : null;

        return {
            queueLength: this.operationQueue.length,
            isProcessing: this.isProcessingQueue,
            oldestOperation
        };
    }

    /**
     * Cleanup expired locks and old queue items
     */
    public performMaintenance(): void {
        try {
            this.cleanupExpiredLocks();
            this.cleanupOldQueueItems();
            this.logger.debug("Synchronization maintenance completed");
        } catch (error) {
            this.logger.error(`Synchronization maintenance failed: ${(error as Error).message}`);
        }
    }

    // Private methods
    private async acquireLock(
        lockKey: string,
        lockId: string,
        owner: string,
        timeout: number
    ): Promise<boolean> {
        const fullLockKey = this.LOCK_PREFIX + lockKey;
        const existingLock = this.getLockInfo(lockKey);

        // Check if lock is already held by someone else
        if (existingLock && !this.isLockExpired(existingLock)) {
            return false;
        }

        // Clean up expired lock
        if (existingLock && this.isLockExpired(existingLock)) {
            this.cleanupExpiredLock(lockKey);
        }

        // Acquire new lock
        const now = getCurrentTimestamp();
        const lockInfo: LockInfo = {
            id: lockId,
            acquiredAt: now,
            expiresAt: now + timeout,
            owner
        };

        this.flowContext.set(fullLockKey, lockInfo);

        // Verify lock was acquired (double-check for race conditions)
        const verifyLock = this.getLockInfo(lockKey);
        return verifyLock?.id === lockId && verifyLock?.owner === owner;
    }

    private async releaseLock(lockKey: string, lockId: string, owner: string): Promise<void> {
        const fullLockKey = this.LOCK_PREFIX + lockKey;
        const lockInfo = this.getLockInfo(lockKey);

        // Only release if we own the lock
        if (lockInfo && lockInfo.id === lockId && lockInfo.owner === owner) {
            this.flowContext.set(fullLockKey, null);
        }
    }

    private getLockInfo(lockKey: string): LockInfo | null {
        const fullLockKey = this.LOCK_PREFIX + lockKey;
        return this.flowContext.get(fullLockKey) || null;
    }

    private isLockExpired(lockInfo: LockInfo): boolean {
        return getCurrentTimestamp() > lockInfo.expiresAt;
    }

    private cleanupExpiredLock(lockKey: string): void {
        const fullLockKey = this.LOCK_PREFIX + lockKey;
        this.flowContext.set(fullLockKey, null);
    }

    private cleanupExpiredLocks(): void {
        const contextKeys = this.getAllContextKeys();
        let cleanedCount = 0;

        for (const key of contextKeys) {
            if (key.startsWith(this.LOCK_PREFIX)) {
                const lockInfo = this.flowContext.get(key);
                if (lockInfo && this.isLockExpired(lockInfo)) {
                    this.flowContext.set(key, null);
                    cleanedCount++;
                }
            }
        }

        if (cleanedCount > 0) {
            this.logger.debug(`Cleaned up ${cleanedCount} expired locks`);
        }
    }

    private cleanupOldQueueItems(): void {
        const fiveMinutesAgo = getCurrentTimestamp() - (5 * 60 * 1000);
        const initialLength = this.operationQueue.length;

        this.operationQueue = this.operationQueue.filter(op => {
            if (op.createdAt < fiveMinutesAgo) {
                op.reject(new Error("Operation timed out in queue"));
                return false;
            }
            return true;
        });

        const cleanedCount = initialLength - this.operationQueue.length;
        if (cleanedCount > 0) {
            this.logger.debug(`Cleaned up ${cleanedCount} old queue items`);
        }
    }

    private async processQueue(): Promise<void> {
        if (this.isProcessingQueue || this.operationQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;

        try {
            while (this.operationQueue.length > 0) {
                const operation = this.operationQueue.shift()!;
                
                try {
                    const result = await operation.operation();
                    operation.resolve(result);
                    this.logger.debug(`Operation completed: ${operation.id}`);
                } catch (error) {
                    operation.reject(error);
                    this.logger.error(`Operation failed: ${operation.id} - ${(error as Error).message}`);
                }
            }
        } finally {
            this.isProcessingQueue = false;
        }
    }

    private generateLockId(): string {
        return `lock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private generateOperationId(): string {
        return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private getAllContextKeys(): string[] {
        // This is a simplified implementation
        // In a real Node-RED environment, you might need to use a different approach
        // to enumerate context keys
        return [];
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
