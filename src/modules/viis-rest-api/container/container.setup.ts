/**
 * @fileoverview TypeDI Container setup for VIIS REST API
 */

import Container from "typedi";
import { Node } from "node-red";
import { DatabaseService } from "../services/database.service";
import { AuthService } from "../services/auth.service";
import { ScheduleLogService } from "../services/schedule-log.service";
import { NotificationService } from "../services/notification.service";
import { ScheduleActivationService } from "../services/schedule-activation.service";
import { AuthController } from "../controllers/auth.controller";
import { UserController } from "../controllers/user.controller";
import { HealthController } from "../controllers/health.controller";
import { AuthValidator } from "../validators/auth.validator";
import { UserValidator } from "../validators/user.validator";
import { AuthMiddleware } from "../middleware/auth.middleware";
import { ValidationMiddleware } from "../middleware/validation.middleware";
import { ApiConfigManager } from "../config/api.config";
import { BaseService, ServiceContext } from "../services/base.service";
import { GlobalContextHelper } from "../../../ultils/global-context-helper";
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
            // Validate inputs before registration
            if (!node || typeof node.log !== 'function') {
                throw new Error('Invalid node provided - must be a valid Node-RED node instance');
            }
            if (!jwtSecret || typeof jwtSecret !== 'string') {
                throw new Error('Invalid jwtSecret provided - must be a non-empty string');
            }
            if (!configManager) {
                throw new Error('Invalid configManager provided');
            }

            // Initialize GlobalContextHelper
            const globalHelper = new GlobalContextHelper(node.context());

            // Register core instances
            Container.set("node", node);
            Container.set("jwtSecret", jwtSecret);
            Container.set("configManager", configManager);
            Container.set("globalHelper", globalHelper);

            // Log successful registration for debugging
            console.log('[VIIS-REST-API] Container setup: Core dependencies registered successfully');

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
            const authService = new AuthService(databaseService, jwtSecret, node, configManager);
            await authService.initialize();
            Container.set(AuthService, authService);

            // Initialize and register ScheduleLogService
            const scheduleLogService = new ScheduleLogService(serviceContext, databaseService);
            await scheduleLogService.initialize();
            Container.set(ScheduleLogService, scheduleLogService);

            // Initialize and register NotificationService
            const notificationService = new NotificationService(serviceContext, databaseService);
            await notificationService.initialize();
            Container.set(NotificationService, notificationService);

            // Initialize and register ScheduleActivationService
            const scheduleActivationService = new ScheduleActivationService(
                serviceContext,
                scheduleLogService,
                notificationService
            );
            await scheduleActivationService.initialize();
            Container.set(ScheduleActivationService, scheduleActivationService);

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
