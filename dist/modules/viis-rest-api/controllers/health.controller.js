"use strict";
/**
 * @fileoverview Health check controller
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthController = void 0;
const typedi_1 = require("typedi");
const base_controller_1 = require("./base.controller");
const database_service_1 = require("../services/database.service");
const controller_decorator_1 = require("../decorators/controller.decorator");
/**
 * Health check controller class
 *
 * Provides system health monitoring endpoints:
 * - Basic health status for load balancers
 * - Detailed health information for administrators
 * - Database connectivity checks
 */
let HealthController = class HealthController extends base_controller_1.BaseController {
    constructor(databaseService, node) {
        super(node);
        this.databaseService = databaseService;
        /**
         * Basic health check endpoint
         */
        this.getHealth = this.asyncHandler(async (req, res) => {
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
        this.getDetailedHealth = this.asyncHandler(async (req, res) => {
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
            }
            catch (error) {
                dbError = error.message;
                dbResponseTime = Date.now() - startTime;
            }
            // Check database tables
            const tableChecks = {};
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
                    }
                    catch (_a) {
                        tableChecks[table] = false;
                    }
                }
            }
            catch (error) {
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
    /**
     * Get route definitions for health endpoints
     */
    getRoutes() {
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
};
exports.HealthController = HealthController;
exports.HealthController = HealthController = __decorate([
    (0, controller_decorator_1.Controller)('/health'),
    __param(0, (0, typedi_1.Inject)()),
    __param(1, (0, typedi_1.Inject)('node')),
    __metadata("design:paramtypes", [database_service_1.DatabaseService, Object])
], HealthController);
