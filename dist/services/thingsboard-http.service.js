"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ThingsboardHttpService = void 0;
const axios_1 = __importDefault(require("axios"));
const global_context_helper_1 = require("../ultils/global-context-helper");
/**
 * Service for sending telemetry and attributes to ThingsBoard via HTTP API
 * Supports single and batch telemetry uploads
 */
class ThingsboardHttpService {
    constructor(nodeContext) {
        this.nodeContext = nodeContext;
        // Use GlobalContextHelper if nodeContext is available
        const helper = nodeContext ? new global_context_helper_1.GlobalContextHelper(nodeContext) : null;
        // Read VIIS_BACKEND from global context (hot-reload support)
        this.baseUrl = helper
            ? helper.getEnvVar('VIIS_BACKEND', 'https://iot.viis.tech')
            : (process.env.VIIS_BACKEND || 'https://iot.viis.tech');
        // Create axios instance with ThingsBoard-specific configuration
        this.axiosInstance = axios_1.default.create({
            timeout: 60000, // INCREASED: 60 seconds timeout (from 30s) to handle slow networks
            headers: {
                'Content-Type': 'application/json',
            },
            validateStatus: (status) => status < 500, // Don't throw on 4xx errors
        });
        // Response interceptor for logging
        this.axiosInstance.interceptors.response.use((response) => response, (error) => {
            console.error(`[ThingsboardHttpService] HTTP Error: ${error.message}`);
            return Promise.reject(error);
        });
    }
    /**
     * Send single telemetry record to ThingsBoard
     * @param deviceToken - ThingsBoard device access token
     * @param data - Telemetry data with timestamp and values
     * @returns Response with success status
     */
    async sendTelemetry(deviceToken, data) {
        try {
            const url = `${this.baseUrl}/api/v1/${deviceToken}/telemetry`;
            const response = await this.axiosInstance.post(url, data);
            if (response.status === 200) {
                return { success: true };
            }
            else {
                return {
                    success: false,
                    error: `Unexpected status: ${response.status}`,
                    statusCode: response.status
                };
            }
        }
        catch (error) {
            return this.handleError(error);
        }
    }
    /**
     * Send batch telemetry records to ThingsBoard (recommended for efficiency)
     * @param deviceToken - ThingsBoard device access token
     * @param data - Array of telemetry data
     * @param idempotencyKey - Optional idempotency key to prevent duplicate submissions
     * @returns Response with success status
     */
    async sendBatchTelemetry(deviceToken, data, idempotencyKey) {
        try {
            if (!data || data.length === 0) {
                return {
                    success: false,
                    error: 'Empty telemetry batch'
                };
            }
            const url = `${this.baseUrl}/api/v1/${deviceToken}/telemetry`;
            // Add idempotency key header if provided
            const headers = {
                'Content-Type': 'application/json',
            };
            if (idempotencyKey) {
                headers['X-Idempotency-Key'] = idempotencyKey;
            }
            const response = await this.axiosInstance.post(url, data, { headers });
            if (response.status === 200) {
                return { success: true };
            }
            else {
                return {
                    success: false,
                    error: `Unexpected status: ${response.status}`,
                    statusCode: response.status
                };
            }
        }
        catch (error) {
            return this.handleError(error);
        }
    }
    /**
     * Send attributes to ThingsBoard
     * @param deviceToken - ThingsBoard device access token
     * @param attributes - Key-value pairs of attributes
     * @returns Response with success status
     */
    async sendAttributes(deviceToken, attributes) {
        try {
            if (!attributes || Object.keys(attributes).length === 0) {
                return {
                    success: false,
                    error: 'Empty attributes object'
                };
            }
            const url = `${this.baseUrl}/api/v1/${deviceToken}/attributes`;
            const response = await this.axiosInstance.post(url, attributes);
            if (response.status === 200) {
                return { success: true };
            }
            else {
                return {
                    success: false,
                    error: `Unexpected status: ${response.status}`,
                    statusCode: response.status
                };
            }
        }
        catch (error) {
            return this.handleError(error);
        }
    }
    /**
     * Update base URL (for hot-reload support)
     * @param newBaseUrl - New ThingsBoard base URL
     */
    updateBaseUrl(newBaseUrl) {
        this.baseUrl = newBaseUrl;
    }
    /**
     * Get current base URL
     */
    getBaseUrl() {
        return this.baseUrl;
    }
    /**
     * Handle HTTP errors and return structured response
     */
    handleError(error) {
        if (error.response) {
            // Server responded with error status
            const status = error.response.status;
            let errorMsg = '';
            let retryAfter;
            switch (status) {
                case 400:
                    errorMsg = 'Bad Request - Invalid telemetry data format';
                    break;
                case 401:
                    errorMsg = 'Unauthorized - Invalid device access token';
                    break;
                case 404:
                    errorMsg = 'Not Found - Device or endpoint not found';
                    break;
                case 429:
                    // Rate limiting - extract Retry-After header
                    const retryAfterHeader = error.response.headers['retry-after'];
                    if (retryAfterHeader) {
                        retryAfter = parseInt(retryAfterHeader, 10);
                    }
                    errorMsg = `Too Many Requests - Rate limited${retryAfter ? `, retry after ${retryAfter}s` : ''}`;
                    break;
                default:
                    errorMsg = `HTTP ${status} - ${error.message}`;
            }
            return {
                success: false,
                error: errorMsg,
                statusCode: status,
                retryAfter
            };
        }
        else if (error.request) {
            // Request made but no response received (timeout or network error)
            return {
                success: false,
                error: 'Network error - No response from ThingsBoard server (timeout or connection failed)'
            };
        }
        else {
            // Error setting up request
            return {
                success: false,
                error: `Request error - ${error.message}`
            };
        }
    }
    /**
     * Validate device token format
     */
    static isValidToken(token) {
        return token && token.trim().length > 0;
    }
    /**
     * Convert simple key-value object to ThingsBoard telemetry format
     * @param data - Simple key-value object
     * @param timestamp - Optional timestamp (default: now)
     */
    static formatTelemetry(data, timestamp) {
        return {
            ts: timestamp || Date.now(),
            values: data
        };
    }
}
exports.ThingsboardHttpService = ThingsboardHttpService;
