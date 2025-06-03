/**
 * @fileoverview Base validator class using class-validator for validation
 */

import { validate, ValidationError } from 'class-validator';
import { plainToClass, ClassConstructor } from 'class-transformer';
import { IValidator, ApiError, ErrorType } from '../types/common.types';

/**
 * Base validator class that all validators should extend
 */
export abstract class BaseValidator implements IValidator {
    /**
     * Validate data using class-validator
     */
    async validate<T extends object>(
        dtoClass: ClassConstructor<T>,
        data: any
    ): Promise<T> {
        try {
            // Transform plain object to class instance
            const dto = plainToClass(dtoClass, data);

            // Validate the DTO
            const errors = await validate(dto, {
                whitelist: true,
                forbidNonWhitelisted: true
            });

            if (errors.length > 0) {
                const details = this.formatValidationErrors(errors);
                throw new ApiError(
                    ErrorType.VALIDATION_ERROR,
                    'Validation failed',
                    400,
                    details
                );
            }

            return dto;
        } catch (error) {
            if (error instanceof ApiError) {
                throw error;
            }

            throw new ApiError(
                ErrorType.VALIDATION_ERROR,
                'Validation error occurred',
                400,
                { originalError: (error as Error).message }
            );
        }
    }

    /**
     * Format validation errors for API response
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
     * Validate data with custom error handling
     */
    protected async validateWithCustomError<T extends object>(
        dtoClass: ClassConstructor<T>,
        data: any,
        errorMessage?: string
    ): Promise<T> {
        try {
            return await this.validate(dtoClass, data);
        } catch (error) {
            if (error instanceof ApiError && errorMessage) {
                error.message = errorMessage;
            }
            throw error;
        }
    }

    /**
     * Validate query parameters using DTO class
     */
    async validateQuery<T extends object>(
        dtoClass: ClassConstructor<T>,
        query: any
    ): Promise<T> {
        return this.validate(dtoClass, query);
    }

    /**
     * Validate request body using DTO class
     */
    async validateBody<T extends object>(
        dtoClass: ClassConstructor<T>,
        body: any
    ): Promise<T> {
        return this.validate(dtoClass, body);
    }

    /**
     * Validate request parameters using DTO class
     */
    async validateParams<T extends object>(
        dtoClass: ClassConstructor<T>,
        params: any
    ): Promise<T> {
        return this.validate(dtoClass, params);
    }
}
