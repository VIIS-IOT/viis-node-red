"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelemetryQueueManager = void 0;
const crypto_1 = require("crypto");
/**
 * Manager for batching telemetry data and handling failed uploads with retry
 * Supports hot-reload of configuration
 */
class TelemetryQueueManager {
    constructor(node, httpService, repository, config) {
        // Batch buffer and timers
        this.batchBuffer = [];
        // Statistics
        this.stats = {
            totalSent: 0,
            totalFailed: 0,
            totalRetried: 0,
            totalSuccess: 0
        };
        this.node = node;
        this.httpService = httpService;
        this.repository = repository;
        // Default configuration
        this.config = {
            batchSize: (config === null || config === void 0 ? void 0 : config.batchSize) || 10,
            flushInterval: (config === null || config === void 0 ? void 0 : config.flushInterval) || 5000,
            maxRetries: (config === null || config === void 0 ? void 0 : config.maxRetries) || 3,
            retryInterval: (config === null || config === void 0 ? void 0 : config.retryInterval) || 30000,
            enableRetry: (config === null || config === void 0 ? void 0 : config.enableRetry) !== false,
            enableLogging: (config === null || config === void 0 ? void 0 : config.enableLogging) || false
        };
        this.log(`Queue Manager initialized with batch size: ${this.config.batchSize}, flush interval: ${this.config.flushInterval}ms`);
    }
    /**
     * Add telemetry data to batch queue
     * Will auto-flush when batch size is reached
     */
    async addTelemetry(deviceId, deviceToken, data, timestamp) {
        // Convert to ThingsBoard format if needed
        const telemetryData = {
            ts: timestamp || Date.now(),
            values: data
        };
        this.batchBuffer.push({
            deviceId,
            deviceToken,
            data: telemetryData
        });
        this.log(`Added telemetry to buffer (${this.batchBuffer.length}/${this.config.batchSize})`);
        // Auto-flush if batch size reached
        if (this.batchBuffer.length >= this.config.batchSize) {
            await this.flush();
        }
        else {
            // Reset flush timer
            this.resetFlushTimer();
        }
    }
    /**
     * Add pre-formatted telemetry data (with ts and values)
     */
    async addFormattedTelemetry(deviceId, deviceToken, data) {
        this.batchBuffer.push({
            deviceId,
            deviceToken,
            data
        });
        this.log(`Added formatted telemetry to buffer (${this.batchBuffer.length}/${this.config.batchSize})`);
        if (this.batchBuffer.length >= this.config.batchSize) {
            await this.flush();
        }
        else {
            this.resetFlushTimer();
        }
    }
    /**
     * Manually flush current batch
     */
    async flush() {
        if (this.batchBuffer.length === 0) {
            return;
        }
        this.clearFlushTimer();
        // Group by device token (in case multiple devices in one batch)
        const grouped = this.groupByDeviceToken(this.batchBuffer);
        const currentBatch = this.batchBuffer;
        this.batchBuffer = []; // Clear buffer
        this.log(`Flushing ${currentBatch.length} telemetry records (${Object.keys(grouped).length} devices)`);
        // Send each device's batch
        for (const [deviceToken, records] of Object.entries(grouped)) {
            const deviceId = records[0].deviceId;
            const payload = records.map(r => r.data);
            try {
                // Send batch without idempotency key for initial attempt
                // (idempotency key is only used for retries from database)
                const result = await this.httpService.sendBatchTelemetry(deviceToken, payload);
                if (result.success) {
                    this.stats.totalSuccess += records.length;
                    this.stats.totalSent += records.length;
                    this.log(`✓ Sent ${records.length} records for device ${deviceId}`);
                }
                else {
                    // Failed - save to database for retry
                    this.stats.totalFailed += records.length;
                    await this.saveFailed(deviceId, deviceToken, payload, result.error || 'Unknown error');
                    this.node.warn(`✗ Failed to send batch for device ${deviceId}: ${result.error}`);
                }
            }
            catch (error) {
                // Unexpected error - save to database
                this.stats.totalFailed += records.length;
                await this.saveFailed(deviceId, deviceToken, payload, error.message);
                this.node.error(`✗ Exception while sending batch for device ${deviceId}: ${error.message}`);
            }
        }
    }
    /**
     * Save failed batch to database for retry
     */
    async saveFailed(deviceId, deviceToken, payload, error) {
        try {
            const queueItem = this.repository.create({
                device_id: deviceId,
                device_token: deviceToken,
                idempotency_key: (0, crypto_1.randomUUID)(), // Generate unique UUID
                payload: payload,
                timestamp: Date.now(),
                retry_count: 0,
                max_retries: this.config.maxRetries,
                status: 'pending',
                last_error: error
            });
            await this.repository.save(queueItem);
            this.log(`Saved ${payload.length} failed records to database for retry (idempotency_key: ${queueItem.idempotency_key})`);
        }
        catch (dbError) {
            this.node.error(`Failed to save to database: ${dbError.message}`);
        }
    }
    /**
     * Retry pending/failed records from database
     */
    async retryPending() {
        if (!this.config.enableRetry) {
            return;
        }
        try {
            // Find pending records that haven't exceeded max retries
            // CRITICAL FIX: Only select 'pending' status to avoid race condition
            // If multiple retry jobs run concurrently, they won't pick the same 'retrying' record
            const pendingRecords = await this.repository
                .createQueryBuilder('queue')
                .where('queue.status = :status', { status: 'pending' })
                .andWhere('queue.retry_count < queue.max_retries')
                .andWhere('(queue.last_retry_at IS NULL OR queue.last_retry_at < :threshold)', { threshold: Date.now() - this.getBackoffDelay(1) })
                .orderBy('queue.created_at', 'ASC')
                .limit(50) // Process max 50 at a time
                .getMany();
            if (pendingRecords.length === 0) {
                return;
            }
            this.log(`Retrying ${pendingRecords.length} pending records from database`);
            for (const record of pendingRecords) {
                await this.retryRecord(record);
            }
            this.stats.totalRetried += pendingRecords.length;
        }
        catch (error) {
            this.node.error(`Error during retry: ${error.message}`);
        }
    }
    /**
     * Retry a single record
     */
    async retryRecord(record) {
        try {
            // Update status to retrying
            record.status = 'retrying';
            record.retry_count += 1;
            record.last_retry_at = Date.now();
            await this.repository.save(record);
            // Attempt to send with idempotency key to prevent duplicates
            const result = await this.httpService.sendBatchTelemetry(record.device_token, record.payload, record.idempotency_key // Pass idempotency key for retry
            );
            if (result.success) {
                // Success - mark as success
                record.status = 'success';
                record.last_error = null;
                await this.repository.save(record);
                this.log(`✓ Retry successful for record ${record.id} (device: ${record.device_id}, idempotency_key: ${record.idempotency_key})`);
            }
            else {
                // Failed again
                record.last_error = result.error || 'Unknown error';
                // Check if rate limited (429) with retry-after
                if (result.statusCode === 429 && result.retryAfter) {
                    // Update last_retry_at to respect rate limit
                    record.last_retry_at = Date.now() + (result.retryAfter * 1000);
                    this.node.warn(`✗ Record ${record.id} rate limited, will retry after ${result.retryAfter}s`);
                }
                if (record.retry_count >= record.max_retries) {
                    // Max retries reached - mark as permanently failed
                    record.status = 'failed';
                    this.node.warn(`✗ Record ${record.id} permanently failed after ${record.retry_count} retries (idempotency_key: ${record.idempotency_key})`);
                }
                else {
                    // Still can retry
                    record.status = 'pending';
                }
                await this.repository.save(record);
            }
        }
        catch (error) {
            record.last_error = error.message;
            record.status = 'pending';
            await this.repository.save(record);
            this.node.error(`✗ Retry exception for record ${record.id}: ${error.message}`);
        }
    }
    /**
     * Start periodic retry job
     */
    startRetryJob() {
        if (!this.config.enableRetry) {
            return;
        }
        this.log(`Starting retry job with interval: ${this.config.retryInterval}ms`);
        this.retryTimer = setInterval(async () => {
            await this.retryPending();
        }, this.config.retryInterval);
    }
    /**
     * Stop retry job
     */
    stopRetryJob() {
        if (this.retryTimer) {
            clearInterval(this.retryTimer);
            this.retryTimer = undefined;
            this.log('Retry job stopped');
        }
    }
    /**
     * Get exponential backoff delay based on retry count
     */
    getBackoffDelay(retryCount) {
        return Math.min(this.config.retryInterval * Math.pow(1.5, retryCount - 1), 300000 // Max 5 minutes
        );
    }
    /**
     * Group batch records by device token
     */
    groupByDeviceToken(records) {
        const grouped = {};
        for (const record of records) {
            if (!grouped[record.deviceToken]) {
                grouped[record.deviceToken] = [];
            }
            grouped[record.deviceToken].push(record);
        }
        return grouped;
    }
    /**
     * Reset flush timer
     */
    resetFlushTimer() {
        this.clearFlushTimer();
        this.flushTimer = setTimeout(async () => {
            await this.flush();
        }, this.config.flushInterval);
    }
    /**
     * Clear flush timer
     */
    clearFlushTimer() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }
    }
    /**
     * Update configuration (hot-reload support)
     */
    updateConfig(newConfig) {
        this.config = Object.assign(Object.assign({}, this.config), newConfig);
        this.log(`Configuration updated: ${JSON.stringify(newConfig)}`);
        // Restart retry job if interval changed
        if (newConfig.retryInterval && this.retryTimer) {
            this.stopRetryJob();
            this.startRetryJob();
        }
    }
    /**
     * Get current statistics
     */
    getStats() {
        return Object.assign(Object.assign({}, this.stats), { bufferSize: this.batchBuffer.length, config: this.config });
    }
    /**
     * Cleanup - flush pending data and stop timers
     */
    async cleanup() {
        this.log('Cleaning up queue manager...');
        // Flush any remaining data
        await this.flush();
        // Stop timers
        this.clearFlushTimer();
        this.stopRetryJob();
        this.log('Queue manager cleaned up');
    }
    /**
     * Log helper
     */
    log(message) {
        if (this.config.enableLogging) {
            this.node.log(`[TelemetryQueueManager] ${message}`);
        }
    }
}
exports.TelemetryQueueManager = TelemetryQueueManager;
