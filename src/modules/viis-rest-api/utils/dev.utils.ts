/**
 * @fileoverview Development utilities for better debugging and development experience
 */

import { Request, Response, NextFunction } from 'express';
import { Node } from 'node-red';
import { logger } from './logger';
import { ApiConfigManager } from '../config/api.config';

/**
 * Request tracing information
 */
interface RequestTrace {
    id: string;
    method: string;
    path: string;
    startTime: number;
    ip: string;
    userAgent?: string;
    user?: any;
    body?: any;
    query?: any;
    params?: any;
}

/**
 * Performance metrics
 */
interface PerformanceMetrics {
    requestCount: number;
    averageResponseTime: number;
    slowestRequest: { path: string; duration: number };
    fastestRequest: { path: string; duration: number };
    errorCount: number;
    lastReset: number;
}

/**
 * Development utilities class
 */
export class DevUtils {
    private static instance: DevUtils;
    private node: Node;
    private configManager: ApiConfigManager;
    private requestTraces: Map<string, RequestTrace> = new Map();
    private metrics: PerformanceMetrics = {
        requestCount: 0,
        averageResponseTime: 0,
        slowestRequest: { path: '', duration: 0 },
        fastestRequest: { path: '', duration: Infinity },
        errorCount: 0,
        lastReset: Date.now()
    };

    constructor(node: Node, configManager: ApiConfigManager) {
        this.node = node;
        this.configManager = configManager;
    }

    static getInstance(node?: Node, configManager?: ApiConfigManager): DevUtils {
        if (!DevUtils.instance && node && configManager) {
            DevUtils.instance = new DevUtils(node, configManager);
        }
        return DevUtils.instance;
    }

    /**
     * Create request tracing middleware
     */
    createRequestTracingMiddleware() {
        return (req: Request, res: Response, next: NextFunction) => {
            if (!this.configManager.isEnabled('enableRequestTracing')) {
                return next();
            }

            const traceId = this.generateTraceId();
            const trace: RequestTrace = {
                id: traceId,
                method: req.method,
                path: req.path,
                startTime: Date.now(),
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                user: (req as any).user,
                body: this.sanitizeBody(req.body),
                query: req.query,
                params: req.params
            };

            // Store trace
            this.requestTraces.set(traceId, trace);

            // Add trace ID to request
            (req as any).traceId = traceId;

            // Log request start
            this.logTrace('Request started', trace);

            // Hook into response to log completion
            const originalSend = res.send;
            res.send = function(body) {
                const duration = Date.now() - trace.startTime;
                DevUtils.instance.logTrace('Request completed', {
                    ...trace,
                    duration,
                    statusCode: res.statusCode,
                    responseSize: Buffer.byteLength(body || '', 'utf8')
                });

                // Update metrics
                DevUtils.instance.updateMetrics(trace.path, duration, res.statusCode >= 400);

                // Clean up trace after some time
                setTimeout(() => {
                    DevUtils.instance.requestTraces.delete(traceId);
                }, 60000); // Keep for 1 minute

                return originalSend.call(this, body);
            };

            next();
        };
    }

    /**
     * Create performance monitoring middleware
     */
    createPerformanceMiddleware() {
        return (req: Request, res: Response, next: NextFunction) => {
            if (!this.configManager.isEnabled('enableDebugMode')) {
                return next();
            }

            const startTime = process.hrtime.bigint();

            res.on('finish', () => {
                const endTime = process.hrtime.bigint();
                const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds

                if (duration > 1000) { // Log slow requests (>1s)
                    logger.warn(this.node, `Slow request detected: ${req.method} ${req.path} (${duration.toFixed(2)}ms)`);
                }

                if (this.configManager.isEnabled('enableRequestTracing')) {
                    logger.debug(this.node, `Request performance: ${req.method} ${req.path} (${duration.toFixed(2)}ms)`);
                }
            });

            next();
        };
    }

    /**
     * Create error details middleware for development
     */
    createErrorDetailsMiddleware() {
        return (error: any, req: Request, res: Response, next: NextFunction) => {
            if (!this.configManager.isEnabled('enableDetailedErrors')) {
                return next(error);
            }

            // Add detailed error information for development
            const errorDetails = {
                message: error.message,
                stack: error.stack,
                path: req.path,
                method: req.method,
                body: this.sanitizeBody(req.body),
                query: req.query,
                params: req.params,
                headers: this.sanitizeHeaders(req.headers),
                timestamp: new Date().toISOString(),
                traceId: (req as any).traceId
            };

            logger.error(this.node, 'Detailed error information:', errorDetails);

            // Attach error details to response in development
            if (process.env.NODE_ENV !== 'production') {
                (error as any).details = errorDetails;
            }

            next(error);
        };
    }

