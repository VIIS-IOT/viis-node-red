"use strict";
/**
 * @fileoverview Example Service with Proper Automatic Dependency Injection
 * Demonstrates how to create services that follow TypeDI best practices
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
exports.ExampleAutoInjectedService = void 0;
const typedi_1 = require("typedi");
const node_red_1 = require("node-red");
const logger_1 = require("../utils/logger");
const database_service_1 = require("./database.service");
const auth_service_1 = require("./auth.service");
const api_config_1 = require("../config/api.config");
const container_setup_1 = require("../container/container.setup");
const common_types_1 = require("../types/common.types");
/**
 * Example service demonstrating proper automatic dependency injection
 *
 * Key Features:
 * - Uses @Service() decorator for automatic registration
 * - Uses @Inject() decorators for dependency injection
 * - No manual Container.get() calls
 * - Easy to test with mocked dependencies
 * - Follows TypeDI best practices
 */
let ExampleAutoInjectedService = class ExampleAutoInjectedService {
    constructor(
    // Inject services using class tokens (automatic)
    databaseService, authService, node, jwtSecret, configManager) {
        this.databaseService = databaseService;
        this.authService = authService;
        this.node = node;
        this.jwtSecret = jwtSecret;
        this.configManager = configManager;
        // Validate injected dependencies
        if (!this.node) {
            throw new Error('Node dependency not properly injected');
        }
        if (!this.jwtSecret) {
            throw new Error('JWT secret not properly injected');
        }
        if (!this.configManager) {
            throw new Error('Config manager not properly injected');
        }
        logger_1.logger.info(this.node, 'ExampleAutoInjectedService initialized with automatic dependency injection');
    }
    /**
     * Example method that uses injected dependencies
     */
    async performExampleOperation(userId) {
        try {
            // Use injected database service
            if (!this.databaseService.isInitialized()) {
                throw new common_types_1.ApiError(common_types_1.ErrorType.DATABASE_ERROR, 'Database service not available', 500);
            }
            // Use injected auth service
            const userInfo = await this.authService.getUserInfo(userId);
            if (!userInfo) {
                throw new common_types_1.ApiError(common_types_1.ErrorType.NOT_FOUND_ERROR, 'User not found', 404);
            }
            // Use injected config manager
            const apiPrefix = this.configManager.get('apiPrefix');
            // Use injected node for logging
            logger_1.logger.info(this.node, 'Example operation completed', {
                userId,
                apiPrefix,
                hasJwtSecret: !!this.jwtSecret
            });
            return {
                success: true,
                user: userInfo,
                apiPrefix,
                timestamp: new Date().toISOString()
            };
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Example operation failed', {
                userId,
                error: error.message
            });
            throw error;
        }
    }
    /**
     * Health check method
     */
    async healthCheck() {
        return {
            status: 'healthy',
            dependencies: {
                databaseService: this.databaseService.isInitialized(),
                authService: !!this.authService,
                node: !!this.node,
                jwtSecret: !!this.jwtSecret,
                configManager: !!this.configManager
            }
        };
    }
};
exports.ExampleAutoInjectedService = ExampleAutoInjectedService;
exports.ExampleAutoInjectedService = ExampleAutoInjectedService = __decorate([
    (0, typedi_1.Service)(),
    __param(2, (0, typedi_1.Inject)(container_setup_1.NODE_TOKEN)),
    __param(3, (0, typedi_1.Inject)(container_setup_1.JWT_SECRET_TOKEN)),
    __param(4, (0, typedi_1.Inject)(container_setup_1.CONFIG_MANAGER_TOKEN)),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        auth_service_1.AuthService, typeof (_a = typeof node_red_1.Node !== "undefined" && node_red_1.Node) === "function" ? _a : Object, String, api_config_1.ApiConfigManager])
], ExampleAutoInjectedService);
