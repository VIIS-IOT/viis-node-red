/**
 * @fileoverview TypeDI Container setup for VIIS REST API
 * Proper dependency injection configuration following TypeDI best practices
 */

import Container, { Token } from "typedi";
import { DataSource } from "typeorm";
import { Node } from "node-red";
import { DatabaseService } from "../services/database.service";
import { AuthService } from "../services/auth.service";
import { ScheduleLogService } from "../services/schedule-log.service";
import { NotificationService } from "../services/notification.service";
import { ScheduleActivationService } from "../services/schedule-activation.service";
import { ScheduleCompletionMonitorService } from "../services/schedule-completion-monitor.service";
import { DeviceService } from "../services/device.service";
import { MarineTelemetryService } from "../services/marine-telemetry.service";
import { MarineWebSocketService } from "../services/marine-websocket.service";
import { AuthController } from "../controllers/auth.controller";
import { UserController } from "../controllers/user.controller";
import { HealthController } from "../controllers/health.controller";
import { DeviceController } from "../controllers/device.controller";
import { ThingsBoardController } from "../controllers/thingsboard.controller";
import { AuthValidator } from "../validators/auth.validator";
import { UserValidator } from "../validators/user.validator";
import { DeviceValidator } from "../validators/device.validator";
import { AuthMiddleware } from "../middleware/auth.middleware";
import { ValidationMiddleware } from "../middleware/validation.middleware";
import { ApiConfigManager } from "../config/api.config";
import { BaseService, ServiceContext } from "../services/base.service";
import { GlobalContextHelper } from "../../../ultils/global-context-helper";
import "reflect-metadata";

// Define tokens for primitive dependencies
export const NODE_TOKEN = new Token<Node>('node');
export const JWT_SECRET_TOKEN = new Token<string>('jwtSecret');
export const CONFIG_MANAGER_TOKEN = new Token<ApiConfigManager>('configManager');
export const GLOBAL_HELPER_TOKEN = new Token<GlobalContextHelper>('globalHelper');
export const SERVICE_CONTEXT_TOKEN = new Token<ServiceContext>('serviceContext');

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
 * Following proper dependency injection patterns
 */
export class ContainerSetup {
    private static isInitialized = false;

