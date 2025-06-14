"use strict";
/**
 * @fileoverview Validation middleware using class-validator
 *
 * This middleware provides a foundation for request validation across all API modules.
 * It demonstrates the recommended patterns for:
 * - DTO-based validation using class-validator
 * - Consistent error handling and response formatting
 * - Type-safe request processing
 * - Reusable validation patterns for other modules
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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ValidationMiddleware = void 0;
const node_red_1 = require("node-red");
const typedi_1 = require("typedi");
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const response_helper_1 = require("../utils/response.helper");
const logger_1 = require("../utils/logger");
/**
 * Validation middleware class using class-validator
 *
 * Provides reusable validation patterns that can be used across all API modules.
 * This serves as the foundation for consistent request validation.
 */
let ValidationMiddleware = class ValidationMiddleware {
    constructor(node) {
        this.node = node;
        /**
         * Validate request body using DTO class
         *
         * @example
         * ```typescript
         * // In route handler:
         * app.post('/login',
         *   validationMiddleware.validateBody(LoginDto),
         *   authController.login
         * );
         * ```
         */
        this.validateBody = (dtoClass) => {
            return async (req, res, next) => {
                try {
                    const dto = (0, class_transformer_1.plainToClass)(dtoClass, req.body);
                    const errors = await (0, class_validator_1.validate)(dto, {
                        whitelist: true,
                        forbidNonWhitelisted: true
                    });
                    if (errors.length > 0) {
                        const details = this.formatValidationErrors(errors);
                        logger_1.logger.warn(this.node, `Body validation failed for ${dtoClass.name}`);
                        return response_helper_1.ResponseHelper.validationError(res, 'Request body validation failed', details, this.node);
                    }
                    // Replace request body with validated and transformed data
                    req.body = dto;
                    next();
                }
                catch (error) {
                    logger_1.logger.error(this.node, `Body validation error: ${error.message}`);
                    response_helper_1.ResponseHelper.validationError(res, 'Body validation error occurred', undefined, this.node);
                }
            };
        };
        /**
         * Validate request query parameters using DTO class
         */
        this.validateQuery = (dtoClass) => {
            return async (req, res, next) => {
                try {
                    const dto = (0, class_transformer_1.plainToClass)(dtoClass, req.query);
                    const errors = await (0, class_validator_1.validate)(dto, {
                        whitelist: true,
                        forbidNonWhitelisted: true
                    });
                    if (errors.length > 0) {
                        const details = this.formatValidationErrors(errors);
                        logger_1.logger.warn(this.node, `Query validation failed for ${dtoClass.name}`);
                        return response_helper_1.ResponseHelper.validationError(res, 'Query parameters validation failed', details, this.node);
                    }
                    // Replace request query with validated and transformed data
                    req.query = dto;
                    next();
                }
                catch (error) {
                    logger_1.logger.error(this.node, `Query validation error: ${error.message}`);
                    response_helper_1.ResponseHelper.validationError(res, 'Query validation error occurred', undefined, this.node);
                }
            };
        };
        /**
         * Validate request parameters using DTO class
         */
        this.validateParams = (dtoClass) => {
            return async (req, res, next) => {
                try {
                    const dto = (0, class_transformer_1.plainToClass)(dtoClass, req.params);
                    const errors = await (0, class_validator_1.validate)(dto, {
                        whitelist: true,
                        forbidNonWhitelisted: true
                    });
                    if (errors.length > 0) {
                        const details = this.formatValidationErrors(errors);
                        logger_1.logger.warn(this.node, `Params validation failed for ${dtoClass.name}`);
                        return response_helper_1.ResponseHelper.validationError(res, 'URL parameters validation failed', details, this.node);
                    }
                    // Replace request params with validated and transformed data
                    req.params = dto;
                    next();
                }
                catch (error) {
                    logger_1.logger.error(this.node, `Params validation error: ${error.message}`);
                    response_helper_1.ResponseHelper.validationError(res, 'Parameters validation error occurred', undefined, this.node);
                }
            };
        };
        /**
         * Create a validation middleware that validates against multiple DTO classes
         * Useful for endpoints that accept different request formats
         *
         * @example
         * ```typescript
         * // Validate either LoginDto or RefreshTokenDto
         * app.post('/auth',
         *   validationMiddleware.validateOneOf([LoginDto, RefreshTokenDto]),
         *   authController.authenticate
         * );
         * ```
         */
        this.validateOneOf = (dtoClasses) => {
            return async (req, res, next) => {
                const errors = [];
                for (const dtoClass of dtoClasses) {
                    try {
                        const dto = (0, class_transformer_1.plainToClass)(dtoClass, req.body);
                        const validationErrors = await (0, class_validator_1.validate)(dto, {
                            whitelist: true,
                            forbidNonWhitelisted: true
                        });
                        if (validationErrors.length === 0) {
                            req.body = dto;
                            return next();
                        }
                        errors.push(`${dtoClass.name}: ${validationErrors.length} validation errors`);
                    }
                    catch (error) {
                        errors.push(`${dtoClass.name}: ${error.message}`);
                    }
                }
                logger_1.logger.warn(this.node, `Validation failed for all DTO classes: ${errors.join(', ')}`);
                response_helper_1.ResponseHelper.validationError(res, 'Request does not match any expected format', { attemptedValidations: errors }, this.node);
            };
        };
    }
    /**
     * Format validation errors for consistent API responses
     *
     * This method provides a standardized way to format validation errors
     * that can be reused across all API modules.
     */
    formatValidationErrors(errors) {
        const details = [];
        const extractErrors = (error, parentPath = '') => {
            const fieldPath = parentPath ? `${parentPath}.${error.property}` : error.property;
            if (error.constraints) {
                Object.values(error.constraints).forEach(message => {
                    details.push({
                        field: fieldPath,
                        message,
                        value: error.value
                    });
                });
            }
            if (error.children && error.children.length > 0) {
                error.children.forEach(child => extractErrors(child, fieldPath));
            }
        };
        errors.forEach(error => extractErrors(error));
        return details;
    }
};
exports.ValidationMiddleware = ValidationMiddleware;
exports.ValidationMiddleware = ValidationMiddleware = __decorate([
    (0, typedi_1.Service)(),
    __metadata("design:paramtypes", [typeof (_a = typeof node_red_1.Node !== "undefined" && node_red_1.Node) === "function" ? _a : Object])
], ValidationMiddleware);
