/**
 * @fileoverview Response helper utilities for consistent API responses
 */

import { Response } from 'express';
import { ApiResponse, ApiError, ErrorType } from '../types/common.types';
import { logger } from './logger';
import { Node } from 'node-red';

/**
 * Response helper class for standardized API responses
 */
export class ResponseHelper {
    /**
     * Send success response
     */
    static success<T>(
        res: Response,
        data: T,
        statusCode: number = 200,
        message?: string
    ): void {
        const response: ApiResponse<T> = {
            result: data,
            timestamp: new Date().toISOString()
        };

        if (message) {
            response.message = message;
        }

        res.status(statusCode).json(response);
    }

    /**
     * Send error response
     */
    static error(
        res: Response,
        error: string | ApiError,
        statusCode?: number,
        details?: any,
        node?: Node
    ): void {
        let response: ApiResponse;

        if (error instanceof ApiError) {
            response = {
                error: error.type,
                message: error.message,
                timestamp: new Date().toISOString()
            };

            if (error.details) {
                response.details = error.details;
            }

            statusCode = error.statusCode;
        } else {
            response = {
                error: ErrorType.INTERNAL_ERROR,
                message: error,
                timestamp: new Date().toISOString()
            };

            if (details) {
                response.details = details;
            }

            statusCode = statusCode || 500;
        }

        // Log error if node is provided
        if (node) {
            logger.error(node, `API Error: ${response.message}`, response.details);
        }

        res.status(statusCode).json(response);
    }

    /**
     * Send validation error response
     */
    static validationError(
        res: Response,
        message: string,
        details?: any,
        node?: Node
    ): void {
        const error = new ApiError(
            ErrorType.VALIDATION_ERROR,
            message,
            400,
            details
        );

        this.error(res, error, undefined, undefined, node);
    }

    /**
     * Send authentication error response
     */
    static authenticationError(
        res: Response,
        message: string = 'Authentication required',
        node?: Node
    ): void {
        const error = new ApiError(
            ErrorType.AUTHENTICATION_ERROR,
            message,
            401
        );

        this.error(res, error, undefined, undefined, node);
    }

    /**
     * Send authorization error response
     */
    static authorizationError(
        res: Response,
        message: string = 'Insufficient permissions',
        node?: Node
    ): void {
        const error = new ApiError(
            ErrorType.AUTHORIZATION_ERROR,
            message,
            403
        );

        this.error(res, error, undefined, undefined, node);
    }

    /**
     * Send not found error response
     */
    static notFoundError(
        res: Response,
        message: string = 'Resource not found',
        node?: Node
    ): void {
        const error = new ApiError(
            ErrorType.NOT_FOUND_ERROR,
            message,
            404
        );

        this.error(res, error, undefined, undefined, node);
    }

    /**
     * Send rate limit error response
     */
    static rateLimitError(
        res: Response,
        message: string = 'Rate limit exceeded',
        node?: Node
    ): void {
        const error = new ApiError(
            ErrorType.RATE_LIMIT_ERROR,
            message,
            429
        );

        this.error(res, error, undefined, undefined, node);
    }

    /**
     * Send database error response
     */
    static databaseError(
        res: Response,
        message: string = 'Database operation failed',
        node?: Node
    ): void {
        const error = new ApiError(
            ErrorType.DATABASE_ERROR,
            message,
            500
        );

        this.error(res, error, undefined, undefined, node);
    }
}
