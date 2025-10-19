import { Node } from 'node-red';
import { Repository } from 'typeorm';
import { TabiotThingsboardTelemetryQueue } from '../orm/entities/device-telemetry/TabiotThingsboardTelemetryQueue';
import { ThingsboardHttpService, TelemetryData } from './thingsboard-http.service';

/**
 * Configuration for TelemetryQueueManager
 */
export interface QueueManagerConfig {
    batchSize: number;          // Number of records per batch (default: 10)
    flushInterval: number;      // Auto-flush interval in ms (default: 5000)
    maxRetries: number;         // Max retry attempts (default: 3)
    retryInterval: number;      // Retry check interval in ms (default: 30000)
    enableRetry: boolean;       // Enable auto-retry (default: true)
    enableLogging: boolean;     // Enable debug logging (default: false)
}

/**
 * Telemetry record in batch buffer
 */
interface TelemetryRecord {
    deviceId: string;
    deviceToken: string;
    data: TelemetryData;
}

/**
 * Manager for batching telemetry data and handling failed uploads with retry
 * Supports hot-reload of configuration
 */
export class TelemetryQueueManager {
    private node: Node;
    private httpService: ThingsboardHttpService;
    private repository: Repository<TabiotThingsboardTelemetryQueue>;
    private config: QueueManagerConfig;
    
    // Batch buffer and timers
    private batchBuffer: TelemetryRecord[] = [];
    private flushTimer?: NodeJS.Timeout;
    private retryTimer?: NodeJS.Timeout;
    
    // Statistics
    private stats = {
        totalSent: 0,
        totalFailed: 0,
        totalRetried: 0,
        totalSuccess: 0
    };

    constructor(
        node: Node,
        httpService: ThingsboardHttpService,
        repository: Repository<TabiotThingsboardTelemetryQueue>,
        config?: Partial<QueueManagerConfig>
    ) {
        this.node = node;
        this.httpService = httpService;
        this.repository = repository;
        
        // Default configuration
        this.config = {
            batchSize: config?.batchSize || 10,
            flushInterval: config?.flushInterval || 5000,
            maxRetries: config?.maxRetries || 3,
            retryInterval: config?.retryInterval || 30000,
            enableRetry: config?.enableRetry !== false,
            enableLogging: config?.enableLogging || false
        };

        this.log(`Queue Manager initialized with batch size: ${this.config.batchSize}, flush interval: ${this.config.flushInterval}ms`);
    }

    /**
     * Add telemetry data to batch queue
     * Will auto-flush when batch size is reached
     */
    async addTelemetry(
        deviceId: string,
        deviceToken: string,
        data: Record<string, any>,
        timestamp?: number
    ): Promise<void> {
        // Convert to ThingsBoard format if needed
        const telemetryData: TelemetryData = {
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
        } else {
            // Reset flush timer
            this.resetFlushTimer();
        }
    }

    /**
     * Add pre-formatted telemetry data (with ts and values)
     */
    async addFormattedTelemetry(
        deviceId: string,
        deviceToken: string,
        data: TelemetryData
    ): Promise<void> {
        this.batchBuffer.push({
            deviceId,
            deviceToken,
            data
        });

        this.log(`Added formatted telemetry to buffer (${this.batchBuffer.length}/${this.config.batchSize})`);

        if (this.batchBuffer.length >= this.config.batchSize) {
            await this.flush();
        } else {
            this.resetFlushTimer();
        }
    }

