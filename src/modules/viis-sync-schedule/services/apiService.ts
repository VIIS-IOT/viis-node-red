/**
 * @fileoverview API Service for VIIS Sync Schedule module
 * Handles communication with the server API
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { ServerResponse, ServerSchedulePlan } from '../interfaces/types';
import { logger } from '../utils/logger';
import configs from '../../../configs';
import { SYNC_DEFAULTS } from '../constants';
import { withRetry } from '../utils/retry';

/**
 * Service for making API requests to the server
 */
export class ApiService {
    /** Axios instance for making HTTP requests */
    private readonly instance: AxiosInstance;
    /** Device access token for authentication */
    private readonly accessToken: string;

    /**
     * Creates a new API service instance
     * @param accessToken - Device access token for authentication
     */
    constructor(accessToken: string) {
        const config: AxiosRequestConfig = {
            baseURL: configs.serverUrl || 'http://localhost:8080',
            timeout: SYNC_DEFAULTS.TIMEOUT,
            headers: {
                'Content-Type': 'application/json',
            }
        };

        this.instance = axios.create(config);
        this.accessToken = accessToken;

        logger.info(null, `API Service initialized with baseURL: ${config.baseURL}`);
    }

    /**
     * Fetches all schedule plans and their schedules for the device
     * @returns Promise that resolves to the server response
     */
    async getAllSchedulePlans(): Promise<ServerResponse<ServerSchedulePlan[]>> {
        logger.info(null, 'Fetching all schedule plans from server');
        const url = `api/v2/schedulePlan/device/all/${this.accessToken}`;
        
        return withRetry(async () => {
            try {
                logger.debug(null, `Making GET request to: ${url}`);
                const response = await this.instance.get<ServerResponse<ServerSchedulePlan[]>>(url);
                const plansCount = response.data.result.data.length || 0;
                logger.info(null, `Received ${plansCount} schedule plans from server`);
                
                return response.data;
            } catch (error) {
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
    private handleApiError(error: unknown, operation: string): void {
        const errorMessage = error instanceof Error 
            ? error.message 
            : 'Unknown error';
            
        logger.error(null, `Failed to ${operation}: ${errorMessage}`);
        
        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError;
            
            if (axiosError.response) {
                logger.error(null, `Server responded with status ${axiosError.response.status}: ${JSON.stringify(axiosError.response.data)}`);
            } else if (axiosError.request) {
                logger.error(null, `No response received from server: ${axiosError.message}`);
            }
            
            if (axiosError.config) {
                logger.debug(null, `Request was made to: ${axiosError.config.url}`);
            }
        }
    }
}
