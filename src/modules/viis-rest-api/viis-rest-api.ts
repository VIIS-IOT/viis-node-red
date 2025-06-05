/**
 * @fileoverview VIIS REST API Node for Node-RED
 * Provides REST API endpoints using Node-RED's built-in Express server
 * with TypeORM database integration
 */

import { NodeAPI, NodeDef, Node } from "node-red";
import { logger } from "./utils/logger";
import { AuthService } from "./services/auth.service";
import { ApiRoutes } from "./routes/api.routes";
import { DatabaseService } from "./services/database.service";
import { ContainerSetup } from "./container/container.setup";
import { ApiConfigManager } from "./config/api.config";
import Container from "typedi";
import "reflect-metadata";

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

        // Initialize configuration manager
        let configManager: ApiConfigManager;
        let databaseService: DatabaseService;
        let authService: AuthService;
        let apiRoutes: ApiRoutes;

        try {
            configManager = new ApiConfigManager(config, node);
        } catch (error) {
            const errorMessage = `Configuration validation failed: ${(error as Error).message}`;
            node.error(errorMessage);
            node.status({ fill: "red", shape: "ring", text: "Config error" });
            logger.error(node, errorMessage);
            return;
        }

        // Async initialization
        (async () => {
            try {
                if (!configManager.get('enabled')) {
                    node.status({ fill: "yellow", shape: "ring", text: "API disabled" });
                    logger.info(node, "VIIS REST API is disabled");
                    return;
                }

                node.status({ fill: "yellow", shape: "dot", text: "Initializing..." });
                logger.info(node, "Initializing VIIS REST API...");

                // Initialize TypeDI container with all dependencies
                await ContainerSetup.initialize({
                    node,
                    jwtSecret: configManager.get('jwtSecret'),
                    configManager
                });
                logger.info(node, "TypeDI container initialized");

                // Get services from container
                databaseService = Container.get(DatabaseService);
                authService = Container.get(AuthService);
                logger.info(node, "Services resolved from container");

                // Initialize and register API routes
                apiRoutes = new ApiRoutes(databaseService, authService, node, configManager);
                await apiRoutes.registerRoutes(RED, configManager.getAll());
                logger.info(node, `API routes registered with prefix: ${configManager.get('apiPrefix')}`);

                node.status({ fill: "green", shape: "dot", text: "API server running" });
                logger.info(node, `✅ VIIS REST API server is running on ${configManager.get('apiPrefix')}`);

                // Log development features if enabled
                if (configManager.isEnabled('enableDebugMode')) {
                    logger.info(node, `🔧 Development mode enabled - Debug routes available at ${configManager.get('apiPrefix')}/debug/*`);
                }

            } catch (error) {
                const errorMessage = `Failed to initialize VIIS REST API: ${(error as Error).message}`;
                node.error(errorMessage);
                node.status({ fill: "red", shape: "ring", text: "Initialization failed" });
                logger.error(node, errorMessage, { stack: (error as Error).stack });
            }
        })();

        // Cleanup on node removal
        node.on('close', async (done: () => void) => {
            try {
                logger.info(node, "Shutting down VIIS REST API...");

                // Cleanup services
                if (authService) {
                    await authService.cleanup();
                }
                if (databaseService) {
                    await databaseService.cleanup();
                }

                // Reset TypeDI container to prevent memory leaks
                ContainerSetup.reset();

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
