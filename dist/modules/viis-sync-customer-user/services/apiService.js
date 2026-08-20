"use strict";
/**
 * @fileoverview Enhanced API Service for VIIS Sync Customer User module
 * Handles communication with the VIIS IoT server API with detailed logging
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
 * Service for API operations related to customer users
 */
class ApiService {
    /**
     * Creates a new API service
     * @param deviceId - Device ID for authentication
     * @param maxRetries - Maximum number of retries for failed API calls
     * @param node - Node-RED node instance for logging
     * @param showDetailedLogs - Whether to show detailed logs
     */
    constructor(deviceId, maxRetries = 3, node = null, showDetailedLogs = false) {
        this.deviceId = deviceId;
        this.node = node;
        this.showDetailedLogs = showDetailedLogs;
        this.maxRetries = maxRetries;
        if (this.node) {
            logger_1.logger.info(this.node, `API Service initialized; baseURL resolved from VIIS_BACKEND/BACKEND_URL at request time, maxRetries: ${this.maxRetries}`);
            logger_1.logger.debug(this.node, `Device ID: ${this.deviceId}`, this.showDetailedLogs);
        }
    }
    resolveBaseUrl() {
        return (0, resolve_backend_url_1.resolveViisBackendUrl)(this.node);
    }
    /**
     * Gets all customers and their users from the server
     * @param throwOnError - If false, returns empty result instead of throwing (default: false for resilience)
     * @returns Promise that resolves to the API response containing customers, or empty result if offline
     */
    async getAllCustomers(throwOnError = false) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const timer = logger_1.logger.startTimer('getAllCustomers API call');
        const config = {
            headers: {
                'Content-Type': 'application/json'
            }
        };
        // Build the API URL with query parameters
        const queryParams = new URLSearchParams({
            size: '10000',
            page: '1',
            order_by: 'name DESC',
            device_id: this.deviceId,
            includeUsers: 'true'
        });
        const apiUrl = `${this.resolveBaseUrl()}/api/v2/iot-customer/customers?${queryParams.toString()}`;
        if (this.node) {
            logger_1.logger.apiRequest(this.node, 'GET', apiUrl, config, this.showDetailedLogs);
            logger_1.logger.debug(this.node, `Query parameters: ${JSON.stringify(Object.fromEntries(queryParams))}`, this.showDetailedLogs);
        }
        try {
            // Make the API call to get customers with their users
            const response = await this.retryApiCall(() => axios_1.default.get(apiUrl, config), apiUrl);
            const duration = logger_1.logger.endTimer(this.node, timer, this.showDetailedLogs);
            if (this.node) {
                logger_1.logger.apiResponse(this.node, response, duration, this.showDetailedLogs);
                // Log response summary
                const customerCount = ((_c = (_b = (_a = response.data) === null || _a === void 0 ? void 0 : _a.result) === null || _b === void 0 ? void 0 : _b.data) === null || _c === void 0 ? void 0 : _c.length) || 0;
                logger_1.logger.info(this.node, `Successfully fetched ${customerCount} customers from server`);
                if (this.showDetailedLogs && ((_e = (_d = response.data) === null || _d === void 0 ? void 0 : _d.result) === null || _e === void 0 ? void 0 : _e.data)) {
                    const customers = response.data.result.data;
                    const totalUsers = customers.reduce((sum, customer) => { var _a; return sum + (((_a = customer.users) === null || _a === void 0 ? void 0 : _a.length) || 0); }, 0);
                    logger_1.logger.debug(this.node, `Total users across all customers: ${totalUsers}`, true);
                }
            }
            // Return the data from the response
            return response.data;
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
                        `Returning empty customer list. Local operations continue normally.`);
                }
                // If throwOnError is false (default), return empty result instead of throwing
                if (!throwOnError) {
                    return {
                        result: {
                            data: []
                        }
                    };
                }
            }
            // For non-network errors or if throwOnError is true, throw as before
            if (axios_1.default.isAxiosError(error)) {
                const errorDetails = {
                    message: error.message,
                    status: (_f = error.response) === null || _f === void 0 ? void 0 : _f.status,
                    statusText: (_g = error.response) === null || _g === void 0 ? void 0 : _g.statusText,
                    data: (_h = error.response) === null || _h === void 0 ? void 0 : _h.data
                };
                throw new Error(`Failed to fetch customers: ${error.message} - ${JSON.stringify(errorDetails)}`);
            }
            else {
                throw new Error(`Failed to fetch customers: ${error instanceof Error ? error.message : String(error)}`);
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
