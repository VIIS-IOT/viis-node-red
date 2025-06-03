/**
 * @fileoverview API Routes for VIIS REST API
 * Registers all API endpoints with Node-RED's Express server
 */

import { NodeAPI, Node } from 'node-red';
import { Request, Response } from 'express';
import { DatabaseService } from '../services/databaseService';
import { AuthService, LoginRequest } from '../services/authService';
import { ApiMiddleware, AuthenticatedRequest, ApiConfig } from '../middleware/apiMiddleware';
import { logger } from '../utils/logger';

/**
 * API routes class for registering all endpoints
 */
export class ApiRoutes {
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
     * @param middleware - API middleware instance
     */
    async registerRoutes(RED: NodeAPI, config: ApiConfig, middleware: ApiMiddleware): Promise<void> {
        try {
            // Apply global middleware
            RED.httpNode.use(config.apiPrefix, middleware.getCorsMiddleware());
            RED.httpNode.use(config.apiPrefix, middleware.getSecurityMiddleware());
            RED.httpNode.use(config.apiPrefix, middleware.getCompressionMiddleware());
            RED.httpNode.use(config.apiPrefix, middleware.getRateLimitMiddleware());
            RED.httpNode.use(config.apiPrefix, middleware.getLoggingMiddleware());

            // Parse JSON bodies
            RED.httpNode.use(config.apiPrefix, RED.httpNode.json({ limit: '10mb' }));
            RED.httpNode.use(config.apiPrefix, RED.httpNode.urlencoded({ extended: true, limit: '10mb' }));

            // Store node reference for middleware
            RED.httpNode.use(config.apiPrefix, (req: any, res: any, next: any) => {
                req.app.locals.node = this.node;
                next();
            });

            // Register authentication routes
            this.registerAuthRoutes(RED, config, middleware);

            // Register user management routes
            this.registerUserRoutes(RED, config, middleware);

            // Register device routes
            this.registerDeviceRoutes(RED, config, middleware);

            // Register telemetry routes
            this.registerTelemetryRoutes(RED, config, middleware);

            // Register health check route
            this.registerHealthRoutes(RED, config);

            // Apply error handling middleware last
            RED.httpNode.use(config.apiPrefix, middleware.getErrorHandlingMiddleware());

            logger.info(this.node, `All API routes registered successfully`);

        } catch (error) {
            logger.error(this.node, `Failed to register API routes: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Register authentication routes
     */
    private registerAuthRoutes(RED: NodeAPI, config: ApiConfig, middleware: ApiMiddleware): void {
        // POST /api/v2/auth/login
        RED.httpNode.post(`${config.apiPrefix}/auth/login`, async (req: Request, res: Response) => {
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

        // POST /api/v2/auth/logout
        RED.httpNode.post(`${config.apiPrefix}/auth/logout`, middleware.getAuthMiddleware(), 
            async (req: AuthenticatedRequest, res: Response) => {
                try {
                    // In a stateless JWT system, logout is handled client-side
                    // But we can log the logout event
                    logger.info(this.node, `User logged out: ${req.user?.user_id}`);
                    
                    res.status(200).json({
                        message: "Logout successful"
                    });
                } catch (error) {
                    logger.error(this.node, `Logout error: ${(error as Error).message}`);
                    res.status(500).json({
                        error: "Internal Server Error",
                        message: "Logout failed"
                    });
                }
            }
        );

        // GET /api/v2/auth/verify
        RED.httpNode.get(`${config.apiPrefix}/auth/verify`, middleware.getAuthMiddleware(),
            async (req: AuthenticatedRequest, res: Response) => {
                try {
                    res.status(200).json({
                        valid: true,
                        user: {
                            user_id: req.user?.user_id,
                            email: req.user?.email,
                            customer_id: req.user?.customer_id,
                            is_admin: req.user?.is_admin,
                            iot_dynamic_role: req.user?.iot_dynamic_role
                        }
                    });
                } catch (error) {
                    logger.error(this.node, `Token verification error: ${(error as Error).message}`);
                    res.status(500).json({
                        error: "Internal Server Error",
                        message: "Token verification failed"
                    });
                }
            }
        );

        logger.info(this.node, "Authentication routes registered");
    }

    /**
     * Register user management routes
     */
    private registerUserRoutes(RED: NodeAPI, config: ApiConfig, middleware: ApiMiddleware): void {
        // GET /api/v2/users - Get all users (admin only)
        RED.httpNode.get(`${config.apiPrefix}/users`, 
            middleware.getAuthMiddleware(),
            middleware.getAdminMiddleware(),
            async (req: AuthenticatedRequest, res: Response) => {
                try {
                    const userRepo = this.databaseService.getCustomerUserRepository();
                    const users = await userRepo.find({
                        relations: ['iot_customer'],
                        select: ['name', 'first_name', 'last_name', 'email', 'customer_id', 'is_admin', 'iot_dynamic_role', 'is_deactivated']
                    });

                    res.status(200).json({
                        result: {
                            data: users,
                            count: users.length
                        }
                    });
                } catch (error) {
                    logger.error(this.node, `Get users error: ${(error as Error).message}`);
                    res.status(500).json({
                        error: "Internal Server Error",
                        message: "Failed to retrieve users"
                    });
                }
            }
        );

        // GET /api/v2/users/me - Get current user info
        RED.httpNode.get(`${config.apiPrefix}/users/me`, middleware.getAuthMiddleware(),
            async (req: AuthenticatedRequest, res: Response) => {
                try {
                    const userRepo = this.databaseService.getCustomerUserRepository();
                    const user = await userRepo.findOne({
                        where: { name: req.user?.user_id },
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
            }
        );

        logger.info(this.node, "User management routes registered");
    }

    /**
     * Register device routes
     */
    private registerDeviceRoutes(RED: NodeAPI, config: ApiConfig, middleware: ApiMiddleware): void {
        // GET /api/v2/devices - Get devices for current user's customer
        RED.httpNode.get(`${config.apiPrefix}/devices`, 
            middleware.getAuthMiddleware(),
            middleware.getCustomerAccessMiddleware(),
            async (req: AuthenticatedRequest, res: Response) => {
                try {
                    const deviceRepo = this.databaseService.getDeviceRepository();
                    const customerId = req.query.customer_id || req.user?.customer_id;

                    const devices = await deviceRepo.find({
                        where: { customer_id: customerId as string },
                        select: ['id', 'name', 'label', 'type', 'customer_id', 'is_gateway', 'additional_info']
                    });

                    res.status(200).json({
                        result: {
                            data: devices,
                            count: devices.length
                        }
                    });
                } catch (error) {
                    logger.error(this.node, `Get devices error: ${(error as Error).message}`);
                    res.status(500).json({
                        error: "Internal Server Error",
                        message: "Failed to retrieve devices"
                    });
                }
            }
        );

        logger.info(this.node, "Device routes registered");
    }

    /**
     * Register telemetry routes
     */
    private registerTelemetryRoutes(RED: NodeAPI, config: ApiConfig, middleware: ApiMiddleware): void {
        // GET /api/v2/telemetry/latest/:deviceId - Get latest telemetry for device
        RED.httpNode.get(`${config.apiPrefix}/telemetry/latest/:deviceId`, 
            middleware.getAuthMiddleware(),
            async (req: AuthenticatedRequest, res: Response) => {
                try {
                    const deviceId = req.params.deviceId;
                    const telemetryRepo = this.databaseService.getDeviceTelemetryLatestRepository();

                    const latestTelemetry = await telemetryRepo.find({
                        where: { device_id: deviceId },
                        order: { ts: 'DESC' },
                        take: 100
                    });

                    res.status(200).json({
                        result: {
                            data: latestTelemetry,
                            count: latestTelemetry.length
                        }
                    });
                } catch (error) {
                    logger.error(this.node, `Get latest telemetry error: ${(error as Error).message}`);
                    res.status(500).json({
                        error: "Internal Server Error",
                        message: "Failed to retrieve telemetry data"
                    });
                }
            }
        );

        logger.info(this.node, "Telemetry routes registered");
    }

    /**
     * Register health check routes
     */
    private registerHealthRoutes(RED: NodeAPI, config: ApiConfig): void {
        // GET /api/v2/health - Health check endpoint
        RED.httpNode.get(`${config.apiPrefix}/health`, async (req: Request, res: Response) => {
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
