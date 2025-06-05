"use strict";
/**
 * @fileoverview TypeDI Container setup for VIIS REST API
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContainerSetup = void 0;
const typedi_1 = __importDefault(require("typedi"));
const database_service_1 = require("../services/database.service");
const auth_service_1 = require("../services/auth.service");
const auth_validator_1 = require("../validators/auth.validator");
const user_validator_1 = require("../validators/user.validator");
const auth_middleware_1 = require("../middleware/auth.middleware");
const validation_middleware_1 = require("../middleware/validation.middleware");
require("reflect-metadata");
/**
 * Setup TypeDI container with all services and dependencies
 */
class ContainerSetup {
    /**
     * Initialize the container with all dependencies
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
            // Register core instances
            typedi_1.default.set("node", node);
            typedi_1.default.set("jwtSecret", jwtSecret);
            typedi_1.default.set("configManager", configManager);
            // Log successful registration for debugging
            console.log('[VIIS-REST-API] Container setup: Core dependencies registered successfully');
            // Initialize and register DatabaseService
            const databaseService = new database_service_1.DatabaseService(node);
            await databaseService.initialize();
            typedi_1.default.set(database_service_1.DatabaseService, databaseService);
            // Create service context for base services
            const serviceContext = {
                node,
                databaseService,
                configManager
            };
            typedi_1.default.set("serviceContext", serviceContext);
            // Initialize and register AuthService
            const authService = new auth_service_1.AuthService(databaseService, jwtSecret, node, configManager);
            await authService.initialize();
            typedi_1.default.set(auth_service_1.AuthService, authService);
            // Register validators
            typedi_1.default.set(auth_validator_1.AuthValidator, new auth_validator_1.AuthValidator());
            typedi_1.default.set(user_validator_1.UserValidator, new user_validator_1.UserValidator());
            // Register middleware
            typedi_1.default.set(auth_middleware_1.AuthMiddleware, new auth_middleware_1.AuthMiddleware(authService, node));
            typedi_1.default.set(validation_middleware_1.ValidationMiddleware, new validation_middleware_1.ValidationMiddleware(node));
            // Register controllers - TypeDI will handle dependency injection automatically
            // Note: Controllers will be instantiated by TypeDI when requested via Container.get()
            // The @Controller decorator and @Inject decorators handle the dependency resolution
            this.isInitialized = true;
        }
        catch (error) {
            throw new Error(`Failed to initialize container: ${error.message}`);
        }
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
