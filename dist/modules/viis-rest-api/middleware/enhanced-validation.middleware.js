"use strict";
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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BusinessRuleValidationInterceptor = exports.EnhancedValidationMiddleware = void 0;
const routing_controllers_1 = require("routing-controllers");
const class_validator_1 = require("class-validator");
const typedi_1 = require("typedi");
const logger_1 = require("../utils/logger");
/**
 * Enhanced validation middleware for routing-controllers
 *
 * This middleware provides comprehensive validation error handling and formatting
 * that integrates with the routing-controllers validation system.
 */
let EnhancedValidationMiddleware = class EnhancedValidationMiddleware {
    constructor(node) {
        this.node = node;
    }
    /**
     * Handle validation errors from routing-controllers
     *
     * @param error - The error object from routing-controllers
     * @param request - Express request object
     * @param response - Express response object
     * @param next - Express next function
     */
    error(error, request, response, next) {
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
    isValidationError(error) {
        return error instanceof class_validator_1.ValidationError ||
            (Array.isArray(error) && error.length > 0 && error[0] instanceof class_validator_1.ValidationError);
    }
    /**
     * Check if error is a routing-controllers validation error
     */
    isRoutingControllersValidationError(error) {
        return error.httpCode === 400 &&
            error.name === 'BadRequestError' &&
            (error.message.includes('validation') || error.errors);
    }
    /**
     * Handle class-validator ValidationError
     */
    handleValidationError(error, request, response) {
        const errors = Array.isArray(error) ? error : [error];
        const formattedErrors = this.formatValidationErrors(errors);
        logger_1.logger.warn(this.node, 'Validation error occurred', {
            path: request.path,
            method: request.method,
            errors: formattedErrors.length,
            userAgent: request.get('User-Agent'),
            ip: request.ip
        });
        const validationResponse = {
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
    handleRoutingControllersValidationError(error, request, response) {
        logger_1.logger.warn(this.node, 'Routing-controllers validation error', {
            path: request.path,
            method: request.method,
            errorName: error.name,
            message: error.message,
            userAgent: request.get('User-Agent'),
            ip: request.ip
        });
        // Extract validation errors if available
        let formattedErrors = [];
        if (error.errors && Array.isArray(error.errors)) {
            formattedErrors = this.formatValidationErrors(error.errors);
        }
        const validationResponse = {
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
    formatValidationErrors(errors) {
        const formattedErrors = [];
        const processError = (error, parentPath = '') => {
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
    generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
};
exports.EnhancedValidationMiddleware = EnhancedValidationMiddleware;
exports.EnhancedValidationMiddleware = EnhancedValidationMiddleware = __decorate([
    (0, routing_controllers_1.Middleware)({ type: 'after' }),
    (0, typedi_1.Service)(),
    __param(0, (0, typedi_1.Inject)('node')),
    __metadata("design:paramtypes", [Object])
], EnhancedValidationMiddleware);
/**
 * Custom validation interceptor for additional business rule validation
 *
 * This interceptor can be used to add custom validation logic that goes
 * beyond what class-validator can provide.
 */
let BusinessRuleValidationInterceptor = class BusinessRuleValidationInterceptor {
    constructor(node) {
        this.node = node;
    }
    /**
     * Validate business rules for user creation
     */
    async validateUserCreation(userData) {
        const errors = [];
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
    async validateDeviceCreation(deviceData) {
        var _a;
        const errors = [];
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
        if ((_a = deviceData.configuration) === null || _a === void 0 ? void 0 : _a.ipAddress) {
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
    getRequiredConfigFields(deviceType) {
        const configRequirements = {
            'gateway': ['ipAddress', 'port'],
            'sensor': ['pollingInterval'],
            'actuator': ['timeout'],
            'controller': ['pollingInterval', 'timeout']
        };
        return configRequirements[deviceType] || [];
    }
};
exports.BusinessRuleValidationInterceptor = BusinessRuleValidationInterceptor;
exports.BusinessRuleValidationInterceptor = BusinessRuleValidationInterceptor = __decorate([
    (0, typedi_1.Service)(),
    __param(0, (0, typedi_1.Inject)('node')),
    __metadata("design:paramtypes", [Object])
], BusinessRuleValidationInterceptor);
