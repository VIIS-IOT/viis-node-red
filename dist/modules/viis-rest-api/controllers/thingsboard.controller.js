"use strict";
/**
 * @fileoverview ThingsBoard RPC controller - Migrated to routing-controllers
 *
 * This controller demonstrates the enhanced patterns for VIIS API modules:
 * - Uses routing-controllers decorators with automatic validation
 * - Leverages class-validator DTOs for request validation
 * - Implements comprehensive error handling and logging
 * - Provides ThingsBoard RPC processing functionality
 * - Serves as a template for other API module controllers
 *
 * Features:
 * - Automatic request validation using enhanced DTOs
 * - ThingsBoard RPC message processing
 * - MQTT integration with existing core services
 * - Telemetry data transformation with type detection
 * - Comprehensive error handling and response formatting
 * - Real-time device communication via RPC
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
exports.ThingsBoardController = void 0;
require("reflect-metadata");
const routing_controllers_1 = require("routing-controllers");
const typedi_1 = require("typedi");
const logger_1 = require("../utils/logger");
const thingsboard_service_1 = require("../services/thingsboard.service");
const thingsboard_dto_1 = require("../dto/thingsboard.dto");
const common_types_1 = require("../types/common.types");
/**
 * Enhanced ThingsBoard RPC controller class with comprehensive validation
 *
 * This controller demonstrates the enhanced patterns for VIIS API modules:
 * - Uses routing-controllers decorators with automatic validation
 * - Leverages class-validator DTOs for request validation
 * - Implements comprehensive error handling and logging
 * - Provides full ThingsBoard RPC lifecycle management
 * - Serves as a template for other API module controllers
 *
 * Features:
 * - Automatic request validation using enhanced DTOs
 * - Comprehensive ThingsBoard RPC endpoints
 * - MQTT integration with existing core services
 * - Telemetry data transformation and type detection
 * - Consistent error handling and response formatting
 * - Real-time device communication capabilities
 */
