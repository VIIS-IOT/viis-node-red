/**
 * @fileoverview Simplified API Routes for VIIS REST API
 * Registers all API endpoints with Node-RED's Express server
 * 
 * Note: Using 'any' types to avoid TypeScript conflicts with Node-RED's Express interface
 */

import { NodeAPI, Node } from 'node-red';
import { DatabaseService } from '../services/databaseService';
import { AuthService, LoginRequest } from '../services/authService';
import { logger } from '../utils/logger';

// Use require for body-parser
const bodyParser = require('body-parser');

/**
 * Simplified API routes class for registering all endpoints
 */
export class SimpleApiRoutes {
    private databaseService: DatabaseService;
    private authService: AuthService;
    private node: Node;

    /**
     * Creates a new API routes instance
     * @param databaseService - Database service
     * @param authService - Authentication service
     * @param node - Node-RED node instance for logging
     */
    constructor(databaseService: DatabaseService, authService: AuthService, node: Node) {
        this.databaseService = databaseService;
        this.authService = authService;
        this.node = node;
    }

    /**
     * Register all API routes with Node-RED's Express server
     * @param RED - Node-RED API
     * @param config - API configuration
     */
    async registerRoutes(RED: NodeAPI, config: any): Promise<void> {
        try {
            // Parse JSON bodies
            RED.httpNode.use(config.apiPrefix, bodyParser.json({ limit: '10mb' }));
            RED.httpNode.use(config.apiPrefix, bodyParser.urlencoded({ extended: true, limit: '10mb' }));

            // Register authentication routes
            this.registerAuthRoutes(RED, config);

            // Register user management routes
            this.registerUserRoutes(RED, config);

            // Register health check route
            this.registerHealthRoutes(RED, config);

            logger.info(this.node, `All API routes registered successfully`);

        } catch (error) {
            logger.error(this.node, `Failed to register API routes: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Register authentication routes
     */
    private registerAuthRoutes(RED: NodeAPI, config: any): void {
        // POST /api/v2/auth/login
        RED.httpNode.post(`${config.apiPrefix}/auth/login`, async (req: any, res: any) => {
            try {
                const loginData: LoginRequest = req.body;

                // Validate input
                if (!loginData.usr || !loginData.pwd) {
                    return res.status(400).json({
                        error: "Bad Request",
                        message: "Username and password are required",
                        details: {
                            usr: loginData?.usr ? "provided" : "missing",
                            pwd: loginData?.pwd ? "provided" : "missing"
                        }
                    });
                }

                // Authenticate user
                const loginResponse = await this.authService.login(loginData);

                logger.info(this.node, `✅ Login successful for user: ${loginData.usr}`);
                res.status(200).json(loginResponse);

            } catch (error) {
                logger.error(this.node, `Login failed: ${(error as Error).message}`);
                res.status(401).json({
                    error: "Unauthorized",
                    message: (error as Error).message
                });
            }
        });

        // GET /api/v2/auth/verify
        RED.httpNode.get(`${config.apiPrefix}/auth/verify`, async (req: any, res: any) => {
            try {
                const authHeader = req.headers.authorization;
                
                if (!authHeader || !authHeader.startsWith('Bearer ')) {
                    return res.status(401).json({
                        error: 'Unauthorized',
                        message: 'Authorization header with Bearer token required'
                    });
                }

                const token = authHeader.substring(7); // Remove 'Bearer ' prefix
                
                // Verify token
                const decoded = await this.authService.verifyToken(token);

                res.status(200).json({
                    valid: true,
                    user: {
                        user_id: decoded.user_id,
                        email: decoded.email,
                        customer_id: decoded.customer_id,
                        is_admin: decoded.is_admin,
                        iot_dynamic_role: decoded.iot_dynamic_role
                    }
                });
            } catch (error) {
                logger.error(this.node, `Token verification error: ${(error as Error).message}`);
                res.status(401).json({
                    error: "Unauthorized",
                    message: "Invalid or expired token"
                });
            }
        });

        logger.info(this.node, "Authentication routes registered");
    }

    /**
     * Register user management routes
     */
    private registerUserRoutes(RED: NodeAPI, config: any): void {
        // GET /api/v2/users/me - Get current user info
        RED.httpNode.get(`${config.apiPrefix}/users/me`, async (req: any, res: any) => {
            try {
                const authHeader = req.headers.authorization;
                
                if (!authHeader || !authHeader.startsWith('Bearer ')) {
                    return res.status(401).json({
                        error: 'Unauthorized',
                        message: 'Authorization header with Bearer token required'
                    });
                }

                const token = authHeader.substring(7);
                const decoded = await this.authService.verifyToken(token);

                const userRepo = this.databaseService.getCustomerUserRepository();
                const user = await userRepo.findOne({
                    where: { name: decoded.user_id },
                    relations: ['iot_customer'],
                    select: ['name', 'first_name', 'last_name', 'email', 'customer_id', 'is_admin', 'iot_dynamic_role', 'phone_number']
                });

                if (!user) {
                    return res.status(404).json({
                        error: "Not Found",
                        message: "User not found"
                    });
                }

                res.status(200).json({
                    result: user
                });
            } catch (error) {
                logger.error(this.node, `Get current user error: ${(error as Error).message}`);
                res.status(500).json({
                    error: "Internal Server Error",
                    message: "Failed to retrieve user information"
                });
            }
        });

        logger.info(this.node, "User management routes registered");
    }

    /**
     * Register health check routes
     */
    private registerHealthRoutes(RED: NodeAPI, config: any): void {
        // GET /api/v2/health - Health check endpoint
        RED.httpNode.get(`${config.apiPrefix}/health`, async (_req: any, res: any) => {
            try {
                const isDbConnected = this.databaseService.isInitialized();
                
                res.status(200).json({
                    status: "ok",
                    timestamp: new Date().toISOString(),
                    services: {
                        database: isDbConnected ? "connected" : "disconnected",
                        api: "running"
                    }
                });
            } catch (error) {
                res.status(503).json({
                    status: "error",
                    timestamp: new Date().toISOString(),
                    error: (error as Error).message
                });
            }
        });

        logger.info(this.node, "Health check routes registered");
    }
}
