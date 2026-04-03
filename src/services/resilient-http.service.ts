/**
 * @fileoverview Resilient HTTP Service with offline support
 * Wraps HTTP calls with retry logic, circuit breaker, and graceful degradation
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { NodeContext } from "node-red";
import { GlobalContextHelper } from "../ultils/global-context-helper";
import { executeWithCircuitBreaker, ExternalServiceCircuitBreaker } from "../core/offline-resilience";

/**
 * Configuration for resilient HTTP service
 */
export interface ResilientHttpConfig {
    /** Base URL for API calls */
    baseURL?: string;
    /** Timeout in milliseconds (default: 10000) */
    timeout?: number;
    /** Max retry attempts (default: 3) */
    maxRetries?: number;
    /** Base delay between retries in ms (default: 1000) */
    retryDelay?: number;
    /** Circuit breaker service key (default: 'backend-http') */
    circuitBreakerKey?: string;
    /** Whether to use exponential backoff (default: true) */
    exponentialBackoff?: boolean;
}

/**
 * Response wrapper for resilient operations
 */
export interface ResilientResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    statusCode?: number;
    isOffline?: boolean;
}

/**
 * Resilient HTTP Service with offline support
 * Ensures HTTP failures don't crash Node-RED and provides graceful degradation
 */
export class ResilientHttpService {
    private axiosInstance: AxiosInstance;
    private nodeContext?: NodeContext;
    private config: Required<ResilientHttpConfig>;
    private circuitBreakerKey: string;

    constructor(config: ResilientHttpConfig = {}, nodeContext?: NodeContext) {
        this.nodeContext = nodeContext;
        
        // Use GlobalContextHelper if nodeContext is available
        const helper = nodeContext ? new GlobalContextHelper(nodeContext) : null;
        const baseURL = config.baseURL || 
            (helper ? helper.getEnvVar('API_BASE_URL', '') : (process.env.API_BASE_URL || ''));
        
        this.config = {
            baseURL,
            timeout: config.timeout || 10000,
            maxRetries: config.maxRetries || 3,
            retryDelay: config.retryDelay || 1000,
            circuitBreakerKey: config.circuitBreakerKey || 'backend-http',
            exponentialBackoff: config.exponentialBackoff !== false
        };

        this.circuitBreakerKey = this.config.circuitBreakerKey;

        // Create axios instance with resilient defaults
        this.axiosInstance = axios.create({
            baseURL: this.config.baseURL,
            timeout: this.config.timeout,
            headers: {
                'Content-Type': 'application/json',
            },
            // Don't throw on any status code - we'll handle it
            validateStatus: () => true
        });

        // Response interceptor for logging (but not throwing)
        this.axiosInstance.interceptors.response.use(
            (response) => response,
            (error) => {
                // Log but don't throw - we handle errors in the methods
                console.warn(`[ResilientHttp] HTTP Error: ${error.message}`);
                return Promise.resolve({
                    ...error.response,
                    data: null,
                    status: error.response?.status || 0,
                    statusText: error.message
                } as AxiosResponse);
            }
        );
    }

    /**
     * Execute HTTP request with retry and circuit breaker
     */
    private async executeWithRetry<T>(
        operation: () => Promise<AxiosResponse<T>>,
        operationName: string
    ): Promise<ResilientResponse<T>> {
        let lastError: Error | null = null;
        let attempt = 0;

        while (attempt < this.config.maxRetries) {
            try {
                // Check circuit breaker
                const circuitBreaker = ExternalServiceCircuitBreaker.getInstance();
                if (!circuitBreaker.canAttempt(this.circuitBreakerKey)) {
                    return {
                        success: false,
                        error: `Service ${this.circuitBreakerKey} is offline - circuit breaker open`,
                        isOffline: true
                    };
                }

                const response = await operation();

                // Check if response is successful (2xx status)
                if (response.status >= 200 && response.status < 300) {
                    circuitBreaker.recordSuccess(this.circuitBreakerKey);
                    return {
                        success: true,
                        data: response.data,
                        statusCode: response.status
                    };
                } else {
                    // Non-2xx status code
                    lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

            } catch (error) {
                lastError = error as Error;
            }

            attempt++;

            // If not last attempt, wait before retry
            if (attempt < this.config.maxRetries) {
                const delay = this.config.exponentialBackoff
                    ? this.config.retryDelay * Math.pow(2, attempt - 1)
                    : this.config.retryDelay;
                
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        // All retries failed
        const circuitBreaker = ExternalServiceCircuitBreaker.getInstance();
        circuitBreaker.recordFailure(this.circuitBreakerKey, lastError!);

        return {
            success: false,
            error: lastError?.message || 'Unknown error',
            isOffline: !circuitBreaker.isServiceOnline(this.circuitBreakerKey)
        };
    }

    /**
     * GET request with resilience
     */
    async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<ResilientResponse<T>> {
        return this.executeWithRetry(
            () => this.axiosInstance.get<T>(url, config),
            `GET ${url}`
        );
    }

    /**
     * POST request with resilience
     */
    async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<ResilientResponse<T>> {
        return this.executeWithRetry(
            () => this.axiosInstance.post<T>(url, data, config),
            `POST ${url}`
        );
    }

    /**
     * PUT request with resilience
     */
    async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<ResilientResponse<T>> {
        return this.executeWithRetry(
            () => this.axiosInstance.put<T>(url, data, config),
            `PUT ${url}`
        );
    }

    /**
     * DELETE request with resilience
     */
    async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<ResilientResponse<T>> {
        return this.executeWithRetry(
            () => this.axiosInstance.delete<T>(url, config),
            `DELETE ${url}`
        );
    }

    /**
     * PATCH request with resilience
     */
    async patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<ResilientResponse<T>> {
        return this.executeWithRetry(
            () => this.axiosInstance.patch<T>(url, data, config),
            `PATCH ${url}`
        );
    }

    /**
     * Check if service is online
     */
    isServiceOnline(): boolean {
        const circuitBreaker = ExternalServiceCircuitBreaker.getInstance();
        return circuitBreaker.isServiceOnline(this.circuitBreakerKey);
    }

    /**
     * Get the underlying axios instance (for advanced usage)
     */
    getAxiosInstance(): AxiosInstance {
        return this.axiosInstance;
    }

    /**
     * Update base URL (for hot-reload support)
     */
    updateBaseUrl(newBaseUrl: string): void {
        this.axiosInstance.defaults.baseURL = newBaseUrl;
        this.config.baseURL = newBaseUrl;
    }
}

/**
 * Factory function to create resilient HTTP service
 */
export function createResilientHttpService(
    config?: ResilientHttpConfig,
    nodeContext?: NodeContext
): ResilientHttpService {
    return new ResilientHttpService(config, nodeContext);
}
