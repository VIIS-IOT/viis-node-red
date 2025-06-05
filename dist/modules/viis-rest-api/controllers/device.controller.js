"use strict";
/**
 * @fileoverview Device controller - Migrated to routing-controllers
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
exports.DeviceController = void 0;
require("reflect-metadata");
const routing_controllers_1 = require("routing-controllers");
const typedi_1 = require("typedi");
const device_service_1 = require("../services/device.service");
const device_validator_1 = require("../validators/device.validator");
const api_config_1 = require("../config/api.config");
const logger_1 = require("../utils/logger");
/**
 * Device controller class - Migrated to routing-controllers
 *
 * Provides device management endpoints:
 * - List devices with pagination
 * - Get device by ID
 * - Create new device
 * - Update existing device
 * - Delete device
 */
let DeviceController = class DeviceController {
    constructor(deviceService, deviceValidator, node, configManager) {
        this.deviceService = deviceService;
        this.deviceValidator = deviceValidator;
        this.node = node;
        this.configManager = configManager;
        logger_1.logger.info(this.node, 'DeviceController initialized with routing-controllers');
    }
    /**
     * List devices with pagination
     * GET /api/v2/devices
     */
    async listDevices(query) {
        var _a;
        logger_1.logger.debug(this.node, 'List devices request', { query });
        // Default pagination
        const page = query.page || 1;
        const limit = Math.min(query.limit || 10, 100); // Max 100 items per page
        const offset = (page - 1) * limit;
        try {
            const result = await this.deviceService.list({ page, limit, offset });
            logger_1.logger.info(this.node, 'Devices retrieved successfully', {
                count: ((_a = result.data) === null || _a === void 0 ? void 0 : _a.length) || 0,
                page,
                limit
            });
            return result;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Failed to list devices', { error: error.message });
            throw new Error('Failed to retrieve devices');
        }
    }
    /**
     * Get device by ID
     * GET /api/v2/devices/:id
     */
    async getDevice(id) {
        logger_1.logger.debug(this.node, 'Get device request', { deviceId: id });
        if (!id || typeof id !== 'string' || id.trim().length === 0) {
            throw new Error('Device ID is required and must be a valid string');
        }
        try {
            const result = await this.deviceService.getById(id);
            if (!result) {
                throw new Error('Device not found');
            }
            logger_1.logger.info(this.node, 'Device retrieved successfully', { deviceId: id });
            return result;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Failed to get device', {
                deviceId: id,
                error: error.message
            });
            throw error;
        }
    }
    /**
     * Create new device
     * POST /api/v2/devices
     */
    async createDevice(deviceData) {
        logger_1.logger.debug(this.node, 'Create device request', { deviceData });
        try {
            // Validate device data
            const validatedData = await this.deviceValidator.validateCreate(deviceData);
            // Create device
            const result = await this.deviceService.create(validatedData);
            logger_1.logger.info(this.node, 'Device created successfully', {
                deviceId: result.id || result._id || 'unknown',
                name: result.name || 'unknown'
            });
            return result;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Failed to create device', {
                error: error.message,
                deviceData
            });
            throw error;
        }
    }
    /**
     * Update device
     * PUT /api/v2/devices/:id
     */
    async updateDevice(id, deviceData) {
        logger_1.logger.debug(this.node, 'Update device request', { deviceId: id, deviceData });
        if (!id || typeof id !== 'string' || id.trim().length === 0) {
            throw new Error('Device ID is required and must be a valid string');
        }
        try {
            // Validate device data
            const validatedData = await this.deviceValidator.validateUpdate(deviceData);
            // Update device
            const result = await this.deviceService.update(id, validatedData);
            logger_1.logger.info(this.node, 'Device updated successfully', {
                deviceId: id,
                updatedFields: Object.keys(validatedData)
            });
            return result;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Failed to update device', {
                deviceId: id,
                error: error.message,
                deviceData
            });
            throw error;
        }
    }
    /**
     * Delete device
     * DELETE /api/v2/devices/:id
     */
    async deleteDevice(id) {
        logger_1.logger.debug(this.node, 'Delete device request', { deviceId: id });
        if (!id || typeof id !== 'string' || id.trim().length === 0) {
            throw new Error('Device ID is required and must be a valid string');
        }
        try {
            // Delete device
            await this.deviceService.delete(id);
            logger_1.logger.info(this.node, 'Device deleted successfully', { deviceId: id });
            return { message: 'Device deleted successfully' };
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Failed to delete device', {
                deviceId: id,
                error: error.message
            });
            throw error;
        }
    }
};
exports.DeviceController = DeviceController;
__decorate([
    (0, routing_controllers_1.Get)('/'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.QueryParams)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DeviceController.prototype, "listDevices", null);
__decorate([
    (0, routing_controllers_1.Get)('/:id'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DeviceController.prototype, "getDevice", null);
__decorate([
    (0, routing_controllers_1.Post)('/'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DeviceController.prototype, "createDevice", null);
__decorate([
    (0, routing_controllers_1.Put)('/:id'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('id')),
    __param(1, (0, routing_controllers_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], DeviceController.prototype, "updateDevice", null);
__decorate([
    (0, routing_controllers_1.Delete)('/:id'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DeviceController.prototype, "deleteDevice", null);
exports.DeviceController = DeviceController = __decorate([
    (0, routing_controllers_1.JsonController)('/devices'),
    (0, typedi_1.Service)(),
    __param(0, (0, typedi_1.Inject)()),
    __param(1, (0, typedi_1.Inject)()),
    __param(2, (0, typedi_1.Inject)('node')),
    __param(3, (0, typedi_1.Inject)('configManager')),
    __metadata("design:paramtypes", [device_service_1.DeviceService,
        device_validator_1.DeviceValidator, Object, api_config_1.ApiConfigManager])
], DeviceController);
