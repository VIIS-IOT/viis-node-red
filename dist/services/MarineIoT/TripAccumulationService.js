"use strict";
/**
 * @fileoverview Trip Accumulation Service
 *
 * Handles running total accumulation for active trips
 * Updates total volume based on real-time flow rates
 *
 * Formula: total += (flow_rate × time_interval)
 * Interval: 2 seconds (configurable)
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
exports.TripAccumulationService = void 0;
const typedi_1 = require("typedi");
const typeorm_1 = require("typeorm");
const TabiotTripAccumulation_1 = require("../../orm/entities/trip/TabiotTripAccumulation");
let TripAccumulationService = class TripAccumulationService {
    constructor(dataSource) {
        this.dataSource = dataSource;
        // Configuration
        this.UPDATE_INTERVAL_MS = 2000; // 2 seconds
        this.accumulationRepo = dataSource.getRepository(TabiotTripAccumulation_1.TabiotTripAccumulation);
    }
    /**
     * Update accumulation for a single sensor
     * Called every 2 seconds with current flow rate
     */
    async updateAccumulation(tripId, update) {
        const { sensorKey, flowRate, density, oilProfileId } = update;
        // Calculate increment for this interval
        // Formula: volume = flow_rate × time
        const intervalHours = this.UPDATE_INTERVAL_MS / (1000 * 60 * 60);
        const incrementM3 = flowRate.m3h * intervalHours;
        const incrementTons = flowRate.th * intervalHours;
        // Update running total using SQL increment
        await this.accumulationRepo
            .createQueryBuilder()
            .update(TabiotTripAccumulation_1.TabiotTripAccumulation)
            .set({
            total_volume_m3: () => `total_volume_m3 + ${incrementM3}`,
            total_volume_tons: () => `total_volume_tons + ${incrementTons}`,
            current_density: density,
            oil_profile_id: oilProfileId,
            last_update_time: Date.now(),
            sample_count: () => 'sample_count + 1',
        })
            .where('trip_id = :tripId', { tripId })
            .andWhere('sensor_key = :sensorKey', { sensorKey })
            .execute();
    }
    /**
     * Batch update accumulation for multiple sensors
     * More efficient than individual updates
     */
    async batchUpdateAccumulation(tripId, updates) {
        const intervalHours = this.UPDATE_INTERVAL_MS / (1000 * 60 * 60);
        const timestamp = Date.now();
        // Build batch update using transaction
        await this.dataSource.transaction(async (manager) => {
            for (const update of updates) {
                const incrementM3 = update.flowRate.m3h * intervalHours;
                const incrementTons = update.flowRate.th * intervalHours;
                await manager
                    .createQueryBuilder()
                    .update(TabiotTripAccumulation_1.TabiotTripAccumulation)
                    .set({
                    total_volume_m3: () => `total_volume_m3 + ${incrementM3}`,
                    total_volume_tons: () => `total_volume_tons + ${incrementTons}`,
                    current_density: update.density,
                    oil_profile_id: update.oilProfileId,
                    last_update_time: timestamp,
                    sample_count: () => 'sample_count + 1',
                })
                    .where('trip_id = :tripId', { tripId })
                    .andWhere('sensor_key = :sensorKey', { sensorKey: update.sensorKey })
                    .execute();
            }
        });
    }
    /**
     * Get accumulation data for a trip
     */
    async getTripAccumulation(tripId) {
        return await this.accumulationRepo.find({
            where: { trip_id: tripId },
            order: { sensor_key: 'ASC' }
        });
    }
    /**
     * Get accumulation data for a specific sensor in a trip
     */
    async getSensorAccumulation(tripId, sensorKey) {
        return await this.accumulationRepo.findOne({
            where: { trip_id: tripId, sensor_key: sensorKey }
        });
    }
    /**
     * Reset accumulation for a trip (use with caution)
     */
    async resetTripAccumulation(tripId) {
        await this.accumulationRepo
            .createQueryBuilder()
            .update(TabiotTripAccumulation_1.TabiotTripAccumulation)
            .set({
            total_volume_m3: 0,
            total_volume_tons: 0,
            sample_count: 0,
            last_update_time: null,
        })
            .where('trip_id = :tripId', { tripId })
            .execute();
    }
    /**
     * Calculate consumption for a machine in a trip
     */
    async getMachineConsumption(tripId, flowInSensor, flowReturnSensor) {
        const flowIn = await this.getSensorAccumulation(tripId, flowInSensor);
        const flowReturn = await this.getSensorAccumulation(tripId, flowReturnSensor);
        if (!flowIn || !flowReturn) {
            return null;
        }
        return {
            m3: Number((Number(flowIn.total_volume_m3) - Number(flowReturn.total_volume_m3)).toFixed(2)),
            tons: Number((Number(flowIn.total_volume_tons) - Number(flowReturn.total_volume_tons)).toFixed(2))
        };
    }
    /**
     * Get total consumption across all machines
     */
    async getTotalConsumption(tripId) {
        const accumulations = await this.getTripAccumulation(tripId);
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
        return {
            m3: Number((totalInM3 - totalReturnM3).toFixed(2)),
            tons: Number((totalInTons - totalReturnTons).toFixed(2))
        };
    }
};
exports.TripAccumulationService = TripAccumulationService;
exports.TripAccumulationService = TripAccumulationService = __decorate([
    (0, typedi_1.Service)(),
    __metadata("design:paramtypes", [typeorm_1.DataSource])
], TripAccumulationService);
