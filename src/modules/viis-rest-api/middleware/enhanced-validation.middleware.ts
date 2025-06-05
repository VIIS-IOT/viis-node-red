/**
 * @fileoverview Enhanced validation middleware for routing-controllers integration
 * 
 * This module provides enhanced validation middleware that integrates seamlessly
 * with routing-controllers and provides advanced validation features beyond
 * the standard class-validator functionality.
 * 
 * Features:
 * - Custom error formatting for API responses
 * - Business rule validation integration
 * - Conditional validation support
 * - Enhanced logging and monitoring
 * - Performance optimization for validation
 * - Integration with custom validators
 */

import { Middleware, ExpressErrorMiddlewareInterface } from 'routing-controllers';
import { ValidationError } from 'class-validator';
import { Service, Inject } from 'typedi';
import { Request, Response, NextFunction } from 'express';
import { Node } from 'node-red';
import { logger } from '../utils/logger';

/**
 * Enhanced validation error interface
 */
interface EnhancedValidationError {
    field: string;
    message: string;
    value: any;
    constraints: string[];
    children?: EnhancedValidationError[];
}

/**
 * Validation response interface
 */
interface ValidationResponse {
    success: false;
    error: {
        type: 'ValidationError';
        message: string;
        details: EnhancedValidationError[];
        timestamp: string;
        requestId?: string;
    };
}

/**
 * Enhanced validation middleware for routing-controllers
 * 
 * This middleware provides comprehensive validation error handling and formatting
 * that integrates with the routing-controllers validation system.
 */
@Middleware({ type: 'after' })
@Service()
export class EnhancedValidationMiddleware implements ExpressErrorMiddlewareInterface {
    constructor(@Inject('node') private node: Node) {}

    /**
     * Handle validation errors from routing-controllers
     * 
     * @param error - The error object from routing-controllers
     * @param request - Express request object
     * @param response - Express response object
     * @param next - Express next function
     */
    error(error: any, request: Request, response: Response, next: NextFunction): void {
        // Check if this is a validation error
        if (this.isValidationError(error)) {
            this.handleValidationError(error, request, response);
            return;
        }

        // Check if this is a routing-controllers validation error
        if (this.isRoutingControllersValidationError(error)) {
            this.handleRoutingControllersValidationError(error, request, response);
            return;
        }

        // Pass other errors to the next middleware
        next(error);
    }

    /**
     * Check if error is a class-validator ValidationError
     */
    private isValidationError(error: any): boolean {
        return error instanceof ValidationError || 
               (Array.isArray(error) && error.length > 0 && error[0] instanceof ValidationError);
    }

    /**
     * Check if error is a routing-controllers validation error
     */
    private isRoutingControllersValidationError(error: any): boolean {
        return error.httpCode === 400 && 
               error.name === 'BadRequestError' &&
               (error.message.includes('validation') || error.errors);
    }

    /**
     * Handle class-validator ValidationError
     */
    private handleValidationError(error: ValidationError | ValidationError[], request: Request, response: Response): void {
        const errors = Array.isArray(error) ? error : [error];
        const formattedErrors = this.formatValidationErrors(errors);

        logger.warn(this.node, 'Validation error occurred', {
            path: request.path,
            method: request.method,
            errors: formattedErrors.length,
            userAgent: request.get('User-Agent'),
            ip: request.ip
        });

        const validationResponse: ValidationResponse = {
            success: false,
            error: {
                type: 'ValidationError',
                message: 'Request validation failed',
                details: formattedErrors,
                timestamp: new Date().toISOString(),
                requestId: this.generateRequestId()
            }
        };

        response.status(400).json(validationResponse);
    }

    /**
     * Handle routing-controllers validation error
     */
    private handleRoutingControllersValidationError(error: any, request: Request, response: Response): void {
        logger.warn(this.node, 'Routing-controllers validation error', {
            path: request.path,
            method: request.method,
            errorName: error.name,
            message: error.message,
            userAgent: request.get('User-Agent'),
            ip: request.ip
        });

        // Extract validation errors if available
        let formattedErrors: EnhancedValidationError[] = [];
        if (error.errors && Array.isArray(error.errors)) {
            formattedErrors = this.formatValidationErrors(error.errors);
        }

        const validationResponse: ValidationResponse = {
            success: false,
            error: {
                type: 'ValidationError',
                message: error.message || 'Request validation failed',
                details: formattedErrors,
                timestamp: new Date().toISOString(),
                requestId: this.generateRequestId()
            }
        };

        response.status(error.httpCode || 400).json(validationResponse);
    }

