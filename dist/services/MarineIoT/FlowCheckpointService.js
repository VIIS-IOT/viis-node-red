"use strict";
/**
 * @fileoverview Flow Checkpoint Service
 *
 * Manages checkpoint values for TFS (Total Flow Sensor) accumulation
 * Handles get/update/reset operations for both trip and hourly checkpoints
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlowCheckpointService = void 0;
const typedi_1 = require("typedi");
const typeorm_1 = require("typeorm");
const TabiotFlowCheckpoint_1 = require("../../orm/entities/flow-checkpoint/TabiotFlowCheckpoint");
let FlowCheckpointService = class FlowCheckpointService {
    constructor(dataSource) {
        this.dataSource = dataSource;
        this.checkpointRepo = dataSource.getRepository(TabiotFlowCheckpoint_1.TabiotFlowCheckpoint);
    }
    /**
     * Get checkpoint value for a sensor
     * Returns null if checkpoint doesn't exist
     */
    async getCheckpoint(deviceId, sensorKey, checkpointType) {
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
    async getDeviceCheckpoints(deviceId, checkpointType) {
        const where = { device_id: deviceId };
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
    async updateCheckpoint(update) {
        const { deviceId, sensorKey, tfsValue, checkpointType, metadata } = update;
        const existing = await this.getCheckpoint(deviceId, sensorKey, checkpointType);
        let delta = null;
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
        }
        else {
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
    async batchUpdateCheckpoints(updates) {
        const deltas = new Map();
        const resets = new Set();
        for (const update of updates) {
            const result = await this.updateCheckpoint(update);
            if (result.wasReset) {
                resets.add(update.sensorKey);
            }
            else if (result.delta !== null) {
                deltas.set(update.sensorKey, result.delta);
            }
        }
        return { deltas, resets };
    }
    /**
     * Reset checkpoint to a specific value
     * Used when starting a new trip or when PLC counter is manually reset
     */
    async resetCheckpoint(deviceId, sensorKey, checkpointType, newValue = 0) {
        const existing = await this.getCheckpoint(deviceId, sensorKey, checkpointType);
        if (existing) {
            existing.last_tfs_value = newValue;
            existing.last_update_time = Date.now();
            return await this.checkpointRepo.save(existing);
        }
        else {
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
    async resetDeviceCheckpoints(deviceId, checkpointType) {
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
    async deleteCheckpoint(deviceId, sensorKey, checkpointType) {
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
    async calculateDelta(deviceId, sensorKey, checkpointType, currentTfsValue) {
        const checkpoint = await this.getCheckpoint(deviceId, sensorKey, checkpointType);
        if (!checkpoint) {
            return null; // No checkpoint yet
        }
        const delta = currentTfsValue - checkpoint.last_tfs_value;
        return delta >= 0 ? delta : null; // Return null if negative (reset detected)
    }
};
exports.FlowCheckpointService = FlowCheckpointService;
exports.FlowCheckpointService = FlowCheckpointService = __decorate([
    (0, typedi_1.Service)(),
    __metadata("design:paramtypes", [typeorm_1.DataSource])
], FlowCheckpointService);
