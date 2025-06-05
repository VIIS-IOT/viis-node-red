/**
 * @fileoverview TypeDI Container setup for VIIS REST API
 */

import Container from "typedi";
import { Node } from "node-red";
import { DatabaseService } from "../services/database.service";
import { AuthService } from "../services/auth.service";
import { AuthController } from "../controllers/auth.controller";
import { UserController } from "../controllers/user.controller";
import { HealthController } from "../controllers/health.controller";
import { AuthValidator } from "../validators/auth.validator";
import { UserValidator } from "../validators/user.validator";
import { AuthMiddleware } from "../middleware/auth.middleware";
import { ValidationMiddleware } from "../middleware/validation.middleware";
import { ApiConfigManager } from "../config/api.config";
import { BaseService, ServiceContext } from "../services/base.service";
import "reflect-metadata";

/**
 * Container setup configuration
 */
export interface ContainerConfig {
    node: Node;
    jwtSecret: string;
    configManager: ApiConfigManager;
}

/**
 * Setup TypeDI container with all services and dependencies
 */
export class ContainerSetup {
    private static isInitialized = false;

    /**
     * Initialize the container with all dependencies
     */
    static async initialize(config: ContainerConfig): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        const { node, jwtSecret, configManager } = config;

        try {
            // Register core instances
            Container.set("node", node);
            Container.set("jwtSecret", jwtSecret);
            Container.set("configManager", configManager);

            // Initialize and register DatabaseService
            const databaseService = new DatabaseService(node);
            await databaseService.initialize();
            Container.set(DatabaseService, databaseService);

            // Create service context for base services
            const serviceContext: ServiceContext = {
                node,
                databaseService,
                configManager
            };
            Container.set("serviceContext", serviceContext);

            // Initialize and register AuthService
            const authService = new AuthService(databaseService, jwtSecret, node);
            await authService.initialize();
            Container.set(AuthService, authService);

            // Register validators
            Container.set(AuthValidator, new AuthValidator());
            Container.set(UserValidator, new UserValidator());

            // Register middleware
            Container.set(AuthMiddleware, new AuthMiddleware(authService, node));
            Container.set(ValidationMiddleware, new ValidationMiddleware(node));

            // Register controllers - TypeDI will handle dependency injection automatically
            // Note: Controllers will be instantiated by TypeDI when requested via Container.get()
            // The @Controller decorator and @Inject decorators handle the dependency resolution

            this.isInitialized = true;
        } catch (error) {
            throw new Error(`Failed to initialize container: ${(error as Error).message}`);
        }
    }

    /**
     * Reset container (useful for testing)
     */
    static reset(): void {
        Container.reset();
        this.isInitialized = false;
    }

    /**
     * Check if container is initialized
     */
    static get initialized(): boolean {
        return this.isInitialized;
    }
}
