"use strict";
/**
 * @fileoverview Resilient HTTP Service with offline support
 * Wraps HTTP calls with retry logic, circuit breaker, and graceful degradation
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResilientHttpService = void 0;
exports.createResilientHttpService = createResilientHttpService;
const axios_1 = __importDefault(require("axios"));
const global_context_helper_1 = require("../ultils/global-context-helper");
const offline_resilience_1 = require("../core/offline-resilience");
/**
 * Resilient HTTP Service with offline support
 * Ensures HTTP failures don't crash Node-RED and provides graceful degradation
 */
class ResilientHttpService {
    constructor(config = {}, nodeContext) {
        this.nodeContext = nodeContext;
        // Use GlobalContextHelper if nodeContext is available
        const helper = nodeContext ? new global_context_helper_1.GlobalContextHelper(nodeContext) : null;
        const baseURL = config.baseURL ||
            (helper ? helper.getEnvVar('API_BASE_URL', '') : (process.env.API_BASE_URL || ''));
        this.config = {
            baseURL,
            timeout: config.timeout || 10000,
            maxRetries: config.maxRetries || 3,
            retryDelay: config.retryDelay || 1000,
            circuitBreakerKey: config.circuitBreakerKey || 'backend-http',
            exponentialBackoff: config.exponentialBackoff !== false
        };
        this.circuitBreakerKey = this.config.circuitBreakerKey;
        // Create axios instance with resilient defaults
        this.axiosInstance = axios_1.default.create({
            baseURL: this.config.baseURL,
            timeout: this.config.timeout,
            headers: {
                'Content-Type': 'application/json',
            },
            // Don't throw on any status code - we'll handle it
            validateStatus: () => true
        });
        // Response interceptor for logging (but not throwing)
        this.axiosInstance.interceptors.response.use((response) => response, (error) => {
            var _a;
            // Log but don't throw - we handle errors in the methods
            console.warn(`[ResilientHttp] HTTP Error: ${error.message}`);
            return Promise.resolve(Object.assign(Object.assign({}, error.response), { data: null, status: ((_a = error.response) === null || _a === void 0 ? void 0 : _a.status) || 0, statusText: error.message }));
        });
    }
    /**
     * Execute HTTP request with retry and circuit breaker
     */
    async executeWithRetry(operation, operationName) {
        let lastError = null;
        let attempt = 0;
        while (attempt < this.config.maxRetries) {
            try {
                // Check circuit breaker
                const circuitBreaker = offline_resilience_1.ExternalServiceCircuitBreaker.getInstance();
                if (!circuitBreaker.canAttempt(this.circuitBreakerKey)) {
                    return {
                        success: false,
                        error: `Service ${this.circuitBreakerKey} is offline - circuit breaker open`,
                        isOffline: true
                    };
                }
                const response = await operation();
                // Check if response is successful (2xx status)
                if (response.status >= 200 && response.status < 300) {
                    circuitBreaker.recordSuccess(this.circuitBreakerKey);
                    return {
                        success: true,
                        data: response.data,
                        statusCode: response.status
                    };
                }
                else {
                    // Non-2xx status code
                    lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
            }
            catch (error) {
                lastError = error;
            }
            attempt++;
            // If not last attempt, wait before retry
            if (attempt < this.config.maxRetries) {
                const delay = this.config.exponentialBackoff
                    ? this.config.retryDelay * Math.pow(2, attempt - 1)
                    : this.config.retryDelay;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        // All retries failed
        const circuitBreaker = offline_resilience_1.ExternalServiceCircuitBreaker.getInstance();
        circuitBreaker.recordFailure(this.circuitBreakerKey, lastError);
        return {
            success: false,
            error: (lastError === null || lastError === void 0 ? void 0 : lastError.message) || 'Unknown error',
            isOffline: !circuitBreaker.isServiceOnline(this.circuitBreakerKey)
        };
    }
    /**
     * GET request with resilience
     */
    async get(url, config) {
        return this.executeWithRetry(() => this.axiosInstance.get(url, config), `GET ${url}`);
    }
    /**
     * POST request with resilience
     */
    async post(url, data, config) {
        return this.executeWithRetry(() => this.axiosInstance.post(url, data, config), `POST ${url}`);
    }
    /**
     * PUT request with resilience
     */
    async put(url, data, config) {
        return this.executeWithRetry(() => this.axiosInstance.put(url, data, config), `PUT ${url}`);
    }
    /**
     * DELETE request with resilience
     */
    async delete(url, config) {
        return this.executeWithRetry(() => this.axiosInstance.delete(url, config), `DELETE ${url}`);
    }
    /**
     * PATCH request with resilience
     */
    async patch(url, data, config) {
        return this.executeWithRetry(() => this.axiosInstance.patch(url, data, config), `PATCH ${url}`);
    }
    /**
     * Check if service is online
     */
    isServiceOnline() {
        const circuitBreaker = offline_resilience_1.ExternalServiceCircuitBreaker.getInstance();
        return circuitBreaker.isServiceOnline(this.circuitBreakerKey);
    }
    /**
     * Get the underlying axios instance (for advanced usage)
     */
    getAxiosInstance() {
        return this.axiosInstance;
    }
    /**
     * Update base URL (for hot-reload support)
     */
    updateBaseUrl(newBaseUrl) {
        this.axiosInstance.defaults.baseURL = newBaseUrl;
        this.config.baseURL = newBaseUrl;
    }
}
exports.ResilientHttpService = ResilientHttpService;
/**
 * Factory function to create resilient HTTP service
 */
function createResilientHttpService(config, nodeContext) {
    return new ResilientHttpService(config, nodeContext);
}
