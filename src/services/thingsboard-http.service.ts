import axios, { AxiosInstance, AxiosError } from 'axios';
import { NodeContext } from 'node-red';
import { GlobalContextHelper } from '../ultils/global-context-helper';

/**
 * ThingsBoard telemetry data format
 */
export interface TelemetryData {
    ts: number; // Unix timestamp in milliseconds
    values: Record<string, any>;
}

/**
 * ThingsBoard HTTP API response
 */
export interface ThingsboardResponse {
    success: boolean;
    error?: string;
    statusCode?: number;
    retryAfter?: number; // Seconds to wait before retry (from Retry-After header)
}

/**
 * Service for sending telemetry and attributes to ThingsBoard via HTTP API
 * Supports single and batch telemetry uploads
 */
export class ThingsboardHttpService {
    private axiosInstance: AxiosInstance;
    private baseUrl: string;
    private nodeContext?: NodeContext;

    constructor(nodeContext?: NodeContext) {
        this.nodeContext = nodeContext;
        
        // Use GlobalContextHelper if nodeContext is available
        const helper = nodeContext ? new GlobalContextHelper(nodeContext) : null;
        
        // Read VIIS_BACKEND from global context (hot-reload support)
        this.baseUrl = helper 
            ? helper.getEnvVar('VIIS_BACKEND', 'https://iot.viis.tech')
            : (process.env.VIIS_BACKEND || 'https://iot.viis.tech');
        
        // Create axios instance with ThingsBoard-specific configuration
        this.axiosInstance = axios.create({
            timeout: 60000, // INCREASED: 60 seconds timeout (from 30s) to handle slow networks
            headers: {
                'Content-Type': 'application/json',
            },
            validateStatus: (status) => status < 500, // Don't throw on 4xx errors
        });

        // Response interceptor for logging
        this.axiosInstance.interceptors.response.use(
            (response) => response,
            (error: AxiosError) => {
                console.error(`[ThingsboardHttpService] HTTP Error: ${error.message}`);
                return Promise.reject(error);
            }
        );
    }

    /**
     * Send single telemetry record to ThingsBoard
     * @param deviceToken - ThingsBoard device access token
     * @param data - Telemetry data with timestamp and values
     * @returns Response with success status
     */
    async sendTelemetry(
        deviceToken: string, 
        data: TelemetryData
    ): Promise<ThingsboardResponse> {
        try {
            const url = `${this.baseUrl}/api/v1/${deviceToken}/telemetry`;
            
            const response = await this.axiosInstance.post(url, data);
            
            if (response.status === 200) {
                return { success: true };
            } else {
                return {
                    success: false,
                    error: `Unexpected status: ${response.status}`,
                    statusCode: response.status
                };
            }
        } catch (error) {
            return this.handleError(error as AxiosError);
        }
    }

    /**
     * Send batch telemetry records to ThingsBoard (recommended for efficiency)
     * @param deviceToken - ThingsBoard device access token
     * @param data - Array of telemetry data
     * @param idempotencyKey - Optional idempotency key to prevent duplicate submissions
     * @returns Response with success status
     */
    async sendBatchTelemetry(
        deviceToken: string,
        data: TelemetryData[],
        idempotencyKey?: string
    ): Promise<ThingsboardResponse> {
        try {
            if (!data || data.length === 0) {
                return {
                    success: false,
                    error: 'Empty telemetry batch'
                };
            }

            const url = `${this.baseUrl}/api/v1/${deviceToken}/telemetry`;
            
            // Add idempotency key header if provided
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            };
            if (idempotencyKey) {
                headers['X-Idempotency-Key'] = idempotencyKey;
            }
            
            const response = await this.axiosInstance.post(url, data, { headers });
            
            if (response.status === 200) {
                return { success: true };
            } else {
                return {
                    success: false,
                    error: `Unexpected status: ${response.status}`,
                    statusCode: response.status
                };
            }
        } catch (error) {
            return this.handleError(error as AxiosError);
        }
    }

    /**
     * Send attributes to ThingsBoard
     * @param deviceToken - ThingsBoard device access token
     * @param attributes - Key-value pairs of attributes
     * @returns Response with success status
     */
    async sendAttributes(
        deviceToken: string,
        attributes: Record<string, any>
    ): Promise<ThingsboardResponse> {
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
            } else {
                return {
                    success: false,
                    error: `Unexpected status: ${response.status}`,
                    statusCode: response.status
                };
            }
        } catch (error) {
            return this.handleError(error as AxiosError);
        }
    }

    /**
     * Update base URL (for hot-reload support)
     * @param newBaseUrl - New ThingsBoard base URL
     */
    updateBaseUrl(newBaseUrl: string): void {
        this.baseUrl = newBaseUrl;
    }

    /**
     * Get current base URL
     */
    getBaseUrl(): string {
        return this.baseUrl;
    }

    /**
     * Handle HTTP errors and return structured response
     */
    private handleError(error: AxiosError): ThingsboardResponse {
        if (error.response) {
            // Server responded with error status
            const status = error.response.status;
            let errorMsg = '';
            let retryAfter: number | undefined;

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
        } else if (error.request) {
            // Request made but no response received (timeout or network error)
            return {
                success: false,
                error: 'Network error - No response from ThingsBoard server (timeout or connection failed)'
            };
        } else {
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
    static isValidToken(token: string): boolean {
        return token && token.trim().length > 0;
    }

    /**
     * Convert simple key-value object to ThingsBoard telemetry format
     * @param data - Simple key-value object
     * @param timestamp - Optional timestamp (default: now)
     */
    static formatTelemetry(
        data: Record<string, any>, 
        timestamp?: number
    ): TelemetryData {
        return {
            ts: timestamp || Date.now(),
            values: data
        };
    }
}