    /**
     * Initialize the container with all dependencies using proper TypeDI patterns
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

            // Register primitive dependencies using tokens
            Container.set(NODE_TOKEN, node);
            Container.set(JWT_SECRET_TOKEN, jwtSecret);
            Container.set(CONFIG_MANAGER_TOKEN, configManager);

            // BACKWARD COMPATIBILITY: Also register node with string identifier
            // This ensures existing controllers using @Inject('node') still work
            Container.set('node', node);

            // Initialize and register GlobalContextHelper
            const globalHelper = new GlobalContextHelper(node.context());
            Container.set(GLOBAL_HELPER_TOKEN, globalHelper);

            // Log successful registration for debugging
            console.log('[VIIS-REST-API] Container setup: Core dependencies registered successfully');

            // Initialize DatabaseService first (required by other services)
            const databaseService = new DatabaseService(node);
            await databaseService.initialize();
            Container.set(DatabaseService, databaseService);

            // Register DataSource for services that need direct access
            // This fixes the "DataSource not found in container" error
            const dataSource = databaseService.getDataSource();
            Container.set(DataSource, dataSource);

            // Create service context for base services
            const serviceContext: ServiceContext = {
                node,
                databaseService,
                configManager
            };
            Container.set(SERVICE_CONTEXT_TOKEN, serviceContext);

            // BACKWARD COMPATIBILITY: Also register serviceContext with string identifier
            // This ensures existing services using @Inject('serviceContext') still work
            Container.set('serviceContext', serviceContext);

            // Register services that need manual initialization
            // These services will be automatically injected into controllers and other services
            await this.registerCoreServices(databaseService, jwtSecret, node, configManager, serviceContext);

            // Register validators (these are stateless and can be singletons)
            this.registerValidators();

            // Register middleware (these need specific dependencies)
            await this.registerMiddleware(node);

            // Controllers are automatically registered by routing-controllers
            // They will be instantiated by TypeDI when needed with proper dependency injection

            this.isInitialized = true;
        } catch (error) {
            throw new Error(`Failed to initialize container: ${(error as Error).message}`);
        }
    }

    /**
     * Register core services with proper dependency injection
     */
    private static async registerCoreServices(
        databaseService: DatabaseService,
        jwtSecret: string,
        node: Node,
        configManager: ApiConfigManager,
        serviceContext: ServiceContext
    ): Promise<void> {
        // Register AuthService with proper dependencies
        const authService = new AuthService(databaseService, jwtSecret, node, configManager);
        await authService.initialize();
        Container.set(AuthService, authService);

        // Register ScheduleLogService
        const scheduleLogService = new ScheduleLogService(serviceContext);
        await scheduleLogService.initialize();
        Container.set(ScheduleLogService, scheduleLogService);

        // Register NotificationService
        const notificationService = new NotificationService(serviceContext, databaseService);
        await notificationService.initialize();
        Container.set(NotificationService, notificationService);

        // Register ScheduleCompletionMonitorService
        // DISABLED: Automatic schedule monitoring causes continuous MQTT publishing
        // To enable, uncomment the following lines
        const scheduleCompletionMonitor = new ScheduleCompletionMonitorService(
            serviceContext,
            databaseService,
            notificationService
        );
        // await scheduleCompletionMonitor.initialize(); // ← DISABLED: This starts the 5-second interval
        Container.set(ScheduleCompletionMonitorService, scheduleCompletionMonitor);

        // Register ScheduleActivationService
        const scheduleActivationService = new ScheduleActivationService(
            serviceContext,
            scheduleLogService,
            notificationService,
            databaseService,
            scheduleCompletionMonitor
        );
        await scheduleActivationService.initialize();
        Container.set(ScheduleActivationService, scheduleActivationService);

        // Register ThingsBoardService with proper initialization
        // This service needs to be manually initialized to ensure MQTT client is set up
        const { ThingsBoardService } = await import('../services/thingsboard.service');
        const thingsBoardService = new ThingsBoardService(serviceContext, scheduleActivationService);
        await thingsBoardService.initialize();
        Container.set(ThingsBoardService, thingsBoardService);

        // Register MarineTelemetryService
        const dataSource = databaseService.getDataSource();
        const marineTelemetryService = new MarineTelemetryService(dataSource);
        Container.set(MarineTelemetryService, marineTelemetryService);

        // Register MarineWebSocketService (will be initialized later with HTTP server)
        const marineWebSocketService = new MarineWebSocketService(
            marineTelemetryService,
            authService,
            node
        );
        Container.set(MarineWebSocketService, marineWebSocketService);

        // Note: DeviceService is decorated with @Service()
        // It will be automatically instantiated by TypeDI when needed
    }

    /**
     * Register validators (stateless singletons)
     */
    private static registerValidators(): void {
        Container.set(AuthValidator, new AuthValidator());
        Container.set(UserValidator, new UserValidator());
        // DeviceValidator will be auto-registered when needed due to @Service() decorator
    }

    /**
     * Register middleware with specific dependencies
     */
    private static async registerMiddleware(node: Node): Promise<void> {
        // AuthMiddleware needs AuthService - get it from container
        const authService = Container.get(AuthService);
        Container.set(AuthMiddleware, new AuthMiddleware(authService, node));

        // ValidationMiddleware is simple
        Container.set(ValidationMiddleware, new ValidationMiddleware(node));
    }

    /**
     * Get a service instance from the container
     * This is the proper way to retrieve services instead of manual Container.get()
     */
    static getService<T>(serviceClass: new (...args: any[]) => T): T {
        if (!this.isInitialized) {
            throw new Error('Container not initialized. Call ContainerSetup.initialize() first.');
        }
        return Container.get(serviceClass);
    }

    /**
     * Get a service instance by token
     */
    static getServiceByToken<T>(token: Token<T>): T {
        if (!this.isInitialized) {
            throw new Error('Container not initialized. Call ContainerSetup.initialize() first.');
        }
        return Container.get(token);
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
