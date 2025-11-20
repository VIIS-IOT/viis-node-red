"use strict";
/**
 * @fileoverview Trip Management Controller
 *
 * REST API endpoints for managing trips/voyages
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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TripManagementController = void 0;
const routing_controllers_1 = require("routing-controllers");
const typedi_1 = require("typedi");
const TripManagementService_1 = require("../../../services/MarineIoT/TripManagementService");
const TripAccumulationService_1 = require("../../../services/MarineIoT/TripAccumulationService");
const container_setup_1 = require("../container/container.setup");
const trip_management_dto_1 = require("../dto/trip-management.dto");
const logger_1 = require("../utils/logger");
let TripManagementController = class TripManagementController {
    constructor(tripManagementService, tripAccumulationService, node) {
        this.tripManagementService = tripManagementService;
        this.tripAccumulationService = tripAccumulationService;
        this.node = node;
        if (!this.node) {
            console.error('[TRIP-API] TripManagementController: Node injection failed');
            throw new Error('TripManagementController initialization failed: Node not injected');
        }
        logger_1.logger.info(this.node, 'TripManagementController initialized with /marine/trip prefix');
    }
    /**
     * Start a new trip
     * POST /api/v2/marine/trip/start
     */
    async startTrip(body) {
        var _a;
        try {
            logger_1.logger.info(this.node, `[TRIP-API] Starting trip for device ${body.device_id}`);
            const trip = await this.tripManagementService.startTrip({
                deviceId: body.device_id,
                tripName: body.trip_name,
                notes: body.notes
            });
            logger_1.logger.info(this.node, `[TRIP-API] Trip started: ${trip.id}`);
            return {
                id: trip.id,
                device_id: trip.device_id,
                trip_name: trip.trip_name,
                start_time: trip.start_time,
                end_time: trip.end_time,
                status: trip.status,
                notes: trip.notes,
                created_at: trip.created_at.toISOString(),
                updated_at: ((_a = trip.updated_at) === null || _a === void 0 ? void 0 : _a.toISOString()) || null
            };
        }
        catch (error) {
            logger_1.logger.error(this.node, `[TRIP-API] Start trip failed: ${error.message}`);
            throw error;
        }
    }
    /**
     * End a trip
     * POST /api/v2/marine/trip/:id/end
     */
    async endTrip(tripId) {
        var _a;
        try {
            logger_1.logger.info(this.node, `[TRIP-API] Ending trip ${tripId}`);
            await this.tripManagementService.endTrip(tripId);
            const tripWithStats = await this.tripManagementService.getTripWithStats(tripId);
            if (!tripWithStats) {
                throw new Error('Trip not found');
            }
            logger_1.logger.info(this.node, `[TRIP-API] Trip ended: ${tripId}`);
            return {
                id: tripWithStats.id,
                device_id: tripWithStats.device_id,
                trip_name: tripWithStats.trip_name,
                start_time: tripWithStats.start_time,
                end_time: tripWithStats.end_time,
                status: tripWithStats.status,
                notes: tripWithStats.notes,
                created_at: tripWithStats.created_at.toISOString(),
                updated_at: ((_a = tripWithStats.updated_at) === null || _a === void 0 ? void 0 : _a.toISOString()) || null,
                total_consumption_m3: tripWithStats.total_consumption_m3 || 0,
                total_consumption_tons: tripWithStats.total_consumption_tons || 0,
                duration_hours: tripWithStats.duration_hours || 0
            };
        }
        catch (error) {
            logger_1.logger.error(this.node, `[TRIP-API] End trip failed: ${error.message}`);
            throw error;
        }
    }
    /**
     * Cancel a trip
     * POST /api/v2/marine/trip/:id/cancel
     */
    async cancelTrip(tripId, body) {
        var _a;
        try {
            logger_1.logger.info(this.node, `[TRIP-API] Cancelling trip ${tripId}`);
            const trip = await this.tripManagementService.cancelTrip(tripId, body.reason);
            if (!trip) {
                throw new Error('Trip not found');
            }
            logger_1.logger.info(this.node, `[TRIP-API] Trip cancelled: ${tripId}`);
            return {
                id: trip.id,
                device_id: trip.device_id,
                trip_name: trip.trip_name,
                start_time: trip.start_time,
                end_time: trip.end_time,
                status: trip.status,
                notes: trip.notes,
                created_at: trip.created_at.toISOString(),
                updated_at: ((_a = trip.updated_at) === null || _a === void 0 ? void 0 : _a.toISOString()) || null
            };
        }
        catch (error) {
            logger_1.logger.error(this.node, `[TRIP-API] Cancel trip failed: ${error.message}`);
            throw error;
        }
    }
    /**
     * Get active trip for a device
     * GET /api/v2/marine/trip/active/:device_id
     */
    async getActiveTrip(deviceId) {
        var _a;
        try {
            const trip = await this.tripManagementService.getActiveTrip(deviceId);
            if (!trip) {
                return null;
            }
            const tripWithStats = await this.tripManagementService.getTripWithStats(trip.id);
            if (!tripWithStats) {
                return null;
            }
            return {
                id: tripWithStats.id,
                device_id: tripWithStats.device_id,
                trip_name: tripWithStats.trip_name,
                start_time: tripWithStats.start_time,
                end_time: tripWithStats.end_time,
                status: tripWithStats.status,
                notes: tripWithStats.notes,
                created_at: tripWithStats.created_at.toISOString(),
                updated_at: ((_a = tripWithStats.updated_at) === null || _a === void 0 ? void 0 : _a.toISOString()) || null,
                total_consumption_m3: tripWithStats.total_consumption_m3 || 0,
                total_consumption_tons: tripWithStats.total_consumption_tons || 0,
                duration_hours: tripWithStats.duration_hours || 0
            };
        }
        catch (error) {
            logger_1.logger.error(this.node, `[TRIP-API] Get active trip failed: ${error.message}`);
            throw error;
        }
    }
    /**
     * Get trip by ID
     * GET /api/v2/marine/trip/:id
     */
    async getTrip(tripId) {
        var _a;
        try {
            const tripWithStats = await this.tripManagementService.getTripWithStats(tripId);
            if (!tripWithStats) {
                throw new Error('Trip not found');
            }
            return {
                id: tripWithStats.id,
                device_id: tripWithStats.device_id,
                trip_name: tripWithStats.trip_name,
                start_time: tripWithStats.start_time,
                end_time: tripWithStats.end_time,
                status: tripWithStats.status,
                notes: tripWithStats.notes,
                created_at: tripWithStats.created_at.toISOString(),
                updated_at: ((_a = tripWithStats.updated_at) === null || _a === void 0 ? void 0 : _a.toISOString()) || null,
                total_consumption_m3: tripWithStats.total_consumption_m3 || 0,
                total_consumption_tons: tripWithStats.total_consumption_tons || 0,
                duration_hours: tripWithStats.duration_hours || 0
            };
        }
        catch (error) {
            logger_1.logger.error(this.node, `[TRIP-API] Get trip failed: ${error.message}`);
            throw error;
        }
    }
    /**
     * Get trip history for a device
     * GET /api/v2/marine/trip/history/:device_id
     */
    async getTripHistory(deviceId, query) {
        try {
            const limit = query.limit || 50;
            const trips = await this.tripManagementService.getTripHistory(deviceId, limit, query.status);
            return trips.map(trip => {
                var _a;
                return ({
                    id: trip.id,
                    device_id: trip.device_id,
                    trip_name: trip.trip_name,
                    start_time: trip.start_time,
                    end_time: trip.end_time,
                    status: trip.status,
                    notes: trip.notes,
                    created_at: trip.created_at.toISOString(),
                    updated_at: ((_a = trip.updated_at) === null || _a === void 0 ? void 0 : _a.toISOString()) || null
                });
            });
        }
        catch (error) {
            logger_1.logger.error(this.node, `[TRIP-API] Get trip history failed: ${error.message}`);
            throw error;
        }
    }
    /**
     * Get trip accumulation data
     * GET /api/v2/marine/trip/:id/accumulation
     */
    async getTripAccumulation(tripId) {
        try {
            const trip = await this.tripManagementService.getTrip(tripId);
            if (!trip) {
                throw new Error('Trip not found');
            }
            const accumulations = await this.tripAccumulationService.getTripAccumulation(tripId);
            const totalConsumption = await this.tripAccumulationService.getTotalConsumption(tripId);
            return {
                trip_id: tripId,
                device_id: trip.device_id,
                sensors: accumulations.map(acc => ({
                    sensor_key: acc.sensor_key,
                    total_volume_m3: Number(acc.total_volume_m3),
                    total_volume_tons: Number(acc.total_volume_tons),
                    oil_profile_id: acc.oil_profile_id,
                    current_density: acc.current_density ? Number(acc.current_density) : null,
                    last_update_time: acc.last_update_time,
                    sample_count: acc.sample_count
                })),
                total_consumption: totalConsumption
            };
        }
        catch (error) {
            logger_1.logger.error(this.node, `[TRIP-API] Get trip accumulation failed: ${error.message}`);
            throw error;
        }
    }
};
exports.TripManagementController = TripManagementController;
__decorate([
    (0, routing_controllers_1.Post)('/start'),
    (0, routing_controllers_1.HttpCode)(201),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [trip_management_dto_1.StartTripDto]),
    __metadata("design:returntype", Promise)
], TripManagementController.prototype, "startTrip", null);
__decorate([
    (0, routing_controllers_1.Post)('/:id/end'),
    (0, routing_controllers_1.HttpCode)(200),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], TripManagementController.prototype, "endTrip", null);
