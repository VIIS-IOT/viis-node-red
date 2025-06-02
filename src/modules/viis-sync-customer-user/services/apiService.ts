/**
 * @fileoverview API Service for VIIS Sync Customer User module
 * Handles communication with the VIIS IoT server API
 */

import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { ServerCustomer } from '../interfaces/types';

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

    /**
     * Creates a new API service
     * @param deviceId - Device ID for authentication
     * @param maxRetries - Maximum number of retries for failed API calls
     */
    constructor(deviceId: string, maxRetries: number = 3) {
        this.deviceId = deviceId;
        // Use global context instead of process.env for hot-reload capability
        const globalContext = (global as any).get?.() || {};
        this.baseUrl = globalContext.VIIS_BACKEND || globalContext.API_URL || 'https://iot.viis.tech';
        this.maxRetries = maxRetries;
    }

    /**
     * Gets all customers and their users from the server
     * @returns Promise that resolves to the API response containing customers
     */
    async getAllCustomers(): Promise<{ result: { data: ServerCustomer[] } }> {
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

        try {
            // Make the API call to get customers with their users
            const response: AxiosResponse = await this.retryApiCall(
                () => axios.get(apiUrl, config)
            );

            // Return the data from the response
            return response.data;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Failed to fetch customers: ${error.message} - ${JSON.stringify(error.response?.data || {})}`);
            } else {
                throw new Error(`Failed to fetch customers: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }

    /**
     * Retries an API call multiple times before giving up
     * @param apiCall - Function that makes the API call
     * @returns Promise that resolves to the API response
     */
    private async retryApiCall(apiCall: () => Promise<AxiosResponse>): Promise<AxiosResponse> {
        let lastError: Error | null = null;
        let attempt = 0;

        while (attempt < this.maxRetries) {
            try {
                return await apiCall();
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                attempt++;

                // Only retry if we haven't reached the maximum attempts
                if (attempt < this.maxRetries) {
                    // Exponential backoff with jitter
                    const delay = Math.min(1000 * 2 ** attempt, 10000) + Math.floor(Math.random() * 1000);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError || new Error('API call failed after maximum retries');
    }
}
