/**
 * @fileoverview Example Service with Proper Automatic Dependency Injection
 * Demonstrates how to create services that follow TypeDI best practices
 */

import { Service, Inject } from 'typedi';
import { Node } from 'node-red';
import { logger } from '../utils/logger';
import { DatabaseService } from './database.service';
import { AuthService } from './auth.service';
import { ApiConfigManager } from '../config/api.config';
import {
    NODE_TOKEN,
    JWT_SECRET_TOKEN,
    CONFIG_MANAGER_TOKEN
} from '../container/container.setup';
import { ApiError, ErrorType } from '../types/common.types';

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
@Service()
export class ExampleAutoInjectedService {
    constructor(
        // Inject services using class tokens (automatic)
        private readonly databaseService: DatabaseService,
        private readonly authService: AuthService,

        // Inject primitive values using custom tokens
        @Inject(NODE_TOKEN) private readonly node: Node,
        @Inject(JWT_SECRET_TOKEN) private readonly jwtSecret: string,
        @Inject(CONFIG_MANAGER_TOKEN) private readonly configManager: ApiConfigManager
    ) {
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

        logger.info(this.node, 'ExampleAutoInjectedService initialized with automatic dependency injection');
    }

    /**
     * Example method that uses injected dependencies
     */
    async performExampleOperation(userId: string): Promise<any> {
        try {
            // Use injected database service
            if (!this.databaseService.isInitialized()) {
                throw new ApiError(
                    ErrorType.DATABASE_ERROR,
                    'Database service not available',
                    500
                );
            }

            // Use injected auth service
            const userInfo = await this.authService.getUserInfo(userId);
            if (!userInfo) {
                throw new ApiError(
                    ErrorType.NOT_FOUND_ERROR,
                    'User not found',
                    404
                );
            }

            // Use injected config manager
            const apiPrefix = this.configManager.get('apiPrefix');

            // Use injected node for logging
            logger.info(this.node, 'Example operation completed', {
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

        } catch (error) {
            logger.error(this.node, 'Example operation failed', {
                userId,
                error: (error as Error).message
            });
            throw error;
        }
    }

    /**
     * Health check method
     */
    async healthCheck(): Promise<{ status: string; dependencies: any }> {
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
}
