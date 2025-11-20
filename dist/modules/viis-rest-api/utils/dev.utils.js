"use strict";
/**
 * @fileoverview Development utilities for better debugging and development experience
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DevUtils = void 0;
const logger_1 = require("./logger");
/**
 * Development utilities class
 */
class DevUtils {
    constructor(node, configManager) {
        this.requestTraces = new Map();
        this.metrics = {
            requestCount: 0,
            averageResponseTime: 0,
            slowestRequest: { path: '', duration: 0 },
            fastestRequest: { path: '', duration: Infinity },
            errorCount: 0,
            lastReset: Date.now()
        };
        this.node = node;
        this.configManager = configManager;
    }
    static getInstance(node, configManager) {
        if (!DevUtils.instance && node && configManager) {
            DevUtils.instance = new DevUtils(node, configManager);
        }
        return DevUtils.instance;
    }
    /**
     * Create request tracing middleware
     */
    createRequestTracingMiddleware() {
        return (req, res, next) => {
            if (!this.configManager.isEnabled('enableRequestTracing')) {
                return next();
            }
            const traceId = this.generateTraceId();
            const trace = {
                id: traceId,
                method: req.method,
                path: req.path,
                startTime: Date.now(),
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                user: req.user,
                body: this.sanitizeBody(req.body),
                query: req.query,
                params: req.params
            };
            // Store trace
            this.requestTraces.set(traceId, trace);
            // Add trace ID to request
            req.traceId = traceId;
            // Log request start
            this.logTrace('Request started', trace);
            // Hook into response to log completion
            const originalSend = res.send;
            res.send = function (body) {
                const duration = Date.now() - trace.startTime;
                DevUtils.instance.logTrace('Request completed', Object.assign(Object.assign({}, trace), { duration, statusCode: res.statusCode, responseSize: Buffer.byteLength(body || '', 'utf8') }));
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
        return (req, res, next) => {
            if (!this.configManager.isEnabled('enableDebugMode')) {
                return next();
            }
            const startTime = process.hrtime.bigint();
            res.on('finish', () => {
                const endTime = process.hrtime.bigint();
                const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
                if (duration > 1000) { // Log slow requests (>1s)
                    logger_1.logger.warn(this.node, `Slow request detected: ${req.method} ${req.path} (${duration.toFixed(2)}ms)`);
                }
                if (this.configManager.isEnabled('enableRequestTracing')) {
                    logger_1.logger.debug(this.node, `Request performance: ${req.method} ${req.path} (${duration.toFixed(2)}ms)`);
                }
            });
            next();
        };
    }
    /**
     * Create error details middleware for development
     */
    createErrorDetailsMiddleware() {
        return (error, req, res, next) => {
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
                traceId: req.traceId
            };
            logger_1.logger.error(this.node, 'Detailed error information:', errorDetails);
            // Attach error details to response in development
            if (process.env.NODE_ENV !== 'production') {
                error.details = errorDetails;
            }
            next(error);
        };
    }
    /**
     * Get current performance metrics
     */
    getMetrics() {
        return Object.assign({}, this.metrics);
    }
    /**
     * Reset performance metrics
     */
    resetMetrics() {
        this.metrics = {
            requestCount: 0,
            averageResponseTime: 0,
            slowestRequest: { path: '', duration: 0 },
            fastestRequest: { path: '', duration: Infinity },
            errorCount: 0,
            lastReset: Date.now()
        };
        logger_1.logger.info(this.node, 'Performance metrics reset');
    }
    /**
     * Get active request traces
     */
    getActiveTraces() {
        return Array.from(this.requestTraces.values());
    }
    /**
     * Generate API documentation from routes
     */
    generateApiDocs(controllers) {
        const docs = {
            openapi: '3.0.0',
            info: {
                title: 'VIIS REST API',
                version: '2.0.0',
                description: 'Auto-generated API documentation'
            },
            paths: {}
        };
        controllers.forEach((controller, name) => {
            const routes = controller.getRoutes();
            routes.forEach((route) => {
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
    getDashboardData() {
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
    generateTraceId() {
        return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    sanitizeBody(body) {
        if (!body)
            return body;
        const sanitized = Object.assign({}, body);
        // Remove sensitive fields
        const sensitiveFields = ['password', 'pwd', 'token', 'secret', 'key'];
        sensitiveFields.forEach(field => {
            if (sanitized[field]) {
                sanitized[field] = '[REDACTED]';
            }
        });
        return sanitized;
    }
    sanitizeHeaders(headers) {
        const sanitized = Object.assign({}, headers);
        // Remove sensitive headers
        const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key'];
        sensitiveHeaders.forEach(header => {
            if (sanitized[header]) {
                sanitized[header] = '[REDACTED]';
            }
        });
        return sanitized;
    }
    logTrace(message, trace) {
        if (this.configManager.isEnabled('enableRequestTracing')) {
            logger_1.logger.debug(this.node, `[TRACE] ${message}`, trace);
        }
    }
    updateMetrics(path, duration, isError) {
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
    extractParameters(path) {
        const params = [];
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
exports.DevUtils = DevUtils;
