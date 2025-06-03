/**
 * @fileoverview Validation middleware
 */

import { Request, Response, NextFunction } from 'express';
import { Node } from 'node-red';
import Joi from 'joi';
import { ResponseHelper } from '../utils/response.helper';
import { logger } from '../utils/logger';

/**
 * Validation middleware class
 */
export class ValidationMiddleware {
    private node: Node;

    constructor(node: Node) {
        this.node = node;
    }

    /**
     * Validate request body
     */
    validateBody = (schema: Joi.ObjectSchema) => {
        return (req: Request, res: Response, next: NextFunction): void => {
            try {
                const { error, value } = schema.validate(req.body, {
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

                    logger.warn(this.node, `Body validation failed: ${error.message}`);
                    return ResponseHelper.validationError(
                        res,
                        'Request body validation failed',
                        details,
                        this.node
                    );
                }

                // Replace request body with validated and sanitized data
                req.body = value;
                next();

            } catch (error) {
                logger.error(this.node, `Body validation error: ${(error as Error).message}`);
                ResponseHelper.validationError(
                    res,
                    'Body validation error occurred',
                    undefined,
                    this.node
                );
            }
        };
    };

    /**
     * Validate request query parameters
     */
    validateQuery = (schema: Joi.ObjectSchema) => {
        return (req: Request, res: Response, next: NextFunction): void => {
            try {
                const { error, value } = schema.validate(req.query, {
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

                    logger.warn(this.node, `Query validation failed: ${error.message}`);
                    return ResponseHelper.validationError(
                        res,
                        'Query parameters validation failed',
                        details,
                        this.node
                    );
                }

                // Replace request query with validated and sanitized data
                req.query = value;
                next();

            } catch (error) {
                logger.error(this.node, `Query validation error: ${(error as Error).message}`);
                ResponseHelper.validationError(
                    res,
                    'Query validation error occurred',
                    undefined,
                    this.node
                );
            }
        };
    };

    /**
     * Validate request parameters
     */
    validateParams = (schema: Joi.ObjectSchema) => {
        return (req: Request, res: Response, next: NextFunction): void => {
            try {
                const { error, value } = schema.validate(req.params, {
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

                    logger.warn(this.node, `Params validation failed: ${error.message}`);
                    return ResponseHelper.validationError(
                        res,
                        'URL parameters validation failed',
                        details,
                        this.node
                    );
                }

                // Replace request params with validated and sanitized data
                req.params = value;
                next();

            } catch (error) {
                logger.error(this.node, `Params validation error: ${(error as Error).message}`);
                ResponseHelper.validationError(
                    res,
                    'Parameters validation error occurred',
                    undefined,
                    this.node
                );
            }
        };
    };

    /**
     * Validate pagination parameters
     */
    validatePagination = (req: Request, res: Response, next: NextFunction): void => {
        const paginationSchema = Joi.object({
            page: Joi.number().integer().min(1).default(1),
            limit: Joi.number().integer().min(1).max(100).default(10),
            offset: Joi.number().integer().min(0).optional()
        });

        this.validateQuery(paginationSchema)(req, res, next);
    };

    /**
     * Validate common ID parameter
     */
    validateIdParam = (paramName: string = 'id') => {
        const schema = Joi.object({
            [paramName]: Joi.string().required().min(1).max(255).messages({
                'string.empty': `${paramName} is required`,
                'string.min': `${paramName} must be at least 1 character`,
                'string.max': `${paramName} must not exceed 255 characters`,
                'any.required': `${paramName} is required`
            })
        });

        return this.validateParams(schema);
    };

    /**
     * Validate date range parameters
     */
    validateDateRange = (req: Request, res: Response, next: NextFunction): void => {
        const dateRangeSchema = Joi.object({
            startDate: Joi.date().iso().optional(),
            endDate: Joi.date().iso().optional(),
            start_date: Joi.date().iso().optional(),
            end_date: Joi.date().iso().optional()
        }).custom((value, helpers) => {
            const startDate = value.startDate || value.start_date;
            const endDate = value.endDate || value.end_date;

            if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
                return helpers.error('date.range', { 
                    message: 'Start date must be before end date' 
                });
            }

            return value;
        });

        this.validateQuery(dateRangeSchema)(req, res, next);
    };
}
