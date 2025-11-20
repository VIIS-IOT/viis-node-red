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
     * Batch update accumulation using direct delta values (TFS-based)
     * Used when accumulation comes from TFS delta instead of flow rate × time
     */
    async batchUpdateAccumulationWithDelta(tripId, updates) {
        const timestamp = Date.now();
        // Build batch update using transaction
        await this.dataSource.transaction(async (manager) => {
            for (const update of updates) {
                // flowRate.m3h and flowRate.th now contain delta values directly
                const deltaM3 = update.flowRate.m3h;
                const deltaTons = update.flowRate.th;
                await manager
                    .createQueryBuilder()
                    .update(TabiotTripAccumulation_1.TabiotTripAccumulation)
                    .set({
                    total_volume_m3: () => `total_volume_m3 + ${deltaM3}`,
                    total_volume_tons: () => `total_volume_tons + ${deltaTons}`,
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
     * For machines with return flow (MAIN_ENGINE, GENERATOR_HFO, GENERATOR_DO)
     */
    async getMachineConsumption(tripId, flowInSensor, flowReturnSensor) {
        const flowIn = await this.getSensorAccumulation(tripId, flowInSensor);
        const flowReturn = await this.getSensorAccumulation(tripId, flowReturnSensor);
        if (!flowIn || !flowReturn) {
            return null;
        }
        return {
            m3: Number((Number(flowIn.total_volume_m3) - Number(flowReturn.total_volume_m3)).toFixed(3)),
            tons: Number((Number(flowIn.total_volume_tons) - Number(flowReturn.total_volume_tons)).toFixed(3))
        };
    }
    /**
     * Get direct consumption for BOILER (fs01 only, no return flow)
     */
    async getBoilerConsumption(tripId) {
        const flowIn = await this.getSensorAccumulation(tripId, 'fs01');
        if (!flowIn) {
            return null;
        }
        return {
            m3: Number(flowIn.total_volume_m3),
            tons: Number(flowIn.total_volume_tons)
        };
    }
    /**
     * Get total consumption across all machines (4-machine configuration)
     * NEW LOGIC:
     * - BOILER: fs01 (direct consumption, no return)
     * - MAIN_ENGINE: fs02 (in) - fs03 (return)
     * - GENERATOR_HFO: fs03 (in) - fs04 (return)
     * - GENERATOR_DO: fs05 (in) - fs06 (return)
     */
    async getTotalConsumption(tripId) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
        const accumulations = await this.getTripAccumulation(tripId);
        // Create map for easy lookup
        const accMap = new Map();
        accumulations.forEach(a => accMap.set(a.sensor_key, a));
        // BOILER: fs01 direct consumption (no return)
        const boilerM3 = Number(((_a = accMap.get('fs01')) === null || _a === void 0 ? void 0 : _a.total_volume_m3) || 0);
        const boilerTons = Number(((_b = accMap.get('fs01')) === null || _b === void 0 ? void 0 : _b.total_volume_tons) || 0);
        // MAIN_ENGINE: fs02 - fs03
        const mainEngineM3 = Number(((_c = accMap.get('fs02')) === null || _c === void 0 ? void 0 : _c.total_volume_m3) || 0) - Number(((_d = accMap.get('fs03')) === null || _d === void 0 ? void 0 : _d.total_volume_m3) || 0);
        const mainEngineTons = Number(((_e = accMap.get('fs02')) === null || _e === void 0 ? void 0 : _e.total_volume_tons) || 0) - Number(((_f = accMap.get('fs03')) === null || _f === void 0 ? void 0 : _f.total_volume_tons) || 0);
        // GENERATOR_HFO: fs03 - fs04
        const genHfoM3 = Number(((_g = accMap.get('fs03')) === null || _g === void 0 ? void 0 : _g.total_volume_m3) || 0) - Number(((_h = accMap.get('fs04')) === null || _h === void 0 ? void 0 : _h.total_volume_m3) || 0);
        const genHfoTons = Number(((_j = accMap.get('fs03')) === null || _j === void 0 ? void 0 : _j.total_volume_tons) || 0) - Number(((_k = accMap.get('fs04')) === null || _k === void 0 ? void 0 : _k.total_volume_tons) || 0);
        // GENERATOR_DO: fs05 - fs06
        const genDoM3 = Number(((_l = accMap.get('fs05')) === null || _l === void 0 ? void 0 : _l.total_volume_m3) || 0) - Number(((_m = accMap.get('fs06')) === null || _m === void 0 ? void 0 : _m.total_volume_m3) || 0);
        const genDoTons = Number(((_o = accMap.get('fs05')) === null || _o === void 0 ? void 0 : _o.total_volume_tons) || 0) - Number(((_p = accMap.get('fs06')) === null || _p === void 0 ? void 0 : _p.total_volume_tons) || 0);
        return {
            m3: Number((boilerM3 + mainEngineM3 + genHfoM3 + genDoM3).toFixed(3)),
            tons: Number((boilerTons + mainEngineTons + genHfoTons + genDoTons).toFixed(3))
        };
    }
};
exports.TripAccumulationService = TripAccumulationService;
exports.TripAccumulationService = TripAccumulationService = __decorate([
    (0, typedi_1.Service)(),
    __metadata("design:paramtypes", [typeorm_1.DataSource])
], TripAccumulationService);