    /**
     * Format validation errors for consistent API response
     */
    private formatValidationErrors(errors: ValidationError[]): EnhancedValidationError[] {
        const formattedErrors: EnhancedValidationError[] = [];

        const processError = (error: ValidationError, parentPath = ''): void => {
            const fieldPath = parentPath ? `${parentPath}.${error.property}` : error.property;

            if (error.constraints) {
                const constraints = Object.keys(error.constraints);
                const messages = Object.values(error.constraints);

                formattedErrors.push({
                    field: fieldPath,
                    message: messages.join(', '),
                    value: error.value,
                    constraints: constraints
                });
            }

            // Process nested errors
            if (error.children && error.children.length > 0) {
                error.children.forEach(child => processError(child, fieldPath));
            }
        };

        errors.forEach(error => processError(error));
        return formattedErrors;
    }

    /**
     * Generate a unique request ID for tracking
     */
    private generateRequestId(): string {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

/**
 * Custom validation interceptor for additional business rule validation
 * 
 * This interceptor can be used to add custom validation logic that goes
 * beyond what class-validator can provide.
 */
@Service()
export class BusinessRuleValidationInterceptor {
    constructor(@Inject('node') private node: Node) {}

    /**
     * Validate business rules for user creation
     */
    async validateUserCreation(userData: any): Promise<string[]> {
        const errors: string[] = [];

        // Example: Check if username is already taken
        if (userData.username) {
            // TODO: Implement database check
            // const existingUser = await this.userService.findByUsername(userData.username);
            // if (existingUser) {
            //     errors.push('Username is already taken');
            // }
        }

        // Example: Validate email domain restrictions
        if (userData.email) {
            const allowedDomains = ['example.com', 'company.com']; // This could come from config
            const emailDomain = userData.email.split('@')[1];
            if (allowedDomains.length > 0 && !allowedDomains.includes(emailDomain)) {
                errors.push(`Email domain ${emailDomain} is not allowed`);
            }
        }

        // Example: Validate role assignments
        if (userData.roles && Array.isArray(userData.roles)) {
            const restrictedRoles = ['admin', 'super_admin'];
            const hasRestrictedRole = userData.roles.some(role => restrictedRoles.includes(role));
            if (hasRestrictedRole && !userData.isAdmin) {
                errors.push('Only administrators can assign restricted roles');
            }
        }

        return errors;
    }

    /**
     * Validate business rules for device creation
     */
    async validateDeviceCreation(deviceData: any): Promise<string[]> {
        const errors: string[] = [];

        // Example: Validate device naming conventions
        if (deviceData.name) {
            const namePattern = /^[A-Z][a-zA-Z0-9\s\-_]+$/;
            if (!namePattern.test(deviceData.name)) {
                errors.push('Device name must start with a capital letter and contain only letters, numbers, spaces, hyphens, and underscores');
            }
        }

        // Example: Validate device type and configuration compatibility
        if (deviceData.deviceType && deviceData.configuration) {
            const requiredConfigFields = this.getRequiredConfigFields(deviceData.deviceType);
            const missingFields = requiredConfigFields.filter(field => !deviceData.configuration[field]);
            if (missingFields.length > 0) {
                errors.push(`Missing required configuration fields for ${deviceData.deviceType}: ${missingFields.join(', ')}`);
            }
        }

        // Example: Validate IP address uniqueness for network devices
        if (deviceData.configuration?.ipAddress) {
            // TODO: Implement database check
            // const existingDevice = await this.deviceService.findByIpAddress(deviceData.configuration.ipAddress);
            // if (existingDevice) {
            //     errors.push('IP address is already in use by another device');
            // }
        }

        return errors;
    }

    /**
     * Get required configuration fields for device type
     */
    private getRequiredConfigFields(deviceType: string): string[] {
        const configRequirements = {
            'gateway': ['ipAddress', 'port'],
            'sensor': ['pollingInterval'],
            'actuator': ['timeout'],
            'controller': ['pollingInterval', 'timeout']
        };

        return configRequirements[deviceType] || [];
    }
}
