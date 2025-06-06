/**
 * @fileoverview Example Controller with Proper Automatic Dependency Injection
 * Demonstrates how to create controllers that follow routing-controllers and TypeDI best practices
 */

import 'reflect-metadata';
import { JsonController, Get, Post, Body, Param, Authorized, CurrentUser } from 'routing-controllers';
import { Service, Inject } from 'typedi';
import { Node } from 'node-red';
import { logger } from '../utils/logger';
import { DatabaseService } from '../services/database.service';
import { AuthService } from '../services/auth.service';
import { ExampleAutoInjectedService } from '../services/example-auto-injected.service';
import { ApiConfigManager } from '../config/api.config';
import {
    NODE_TOKEN,
    CONFIG_MANAGER_TOKEN
} from '../container/container.setup';

/**
 * Example DTO for request validation
 */
export class ExampleRequestDto {
    userId!: string;
    action!: string;
}

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
@JsonController('/example')
@Service()
export class ExampleAutoInjectedController {
    constructor(
        // Inject services using class tokens (automatic)
        private readonly databaseService: DatabaseService,
        private readonly authService: AuthService,
        private readonly exampleService: ExampleAutoInjectedService,

        // Inject primitive values using custom tokens
        @Inject(NODE_TOKEN) private readonly node: Node,
        @Inject(CONFIG_MANAGER_TOKEN) private readonly configManager: ApiConfigManager
    ) {
        // Validate injected dependencies
        if (!this.node) {
            throw new Error('Node dependency not properly injected');
        }
        if (!this.configManager) {
            throw new Error('Config manager not properly injected');
        }

        logger.info(this.node, 'ExampleAutoInjectedController initialized with automatic dependency injection');
    }

    /**
     * Public endpoint - no authentication required
     * GET /api/v2/example/health
     */
    @Get('/2')
    async getHealth(): Promise<any> {
        logger.info(this.node, 'Example health check requested');

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

        } catch (error) {
            logger.error(this.node, 'Example health check failed', {
                error: (error as Error).message
            });
            throw error;
        }
    }

    /**
     * Protected endpoint - requires authentication
     * GET /api/v2/example/user/:userId
     */
    @Get('/user/:userId')
    @Authorized()
    async getUserExample(
        @Param('userId') userId: string,
        @CurrentUser() currentUser: any
    ): Promise<any> {
        logger.info(this.node, 'Example user operation requested', {
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

        } catch (error) {
            logger.error(this.node, 'Example user operation failed', {
                userId,
                requestedBy: currentUser.user_id,
                error: (error as Error).message
            });
            throw error;
        }
    }

    /**
     * POST endpoint with request body validation
     * POST /api/v2/example/action
     */
    @Post('/action')
    @Authorized()
    async performAction(
        @Body() requestData: ExampleRequestDto,
        @CurrentUser() currentUser: any
    ): Promise<any> {
        logger.info(this.node, 'Example action requested', {
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

        } catch (error) {
            logger.error(this.node, 'Example action failed', {
                userId: requestData.userId,
                action: requestData.action,
                requestedBy: currentUser.user_id,
                error: (error as Error).message
            });
            throw error;
        }
    }

    /**
     * Admin-only endpoint
     * GET /api/v2/example/admin/stats
     */
    @Get('/admin/stats')
    @Authorized(['admin'])
    async getAdminStats(@CurrentUser() currentUser: any): Promise<any> {
        logger.info(this.node, 'Example admin stats requested', {
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

        } catch (error) {
            logger.error(this.node, 'Example admin stats failed', {
                requestedBy: currentUser.user_id,
                error: (error as Error).message
            });
            throw error;
        }
    }
}
