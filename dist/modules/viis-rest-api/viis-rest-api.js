"use strict";
/**
 * @fileoverview VIIS REST API Node for Node-RED
 * Provides REST API endpoints using Node-RED's built-in Express server
 * with TypeORM database integration
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const logger_1 = require("./utils/logger");
const auth_service_1 = require("./services/auth.service");
const api_routes_1 = require("./routes/api.routes");
const database_service_1 = require("./services/database.service");
const container_setup_1 = require("./container/container.setup");
const api_config_1 = require("./config/api.config");
const typedi_1 = __importDefault(require("typedi"));
require("reflect-metadata");
module.exports = function (RED) {
    /**
     * VIIS REST API Node constructor
     */
    function ViisRestApiNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        // Initialize configuration manager
        let configManager;
        let databaseService;
        let authService;
        let apiRoutes;
        try {
            configManager = new api_config_1.ApiConfigManager(config, node);
        }
        catch (error) {
            const errorMessage = `Configuration validation failed: ${error.message}`;
            node.error(errorMessage);
            node.status({ fill: "red", shape: "ring", text: "Config error" });
            logger_1.logger.error(node, errorMessage);
            return;
        }
        // Async initialization
        (async () => {
            try {
                if (!configManager.get('enabled')) {
                    node.status({ fill: "yellow", shape: "ring", text: "API disabled" });
                    logger_1.logger.info(node, "VIIS REST API is disabled");
                    return;
                }
                node.status({ fill: "yellow", shape: "dot", text: "Initializing..." });
                logger_1.logger.info(node, "Initializing VIIS REST API...");
                // Initialize TypeDI container with all dependencies
                await container_setup_1.ContainerSetup.initialize({
                    node,
                    jwtSecret: configManager.get('jwtSecret'),
                    configManager
                });
                logger_1.logger.info(node, "TypeDI container initialized");
                // Get services from container
                databaseService = typedi_1.default.get(database_service_1.DatabaseService);
                authService = typedi_1.default.get(auth_service_1.AuthService);
                logger_1.logger.info(node, "Services resolved from container");
                // Initialize and register API routes
                apiRoutes = new api_routes_1.ApiRoutes(databaseService, authService, node, configManager);
                await apiRoutes.registerRoutes(RED, configManager.getAll());
                logger_1.logger.info(node, `API routes registered with prefix: ${configManager.get('apiPrefix')}`);
                node.status({ fill: "green", shape: "dot", text: "API server running" });
                logger_1.logger.info(node, `✅ VIIS REST API server is running on ${configManager.get('apiPrefix')}`);
                // Log development features if enabled
                if (configManager.isEnabled('enableDebugMode')) {
                    logger_1.logger.info(node, `🔧 Development mode enabled - Debug routes available at ${configManager.get('apiPrefix')}/debug/*`);
                }
            }
            catch (error) {
                const errorMessage = `Failed to initialize VIIS REST API: ${error.message}`;
                node.error(errorMessage);
                node.status({ fill: "red", shape: "ring", text: "Initialization failed" });
                logger_1.logger.error(node, errorMessage, { stack: error.stack });
            }
        })();
        // Cleanup on node removal
        node.on('close', async (done) => {
            try {
                logger_1.logger.info(node, "Shutting down VIIS REST API...");
                // Cleanup services
                if (authService) {
                    await authService.cleanup();
                }
                if (databaseService) {
                    await databaseService.cleanup();
                }
                // Reset TypeDI container to prevent memory leaks
                container_setup_1.ContainerSetup.reset();
                // Remove registered routes (Node-RED handles this automatically)
                logger_1.logger.info(node, "VIIS REST API shutdown complete");
                done();
            }
            catch (error) {
                logger_1.logger.error(node, `Error during shutdown: ${error.message}`);
                done();
            }
        });
    }
    // Register the node type
    RED.nodes.registerType("viis-rest-api", ViisRestApiNode);
};
