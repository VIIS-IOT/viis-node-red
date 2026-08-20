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
const container_setup_1 = require("../container/container.setup");
const thingsboard_dto_1 = require("../dto/thingsboard.dto");
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
     *   "mqttTopic": "v1/device/device123/rpc/+",
     *   "processingTime": 150
     * }
     * ```
     */
    async processOneWayRpc(deviceId, rpcData, user) {
        logger_1.logger.info(this.node, `Enhanced one-way RPC request for device: ${deviceId}`, {
            method: rpcData.method,
            deviceId,
            hasParams: !!rpcData.params,
            userId: user === null || user === void 0 ? void 0 : user.user_id
        });
        try {
            // Process RPC request using service
            const responseDto = await this.thingsBoardService.processOneWayRpcFromDto(deviceId, rpcData, user);
            // Schedule activation logic is now handled within the service
            logger_1.logger.info(this.node, `One-way RPC processed successfully for device: ${deviceId}`, {
                method: rpcData.method,
                requestId: responseDto.requestId,
                processingTime: responseDto.processingTime,
                recordsCount: responseDto.telemetryRecordsCount,
                mqttPublished: responseDto.mqttPublished,
                userId: user === null || user === void 0 ? void 0 : user.user_id
            });
            return responseDto;
        }
        catch (error) {
            logger_1.logger.error(this.node, `One-way RPC failed for device: ${deviceId}`, {
                error: error.message,
                method: rpcData.method,
                deviceId,
                userId: user === null || user === void 0 ? void 0 : user.user_id
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
        logger_1.logger.debug(this.node, 'ThingsBoard service health check requested');
        try {
            const healthInfo = await this.thingsBoardService.getServiceHealthInfo();
            logger_1.logger.debug(this.node, 'ThingsBoard service health check completed', {
                status: healthInfo.status
            });
            return healthInfo;
        }
        catch (error) {
            logger_1.logger.error(this.node, 'ThingsBoard service health check failed', {
                error: error.message
            });
            throw error;
        }
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
    __param(1, (0, typedi_1.Inject)(container_setup_1.NODE_TOKEN)),
    __metadata("design:paramtypes", [thingsboard_service_1.ThingsBoardService, Object])
], ThingsBoardController);