    /**
     * Manually flush current batch
     */
    async flush(): Promise<void> {
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
                const result = await this.httpService.sendBatchTelemetry(deviceToken, payload);

                if (result.success) {
                    this.stats.totalSuccess += records.length;
                    this.stats.totalSent += records.length;
                    this.log(`✓ Sent ${records.length} records for device ${deviceId}`);
                } else {
                    // Failed - save to database for retry
                    this.stats.totalFailed += records.length;
                    await this.saveFailed(deviceId, deviceToken, payload, result.error || 'Unknown error');
                    this.node.warn(`✗ Failed to send batch for device ${deviceId}: ${result.error}`);
                }
            } catch (error) {
                // Unexpected error - save to database
                this.stats.totalFailed += records.length;
                await this.saveFailed(deviceId, deviceToken, payload, (error as Error).message);
                this.node.error(`✗ Exception while sending batch for device ${deviceId}: ${(error as Error).message}`);
            }
        }
    }

    /**
     * Save failed batch to database for retry
     */
    private async saveFailed(
        deviceId: string,
        deviceToken: string,
        payload: TelemetryData[],
        error: string
    ): Promise<void> {
        try {
            const queueItem = this.repository.create({
                device_id: deviceId,
                device_token: deviceToken,
                payload: payload,
                timestamp: Date.now(),
                retry_count: 0,
                max_retries: this.config.maxRetries,
                status: 'pending',
                last_error: error
            });

            await this.repository.save(queueItem);
            this.log(`Saved ${payload.length} failed records to database for retry`);
        } catch (dbError) {
            this.node.error(`Failed to save to database: ${(dbError as Error).message}`);
        }
    }

    /**
     * Retry pending/failed records from database
     */
    async retryPending(): Promise<void> {
        if (!this.config.enableRetry) {
            return;
        }

        try {
            // Find pending records that haven't exceeded max retries
            const pendingRecords = await this.repository
                .createQueryBuilder('queue')
                .where('queue.status IN (:...statuses)', { statuses: ['pending', 'retrying'] })
                .andWhere('queue.retry_count < queue.max_retries')
                .andWhere(
                    '(queue.last_retry_at IS NULL OR queue.last_retry_at < :threshold)',
                    { threshold: Date.now() - this.getBackoffDelay(1) }
                )
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
        } catch (error) {
            this.node.error(`Error during retry: ${(error as Error).message}`);
        }
    }

    /**
     * Retry a single record
     */
    private async retryRecord(record: TabiotThingsboardTelemetryQueue): Promise<void> {
        try {
            // Update status to retrying
            record.status = 'retrying';
            record.retry_count += 1;
            record.last_retry_at = Date.now();
            await this.repository.save(record);

            // Attempt to send
            const result = await this.httpService.sendBatchTelemetry(
                record.device_token,
                record.payload
            );

            if (result.success) {
                // Success - mark as success
                record.status = 'success';
                record.last_error = null;
                await this.repository.save(record);
                this.log(`✓ Retry successful for record ${record.id} (device: ${record.device_id})`);
            } else {
                // Failed again
                record.last_error = result.error || 'Unknown error';
                
                if (record.retry_count >= record.max_retries) {
                    // Max retries reached - mark as permanently failed
                    record.status = 'failed';
                    this.node.warn(`✗ Record ${record.id} permanently failed after ${record.retry_count} retries`);
                } else {
                    // Still can retry
                    record.status = 'pending';
                }
                
                await this.repository.save(record);
            }
        } catch (error) {
            record.last_error = (error as Error).message;
            record.status = 'pending';
            await this.repository.save(record);
            this.node.error(`✗ Retry exception for record ${record.id}: ${(error as Error).message}`);
        }
    }

    /**
     * Start periodic retry job
     */
    startRetryJob(): void {
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
    stopRetryJob(): void {
        if (this.retryTimer) {
            clearInterval(this.retryTimer);
            this.retryTimer = undefined;
            this.log('Retry job stopped');
        }
    }

    /**
     * Get exponential backoff delay based on retry count
     */
    private getBackoffDelay(retryCount: number): number {
        return Math.min(
            this.config.retryInterval * Math.pow(1.5, retryCount - 1),
            300000 // Max 5 minutes
        );
    }

    /**
     * Group batch records by device token
     */
    private groupByDeviceToken(records: TelemetryRecord[]): Record<string, TelemetryRecord[]> {
        const grouped: Record<string, TelemetryRecord[]> = {};
        
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
    private resetFlushTimer(): void {
        this.clearFlushTimer();
        
        this.flushTimer = setTimeout(async () => {
            await this.flush();
        }, this.config.flushInterval);
    }

    /**
     * Clear flush timer
     */
    private clearFlushTimer(): void {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }
    }

    /**
     * Update configuration (hot-reload support)
     */
    updateConfig(newConfig: Partial<QueueManagerConfig>): void {
        this.config = { ...this.config, ...newConfig };
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
        return {
            ...this.stats,
            bufferSize: this.batchBuffer.length,
            config: this.config
        };
    }

    /**
     * Cleanup - flush pending data and stop timers
     */
    async cleanup(): Promise<void> {
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
    private log(message: string): void {
        if (this.config.enableLogging) {
            this.node.log(`[TelemetryQueueManager] ${message}`);
        }
    }
}
