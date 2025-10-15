"use strict";
/**
 * @fileoverview TypeDI Container setup for VIIS REST API
 * Proper dependency injection configuration following TypeDI best practices
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContainerSetup = exports.SERVICE_CONTEXT_TOKEN = exports.GLOBAL_HELPER_TOKEN = exports.CONFIG_MANAGER_TOKEN = exports.JWT_SECRET_TOKEN = exports.NODE_TOKEN = void 0;
const typedi_1 = __importStar(require("typedi"));
const database_service_1 = require("../services/database.service");
const auth_service_1 = require("../services/auth.service");
const schedule_log_service_1 = require("../services/schedule-log.service");
const notification_service_1 = require("../services/notification.service");
const schedule_activation_service_1 = require("../services/schedule-activation.service");
const schedule_completion_monitor_service_1 = require("../services/schedule-completion-monitor.service");
const auth_validator_1 = require("../validators/auth.validator");
const user_validator_1 = require("../validators/user.validator");
const auth_middleware_1 = require("../middleware/auth.middleware");
const validation_middleware_1 = require("../middleware/validation.middleware");
const global_context_helper_1 = require("../../../ultils/global-context-helper");
require("reflect-metadata");
// Define tokens for primitive dependencies
exports.NODE_TOKEN = new typedi_1.Token('node');
exports.JWT_SECRET_TOKEN = new typedi_1.Token('jwtSecret');
exports.CONFIG_MANAGER_TOKEN = new typedi_1.Token('configManager');
exports.GLOBAL_HELPER_TOKEN = new typedi_1.Token('globalHelper');
exports.SERVICE_CONTEXT_TOKEN = new typedi_1.Token('serviceContext');
/**
 * Setup TypeDI container with all services and dependencies
 * Following proper dependency injection patterns
 */
class ContainerSetup {
    /**
     * Initialize the container with all dependencies using proper TypeDI patterns
     */
    static async initialize(config) {
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
            typedi_1.default.set(exports.NODE_TOKEN, node);
            typedi_1.default.set(exports.JWT_SECRET_TOKEN, jwtSecret);
            typedi_1.default.set(exports.CONFIG_MANAGER_TOKEN, configManager);
            // BACKWARD COMPATIBILITY: Also register node with string identifier
            // This ensures existing controllers using @Inject('node') still work
            typedi_1.default.set('node', node);
            // Initialize and register GlobalContextHelper
            const globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
            typedi_1.default.set(exports.GLOBAL_HELPER_TOKEN, globalHelper);
            // Log successful registration for debugging
            console.log('[VIIS-REST-API] Container setup: Core dependencies registered successfully');
            // Initialize DatabaseService first (required by other services)
            const databaseService = new database_service_1.DatabaseService(node);
            await databaseService.initialize();
            typedi_1.default.set(database_service_1.DatabaseService, databaseService);
            // Create service context for base services
            const serviceContext = {
                node,
                databaseService,
                configManager
            };
            typedi_1.default.set(exports.SERVICE_CONTEXT_TOKEN, serviceContext);
            // BACKWARD COMPATIBILITY: Also register serviceContext with string identifier
            // This ensures existing services using @Inject('serviceContext') still work
            typedi_1.default.set('serviceContext', serviceContext);
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
        }
        catch (error) {
            throw new Error(`Failed to initialize container: ${error.message}`);
        }
    }
    /**
     * Register core services with proper dependency injection
     */
    static async registerCoreServices(databaseService, jwtSecret, node, configManager, serviceContext) {
        // Register AuthService with proper dependencies
        const authService = new auth_service_1.AuthService(databaseService, jwtSecret, node, configManager);
        await authService.initialize();
        typedi_1.default.set(auth_service_1.AuthService, authService);
        // Register ScheduleLogService
        const scheduleLogService = new schedule_log_service_1.ScheduleLogService(serviceContext);
        await scheduleLogService.initialize();
        typedi_1.default.set(schedule_log_service_1.ScheduleLogService, scheduleLogService);
        // Register NotificationService
        const notificationService = new notification_service_1.NotificationService(serviceContext, databaseService);
        await notificationService.initialize();
        typedi_1.default.set(notification_service_1.NotificationService, notificationService);
        // Register ScheduleCompletionMonitorService
        // DISABLED: Automatic schedule monitoring causes continuous MQTT publishing
        // To enable, uncomment the following lines
        const scheduleCompletionMonitor = new schedule_completion_monitor_service_1.ScheduleCompletionMonitorService(serviceContext, databaseService, notificationService);
        // await scheduleCompletionMonitor.initialize(); // ← DISABLED: This starts the 5-second interval
        typedi_1.default.set(schedule_completion_monitor_service_1.ScheduleCompletionMonitorService, scheduleCompletionMonitor);
        // Register ScheduleActivationService
        const scheduleActivationService = new schedule_activation_service_1.ScheduleActivationService(serviceContext, scheduleLogService, notificationService, databaseService, scheduleCompletionMonitor);
        await scheduleActivationService.initialize();
        typedi_1.default.set(schedule_activation_service_1.ScheduleActivationService, scheduleActivationService);
        // Register ThingsBoardService with proper initialization
        // This service needs to be manually initialized to ensure MQTT client is set up
        const { ThingsBoardService } = await Promise.resolve().then(() => __importStar(require('../services/thingsboard.service')));
        const thingsBoardService = new ThingsBoardService(serviceContext, scheduleActivationService);
        await thingsBoardService.initialize();
        typedi_1.default.set(ThingsBoardService, thingsBoardService);
        // Note: DeviceService is decorated with @Service()
        // It will be automatically instantiated by TypeDI when needed
    }
    /**
     * Register validators (stateless singletons)
     */
    static registerValidators() {
        typedi_1.default.set(auth_validator_1.AuthValidator, new auth_validator_1.AuthValidator());
        typedi_1.default.set(user_validator_1.UserValidator, new user_validator_1.UserValidator());
        // DeviceValidator will be auto-registered when needed due to @Service() decorator
    }
    /**
     * Register middleware with specific dependencies
     */
    static async registerMiddleware(node) {
        // AuthMiddleware needs AuthService - get it from container
        const authService = typedi_1.default.get(auth_service_1.AuthService);
        typedi_1.default.set(auth_middleware_1.AuthMiddleware, new auth_middleware_1.AuthMiddleware(authService, node));
        // ValidationMiddleware is simple
        typedi_1.default.set(validation_middleware_1.ValidationMiddleware, new validation_middleware_1.ValidationMiddleware(node));
    }
    /**
     * Get a service instance from the container
     * This is the proper way to retrieve services instead of manual Container.get()
     */
    static getService(serviceClass) {
        if (!this.isInitialized) {
            throw new Error('Container not initialized. Call ContainerSetup.initialize() first.');
        }
        return typedi_1.default.get(serviceClass);
    }
    /**
     * Get a service instance by token
     */
    static getServiceByToken(token) {
        if (!this.isInitialized) {
            throw new Error('Container not initialized. Call ContainerSetup.initialize() first.');
        }
        return typedi_1.default.get(token);
    }
    /**
     * Reset container (useful for testing)
     */
    static reset() {
        typedi_1.default.reset();
        this.isInitialized = false;
    }
    /**
     * Check if container is initialized
     */
    static get initialized() {
        return this.isInitialized;
    }
}
exports.ContainerSetup = ContainerSetup;
ContainerSetup.isInitialized = false;
