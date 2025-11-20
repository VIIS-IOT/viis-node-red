"use strict";
/**
 * @fileoverview Base validator class using class-validator for validation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseValidator = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const common_types_1 = require("../types/common.types");
/**
 * Base validator class that all validators should extend
 */
class BaseValidator {
    /**
     * Validate data using class-validator
     */
    async validate(dtoClass, data) {
        try {
            // Transform plain object to class instance
            const dto = (0, class_transformer_1.plainToClass)(dtoClass, data);
            // Validate the DTO
            const errors = await (0, class_validator_1.validate)(dto, {
                whitelist: true,
                forbidNonWhitelisted: true
            });
            if (errors.length > 0) {
                const details = this.formatValidationErrors(errors);
                throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, 'Validation failed', 400, details);
            }
            return dto;
        }
        catch (error) {
            if (error instanceof common_types_1.ApiError) {
                throw error;
            }
            throw new common_types_1.ApiError(common_types_1.ErrorType.VALIDATION_ERROR, 'Validation error occurred', 400, { originalError: error.message });
        }
    }
    /**
     * Format validation errors for API response
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
    /**
     * Validate data with custom error handling
     */
    async validateWithCustomError(dtoClass, data, errorMessage) {
        try {
            return await this.validate(dtoClass, data);
        }
        catch (error) {
            if (error instanceof common_types_1.ApiError && errorMessage) {
                error.message = errorMessage;
            }
            throw error;
        }
    }
    /**
     * Validate query parameters using DTO class
     */
    async validateQuery(dtoClass, query) {
        return this.validate(dtoClass, query);
    }
    /**
     * Validate request body using DTO class
     */
    async validateBody(dtoClass, body) {
        return this.validate(dtoClass, body);
    }
    /**
     * Validate request parameters using DTO class
     */
    async validateParams(dtoClass, params) {
        return this.validate(dtoClass, params);
    }
}
exports.BaseValidator = BaseValidator;
