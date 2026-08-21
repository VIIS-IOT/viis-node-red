/**
 * @fileoverview API Service for VIIS Sync Schedule module
 * Handles communication with the server API
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { ServerResponse, ServerSchedulePlan } from '../interfaces/types';
import { logger } from '../utils/logger';
import { API_PATHS, SYNC_DEFAULTS } from '../constants';
import { withRetry } from '../utils/retry';
import { NodeContext } from 'node-red';
import { resolveViisBackendUrl } from '../../../ultils/resolve-backend-url';
import { fromDeviceSchedulePlan, unwrapDevicePlanList } from '../../../core/demeter-schedule-protocol';

/**
 * Service for making API requests to the server
 */
export class ApiService {
    /** Axios instance for making HTTP requests */
    private readonly instance: AxiosInstance;
    /** Device access token for authentication */
    private readonly accessToken: string;
    /** Node-RED context so VIIS_BACKEND can load after env-loader */
    private readonly nodeContext?: NodeContext;

    /**
     * Creates a new API service instance
     * @param accessToken - Device access token for authentication
     * @param nodeContext - Optional Node-RED context for hot reload support
     */
    constructor(accessToken: string, nodeContext?: NodeContext) {
        this.nodeContext = nodeContext;
        const config: AxiosRequestConfig = {
            timeout: SYNC_DEFAULTS.TIMEOUT,
            headers: {
                'Content-Type': 'application/json',
            }
        };

        this.instance = axios.create(config);
        this.accessToken = accessToken;

        logger.info(null, 'API Service initialized; baseURL resolved from VIIS_BACKEND/BACKEND_URL at request time');
    }

    private resolveBaseUrl(): string {
        return resolveViisBackendUrl(this.nodeContext);
    }

    /**
     * Fetches all schedule plans and their schedules for the device
     * @returns Promise that resolves to the server response
     */
    async getAllSchedulePlans(): Promise<ServerResponse<ServerSchedulePlan[]>> {
        logger.info(null, 'Fetching all schedule plans from server');
        const url = `/api/v2${API_PATHS.SCHEDULE_PLAN_ALL}/${this.accessToken}`;
        
        return withRetry(async () => {
            try {
                this.instance.defaults.baseURL = this.resolveBaseUrl();
                logger.debug(null, `Making GET request to: ${this.instance.defaults.baseURL}${url}`);
                const response = await this.instance.get(url);
                const plans = unwrapDevicePlanList(response.data).map((plan) => {
                    const local = fromDeviceSchedulePlan(plan);
                    return {
                        ...local,
                        id: local.name,
                        schedules: (local.schedules || []).map((schedule) => ({
                            ...schedule,
                            id: schedule.name,
                        })),
                    } as unknown as ServerSchedulePlan;
                });
                logger.info(null, `Received ${plans.length} schedule plans from server`);

                return {
                    result: {
                        status: 200,
                        message: 'ok',
                        data: plans,
                    },
                };
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
