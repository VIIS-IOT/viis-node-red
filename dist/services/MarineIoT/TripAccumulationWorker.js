"use strict";
/**
 * @fileoverview Trip Accumulation Background Worker
 *
 * Runs every 2 seconds to update trip accumulation based on real-time flow rates
 * IMPORTANT: This worker is independent of hourly accumulation (FlowAccumulationService)
 *
 * Architecture:
 * - Reads latest telemetry from tabiot_device_telemetry_latest
 * - Updates running totals in tabiot_trip_accumulation
 * - Only processes ACTIVE trips
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
exports.TripAccumulationWorker = void 0;
const typedi_1 = require("typedi");
const typeorm_1 = require("typeorm");
const TabiotTrip_1 = require("../../orm/entities/trip/TabiotTrip");
const TabiotDeviceTelemetryLatest_1 = require("../../orm/entities/device-telemetry/TabiotDeviceTelemetryLatest");
const TripAccumulationService_1 = require("./TripAccumulationService");
const logger_1 = require("../../modules/viis-rest-api/utils/logger");
let TripAccumulationWorker = class TripAccumulationWorker {
    constructor(dataSource, tripAccumulationService, node) {
        this.dataSource = dataSource;
        this.tripAccumulationService = tripAccumulationService;
        this.node = node;
        this.interval = null;
        this.isRunning = false;
        this.UPDATE_INTERVAL = 2000; // 2 seconds
        this.FLOW_SENSORS = ['fs01', 'fs02', 'fs03', 'fs04', 'fs05', 'fs06'];
        this.tripRepo = dataSource.getRepository(TabiotTrip_1.TabiotTrip);
        this.telemetryLatestRepo = dataSource.getRepository(TabiotDeviceTelemetryLatest_1.TabiotDeviceTelemetryLatest);
    }
    /**
     * Start the background worker
     */
    start() {
        if (this.isRunning) {
            logger_1.logger.warn(this.node, '[TRIP-WORKER] Already running');
            return;
        }
        this.isRunning = true;
        this.interval = setInterval(async () => {
            await this.processActiveTrips();
        }, this.UPDATE_INTERVAL);
        logger_1.logger.info(this.node, `[TRIP-WORKER] ✅ Started (interval: ${this.UPDATE_INTERVAL}ms)`);
    }
    /**
     * Stop the background worker
     */
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.isRunning = false;
        logger_1.logger.info(this.node, '[TRIP-WORKER] Stopped');
    }
    /**
     * Check if worker is running
     */
    isActive() {
        return this.isRunning;
    }
    /**
     * Process all active trips
     * Main worker loop
     */
    async processActiveTrips() {
        try {
            // Get all active trips
            const activeTrips = await this.tripRepo.find({
                where: { status: 'ACTIVE' }
            });
            if (activeTrips.length === 0) {
                return; // No active trips
            }
            logger_1.logger.debug(this.node, `[TRIP-WORKER] Processing ${activeTrips.length} active trips`);
            // Process each trip
            for (const trip of activeTrips) {
                await this.processSingleTrip(trip);
            }
        }
        catch (error) {
            logger_1.logger.error(this.node, `[TRIP-WORKER] Error processing trips: ${error.message}`);
        }
    }
    /**
     * Process a single trip
     */
    async processSingleTrip(trip) {
        try {
            // Get latest telemetry for all flow sensors
            const latestData = await this.telemetryLatestRepo
                .createQueryBuilder('t')
                .where('t.device_id = :deviceId', { deviceId: trip.device_id })
                .andWhere('t.key_name IN (:...sensors)', { sensors: this.FLOW_SENSORS })
                .getMany();
            if (latestData.length === 0) {
                logger_1.logger.debug(this.node, `[TRIP-WORKER] No telemetry data for trip ${trip.id}`);
                return;
            }
            // Build batch update
            const updates = latestData.map(sensor => {
                const flowRateM3h = sensor.float_value || 0;
                const density = sensor.density_snapshot || 1000;
                const flowRateTons = this.calculateTons(flowRateM3h, density);
                return {
                    sensorKey: sensor.key_name,
                    flowRate: {
                        m3h: flowRateM3h,
                        th: flowRateTons
                    },
                    density: density,
                    oilProfileId: sensor.oil_profile_id || null
                };
            });
            // Batch update accumulation
            await this.tripAccumulationService.batchUpdateAccumulation(trip.id, updates);
            logger_1.logger.debug(this.node, `[TRIP-WORKER] Updated trip ${trip.id} (${updates.length} sensors)`);
        }
        catch (error) {
            logger_1.logger.error(this.node, `[TRIP-WORKER] Error processing trip ${trip.id}: ${error.message}`);
        }
    }
    /**
     * Calculate tons from m³/h and density
     */
    calculateTons(m3h, density) {
        return Number(((m3h * density) / 1000).toFixed(2));
    }
    /**
     * Manual trigger for testing
     */
    async triggerUpdate() {
        logger_1.logger.info(this.node, '[TRIP-WORKER] Manual trigger');
        await this.processActiveTrips();
    }
    /**
     * Get worker statistics
     */
    getStats() {
        return {
            isRunning: this.isRunning,
            updateInterval: this.UPDATE_INTERVAL,
            sensors: this.FLOW_SENSORS
        };
    }
};
exports.TripAccumulationWorker = TripAccumulationWorker;
exports.TripAccumulationWorker = TripAccumulationWorker = __decorate([
    (0, typedi_1.Service)(),
    __metadata("design:paramtypes", [typeorm_1.DataSource,
        TripAccumulationService_1.TripAccumulationService, Object])
], TripAccumulationWorker);
