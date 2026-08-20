/**
 * @fileoverview API Service for VIIS Sync Production Function module
 * Handles communication with the VIIS IoT server API
 */

import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { Node } from 'node-red';
import { ServerProductionFunctionResponse, ApiResponseWrapper } from '../interfaces/types';
import { logger } from '../utils/logger';
import { ExternalServiceCircuitBreaker } from '../../../core/offline-resilience';
import { resolveViisBackendUrl } from '../../../ultils/resolve-backend-url';

/**
 * Service for API operations related to production functions
 */
export class ApiService {
    /** ThingsBoard access token for API authentication */
    private readonly thingsboardAccessToken: string;
    /** Maximum number of retries for failed API calls */
    private readonly maxRetries: number;
    /** Node-RED node instance for logging */
    private readonly node: Node | null;
    /** Whether to show detailed logs */
    private readonly showDetailedLogs: boolean;

    /**
     * Creates a new API service
     * @param thingsboardAccessToken - ThingsBoard access token for authentication
     * @param maxRetries - Maximum number of retries for failed API calls
     * @param node - Node-RED node instance for logging
     * @param showDetailedLogs - Whether to show detailed logs
     */
    constructor(thingsboardAccessToken: string, maxRetries: number = 3, node: Node | null = null, showDetailedLogs: boolean = false) {
        this.thingsboardAccessToken = thingsboardAccessToken;
        this.node = node;
        this.showDetailedLogs = showDetailedLogs;
        this.maxRetries = maxRetries;

        if (this.node) {
            logger.info(this.node, `API Service initialized; baseURL resolved from VIIS_BACKEND/BACKEND_URL at request time, maxRetries: ${this.maxRetries}`);
            logger.debug(this.node, `ThingsBoard Access Token: ${this.thingsboardAccessToken.substring(0, 8)}...`, this.showDetailedLogs);
        }
    }

    private resolveBaseUrl(): string {
        return resolveViisBackendUrl(this.node);
    }

    /**
     * Syncs production functions from the server
     * @param throwOnError - If false, returns empty result instead of throwing (default: false for resilience)
     * @returns Promise that resolves to the API response containing production functions, or empty result if offline
     */
    async syncProductionFunctions(throwOnError: boolean = false): Promise<ServerProductionFunctionResponse> {
        const timer = logger.startTimer('syncProductionFunctions API call');

        const config: AxiosRequestConfig = {
            headers: {
                'Content-Type': 'application/json'
            },
            data: {
                thingsboard_access_token: this.thingsboardAccessToken
            }
        };

        const apiUrl = `${this.resolveBaseUrl()}/api/v2/device/sync-production-functions`;

        if (this.node) {
            logger.apiRequest(this.node, 'POST', apiUrl, config, this.showDetailedLogs);
        }

        try {
            // Make the API call to sync production functions
            const response: AxiosResponse = await this.retryApiCall(
                () => axios.post(apiUrl, config.data, { headers: config.headers }),
                apiUrl
            );

            const duration = logger.endTimer(this.node, timer, this.showDetailedLogs);

            if (this.node) {
                logger.apiResponse(this.node, response, duration, this.showDetailedLogs);

                // Unwrap the result from the API response wrapper
                const apiData: ApiResponseWrapper = response.data;
                const actualData: ServerProductionFunctionResponse = apiData.result || {
                    success: false,
                    production_functions: [],
                    total: 0
                };

                // Log response summary
                const functionCount = actualData?.production_functions?.length || 0;
                const totalCount = actualData?.total || functionCount;
                logger.info(this.node, `Successfully fetched ${functionCount} production functions from server (total: ${totalCount})`);

                if (this.showDetailedLogs) {
                    logger.debug(this.node, `Device Profile: ${actualData?.device_profile?.name || 'N/A'}`, true);
                    logger.debug(this.node, `Device Info: ${actualData?.device_info?.name || 'N/A'}`, true);
                }
            }

            // Unwrap and return the actual data from the result object
            const apiData: ApiResponseWrapper = response.data;
            return apiData.result || {
                success: false,
                production_functions: [],
                total: 0
            };
        } catch (error) {
            const duration = logger.endTimer(this.node, timer, this.showDetailedLogs);

            if (this.node) {
                logger.apiError(this.node, error, duration, this.showDetailedLogs);
            }

            // Check if this is a network/offline error
            const isNetworkError = axios.isAxiosError(error) &&
                (!error.response || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND');

            if (isNetworkError) {
                // Record circuit breaker failure
                const circuitBreaker = ExternalServiceCircuitBreaker.getInstance();
                circuitBreaker.recordFailure('backend-http', error as Error);

                if (this.node) {
                    this.node.warn(
                        `[OFFLINE-RESILIENT] Backend API unreachable (likely offline). ` +
                        `Returning empty production functions list. Local operations continue normally.`
                    );
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
            if (axios.isAxiosError(error)) {
                const errorDetails = {
                    message: error.message,
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    data: error.response?.data
                };
                throw new Error(`Failed to sync production functions: ${error.message} - ${JSON.stringify(errorDetails)}`);
            } else {
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
    private async retryApiCall(apiCall: () => Promise<AxiosResponse>, url?: string): Promise<AxiosResponse> {
        let lastError: Error | null = null;
        let attempt = 0;

        while (attempt < this.maxRetries) {
            try {
                if (this.node && attempt > 0) {
                    logger.info(this.node, `Retry attempt ${attempt} for ${url || 'API call'}`);
                }

                return await apiCall();
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                attempt++;

                if (this.node) {
                    logger.warn(this.node, `API call attempt ${attempt} failed for ${url || 'unknown URL'}: ${lastError.message}`);
                }

                // Only retry if we haven't reached the maximum attempts
                if (attempt < this.maxRetries) {
                    // Exponential backoff with jitter
                    const delay = Math.min(1000 * 2 ** attempt, 10000) + Math.floor(Math.random() * 1000);

                    if (this.node) {
                        logger.info(this.node, `Waiting ${delay}ms before retry attempt ${attempt + 1}/${this.maxRetries}`);
                    }

                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    if (this.node) {
                        logger.error(this.node, `All ${this.maxRetries} retry attempts failed for ${url || 'API call'}`);
                    }
                }
            }
        }

        throw lastError || new Error('API call failed after maximum retries');
    }
}
