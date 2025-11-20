"use strict";
/**
 * @fileoverview Trip Management Service
 *
 * Manages voyage/trip lifecycle for Marine IoT fuel consumption tracking
 * Handles start/end/cancel operations for trips
 *
 * IMPORTANT: This is separate from FlowAccumulationService (hourly accumulation)
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
exports.TripManagementService = void 0;
const typedi_1 = require("typedi");
const typeorm_1 = require("typeorm");
const uuid_1 = require("uuid");
const TabiotTrip_1 = require("../../orm/entities/trip/TabiotTrip");
const TabiotTripAccumulation_1 = require("../../orm/entities/trip/TabiotTripAccumulation");
const FlowCheckpointService_1 = require("./FlowCheckpointService");
let TripManagementService = class TripManagementService {
    constructor(dataSource) {
        this.dataSource = dataSource;
        this.tripRepo = dataSource.getRepository(TabiotTrip_1.TabiotTrip);
        this.accumulationRepo = dataSource.getRepository(TabiotTripAccumulation_1.TabiotTripAccumulation);
        this.checkpointService = new FlowCheckpointService_1.FlowCheckpointService(dataSource);
    }
    /**
     * Start a new trip
     * Auto-ends any active trips for the same device before starting
     * Resets trip checkpoints to current TFS values to avoid negative deltas
     */
    async startTrip(options) {
        const { deviceId, tripName, notes } = options;
        // End any active trips for this device first
        await this.endActiveTrips(deviceId);
        // Create new trip
        const tripId = (0, uuid_1.v4)();
        const trip = this.tripRepo.create({
            id: tripId,
            device_id: deviceId,
            trip_name: tripName || `Trip ${new Date().toISOString().split('T')[0]}`,
            start_time: Date.now(),
            status: 'ACTIVE',
            notes: notes || null,
        });
        await this.tripRepo.save(trip);
        // Initialize accumulation counters for all 6 sensors
        const sensors = ['fs01', 'fs02', 'fs03', 'fs04', 'fs05', 'fs06'];
        const accumulationRecords = sensors.map(sensor => this.accumulationRepo.create({
            trip_id: tripId,
            device_id: deviceId,
            sensor_key: sensor,
            total_volume_m3: 0,
            total_volume_tons: 0,
            sample_count: 0,
            last_update_time: null,
        }));
        await this.accumulationRepo.save(accumulationRecords);
        // Reset trip checkpoints to current TFS values
        // This prevents negative deltas when starting a new trip
        try {
            const resetCount = await this.checkpointService.resetCheckpointsToCurrentValues(deviceId, 'trip');
            console.log(`[TripManagement] Reset ${resetCount} trip checkpoints for device ${deviceId}`);
        }
        catch (error) {
            console.error(`[TripManagement] Failed to reset checkpoints: ${error.message}`);
            // Don't fail the trip creation if checkpoint reset fails
        }
        return trip;
    }
    /**
     * End a specific trip
     */
    async endTrip(tripId) {
        const trip = await this.tripRepo.findOne({ where: { id: tripId } });
        if (!trip) {
            throw new Error(`Trip ${tripId} not found`);
        }
        if (trip.status !== 'ACTIVE') {
            throw new Error(`Trip ${tripId} is not active (status: ${trip.status})`);
        }
        trip.end_time = Date.now();
        trip.status = 'COMPLETED';
        trip.updated_at = new Date();
        return await this.tripRepo.save(trip);
    }
    /**
     * Cancel a trip
     */
    async cancelTrip(tripId, reason) {
        const trip = await this.tripRepo.findOne({ where: { id: tripId } });
        if (!trip) {
            throw new Error(`Trip ${tripId} not found`);
        }
        trip.end_time = Date.now();
        trip.status = 'CANCELLED';
        trip.notes = reason ? `${trip.notes || ''}\nCancelled: ${reason}`.trim() : trip.notes;
        trip.updated_at = new Date();
        return await this.tripRepo.save(trip);
    }
    /**
     * Get active trip for a device
     */
    async getActiveTrip(deviceId) {
        return await this.tripRepo.findOne({
            where: {
                device_id: deviceId,
                status: 'ACTIVE'
            }
        });
    }
    /**
     * Get trip by ID
     */
    async getTrip(tripId) {
        return await this.tripRepo.findOne({
            where: { id: tripId }
        });
    }
    /**
     * Get trip with consumption statistics
     */
    async getTripWithStats(tripId) {
        const trip = await this.getTrip(tripId);
        if (!trip)
            return null;
        // Get accumulation data
        const accumulations = await this.accumulationRepo.find({
            where: { trip_id: tripId }
        });
        // Calculate total consumption (sum of all flow_in - flow_return)
        const flowInSensors = ['fs01', 'fs03', 'fs05'];
        const flowReturnSensors = ['fs02', 'fs04', 'fs06'];
        const totalInM3 = accumulations
            .filter(a => flowInSensors.includes(a.sensor_key))
            .reduce((sum, a) => sum + Number(a.total_volume_m3), 0);
        const totalReturnM3 = accumulations
            .filter(a => flowReturnSensors.includes(a.sensor_key))
            .reduce((sum, a) => sum + Number(a.total_volume_m3), 0);
        const totalInTons = accumulations
            .filter(a => flowInSensors.includes(a.sensor_key))
            .reduce((sum, a) => sum + Number(a.total_volume_tons), 0);
        const totalReturnTons = accumulations
            .filter(a => flowReturnSensors.includes(a.sensor_key))
            .reduce((sum, a) => sum + Number(a.total_volume_tons), 0);
        const durationMs = (trip.end_time || Date.now()) - trip.start_time;
        const durationHours = durationMs / (1000 * 60 * 60);
        return Object.assign(Object.assign({}, trip), { total_consumption_m3: Number((totalInM3 - totalReturnM3).toFixed(2)), total_consumption_tons: Number((totalInTons - totalReturnTons).toFixed(2)), duration_hours: Number(durationHours.toFixed(2)) });
    }
    /**
     * Get trip history for a device
     */
    async getTripHistory(deviceId, limit = 50, status) {
        const queryBuilder = this.tripRepo
            .createQueryBuilder('trip')
            .where('trip.device_id = :deviceId', { deviceId })
            .orderBy('trip.start_time', 'DESC')
            .limit(limit);
        if (status) {
            queryBuilder.andWhere('trip.status = :status', { status });
        }
        return await queryBuilder.getMany();
    }
    /**
     * End all active trips for a device
     * Used internally when starting a new trip
     */
    async endActiveTrips(deviceId) {
        await this.tripRepo
            .createQueryBuilder()
            .update(TabiotTrip_1.TabiotTrip)
            .set({
            end_time: Date.now(),
            status: 'COMPLETED',
            updated_at: new Date()
        })
            .where('device_id = :deviceId', { deviceId })
            .andWhere('status = :status', { status: 'ACTIVE' })
            .execute();
    }
    /**
     * Delete old completed trips (data retention)
     */
    async deleteOldTrips(deviceId, olderThanDays = 90) {
        const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
        const result = await this.tripRepo
            .createQueryBuilder()
            .delete()
            .from(TabiotTrip_1.TabiotTrip)
            .where('device_id = :deviceId', { deviceId })
            .andWhere('status IN (:...statuses)', { statuses: ['COMPLETED', 'CANCELLED'] })
            .andWhere('end_time < :cutoffTime', { cutoffTime })
            .execute();
        return result.affected || 0;
    }
};
exports.TripManagementService = TripManagementService;
exports.TripManagementService = TripManagementService = __decorate([
    (0, typedi_1.Service)(),
    __metadata("design:paramtypes", [typeorm_1.DataSource])
], TripManagementService);
