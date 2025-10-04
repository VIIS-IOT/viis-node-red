"use strict";
/**
 * Synchronization Service for Fan Control
 * Prevents race conditions and ensures thread-safe operations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SynchronizationService = void 0;
const timeUtils_1 = require("../utils/timeUtils");
class SynchronizationService {
    constructor(flowContext, logger) {
        this.LOCK_PREFIX = "fan_control_lock_";
        this.DEFAULT_LOCK_TIMEOUT = 30000; // 30 seconds
        this.OPERATION_QUEUE_KEY = "fan_control_operation_queue";
        this.MAX_QUEUE_SIZE = 100;
        this.operationQueue = [];
        this.isProcessingQueue = false;
        this.flowContext = flowContext;
        this.logger = logger;
        this.queueProcessorId = `queue_processor_${Date.now()}_${Math.random()}`;
    }
    /**
     * Execute operation with exclusive lock
     */
    async withLock(lockKey, operation, options = {}) {
        const { timeout = this.DEFAULT_LOCK_TIMEOUT, retryAttempts = 3, retryDelay = 1000, priority = 0 } = options;
        const lockId = this.generateLockId();
        const owner = `${this.queueProcessorId}_${lockId}`;
        // Try to acquire lock with retries
        let lockAcquired = false;
        for (let attempt = 0; attempt < retryAttempts; attempt++) {
            lockAcquired = await this.acquireLock(lockKey, lockId, owner, timeout);
            if (lockAcquired)
                break;
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
        }
        finally {
            await this.releaseLock(lockKey, lockId, owner);
            this.logger.debug(`Lock released: ${lockKey} by ${owner}`);
        }
    }
    /**
     * Queue operation for sequential execution
     */
    async queueOperation(operation, priority = 0) {
        return new Promise((resolve, reject) => {
            const operationId = this.generateOperationId();
            const queuedOperation = {
                id: operationId,
                operation,
                resolve,
                reject,
                priority,
                createdAt: (0, timeUtils_1.getCurrentTimestamp)()
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
    async executeCritical(operation, lockKey) {
        if (lockKey) {
            return this.withLock(lockKey, operation, { priority: 1000, retryAttempts: 5 });
        }
        else {
            return this.queueOperation(operation, 1000);
        }
    }
    /**
     * Check if lock exists and is valid
     */
    isLocked(lockKey) {
        const lockInfo = this.getLockInfo(lockKey);
        if (!lockInfo)
            return false;
        const now = (0, timeUtils_1.getCurrentTimestamp)();
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
    getLockOwner(lockKey) {
        const lockInfo = this.getLockInfo(lockKey);
        if (!lockInfo || this.isLockExpired(lockInfo)) {
            return null;
        }
        return lockInfo.owner;
    }
    /**
     * Force release all locks (emergency cleanup)
     */
    async forceReleaseAllLocks() {
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
    getQueueStatus() {
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
    performMaintenance() {
        try {
            this.cleanupExpiredLocks();
            this.cleanupOldQueueItems();
            this.logger.debug("Synchronization maintenance completed");
        }
        catch (error) {
            this.logger.error(`Synchronization maintenance failed: ${error.message}`);
        }
    }
    // Private methods
    async acquireLock(lockKey, lockId, owner, timeout) {
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
        const now = (0, timeUtils_1.getCurrentTimestamp)();
        const lockInfo = {
            id: lockId,
            acquiredAt: now,
            expiresAt: now + timeout,
            owner
        };
        this.flowContext.set(fullLockKey, lockInfo);
        // Verify lock was acquired (double-check for race conditions)
        const verifyLock = this.getLockInfo(lockKey);
        return (verifyLock === null || verifyLock === void 0 ? void 0 : verifyLock.id) === lockId && (verifyLock === null || verifyLock === void 0 ? void 0 : verifyLock.owner) === owner;
    }
    async releaseLock(lockKey, lockId, owner) {
        const fullLockKey = this.LOCK_PREFIX + lockKey;
        const lockInfo = this.getLockInfo(lockKey);
        // Only release if we own the lock
        if (lockInfo && lockInfo.id === lockId && lockInfo.owner === owner) {
            this.flowContext.set(fullLockKey, null);
        }
    }
    getLockInfo(lockKey) {
        const fullLockKey = this.LOCK_PREFIX + lockKey;
        return this.flowContext.get(fullLockKey) || null;
    }
    isLockExpired(lockInfo) {
        return (0, timeUtils_1.getCurrentTimestamp)() > lockInfo.expiresAt;
    }
    cleanupExpiredLock(lockKey) {
        const fullLockKey = this.LOCK_PREFIX + lockKey;
        this.flowContext.set(fullLockKey, null);
    }
    cleanupExpiredLocks() {
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
    cleanupOldQueueItems() {
        const fiveMinutesAgo = (0, timeUtils_1.getCurrentTimestamp)() - (5 * 60 * 1000);
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
    async processQueue() {
        if (this.isProcessingQueue || this.operationQueue.length === 0) {
            return;
        }
        this.isProcessingQueue = true;
        try {
            while (this.operationQueue.length > 0) {
                const operation = this.operationQueue.shift();
                try {
                    const result = await operation.operation();
                    operation.resolve(result);
                    this.logger.debug(`Operation completed: ${operation.id}`);
                }
                catch (error) {
                    operation.reject(error);
                    this.logger.error(`Operation failed: ${operation.id} - ${error.message}`);
                }
            }
        }
        finally {
            this.isProcessingQueue = false;
        }
    }
    generateLockId() {
        return `lock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    generateOperationId() {
        return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    getAllContextKeys() {
        // This is a simplified implementation
        // In a real Node-RED environment, you might need to use a different approach
        // to enumerate context keys
        return [];
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.SynchronizationService = SynchronizationService;
