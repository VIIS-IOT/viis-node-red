/**
 * @fileoverview Health check controller - Migrated to routing-controllers
 */

import 'reflect-metadata';
import { JsonController, Get, Authorized } from 'routing-controllers';
import { Service, Inject } from 'typedi';
import { DatabaseService } from '../services/database.service';
import { Node } from 'node-red';
import { logger } from '../utils/logger';
import { NODE_TOKEN } from '../container/container.setup';

/**
 * Health check response interface
 */
interface HealthResponse {
    status: 'ok' | 'error';
    timestamp: string;
    services: {
        database: string;
        api: string;
    };
}

/**
 * Detailed health check response interface
 */
interface DetailedHealthResponse {
    status: 'ok' | 'error';
    timestamp: string;
    responseTime: string;
    services: {
        api: {
            status: string;
            uptime: number;
            memory: NodeJS.MemoryUsage;
            nodeVersion: string;
        };
        database: {
            status: string;
            responseTime: string;
            error: string | null;
            tables: Record<string, boolean>;
        };
    };
    environment: {
        nodeEnv: string;
        platform: string;
        arch: string;
    };
}

/**
 * Health check controller class - Migrated to routing-controllers
 *
 * Provides system health monitoring endpoints:
 * - Basic health status for load balancers
 * - Detailed health information for administrators
 * - Database connectivity checks
 */
@JsonController('/health')
@Service()
export class HealthController {
    constructor(
        @Inject() private databaseService: DatabaseService,
        @Inject(NODE_TOKEN) private node: Node
    ) {
        logger.info(this.node, 'HealthController initialized with routing-controllers');
    }

    /**
     * Basic health check endpoint
     * GET /api/v2/health
     */
    @Get('/')
    async getHealth(): Promise<HealthResponse> {
        const isDbConnected = this.databaseService.isInitialized();

        const healthStatus: HealthResponse = {
            status: isDbConnected ? "ok" : "error",
            timestamp: new Date().toISOString(),
            services: {
                database: isDbConnected ? "connected" : "disconnected",
                api: "running"
            }
        };

        logger.debug(this.node, 'Health check completed', {
            status: healthStatus.status,
            dbConnected: isDbConnected
        });

        return healthStatus;
    }

    /**
     * Detailed health check endpoint (admin only)
     * GET /api/v2/health/detailed
     */
    @Get('/detailed')
    @Authorized(['admin'])
    async getDetailedHealth(): Promise<DetailedHealthResponse> {
        const startTime = Date.now();

        // Check database connection
        let dbStatus = "disconnected";
        let dbResponseTime = 0;
        let dbError = null;

        try {
            const dbStartTime = Date.now();
            await this.databaseService.query('SELECT 1 as test');
            dbResponseTime = Date.now() - dbStartTime;
            dbStatus = "connected";
        } catch (error) {
            dbError = (error as Error).message;
            dbResponseTime = Date.now() - startTime;
        }

        // Check database tables
        const tableChecks: Record<string, boolean> = {};
        try {
            const tables = [
                'tabiot_customer',
                'iot_customer_user',
                'iot_customer_user_credentials',
                'iot_dynamic_role',
                'tabiot_device',
                'tabiot_device_telemetry_latest'
            ];

            for (const table of tables) {
                try {
                    await this.databaseService.query(`SELECT 1 FROM ${table} LIMIT 1`);
                    tableChecks[table] = true;
                } catch {
                    tableChecks[table] = false;
                }
            }
        } catch (error) {
            // If we can't check tables, mark all as false
        }

        const totalResponseTime = Date.now() - startTime;
        const isHealthy = dbStatus === "connected" && Object.values(tableChecks).every(check => check);

        const detailedHealth: DetailedHealthResponse = {
            status: isHealthy ? "ok" : "error",
            timestamp: new Date().toISOString(),
            responseTime: `${totalResponseTime}ms`,
            services: {
                api: {
                    status: "running",
                    uptime: process.uptime(),
                    memory: process.memoryUsage(),
                    nodeVersion: process.version
                },
                database: {
                    status: dbStatus,
                    responseTime: `${dbResponseTime}ms`,
                    error: dbError,
                    tables: tableChecks
                }
            },
            environment: {
                nodeEnv: process.env.NODE_ENV || 'development',
                platform: process.platform,
                arch: process.arch
            }
        };

        logger.info(this.node, 'Detailed health check completed', {
            status: detailedHealth.status,
            responseTime: totalResponseTime,
            requestedBy: 'admin_user'
        });

        return detailedHealth;
    }
}
