"use strict";
/**
 * @fileoverview API Service for VIIS Sync Production Function module
 * Handles communication with the VIIS IoT server API
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiService = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
const offline_resilience_1 = require("../../../core/offline-resilience");
const resolve_backend_url_1 = require("../../../ultils/resolve-backend-url");
/**
 * Service for API operations related to production functions
 */
class ApiService {
    /**
     * Creates a new API service
     * @param thingsboardAccessToken - ThingsBoard access token for authentication
     * @param maxRetries - Maximum number of retries for failed API calls
     * @param node - Node-RED node instance for logging
     * @param showDetailedLogs - Whether to show detailed logs
     */
    constructor(thingsboardAccessToken, maxRetries = 3, node = null, showDetailedLogs = false) {
        this.thingsboardAccessToken = thingsboardAccessToken;
        this.node = node;
        this.showDetailedLogs = showDetailedLogs;
        this.maxRetries = maxRetries;
        if (this.node) {
            logger_1.logger.info(this.node, `API Service initialized; baseURL resolved from VIIS_BACKEND/BACKEND_URL at request time, maxRetries: ${this.maxRetries}`);
            logger_1.logger.debug(this.node, `ThingsBoard Access Token: ${this.thingsboardAccessToken.substring(0, 8)}...`, this.showDetailedLogs);
        }
    }
    resolveBaseUrl() {
        return (0, resolve_backend_url_1.resolveViisBackendUrl)(this.node);
    }
    /**
     * Syncs production functions from the server
     * @param throwOnError - If false, returns empty result instead of throwing (default: false for resilience)
     * @returns Promise that resolves to the API response containing production functions, or empty result if offline
     */
    async syncProductionFunctions(throwOnError = false) {
        var _a, _b, _c, _d, _e, _f;
        const timer = logger_1.logger.startTimer('syncProductionFunctions API call');
        const config = {
            headers: {
                'Content-Type': 'application/json'
            },
            data: {
                access_token: this.thingsboardAccessToken,
            }
        };
        const apiUrl = `${this.resolveBaseUrl()}/api/v2/device/sync-production-functions`;
        if (this.node) {
            logger_1.logger.apiRequest(this.node, 'POST', apiUrl, config, this.showDetailedLogs);
        }
        try {
            // Make the API call to sync production functions
            const response = await this.retryApiCall(() => axios_1.default.post(apiUrl, config.data, { headers: config.headers }), apiUrl);
            const duration = logger_1.logger.endTimer(this.node, timer, this.showDetailedLogs);
            if (this.node) {
                logger_1.logger.apiResponse(this.node, response, duration, this.showDetailedLogs);
                // Unwrap the result from the API response wrapper
                const apiData = response.data;
                const actualData = apiData.result || {
                    success: false,
                    production_functions: [],
                    total: 0
                };
                // Log response summary
                const functionCount = ((_a = actualData === null || actualData === void 0 ? void 0 : actualData.production_functions) === null || _a === void 0 ? void 0 : _a.length) || 0;
                const totalCount = (actualData === null || actualData === void 0 ? void 0 : actualData.total) || functionCount;
                logger_1.logger.info(this.node, `Successfully fetched ${functionCount} production functions from server (total: ${totalCount})`);
                if (this.showDetailedLogs) {
                    logger_1.logger.debug(this.node, `Device Profile: ${((_b = actualData === null || actualData === void 0 ? void 0 : actualData.device_profile) === null || _b === void 0 ? void 0 : _b.name) || 'N/A'}`, true);
                    logger_1.logger.debug(this.node, `Device Info: ${((_c = actualData === null || actualData === void 0 ? void 0 : actualData.device_info) === null || _c === void 0 ? void 0 : _c.name) || 'N/A'}`, true);
                }
            }
            // Unwrap and return the actual data from the result object
            const apiData = response.data;
            return apiData.result || {
                success: false,
                production_functions: [],
                total: 0
            };
        }
        catch (error) {
            const duration = logger_1.logger.endTimer(this.node, timer, this.showDetailedLogs);
            if (this.node) {
                logger_1.logger.apiError(this.node, error, duration, this.showDetailedLogs);
            }
            // Check if this is a network/offline error
            const isNetworkError = axios_1.default.isAxiosError(error) &&
                (!error.response || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND');
            if (isNetworkError) {
                // Record circuit breaker failure
                const circuitBreaker = offline_resilience_1.ExternalServiceCircuitBreaker.getInstance();
                circuitBreaker.recordFailure('backend-http', error);
                if (this.node) {
                    this.node.warn(`[OFFLINE-RESILIENT] Backend API unreachable (likely offline). ` +
                        `Returning empty production functions list. Local operations continue normally.`);
                }
                // If throwOnError is false (default), return empty result instead of throwing
                if (!throwOnError) {
                    return {
                        success: false,
                        device_profile: undefined,
                        device_info: undefined,
                        production_functions: [],
                        total: 0
                    };
                }
            }
            // For non-network errors or if throwOnError is true, throw as before
            if (axios_1.default.isAxiosError(error)) {
                const errorDetails = {
                    message: error.message,
                    status: (_d = error.response) === null || _d === void 0 ? void 0 : _d.status,
                    statusText: (_e = error.response) === null || _e === void 0 ? void 0 : _e.statusText,
                    data: (_f = error.response) === null || _f === void 0 ? void 0 : _f.data
                };
                throw new Error(`Failed to sync production functions: ${error.message} - ${JSON.stringify(errorDetails)}`);
            }
            else {
                throw new Error(`Failed to sync production functions: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    /**
     * Retries an API call multiple times before giving up
     * @param apiCall - Function that makes the API call
     * @param url - URL being called (for logging purposes)
     * @returns Promise that resolves to the API response
     */
    async retryApiCall(apiCall, url) {
        let lastError = null;
        let attempt = 0;
        while (attempt < this.maxRetries) {
            try {
                if (this.node && attempt > 0) {
                    logger_1.logger.info(this.node, `Retry attempt ${attempt} for ${url || 'API call'}`);
                }
                return await apiCall();
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                attempt++;
                if (this.node) {
                    logger_1.logger.warn(this.node, `API call attempt ${attempt} failed for ${url || 'unknown URL'}: ${lastError.message}`);
                }
                // Only retry if we haven't reached the maximum attempts
                if (attempt < this.maxRetries) {
                    // Exponential backoff with jitter
                    const delay = Math.min(1000 * 2 ** attempt, 10000) + Math.floor(Math.random() * 1000);
                    if (this.node) {
                        logger_1.logger.info(this.node, `Waiting ${delay}ms before retry attempt ${attempt + 1}/${this.maxRetries}`);
                    }
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
                else {
                    if (this.node) {
                        logger_1.logger.error(this.node, `All ${this.maxRetries} retry attempts failed for ${url || 'API call'}`);
                    }
                }
            }
        }
        throw lastError || new Error('API call failed after maximum retries');
    }
}
exports.ApiService = ApiService;