__decorate([
    (0, routing_controllers_1.Post)('/:id/cancel'),
    (0, routing_controllers_1.HttpCode)(200),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('id')),
    __param(1, (0, routing_controllers_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], TripManagementController.prototype, "cancelTrip", null);
__decorate([
    (0, routing_controllers_1.Get)('/active/:device_id'),
    (0, routing_controllers_1.HttpCode)(200),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('device_id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], TripManagementController.prototype, "getActiveTrip", null);
__decorate([
    (0, routing_controllers_1.Get)('/:id'),
    (0, routing_controllers_1.HttpCode)(200),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], TripManagementController.prototype, "getTrip", null);
__decorate([
    (0, routing_controllers_1.Get)('/history/:device_id'),
    (0, routing_controllers_1.HttpCode)(200),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('device_id')),
    __param(1, (0, routing_controllers_1.QueryParams)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, trip_management_dto_1.TripHistoryQueryDto]),
    __metadata("design:returntype", Promise)
], TripManagementController.prototype, "getTripHistory", null);
__decorate([
    (0, routing_controllers_1.Get)('/:id/accumulation'),
    (0, routing_controllers_1.HttpCode)(200),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], TripManagementController.prototype, "getTripAccumulation", null);
exports.TripManagementController = TripManagementController = __decorate([
    (0, routing_controllers_1.JsonController)('/marine/trip'),
    (0, typedi_1.Service)(),
    __param(0, (0, typedi_1.Inject)()),
    __param(1, (0, typedi_1.Inject)()),
    __param(2, (0, typedi_1.Inject)(container_setup_1.NODE_TOKEN)),
    __metadata("design:paramtypes", [TripManagementService_1.TripManagementService,
        TripAccumulationService_1.TripAccumulationService, Object])
], TripManagementController);
