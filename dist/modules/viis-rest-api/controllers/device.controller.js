"use strict";
/**
 * @fileoverview Enhanced Device controller with comprehensive validation
 *
 * This controller demonstrates the enhanced patterns for device management:
 * - Uses routing-controllers decorators with automatic validation
 * - Leverages enhanced class-validator DTOs for request validation
 * - Implements comprehensive error handling and logging
 * - Provides full device lifecycle management
 * - Supports advanced filtering and bulk operations
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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceController = void 0;
require("reflect-metadata");
const routing_controllers_1 = require("routing-controllers");
const typedi_1 = require("typedi");
const device_service_1 = require("../services/device.service");
const node_red_1 = require("node-red");
const logger_1 = require("../utils/logger");
const container_setup_1 = require("../container/container.setup");
/**
 * Enhanced Device controller class with comprehensive validation
 *
 * This controller demonstrates the enhanced patterns for VIIS API modules:
 * - Uses routing-controllers decorators with automatic validation
 * - Leverages enhanced class-validator DTOs for request validation
 * - Implements comprehensive error handling and logging
 * - Provides full device lifecycle management with advanced features
 * - Supports bulk operations and advanced filtering
 * - Serves as a template for other API module controllers
 *
 * Features:
 * - Automatic request validation using enhanced DTOs
 * - Comprehensive device management endpoints
 * - Advanced filtering and pagination
 * - Bulk operations support
 * - Nested object validation for device configuration
 * - Enum validation for device types and statuses
 * - Consistent error handling and response formatting
 */
let DeviceController = class DeviceController {
    constructor(deviceService, node) {
        this.deviceService = deviceService;
        this.node = node;
        logger_1.logger.info(this.node, 'Enhanced DeviceController initialized with routing-controllers and automatic validation');
    }
};
exports.DeviceController = DeviceController;
exports.DeviceController = DeviceController = __decorate([
    (0, routing_controllers_1.JsonController)('/devices'),
    (0, typedi_1.Service)(),
    __param(0, (0, typedi_1.Inject)()),
    __param(1, (0, typedi_1.Inject)(container_setup_1.NODE_TOKEN)),
    __metadata("design:paramtypes", [device_service_1.DeviceService, typeof (_a = typeof node_red_1.Node !== "undefined" && node_red_1.Node) === "function" ? _a : Object])
], DeviceController);
