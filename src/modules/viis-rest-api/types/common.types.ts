/**
 * @fileoverview Common types and interfaces for VIIS REST API
 */

import { Node } from "node-red";

/**
 * API Configuration interface
 */
export interface ApiConfig {
    enabled: boolean;
    apiPrefix: string;
    enableLogging: boolean;
    enableCors: boolean;
    jwtSecret: string;
    enableRateLimit: boolean;
    maxRequestsPerMinute: number;
}

/**
 * Standard API Response interface
 */
export interface ApiResponse<T = any> {
    result?: T;
    error?: string;
    message?: string;
    details?: any;
    timestamp?: string;
}

/**
 * Pagination interface
 */
export interface PaginationParams {
    page?: number;
    limit?: number;
    offset?: number;
}

/**
 * Pagination response interface
 */
export interface PaginatedResponse<T> {
    data: T[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

/**
 * Request context interface
 */
export interface RequestContext {
    node: Node;
    user?: any;
    requestId?: string;
    startTime?: number;
}

/**
 * HTTP Method types
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/**
 * Route definition interface
 */
export interface RouteDefinition {
    method: HttpMethod;
    path: string;
    handler: string;
    middleware?: string[];
    validation?: {
        body?: any;
        params?: any;
        query?: any;
    };
}

/**
 * Controller interface
 */
export interface IController {
    getRoutes(): RouteDefinition[];
}

/**
 * Service interface
 */
export interface IService {
    initialize?(): Promise<void>;
    cleanup?(): Promise<void>;
}

/**
 * Validator interface for class-validator based validation
 *
 * This interface defines the contract for all validators in the VIIS API modules.
 * It supports the new class-validator approach with DTO classes.
 */
export interface IValidator {
    /**
     * Validate data using a DTO class with class-validator decorators
     *
     * @param dtoClass - The DTO class constructor with validation decorators
     * @param data - The data to validate
     * @returns Promise resolving to the validated and transformed DTO instance
     */
    validate<T extends object>(dtoClass: any, data: any): Promise<T>;
}

/**
 * Error types
 */
export enum ErrorType {
    VALIDATION_ERROR = 'VALIDATION_ERROR',
    AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
    AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
    NOT_FOUND_ERROR = 'NOT_FOUND_ERROR',
    INTERNAL_ERROR = 'INTERNAL_ERROR',
    DATABASE_ERROR = 'DATABASE_ERROR',
    RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
}

/**
 * Custom API Error class
 */
export class ApiError extends Error {
    public readonly type: ErrorType;
    public readonly statusCode: number;
    public readonly details?: any;

    constructor(
        type: ErrorType,
        message: string,
        statusCode: number = 500,
        details?: any
    ) {
        super(message);
        this.type = type;
        this.statusCode = statusCode;
        this.details = details;
        this.name = 'ApiError';
    }
}