    /**
     * Get current performance metrics
     */
    getMetrics(): PerformanceMetrics {
        return { ...this.metrics };
    }

    /**
     * Reset performance metrics
     */
    resetMetrics(): void {
        this.metrics = {
            requestCount: 0,
            averageResponseTime: 0,
            slowestRequest: { path: '', duration: 0 },
            fastestRequest: { path: '', duration: Infinity },
            errorCount: 0,
            lastReset: Date.now()
        };
        logger.info(this.node, 'Performance metrics reset');
    }

    /**
     * Get active request traces
     */
    getActiveTraces(): RequestTrace[] {
        return Array.from(this.requestTraces.values());
    }

    /**
     * Generate API documentation from routes
     */
    generateApiDocs(controllers: Map<string, any>): any {
        const docs = {
            openapi: '3.0.0',
            info: {
                title: 'VIIS REST API',
                version: '2.0.0',
                description: 'Auto-generated API documentation'
            },
            paths: {} as any
        };

        controllers.forEach((controller, name) => {
            const routes = controller.getRoutes();
            routes.forEach((route: any) => {
                const path = route.path.replace(/:(\w+)/g, '{$1}');
                if (!docs.paths[path]) {
                    docs.paths[path] = {};
                }

                docs.paths[path][route.method.toLowerCase()] = {
                    summary: `${route.method} ${path}`,
                    tags: [name],
                    parameters: this.extractParameters(route.path),
                    responses: {
                        '200': {
                            description: 'Success',
                            content: {
                                'application/json': {
                                    schema: { type: 'object' }
                                }
                            }
                        },
                        '400': { description: 'Bad Request' },
                        '401': { description: 'Unauthorized' },
                        '403': { description: 'Forbidden' },
                        '404': { description: 'Not Found' },
                        '500': { description: 'Internal Server Error' }
                    }
                };
            });
        });

        return docs;
    }

    /**
     * Create development dashboard data
     */
    getDashboardData(): any {
        return {
            metrics: this.getMetrics(),
            activeTraces: this.getActiveTraces().length,
            configuration: {
                debugMode: this.configManager.isEnabled('enableDebugMode'),
                requestTracing: this.configManager.isEnabled('enableRequestTracing'),
                detailedErrors: this.configManager.isEnabled('enableDetailedErrors'),
                apiPrefix: this.configManager.get('apiPrefix')
            },
            system: {
                nodeVersion: process.version,
                platform: process.platform,
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage()
            }
        };
    }

    private generateTraceId(): string {
        return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private sanitizeBody(body: any): any {
        if (!body) return body;
        
        const sanitized = { ...body };
        // Remove sensitive fields
        const sensitiveFields = ['password', 'pwd', 'token', 'secret', 'key'];
        sensitiveFields.forEach(field => {
            if (sanitized[field]) {
                sanitized[field] = '[REDACTED]';
            }
        });
        return sanitized;
    }

    private sanitizeHeaders(headers: any): any {
        const sanitized = { ...headers };
        // Remove sensitive headers
        const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key'];
        sensitiveHeaders.forEach(header => {
            if (sanitized[header]) {
                sanitized[header] = '[REDACTED]';
            }
        });
        return sanitized;
    }

    private logTrace(message: string, trace: any): void {
        if (this.configManager.isEnabled('enableRequestTracing')) {
            logger.debug(this.node, `[TRACE] ${message}`, trace);
        }
    }

    private updateMetrics(path: string, duration: number, isError: boolean): void {
        this.metrics.requestCount++;
        
        if (isError) {
            this.metrics.errorCount++;
        }

        // Update average response time
        this.metrics.averageResponseTime = 
            (this.metrics.averageResponseTime * (this.metrics.requestCount - 1) + duration) / 
            this.metrics.requestCount;

        // Update slowest request
        if (duration > this.metrics.slowestRequest.duration) {
            this.metrics.slowestRequest = { path, duration };
        }

        // Update fastest request
        if (duration < this.metrics.fastestRequest.duration) {
            this.metrics.fastestRequest = { path, duration };
        }
    }

    private extractParameters(path: string): any[] {
        const params: any[] = [];
        const matches = path.match(/:(\w+)/g);
        
        if (matches) {
            matches.forEach(match => {
                const paramName = match.substring(1);
                params.push({
                    name: paramName,
                    in: 'path',
                    required: true,
                    schema: { type: 'string' }
                });
            });
        }

        return params;
    }
}
