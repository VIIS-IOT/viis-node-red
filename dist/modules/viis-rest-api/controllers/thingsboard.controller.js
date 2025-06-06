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
const schedule_activation_service_1 = require("../services/schedule-activation.service");
const container_setup_1 = require("../container/container.setup");
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
    constructor(thingsBoardService, scheduleActivationService, node) {
        this.thingsBoardService = thingsBoardService;
        this.scheduleActivationService = scheduleActivationService;
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
    async processOneWayRpc(deviceId, rpcData, user) {
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
            // Process schedule activation logic if conditions are met
            await this.processScheduleActivationIfNeeded(deviceId, rpcData.params || {}, user, requestId);
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
     * Process schedule activation logic if conditions are met
     * This method implements the specialized conditional logic for schedule activation
     */
    async processScheduleActivationIfNeeded(deviceId, rpcParams, user, requestId) {
        try {
            logger_1.logger.info(this.node, 'Checking schedule activation conditions', {
                deviceId,
                requestId,
                hasCoilAutoTron: rpcParams.COIL_AUTO_TRON,
                hasScheduleId: !!rpcParams.schedule_id
            });
            // Check if schedule activation conditions are met
            if (!this.scheduleActivationService.isScheduleActivationTrigger(rpcParams)) {
                logger_1.logger.info(this.node, 'Schedule activation conditions not met', {
                    deviceId,
                    requestId,
                    hasCoilAutoTron: rpcParams.COIL_AUTO_TRON,
                    hasScheduleId: !!rpcParams.schedule_id
                });
                return;
            }
            // Validate user context
            const userContext = {
                user_id: (user === null || user === void 0 ? void 0 : user.user_id) || (user === null || user === void 0 ? void 0 : user.name),
                customer_id: user === null || user === void 0 ? void 0 : user.customer_id,
                first_name: user === null || user === void 0 ? void 0 : user.first_name,
                last_name: user === null || user === void 0 ? void 0 : user.last_name,
                email: user === null || user === void 0 ? void 0 : user.email
            };
            if (!this.scheduleActivationService.validateUserContext(userContext)) {
                logger_1.logger.warn(this.node, 'Invalid user context for schedule activation', {
                    deviceId,
                    requestId,
                    userId: userContext.user_id
                });
                return;
            }
            // Extract schedule activation parameters
            const activationParams = this.scheduleActivationService.extractScheduleActivationParams(deviceId, rpcParams, userContext);
            if (!activationParams) {
                logger_1.logger.warn(this.node, 'Failed to extract schedule activation parameters', {
                    deviceId,
                    requestId
                });
                return;
            }
            logger_1.logger.info(this.node, 'Processing schedule activation', {
                deviceId,
                scheduleId: activationParams.scheduleId,
                userId: userContext.user_id,
                requestId
            });
            // Process schedule activation
            const activationResult = await this.scheduleActivationService.processScheduleActivation(activationParams);
            logger_1.logger.info(this.node, 'Schedule activation processing completed', {
                deviceId,
                scheduleId: activationParams.scheduleId,
                scheduleLogCreated: activationResult.scheduleLogCreated,
                notificationCreated: activationResult.notificationCreated,
                mqttPublished: activationResult.mqttPublished,
                errors: activationResult.errors,
                requestId
            });
        }
        catch (error) {
            // Log error but don't throw - schedule activation is additional functionality
            logger_1.logger.error(this.node, 'Schedule activation processing failed', {
                error: error.message,
                deviceId,
                requestId,
                stack: error.stack
            });
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
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('id')),
    __param(1, (0, routing_controllers_1.Body)()),
    __param(2, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, thingsboard_dto_1.ThingsBoardRpcRequestDto, Object]),
    __metadata("design:returntype", Promise)
], ThingsBoardController.prototype, "processOneWayRpc", null);
__decorate([
    (0, routing_controllers_1.Get)('/health'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ThingsBoardController.prototype, "getServiceHealth", null);
exports.ThingsBoardController = ThingsBoardController = __decorate([
    (0, routing_controllers_1.JsonController)('/thingsboard'),
    (0, typedi_1.Service)(),
    __param(0, (0, typedi_1.Inject)()),
    __param(1, (0, typedi_1.Inject)()),
    __param(2, (0, typedi_1.Inject)(container_setup_1.NODE_TOKEN)),
    __metadata("design:paramtypes", [thingsboard_service_1.ThingsBoardService,
        schedule_activation_service_1.ScheduleActivationService, Object])
], ThingsBoardController);
