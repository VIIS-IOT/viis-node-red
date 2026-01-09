"use strict";
/**
 * @fileoverview VIIS REST API Node for Node-RED
 * Provides REST API endpoints using Node-RED's built-in Express server
 * with TypeORM database integration
 */
const logger_1 = require("./utils/logger");
const auth_service_1 = require("./services/auth.service");
const api_routes_1 = require("./routes/api.routes");
const database_service_1 = require("./services/database.service");
const default_user_seed_service_1 = require("./services/default-user-seed.service");
const marine_websocket_service_1 = require("./services/marine-websocket.service");
const viis_rest_api_trip_integration_1 = require("./viis-rest-api-trip-integration");
const container_setup_1 = require("./container/container.setup");
const api_config_1 = require("./config/api.config");
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
        let marineWebSocketService = null;
        let tripIntegrationManager = null;
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
                // Get services using proper dependency injection
                databaseService = container_setup_1.ContainerSetup.getService(database_service_1.DatabaseService);
                authService = container_setup_1.ContainerSetup.getService(auth_service_1.AuthService);
                logger_1.logger.info(node, "Services resolved from container using proper DI");
                // Seed default admin user if not exists
                try {
                    const seedService = new default_user_seed_service_1.DefaultUserSeedService(databaseService, node);
                    await seedService.seedDefaultUser();
                }
                catch (error) {
                    logger_1.logger.warn(node, `Failed to seed default user: ${error.message}`);
                    // Continue execution even if seeding fails
                }
                // Initialize and register API routes
                apiRoutes = new api_routes_1.ApiRoutes(databaseService, authService, node, configManager);
                await apiRoutes.registerRoutes(RED, configManager.getAll());
                logger_1.logger.info(node, `API routes registered with prefix: ${configManager.get('apiPrefix')}`);
                // Initialize WebSocket for Marine IoT real-time telemetry
                try {
                    marineWebSocketService = container_setup_1.ContainerSetup.getService(marine_websocket_service_1.MarineWebSocketService);
                    // Access Node-RED's HTTP server
                    const httpServer = RED.server;
                    if (httpServer) {
                        await marineWebSocketService.initializeWithServer(httpServer);
                        logger_1.logger.info(node, "🌐 WebSocket service initialized for Marine IoT real-time telemetry");
                    }
                    else {
                        logger_1.logger.warn(node, "HTTP server not found - WebSocket disabled");
                    }
                }
                catch (error) {
                    logger_1.logger.warn(node, `Failed to initialize WebSocket: ${error.message}`);
                    // Continue without WebSocket - REST API still works
                }
                // Initialize Trip Accumulation Worker
                try {
                    const dataSource = await databaseService.getDataSource();
                    tripIntegrationManager = new viis_rest_api_trip_integration_1.TripIntegrationManager(dataSource, node);
                    await tripIntegrationManager.initialize();
                    logger_1.logger.info(node, "🚢 Trip accumulation worker started");
                }
                catch (error) {
                    logger_1.logger.warn(node, `Failed to initialize trip worker: ${error.message}`);
                    // Continue without trip worker - REST API still works
                }
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
                if (tripIntegrationManager) {
                    await tripIntegrationManager.cleanup();
                }
                if (marineWebSocketService) {
                    await marineWebSocketService.cleanup();
                }
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