let ThingsBoardController = class ThingsBoardController {
    constructor(thingsBoardService, node) {
        this.thingsBoardService = thingsBoardService;
        this.node = node;
        // Validate that node is properly injected
        if (!this.node) {
            console.error('[VIIS-REST-API] ThingsBoardController: Node injection failed - node is undefined');
            throw new Error('ThingsBoardController initialization failed: Node dependency not properly injected');
        }
        logger_1.logger.info(this.node, 'Enhanced ThingsBoardController initialized with routing-controllers and automatic validation');
    }
    /**
     * Enhanced one-way RPC endpoint with automatic validation
     * POST /api/v2/thingsboard/rpc/oneway/:id
     *
     * Features:
     * - Automatic request validation using enhanced ThingsBoardRpcRequestDto
     * - Support for multiple RPC methods (setTelemetry, controlDevice, etc.)
     * - Telemetry data transformation with type detection
     * - MQTT publishing with retry logic
     * - Comprehensive error handling and logging
     * - Standardized response format
     *
     * @param deviceId - Device ID from URL parameter
     * @param rpcData - Validated RPC request data from request body
     * @returns RPC execution result with processing details
     *
     * @example
     * Request URL: POST /api/v2/thingsboard/rpc/oneway/device123
     * Request body:
     * ```json
     * {
     *   "method": "setTelemetry",
     *   "params": {
     *     "temperature": 25.5,
     *     "humidity": "60",
     *     "status": "true",
     *     "metadata": {"location": "room1"}
     *   },
     *   "timeout": 30000,
     *   "retries": 3
     * }
     * ```
     *
     * Response:
     * ```json
     * {
     *   "success": true,
     *   "deviceId": "device123",
     *   "method": "setTelemetry",
     *   "telemetryRecordsCount": 4,
     *   "mqttPublished": true,
     *   "mqttTopic": "v1/devices/me/rpc/request/device123",
     *   "processingTime": 150
     * }
     * ```
     */
    async processOneWayRpc(deviceId, rpcData) {
        const requestId = this.generateRequestId();
        logger_1.logger.info(this.node, `Enhanced one-way RPC request for device: ${deviceId}`, {
            method: rpcData.method,
            requestId,
            deviceId,
            hasParams: !!rpcData.params
        });
        try {
            // Validate device ID
            this.validateDeviceId(deviceId);
            // Create processing context
            const context = {
                deviceId,
                method: rpcData.method,
                requestId,
                startTime: Date.now()
            };
            // Convert DTO to internal request format
            const rpcRequest = {
                method: rpcData.method,
                params: rpcData.params || {},
                timeout: rpcData.timeout || 30000,
                persistent: rpcData.persistent || false,
                retries: rpcData.retries || 3
            };
            // Process RPC request using service
            const executionResult = await this.thingsBoardService.processRpcRequest(deviceId, rpcRequest, context);
            logger_1.logger.info(this.node, `One-way RPC processed successfully for device: ${deviceId}`, {
                method: rpcData.method,
                requestId,
                processingTime: executionResult.processingTime,
                recordsCount: executionResult.telemetryRecords.length,
                mqttPublished: executionResult.mqttPublished
            });
            // Convert to response DTO
            const responseDto = {
                success: executionResult.success,
                deviceId: executionResult.deviceId,
                method: executionResult.method,
                telemetryRecordsCount: executionResult.telemetryRecords.length,
                mqttPublished: executionResult.mqttPublished,
                mqttTopic: executionResult.mqttTopic,
                processingTime: executionResult.processingTime,
                errors: executionResult.errors.length > 0 ? executionResult.errors : undefined,
                warnings: executionResult.warnings.length > 0 ? executionResult.warnings : undefined,
                requestId
            };
            return responseDto;
        }
        catch (error) {
            logger_1.logger.error(this.node, `One-way RPC failed for device: ${deviceId}`, {
                error: error.message,
                method: rpcData.method,
                requestId,
                deviceId
            });
            throw error;
        }
    }
    /**
     * Enhanced set telemetry RPC endpoint
     * POST /api/v2/thingsboard/rpc/telemetry/:id
     *
     * Features:
     * - Specialized endpoint for telemetry data
     * - Enhanced validation for telemetry-specific data
     * - Automatic type detection and conversion
     * - Optimized for high-frequency telemetry updates
     *
     * @param deviceId - Device ID from URL parameter
     * @param telemetryData - Validated telemetry RPC data
     * @returns RPC execution result
     */
    async setTelemetry(deviceId, telemetryData) {
        const requestId = this.generateRequestId();
        logger_1.logger.info(this.node, `Enhanced telemetry RPC request for device: ${deviceId}`, {
            requestId,
            deviceId,
            keysCount: Object.keys(telemetryData.params || {}).length
        });
        try {
            this.validateDeviceId(deviceId);
            const context = {
                deviceId,
                method: 'setTelemetry',
                requestId,
                startTime: Date.now()
            };
            const rpcRequest = {
                method: 'setTelemetry',
                params: telemetryData.params,
                timeout: telemetryData.timeout || 30000,
                retries: telemetryData.retries || 3
            };
            const executionResult = await this.thingsBoardService.processRpcRequest(deviceId, rpcRequest, context);
            logger_1.logger.info(this.node, `Telemetry RPC processed successfully for device: ${deviceId}`, {
                requestId,
                processingTime: executionResult.processingTime,
                recordsCount: executionResult.telemetryRecords.length
            });
            return {
                success: executionResult.success,
                deviceId: executionResult.deviceId,
                method: executionResult.method,
                telemetryRecordsCount: executionResult.telemetryRecords.length,
                mqttPublished: executionResult.mqttPublished,
                mqttTopic: executionResult.mqttTopic,
                processingTime: executionResult.processingTime,
                errors: executionResult.errors.length > 0 ? executionResult.errors : undefined,
                warnings: executionResult.warnings.length > 0 ? executionResult.warnings : undefined,
                requestId
            };
        }
        catch (error) {
            logger_1.logger.error(this.node, `Telemetry RPC failed for device: ${deviceId}`, {
                error: error.message,
                requestId,
                deviceId
            });
            throw error;
        }
    }
    /**
     * Enhanced device control RPC endpoint
     * POST /api/v2/thingsboard/rpc/control/:id
     *
     * Features:
     * - Specialized endpoint for device control commands
     * - Enhanced validation for control-specific data
     * - Support for complex control parameters
     * - Audit logging for control operations
     *
     * @param deviceId - Device ID from URL parameter
     * @param controlData - Validated device control RPC data
     * @returns RPC execution result
     */
    async controlDevice(deviceId, controlData) {
        const requestId = this.generateRequestId();
        logger_1.logger.info(this.node, `Enhanced device control RPC request for device: ${deviceId}`, {
            requestId,
            deviceId,
            command: controlData.params.command
        });
        try {
            this.validateDeviceId(deviceId);
            const context = {
                deviceId,
                method: 'controlDevice',
                requestId,
                startTime: Date.now()
            };
            const rpcRequest = {
                method: 'controlDevice',
                params: controlData.params,
                timeout: controlData.timeout || 30000,
                retries: controlData.retries || 3
            };
            const executionResult = await this.thingsBoardService.processRpcRequest(deviceId, rpcRequest, context);
            logger_1.logger.info(this.node, `Device control RPC processed successfully for device: ${deviceId}`, {
                requestId,
                command: controlData.params.command,
                processingTime: executionResult.processingTime
            });
            return {
                success: executionResult.success,
                deviceId: executionResult.deviceId,
                method: executionResult.method,
                telemetryRecordsCount: executionResult.telemetryRecords.length,
                mqttPublished: executionResult.mqttPublished,
                mqttTopic: executionResult.mqttTopic,
                processingTime: executionResult.processingTime,
                errors: executionResult.errors.length > 0 ? executionResult.errors : undefined,
                warnings: executionResult.warnings.length > 0 ? executionResult.warnings : undefined,
                requestId
            };
        }
        catch (error) {
            logger_1.logger.error(this.node, `Device control RPC failed for device: ${deviceId}`, {
                error: error.message,
                requestId,
                deviceId,
                command: controlData.params.command
            });
            throw error;
        }
    }
    /**
     * Enhanced service health check endpoint
     * GET /api/v2/thingsboard/health
     *
     * Features:
     * - Service health status monitoring
     * - MQTT connection status
     * - Processing statistics
     * - Performance metrics
     *
     * @returns Service health information
     */
    async getServiceHealth() {
        var _a;
        logger_1.logger.debug(this.node, 'ThingsBoard service health check requested');
        try {
            const healthInfo = await this.thingsBoardService.healthCheck();
            const processingStats = this.thingsBoardService.getProcessingStats();
            logger_1.logger.debug(this.node, 'ThingsBoard service health check completed', {
                status: healthInfo.status,
                mqttConnected: (_a = healthInfo.details) === null || _a === void 0 ? void 0 : _a.mqttConnected
            });
            return {
                service: 'ThingsBoard RPC',
                status: healthInfo.status,
                timestamp: new Date().toISOString(),
                details: Object.assign(Object.assign({}, healthInfo.details), { processingStats })
            };
        }
        catch (error) {
            logger_1.logger.error(this.node, 'ThingsBoard service health check failed', {
                error: error.message
            });
            throw error;
        }
    }
    /**
     * Enhanced custom command RPC endpoint
     * POST /api/v2/thingsboard/rpc/custom/:id
     *
     * Features:
     * - Support for custom RPC methods
     * - Flexible parameter validation
     * - Extensible for future RPC methods
     * - Comprehensive logging and monitoring
     *
     * @param deviceId - Device ID from URL parameter
     * @param customData - Validated custom RPC data
     * @returns RPC execution result
     */
    async executeCustomRpc(deviceId, customData) {
        const requestId = this.generateRequestId();
        logger_1.logger.info(this.node, `Enhanced custom RPC request for device: ${deviceId}`, {
            requestId,
            deviceId,
            method: customData.method
        });
        try {
            this.validateDeviceId(deviceId);
            const context = {
                deviceId,
                method: customData.method,
                requestId,
                startTime: Date.now()
            };
            const rpcRequest = {
                method: customData.method,
                params: customData.params || {},
                timeout: customData.timeout || 30000,
                retries: customData.retries || 3
            };
            const executionResult = await this.thingsBoardService.processRpcRequest(deviceId, rpcRequest, context);
            logger_1.logger.info(this.node, `Custom RPC processed successfully for device: ${deviceId}`, {
                requestId,
                method: customData.method,
                processingTime: executionResult.processingTime
            });
            return {
                success: executionResult.success,
                deviceId: executionResult.deviceId,
                method: executionResult.method,
                telemetryRecordsCount: executionResult.telemetryRecords.length,
                mqttPublished: executionResult.mqttPublished,
                mqttTopic: executionResult.mqttTopic,
                processingTime: executionResult.processingTime,
                errors: executionResult.errors.length > 0 ? executionResult.errors : undefined,
                warnings: executionResult.warnings.length > 0 ? executionResult.warnings : undefined,
                requestId
            };
        }
        catch (error) {
            logger_1.logger.error(this.node, `Custom RPC failed for device: ${deviceId}`, {
                error: error.message,
                requestId,
                deviceId,
                method: customData.method
            });
            throw error;
        }
    }
    /**
     * Enhanced service statistics endpoint
     * GET /api/v2/thingsboard/stats
     *
     * Features:
     * - Real-time processing statistics
     * - Performance metrics
     * - MQTT publish success rates
     * - Service uptime information
     *
     * @returns Service processing statistics
     */
    async getServiceStats() {
        logger_1.logger.debug(this.node, 'ThingsBoard service statistics requested');
        try {
            const stats = this.thingsBoardService.getProcessingStats();
            logger_1.logger.debug(this.node, 'ThingsBoard service statistics retrieved', {
                totalRequests: stats.totalRequests,
                successRate: stats.totalRequests > 0 ? (stats.successfulRequests / stats.totalRequests) : 0
            });
            return {
                service: 'ThingsBoard RPC',
                timestamp: new Date().toISOString(),
                statistics: stats,
                uptime: this.thingsBoardService.isInitialized() ? Date.now() : 0
            };
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Failed to retrieve ThingsBoard service statistics', {
                error: error.message
            });
            throw error;
        }
    }
    /**
     * Validate device ID format and constraints
     */
    validateDeviceId(deviceId) {
        if (!deviceId || typeof deviceId !== 'string') {
            throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, 'Device ID is required and must be a string', 400);
        }
        if (deviceId.trim().length === 0) {
            throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, 'Device ID cannot be empty', 400);
        }
        if (deviceId.length > 100) {
            throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, 'Device ID cannot exceed 100 characters', 400);
        }
        // Validate device ID format (alphanumeric, hyphens, underscores)
        if (!/^[a-zA-Z0-9\-_]+$/.test(deviceId)) {
            throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, 'Device ID must contain only letters, numbers, hyphens, and underscores', 400);
        }
    }
    /**
     * Generate unique request ID for tracking
     */
    generateRequestId() {
        return `rpc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
};
exports.ThingsBoardController = ThingsBoardController;
__decorate([
    (0, routing_controllers_1.Post)('/rpc/oneway/:id'),
    __param(0, (0, routing_controllers_1.Param)('id')),
    __param(1, (0, routing_controllers_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, thingsboard_dto_1.ThingsBoardRpcRequestDto]),
    __metadata("design:returntype", Promise)
], ThingsBoardController.prototype, "processOneWayRpc", null);
__decorate([
    (0, routing_controllers_1.Post)('/rpc/telemetry/:id'),
    __param(0, (0, routing_controllers_1.Param)('id')),
    __param(1, (0, routing_controllers_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, thingsboard_dto_1.SetTelemetryRpcDto]),
    __metadata("design:returntype", Promise)
], ThingsBoardController.prototype, "setTelemetry", null);
__decorate([
    (0, routing_controllers_1.Post)('/rpc/control/:id'),
    __param(0, (0, routing_controllers_1.Param)('id')),
    __param(1, (0, routing_controllers_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, thingsboard_dto_1.DeviceControlRpcDto]),
    __metadata("design:returntype", Promise)
], ThingsBoardController.prototype, "controlDevice", null);
__decorate([
    (0, routing_controllers_1.Get)('/health'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ThingsBoardController.prototype, "getServiceHealth", null);
__decorate([
    (0, routing_controllers_1.Post)('/rpc/custom/:id'),
    __param(0, (0, routing_controllers_1.Param)('id')),
    __param(1, (0, routing_controllers_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, thingsboard_dto_1.CustomCommandRpcDto]),
    __metadata("design:returntype", Promise)
], ThingsBoardController.prototype, "executeCustomRpc", null);
__decorate([
    (0, routing_controllers_1.Get)('/stats'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ThingsBoardController.prototype, "getServiceStats", null);
exports.ThingsBoardController = ThingsBoardController = __decorate([
    (0, routing_controllers_1.JsonController)('/thingsboard'),
    (0, typedi_1.Service)(),
    __param(0, (0, typedi_1.Inject)()),
    __param(1, (0, typedi_1.Inject)('node')),
    __metadata("design:paramtypes", [thingsboard_service_1.ThingsBoardService, Object])
], ThingsBoardController);
