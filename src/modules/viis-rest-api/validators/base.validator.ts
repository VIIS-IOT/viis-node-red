/**
 * @fileoverview Base validator class using Joi for validation
 */

import Joi from 'joi';
import { IValidator, ApiError, ErrorType } from '../types/common.types';

/**
 * Base validator class that all validators should extend
 */
export abstract class BaseValidator implements IValidator {
    /**
     * Validate data against schema
     */
    async validate(data: any, schema?: Joi.ObjectSchema): Promise<any> {
        if (!schema) {
            throw new ApiError(
                ErrorType.INTERNAL_ERROR,
                'Validation schema not provided',
                500
            );
        }

        try {
            const { error, value } = schema.validate(data, {
                abortEarly: false,
                stripUnknown: true,
                convert: true
            });

            if (error) {
                const details = error.details.map(detail => ({
                    field: detail.path.join('.'),
                    message: detail.message,
                    value: detail.context?.value
                }));

                throw new ApiError(
                    ErrorType.VALIDATION_ERROR,
                    'Validation failed',
                    400,
                    details
                );
            }

            return value;
        } catch (error) {
            if (error instanceof ApiError) {
                throw error;
            }

            throw new ApiError(
                ErrorType.VALIDATION_ERROR,
                'Validation error occurred',
                400,
                { originalError: error.message }
            );
        }
    }

    /**
     * Common validation schemas
     */
    protected static commonSchemas = {
        id: Joi.string().required().min(1).max(255),
        email: Joi.string().email().required(),
        password: Joi.string().min(6).max(255).required(),
        name: Joi.string().min(1).max(255).required(),
        optionalName: Joi.string().min(1).max(255).optional(),
        phone: Joi.string().pattern(/^[+]?[\d\s\-()]+$/).optional(),
        boolean: Joi.boolean().optional(),
        number: Joi.number().integer().min(0).optional(),
        positiveNumber: Joi.number().integer().min(1).optional(),
        pagination: Joi.object({
            page: Joi.number().integer().min(1).default(1),
            limit: Joi.number().integer().min(1).max(100).default(10)
        }).optional(),
        search: Joi.string().min(1).max(255).optional(),
        customerId: Joi.string().min(1).max(255).optional(),
        deviceId: Joi.string().min(1).max(255).required(),
        timestamp: Joi.date().iso().optional(),
        dateRange: Joi.object({
            startDate: Joi.date().iso().optional(),
            endDate: Joi.date().iso().optional()
        }).optional()
    };

    /**
     * Validate pagination parameters
     */
    protected validatePagination(data: any) {
        return this.validate(data, BaseValidator.commonSchemas.pagination);
    }

    /**
     * Validate ID parameter
     */
    protected validateId(id: any) {
        return this.validate({ id }, Joi.object({ id: BaseValidator.commonSchemas.id }));
    }

    /**
     * Validate email
     */
    protected validateEmail(email: any) {
        return this.validate({ email }, Joi.object({ email: BaseValidator.commonSchemas.email }));
    }

    /**
     * Create custom validation schema
     */
    protected createSchema(schemaDefinition: Record<string, Joi.Schema>): Joi.ObjectSchema {
        return Joi.object(schemaDefinition);
    }

    /**
     * Validate query parameters
     */
    async validateQuery(query: any, schema: Joi.ObjectSchema): Promise<any> {
        return this.validate(query, schema);
    }

    /**
     * Validate request body
     */
    async validateBody(body: any, schema: Joi.ObjectSchema): Promise<any> {
        return this.validate(body, schema);
    }

    /**
     * Validate request parameters
     */
    async validateParams(params: any, schema: Joi.ObjectSchema): Promise<any> {
        return this.validate(params, schema);
    }
}
