/**
 * @fileoverview Enhanced API Service for VIIS Sync Customer User module
 * Handles communication with the VIIS IoT server API with detailed logging
 */

import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { Node } from 'node-red';
import { ServerCustomer } from '../interfaces/types';
import { logger } from '../utils/logger';
import { executeOfflineSafe, ExternalServiceCircuitBreaker } from '../../../core/offline-resilience';

/**
 * Service for API operations related to customer users
 */
export class ApiService {
    /** Device ID for API authentication */
    private readonly deviceId: string;
    /** Base URL for API calls */
    private readonly baseUrl: string;
    /** Maximum number of retries for failed API calls */
    private readonly maxRetries: number;
    /** Node-RED node instance for logging */
    private readonly node: Node | null;
    /** Whether to show detailed logs */
    private readonly showDetailedLogs: boolean;

    /**
     * Creates a new API service
     * @param deviceId - Device ID for authentication
     * @param maxRetries - Maximum number of retries for failed API calls
     * @param node - Node-RED node instance for logging
     * @param showDetailedLogs - Whether to show detailed logs
     */
    constructor(deviceId: string, maxRetries: number = 3, node: Node | null = null, showDetailedLogs: boolean = false) {
        this.deviceId = deviceId;
        this.node = node;
        this.showDetailedLogs = showDetailedLogs;

        // Use global context instead of process.env for hot-reload capability
        const globalContext = (global as any).get?.() || {};
        this.baseUrl = globalContext.VIIS_BACKEND || globalContext.API_URL || 'https://iot.viis.tech';
        this.maxRetries = maxRetries;

        if (this.node) {
            logger.info(this.node, `API Service initialized with baseURL: ${this.baseUrl}, maxRetries: ${this.maxRetries}`);
            logger.debug(this.node, `Device ID: ${this.deviceId}`, this.showDetailedLogs);
        }
    }

    /**
     * Gets all customers and their users from the server
     * @param throwOnError - If false, returns empty result instead of throwing (default: false for resilience)
     * @returns Promise that resolves to the API response containing customers, or empty result if offline
     */
    async getAllCustomers(throwOnError: boolean = false): Promise<{ result: { data: ServerCustomer[] } }> {
        const timer = logger.startTimer('getAllCustomers API call');

        const config: AxiosRequestConfig = {
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

        const apiUrl = `${this.baseUrl}/api/v2/iot-customer/customers?${queryParams.toString()}`;

        if (this.node) {
            logger.apiRequest(this.node, 'GET', apiUrl, config, this.showDetailedLogs);
            logger.debug(this.node, `Query parameters: ${JSON.stringify(Object.fromEntries(queryParams))}`, this.showDetailedLogs);
        }

        try {
            // Make the API call to get customers with their users
            const response: AxiosResponse = await this.retryApiCall(
                () => axios.get(apiUrl, config),
                apiUrl
            );

            const duration = logger.endTimer(this.node, timer, this.showDetailedLogs);

            if (this.node) {
                logger.apiResponse(this.node, response, duration, this.showDetailedLogs);

                // Log response summary
                const customerCount = response.data?.result?.data?.length || 0;
                logger.info(this.node, `Successfully fetched ${customerCount} customers from server`);

                if (this.showDetailedLogs && response.data?.result?.data) {
                    const customers = response.data.result.data;
                    const totalUsers = customers.reduce((sum: number, customer: ServerCustomer) =>
                        sum + (customer.users?.length || 0), 0);
                    logger.debug(this.node, `Total users across all customers: ${totalUsers}`, true);
                }
            }

            // Return the data from the response
            return response.data;
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
                        `Returning empty customer list. Local operations continue normally.`
                    );
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
            if (axios.isAxiosError(error)) {
                const errorDetails = {
                    message: error.message,
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    data: error.response?.data
                };
                throw new Error(`Failed to fetch customers: ${error.message} - ${JSON.stringify(errorDetails)}`);
            } else {
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
