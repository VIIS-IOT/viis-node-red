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
module.exports = function (RED) {
    /**
     * VIIS REST API Node constructor
     */
    function ViisRestApiNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        // Configuration with defaults
        const apiConfig = {
            enabled: config.enabled !== false,
            apiPrefix: config.apiPrefix || '/api/v2',
            enableLogging: config.enableLogging !== false,
            enableCors: config.enableCors !== false,
            jwtSecret: config.jwtSecret || process.env.JWT_SECRET || 'viis-iot-secret-key-2024',
            enableRateLimit: config.enableRateLimit !== false,
            maxRequestsPerMinute: config.maxRequestsPerMinute || 100
        };
        // Initialize services
        let databaseService;
        let authService;
        let apiRoutes;
        // Async initialization
        (async () => {
            try {
                if (!apiConfig.enabled) {
                    node.status({ fill: "yellow", shape: "ring", text: "API disabled" });
                    logger_1.logger.info(node, "VIIS REST API is disabled");
                    return;
                }
                node.status({ fill: "yellow", shape: "dot", text: "Initializing..." });
                logger_1.logger.info(node, "Initializing VIIS REST API...");
                // Initialize database service
                databaseService = new database_service_1.DatabaseService(node);
                await databaseService.initialize();
                logger_1.logger.info(node, "Database service initialized");
                // Initialize auth service
                authService = new auth_service_1.AuthService(databaseService, apiConfig.jwtSecret, node);
                await authService.initialize();
                logger_1.logger.info(node, "Auth service initialized");
                // Initialize and register API routes
                apiRoutes = new api_routes_1.ApiRoutes(databaseService, authService, node);
                await apiRoutes.registerRoutes(RED, apiConfig);
                logger_1.logger.info(node, `API routes registered with prefix: ${apiConfig.apiPrefix}`);
                node.status({ fill: "green", shape: "dot", text: "API server running" });
                logger_1.logger.info(node, `✅ VIIS REST API server is running on ${apiConfig.apiPrefix}`);
            }
            catch (error) {
                const errorMessage = `Failed to initialize VIIS REST API: ${error.message}`;
                node.error(errorMessage);
                node.status({ fill: "red", shape: "ring", text: "Initialization failed" });
                logger_1.logger.error(node, errorMessage);
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
