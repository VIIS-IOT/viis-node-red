/**
 * @fileoverview VIIS REST API Node for Node-RED
 * Provides REST API endpoints using Node-RED's built-in Express server
 * with TypeORM database integration
 */

import { NodeAPI, NodeDef, Node } from "node-red";
import { logger } from "./utils/logger";
import { DatabaseService } from "./services/databaseService";
import { AuthService } from "./services/authService";
import { ApiRoutes } from "./routes/api.routes";

/**
 * Configuration interface for VIIS REST API node
 */
interface ViisRestApiNodeDef extends NodeDef {
    /** Enable/disable the REST API server */
    enabled: boolean;
    /** API base path prefix */
    apiPrefix: string;
    /** Enable detailed logging */
    enableLogging: boolean;
    /** Enable CORS */
    enableCors: boolean;
    /** JWT secret key */
    jwtSecret: string;
    /** API rate limiting */
    enableRateLimit: boolean;
    /** Maximum requests per minute */
    maxRequestsPerMinute: number;
}

/**
 * VIIS REST API Node implementation
 */
export = function (RED: NodeAPI) {
    /**
     * VIIS REST API Node constructor
     */
    function ViisRestApiNode(this: Node, config: ViisRestApiNodeDef) {
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
        let databaseService: DatabaseService;
        let authService: AuthService;
        let apiRoutes: ApiRoutes;

        // Async initialization
        (async () => {
            try {
                if (!apiConfig.enabled) {
                    node.status({ fill: "yellow", shape: "ring", text: "API disabled" });
                    logger.info(node, "VIIS REST API is disabled");
                    return;
                }

                node.status({ fill: "yellow", shape: "dot", text: "Initializing..." });
                logger.info(node, "Initializing VIIS REST API...");

                // Initialize database service
                databaseService = new DatabaseService(node);
                await databaseService.initialize();
                logger.info(node, "Database service initialized");

                // Initialize auth service
                authService = new AuthService(databaseService, apiConfig.jwtSecret, node);
                logger.info(node, "Auth service initialized");

                // Initialize and register API routes
                apiRoutes = new ApiRoutes(databaseService, authService, node);
                await apiRoutes.registerRoutes(RED, apiConfig);
                logger.info(node, `API routes registered with prefix: ${apiConfig.apiPrefix}`);

                node.status({ fill: "green", shape: "dot", text: "API server running" });
                logger.info(node, `✅ VIIS REST API server is running on ${apiConfig.apiPrefix}`);

            } catch (error) {
                const errorMessage = `Failed to initialize VIIS REST API: ${(error as Error).message}`;
                node.error(errorMessage);
                node.status({ fill: "red", shape: "ring", text: "Initialization failed" });
                logger.error(node, errorMessage);
            }
        })();

        // Cleanup on node removal
        node.on('close', async (done) => {
            try {
                logger.info(node, "Shutting down VIIS REST API...");

                // Cleanup database connections
                if (databaseService) {
                    await databaseService.cleanup();
                }

                // Remove registered routes (Node-RED handles this automatically)
                logger.info(node, "VIIS REST API shutdown complete");
                done();
            } catch (error) {
                logger.error(node, `Error during shutdown: ${(error as Error).message}`);
                done();
            }
        });
    }

    // Register the node type
    RED.nodes.registerType("viis-rest-api", ViisRestApiNode);
};
