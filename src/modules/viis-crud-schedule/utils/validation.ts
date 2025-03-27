// src/utils/validation.ts
import { validate, ValidationError } from 'class-validator';
import { plainToClass } from 'class-transformer';

export async function validateDto<T extends object>(dtoClass: new () => T, data: any): Promise<T> {
    const dtoInstance = plainToClass(dtoClass, data);
    const errors: ValidationError[] = await validate(dtoInstance);

    if (errors.length > 0) {
        const errorMessages = errors
            .map((err) => Object.values(err.constraints || {}).join(', '))
            .join('; ');
        throw new Error(`Validation failed: ${errorMessages}`);
    }

    return dtoInstance;
}