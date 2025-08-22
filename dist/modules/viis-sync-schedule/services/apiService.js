"use strict";
/**
 * @fileoverview API Service for VIIS Sync Schedule module
 * Handles communication with the server API
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiService = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
const configs_1 = require("../../../configs");
const constants_1 = require("../constants");
const retry_1 = require("../utils/retry");
/**
 * Service for making API requests to the server
 */
class ApiService {
    /**
     * Creates a new API service instance
     * @param accessToken - Device access token for authentication
     * @param nodeContext - Optional Node-RED context for hot reload support
     */
    constructor(accessToken, nodeContext) {
        this.configs = (0, configs_1.createConfig)(nodeContext);
        const config = {
            baseURL: this.configs.serverUrl || 'http://localhost:8080',
            timeout: constants_1.SYNC_DEFAULTS.TIMEOUT,
            headers: {
                'Content-Type': 'application/json',
            }
        };
        this.instance = axios_1.default.create(config);
        this.accessToken = accessToken;
        logger_1.logger.info(null, `API Service initialized with baseURL: ${config.baseURL}`);
    }
    /**
     * Fetches all schedule plans and their schedules for the device
     * @returns Promise that resolves to the server response
     */
    async getAllSchedulePlans() {
        logger_1.logger.info(null, 'Fetching all schedule plans from server');
        const url = `api/v2/schedulePlan/device/all/${this.accessToken}`;
        return (0, retry_1.withRetry)(async () => {
            try {
                logger_1.logger.debug(null, `Making GET request to: ${url}`);
                const response = await this.instance.get(url);
                const plansCount = response.data.result.data.length || 0;
                logger_1.logger.info(null, `Received ${plansCount} schedule plans from server`);
                return response.data;
            }
            catch (error) {
                this.handleApiError(error, 'fetch schedule plans');
                throw error; // Re-throw for retry mechanism
            }
        }, {
            maxRetries: 3,
            initialDelay: 2000
        });
    }
    /**
     * Handles and logs API errors consistently
     * @param error - Error object from API call
     * @param operation - Name of the operation that failed
     */
    handleApiError(error, operation) {
        const errorMessage = error instanceof Error
            ? error.message
            : 'Unknown error';
        logger_1.logger.error(null, `Failed to ${operation}: ${errorMessage}`);
        if (axios_1.default.isAxiosError(error)) {
            const axiosError = error;
            if (axiosError.response) {
                logger_1.logger.error(null, `Server responded with status ${axiosError.response.status}: ${JSON.stringify(axiosError.response.data)}`);
            }
            else if (axiosError.request) {
                logger_1.logger.error(null, `No response received from server: ${axiosError.message}`);
            }
            if (axiosError.config) {
                logger_1.logger.debug(null, `Request was made to: ${axiosError.config.url}`);
            }
        }
    }
}
exports.ApiService = ApiService;
