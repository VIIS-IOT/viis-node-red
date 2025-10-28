/**
 * @fileoverview Flow Checkpoint Service
 * 
 * Manages checkpoint values for TFS (Total Flow Sensor) accumulation
 * Handles get/update/reset operations for both trip and hourly checkpoints
 */

import { Service } from 'typedi';
import { DataSource, Repository } from 'typeorm';
import { TabiotFlowCheckpoint } from '../../orm/entities/flow-checkpoint/TabiotFlowCheckpoint';

export type CheckpointType = 'trip' | 'hourly';

export interface CheckpointUpdate {
    deviceId: string;
    sensorKey: string;
    tfsValue: number;
    checkpointType: CheckpointType;
    metadata?: any;
}

@Service()
export class FlowCheckpointService {
    private checkpointRepo: Repository<TabiotFlowCheckpoint>;

    constructor(private dataSource: DataSource) {
        this.checkpointRepo = dataSource.getRepository(TabiotFlowCheckpoint);
    }

    /**
     * Get checkpoint value for a sensor
     * Returns null if checkpoint doesn't exist
     */
    async getCheckpoint(
        deviceId: string,
        sensorKey: string,
        checkpointType: CheckpointType
    ): Promise<TabiotFlowCheckpoint | null> {
        return await this.checkpointRepo.findOne({
            where: {
                device_id: deviceId,
                sensor_key: sensorKey,
                checkpoint_type: checkpointType
            }
        });
    }

    /**
     * Get all checkpoints for a device
     */
    async getDeviceCheckpoints(
        deviceId: string,
        checkpointType?: CheckpointType
    ): Promise<TabiotFlowCheckpoint[]> {
        const where: any = { device_id: deviceId };
        if (checkpointType) {
            where.checkpoint_type = checkpointType;
        }

        return await this.checkpointRepo.find({
            where,
            order: { sensor_key: 'ASC' }
        });
    }

    /**
     * Update or create checkpoint
     * Returns the delta if checkpoint existed, otherwise null
     */
    async updateCheckpoint(update: CheckpointUpdate): Promise<{
        checkpoint: TabiotFlowCheckpoint;
        delta: number | null;
        wasReset: boolean;
    }> {
        const { deviceId, sensorKey, tfsValue, checkpointType, metadata } = update;

        const existing = await this.getCheckpoint(deviceId, sensorKey, checkpointType);

        let delta: number | null = null;
        let wasReset = false;

        if (existing) {
            // Calculate delta
            delta = tfsValue - existing.last_tfs_value;

            // Check for reset (negative delta)
            if (delta < 0) {
                wasReset = true;
                delta = null; // Don't use negative delta
            }

            // Update existing checkpoint
            existing.last_tfs_value = tfsValue;
            existing.last_update_time = Date.now();
            if (metadata) {
                existing.metadata = JSON.stringify(metadata);
            }

            const saved = await this.checkpointRepo.save(existing);
            return { checkpoint: saved, delta, wasReset };
        } else {
            // Create new checkpoint
            const newCheckpoint = this.checkpointRepo.create({
                device_id: deviceId,
                sensor_key: sensorKey,
                checkpoint_type: checkpointType,
                last_tfs_value: tfsValue,
                last_update_time: Date.now(),
                metadata: metadata ? JSON.stringify(metadata) : null
            });

            const saved = await this.checkpointRepo.save(newCheckpoint);
            return { checkpoint: saved, delta: null, wasReset: false };
        }
    }

    /**
     * Batch update checkpoints for multiple sensors
     */
    async batchUpdateCheckpoints(updates: CheckpointUpdate[]): Promise<{
        deltas: Map<string, number>; // sensorKey -> delta
        resets: Set<string>; // sensorKeys that were reset
    }> {
        const deltas = new Map<string, number>();
        const resets = new Set<string>();

        for (const update of updates) {
            const result = await this.updateCheckpoint(update);
            
            if (result.wasReset) {
                resets.add(update.sensorKey);
            } else if (result.delta !== null) {
                deltas.set(update.sensorKey, result.delta);
            }
        }

        return { deltas, resets };
    }

    /**
     * Reset checkpoint to a specific value
     * Used when starting a new trip or when PLC counter is manually reset
     */
    async resetCheckpoint(
        deviceId: string,
        sensorKey: string,
        checkpointType: CheckpointType,
        newValue: number = 0
    ): Promise<TabiotFlowCheckpoint> {
        const existing = await this.getCheckpoint(deviceId, sensorKey, checkpointType);

        if (existing) {
            existing.last_tfs_value = newValue;
            existing.last_update_time = Date.now();
            return await this.checkpointRepo.save(existing);
        } else {
            const newCheckpoint = this.checkpointRepo.create({
                device_id: deviceId,
                sensor_key: sensorKey,
                checkpoint_type: checkpointType,
                last_tfs_value: newValue,
                last_update_time: Date.now()
            });
            return await this.checkpointRepo.save(newCheckpoint);
        }
    }

    /**
     * Reset all checkpoints for a device and type
     */
    async resetDeviceCheckpoints(
        deviceId: string,
        checkpointType: CheckpointType
    ): Promise<void> {
        const checkpoints = await this.getDeviceCheckpoints(deviceId, checkpointType);
        
        for (const checkpoint of checkpoints) {
            checkpoint.last_tfs_value = 0;
            checkpoint.last_update_time = Date.now();
            await this.checkpointRepo.save(checkpoint);
        }
    }

    /**
     * Delete checkpoint
     */
    async deleteCheckpoint(
        deviceId: string,
        sensorKey: string,
        checkpointType: CheckpointType
    ): Promise<void> {
        await this.checkpointRepo.delete({
            device_id: deviceId,
            sensor_key: sensorKey,
            checkpoint_type: checkpointType
        });
    }

    /**
     * Calculate delta without updating checkpoint
     * Useful for testing/preview
     */
    async calculateDelta(
        deviceId: string,
        sensorKey: string,
        checkpointType: CheckpointType,
        currentTfsValue: number
    ): Promise<number | null> {
        const checkpoint = await this.getCheckpoint(deviceId, sensorKey, checkpointType);
        
        if (!checkpoint) {
            return null; // No checkpoint yet
        }

        const delta = currentTfsValue - checkpoint.last_tfs_value;
        return delta >= 0 ? delta : null; // Return null if negative (reset detected)
    }
}
