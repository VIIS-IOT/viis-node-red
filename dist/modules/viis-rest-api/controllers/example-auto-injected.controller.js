"use strict";
/**
 * @fileoverview Example Controller with Proper Automatic Dependency Injection
 * Demonstrates how to create controllers that follow routing-controllers and TypeDI best practices
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
exports.ExampleAutoInjectedController = exports.ExampleRequestDto = void 0;
require("reflect-metadata");
const routing_controllers_1 = require("routing-controllers");
const typedi_1 = require("typedi");
const logger_1 = require("../utils/logger");
const database_service_1 = require("../services/database.service");
const auth_service_1 = require("../services/auth.service");
const example_auto_injected_service_1 = require("../services/example-auto-injected.service");
const api_config_1 = require("../config/api.config");
const container_setup_1 = require("../container/container.setup");
/**
 * Example DTO for request validation
 */
class ExampleRequestDto {
}
exports.ExampleRequestDto = ExampleRequestDto;
/**
 * Example controller demonstrating proper automatic dependency injection
 *
 * Key Features:
 * - Uses @JsonController() decorator for automatic route registration
 * - Uses @Service() decorator for automatic dependency injection
 * - Uses @Inject() decorators for dependency injection
 * - No manual Container.get() calls
 * - Easy to test with mocked dependencies
 * - Follows routing-controllers and TypeDI best practices
 * - Automatic request validation with DTOs
 * - Automatic authorization with @Authorized decorator
 */
let ExampleAutoInjectedController = class ExampleAutoInjectedController {
    constructor(
    // Inject services using class tokens (automatic)
    databaseService, authService, exampleService, node, configManager) {
        this.databaseService = databaseService;
        this.authService = authService;
        this.exampleService = exampleService;
        this.node = node;
        this.configManager = configManager;
        // Validate injected dependencies
        if (!this.node) {
            throw new Error('Node dependency not properly injected');
        }
        if (!this.configManager) {
            throw new Error('Config manager not properly injected');
        }
        logger_1.logger.info(this.node, 'ExampleAutoInjectedController initialized with automatic dependency injection');
    }
    /**
     * Public endpoint - no authentication required
     * GET /api/v2/example/health
     */
    async getHealth() {
        logger_1.logger.info(this.node, 'Example health check requested');
        try {
            // Use injected services
            const serviceHealth = await this.exampleService.healthCheck();
            return {
                success: true,
                controller: 'ExampleAutoInjectedController',
                dependencies: {
                    databaseService: this.databaseService.isInitialized(),
                    authService: !!this.authService,
                    exampleService: !!this.exampleService,
                    node: !!this.node,
                    configManager: !!this.configManager
                },
                serviceHealth,
                timestamp: new Date().toISOString()
            };
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Example health check failed', {
                error: error.message
            });
            throw error;
        }
    }
    /**
     * Protected endpoint - requires authentication
     * GET /api/v2/example/user/:userId
     */
    async getUserExample(userId, currentUser) {
        logger_1.logger.info(this.node, 'Example user operation requested', {
            userId,
            requestedBy: currentUser.user_id
        });
        try {
            // Use injected service
            const result = await this.exampleService.performExampleOperation(userId);
            return {
                success: true,
                requestedBy: currentUser.user_id,
                result,
                timestamp: new Date().toISOString()
            };
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Example user operation failed', {
                userId,
                requestedBy: currentUser.user_id,
                error: error.message
            });
            throw error;
        }
    }
    /**
     * POST endpoint with request body validation
     * POST /api/v2/example/action
     */
    async performAction(requestData, currentUser) {
        logger_1.logger.info(this.node, 'Example action requested', {
            userId: requestData.userId,
            action: requestData.action,
            requestedBy: currentUser.user_id
        });
        try {
            // Use injected services
            const userInfo = await this.authService.getUserInfo(requestData.userId);
            if (!userInfo) {
                return {
                    success: false,
                    error: 'User not found',
                    timestamp: new Date().toISOString()
                };
            }
            // Use injected config manager
            const apiPrefix = this.configManager.get('apiPrefix');
            return {
                success: true,
                action: requestData.action,
                user: userInfo,
                requestedBy: currentUser.user_id,
                apiPrefix,
                timestamp: new Date().toISOString()
            };
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Example action failed', {
                userId: requestData.userId,
                action: requestData.action,
                requestedBy: currentUser.user_id,
                error: error.message
            });
            throw error;
        }
    }
    /**
     * Admin-only endpoint
     * GET /api/v2/example/admin/stats
     */
    async getAdminStats(currentUser) {
        logger_1.logger.info(this.node, 'Example admin stats requested', {
            requestedBy: currentUser.user_id,
            isAdmin: currentUser.is_admin
        });
        try {
            // Use injected services to gather stats
            const dbStats = this.databaseService.isInitialized();
            const serviceHealth = await this.exampleService.healthCheck();
            return {
                success: true,
                stats: {
                    database: { initialized: dbStats },
                    services: serviceHealth,
                    config: {
                        apiPrefix: this.configManager.get('apiPrefix'),
                        debugMode: this.configManager.isEnabled('enableDebugMode')
                    }
                },
                requestedBy: currentUser.user_id,
                timestamp: new Date().toISOString()
            };
        }
        catch (error) {
            logger_1.logger.error(this.node, 'Example admin stats failed', {
                requestedBy: currentUser.user_id,
                error: error.message
            });
            throw error;
        }
    }
};
exports.ExampleAutoInjectedController = ExampleAutoInjectedController;
__decorate([
    (0, routing_controllers_1.Get)('/2'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ExampleAutoInjectedController.prototype, "getHealth", null);
__decorate([
    (0, routing_controllers_1.Get)('/user/:userId'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Param)('userId')),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ExampleAutoInjectedController.prototype, "getUserExample", null);
__decorate([
    (0, routing_controllers_1.Post)('/action'),
    (0, routing_controllers_1.Authorized)(),
    __param(0, (0, routing_controllers_1.Body)()),
    __param(1, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ExampleRequestDto, Object]),
    __metadata("design:returntype", Promise)
], ExampleAutoInjectedController.prototype, "performAction", null);
__decorate([
    (0, routing_controllers_1.Get)('/admin/stats'),
    (0, routing_controllers_1.Authorized)(['admin']),
    __param(0, (0, routing_controllers_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ExampleAutoInjectedController.prototype, "getAdminStats", null);
exports.ExampleAutoInjectedController = ExampleAutoInjectedController = __decorate([
    (0, routing_controllers_1.JsonController)('/example'),
    (0, typedi_1.Service)(),
    __param(3, (0, typedi_1.Inject)(container_setup_1.NODE_TOKEN)),
    __param(4, (0, typedi_1.Inject)(container_setup_1.CONFIG_MANAGER_TOKEN)),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        auth_service_1.AuthService,
        example_auto_injected_service_1.ExampleAutoInjectedService, Object, api_config_1.ApiConfigManager])
], ExampleAutoInjectedController);
