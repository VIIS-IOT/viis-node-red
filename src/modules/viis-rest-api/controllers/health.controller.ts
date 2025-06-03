/**
 * @fileoverview Health check controller
 */

import { Request, Response } from 'express';
import { BaseController } from './base.controller';
import { DatabaseService } from '../services/database.service';
import { RouteDefinition } from '../types/common.types';
import { Node } from 'node-red';

/**
 * Health check controller class
 */
export class HealthController extends BaseController {
    private databaseService: DatabaseService;

    constructor(databaseService: DatabaseService, node: Node) {
        super(node);
        this.databaseService = databaseService;
    }

    /**
     * Get route definitions for health endpoints
     */
    getRoutes(): RouteDefinition[] {
        return [
            {
                method: 'GET',
                path: '/health',
                handler: 'getHealth'
            },
            {
                method: 'GET',
                path: '/health/detailed',
                handler: 'getDetailedHealth',
                middleware: ['auth', 'admin']
            }
        ];
    }

    /**
     * Basic health check endpoint
     */
    getHealth = this.asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const isDbConnected = this.databaseService.isInitialized();
        
        const healthStatus = {
            status: isDbConnected ? "ok" : "error",
            timestamp: new Date().toISOString(),
            services: {
                database: isDbConnected ? "connected" : "disconnected",
                api: "running"
            }
        };

        const statusCode = isDbConnected ? 200 : 503;
        this.success(res, healthStatus, statusCode, 'Health check completed');
    });

    /**
     * Detailed health check endpoint (admin only)
     */
    getDetailedHealth = this.asyncHandler(async (req: Request, res: Response): Promise<void> => {
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

        const detailedHealth = {
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

        const statusCode = isHealthy ? 200 : 503;
        this.success(res, detailedHealth, statusCode, 'Detailed health check completed');
    });
}
