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

import { Request, Response, NextFunction } from 'express';
import { Node } from 'node-red';
import { Service } from 'typedi';
import { validate, ValidationError } from 'class-validator';
import { plainToClass, ClassConstructor } from 'class-transformer';
import { ResponseHelper } from '../utils/response.helper';
import { logger } from '../utils/logger';
import { ApiError, ErrorType } from '../types/common.types';

/**
 * Validation middleware class using class-validator
 *
 * Provides reusable validation patterns that can be used across all API modules.
 * This serves as the foundation for consistent request validation.
 */
@Service()
export class ValidationMiddleware {
    constructor(private node: Node) { }

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
    validateBody = <T extends object>(dtoClass: ClassConstructor<T>) => {
        return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
            try {
                const dto = plainToClass(dtoClass, req.body);
                const errors = await validate(dto, {
                    whitelist: true,
                    forbidNonWhitelisted: true
                });

                if (errors.length > 0) {
                    const details = this.formatValidationErrors(errors);
                    logger.warn(this.node, `Body validation failed for ${dtoClass.name}`);
                    return ResponseHelper.validationError(
                        res,
                        'Request body validation failed',
                        details,
                        this.node
                    );
                }

                // Replace request body with validated and transformed data
                req.body = dto;
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
     * Validate request query parameters using DTO class
     */
    validateQuery = <T extends object>(dtoClass: ClassConstructor<T>) => {
        return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
            try {
                const dto = plainToClass(dtoClass, req.query);
                const errors = await validate(dto, {
                    whitelist: true,
                    forbidNonWhitelisted: true
                });

                if (errors.length > 0) {
                    const details = this.formatValidationErrors(errors);
                    logger.warn(this.node, `Query validation failed for ${dtoClass.name}`);
                    return ResponseHelper.validationError(
                        res,
                        'Query parameters validation failed',
                        details,
                        this.node
                    );
                }

                // Replace request query with validated and transformed data
                req.query = dto as any;
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
     * Validate request parameters using DTO class
     */
    validateParams = <T extends object>(dtoClass: ClassConstructor<T>) => {
        return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
            try {
                const dto = plainToClass(dtoClass, req.params);
                const errors = await validate(dto, {
                    whitelist: true,
                    forbidNonWhitelisted: true
                });

                if (errors.length > 0) {
                    const details = this.formatValidationErrors(errors);
                    logger.warn(this.node, `Params validation failed for ${dtoClass.name}`);
                    return ResponseHelper.validationError(
                        res,
                        'URL parameters validation failed',
                        details,
                        this.node
                    );
                }

                // Replace request params with validated and transformed data
                req.params = dto as any;
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
     * Format validation errors for consistent API responses
     *
     * This method provides a standardized way to format validation errors
     * that can be reused across all API modules.
     */
    private formatValidationErrors(errors: ValidationError[]): any[] {
        const details: any[] = [];

        const extractErrors = (error: ValidationError, parentPath = '') => {
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
    validateOneOf = <T extends object>(dtoClasses: ClassConstructor<T>[]) => {
        return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
            const errors: string[] = [];

            for (const dtoClass of dtoClasses) {
                try {
                    const dto = plainToClass(dtoClass, req.body);
                    const validationErrors = await validate(dto, {
                        whitelist: true,
                        forbidNonWhitelisted: true
                    });

                    if (validationErrors.length === 0) {
                        req.body = dto;
                        return next();
                    }

                    errors.push(`${dtoClass.name}: ${validationErrors.length} validation errors`);
                } catch (error) {
                    errors.push(`${dtoClass.name}: ${(error as Error).message}`);
                }
            }

            logger.warn(this.node, `Validation failed for all DTO classes: ${errors.join(', ')}`);
            ResponseHelper.validationError(
                res,
                'Request does not match any expected format',
                { attemptedValidations: errors },
                this.node
            );
        };
    };
}
