/**
 * @fileoverview Custom validation decorators for enhanced business logic validation
 * 
 * This module provides custom validation decorators that extend class-validator
 * with business-specific validation rules for the VIIS REST API module.
 * 
 * Features:
 * - Password confirmation matching validation
 * - Device configuration validation
 * - Custom business rule validation
 * - Conditional validation based on other fields
 * - Array element validation with custom rules
 */

import {
    registerDecorator,
    ValidationOptions,
    ValidationArguments,
    ValidatorConstraint,
    ValidatorConstraintInterface
} from 'class-validator';

/**
 * Custom validator for password confirmation matching
 */
@ValidatorConstraint({ name: 'passwordMatch', async: false })
export class PasswordMatchConstraint implements ValidatorConstraintInterface {
    validate(confirmPassword: any, args: ValidationArguments) {
        const [relatedPropertyName] = args.constraints;
        const relatedValue = (args.object as any)[relatedPropertyName];
        return confirmPassword === relatedValue;
    }

    defaultMessage(args: ValidationArguments) {
        const [relatedPropertyName] = args.constraints;
        return `Password confirmation must match ${relatedPropertyName}`;
    }
}

/**
 * Password match decorator
 * Validates that a field matches another field (typically for password confirmation)
 * 
 * @param property - The property name to match against
 * @param validationOptions - Additional validation options
 * 
 * @example
 * ```typescript
 * export class ChangePasswordDto {
 *   @IsString()
 *   newPassword: string;
 * 
 *   @IsString()
 *   @PasswordMatch('newPassword')
 *   confirmPassword: string;
 * }
 * ```
 */
export function PasswordMatch(property: string, validationOptions?: ValidationOptions) {
    return function (object: Object, propertyName: string) {
        registerDecorator({
            target: object.constructor,
            propertyName: propertyName,
            options: validationOptions,
            constraints: [property],
            validator: PasswordMatchConstraint,
        });
    };
}

/**
 * Custom validator for device configuration validation
 */
@ValidatorConstraint({ name: 'deviceConfigValid', async: false })
export class DeviceConfigValidConstraint implements ValidatorConstraintInterface {
    validate(config: any, args: ValidationArguments) {
        if (!config || typeof config !== 'object') {
            return false;
        }

        // Validate based on device type from the parent object
        const deviceType = (args.object as any).deviceType;
        
        switch (deviceType) {
            case 'sensor':
                return this.validateSensorConfig(config);
            case 'actuator':
                return this.validateActuatorConfig(config);
            case 'controller':
                return this.validateControllerConfig(config);
            case 'gateway':
                return this.validateGatewayConfig(config);
            default:
                return true; // Allow any config for unknown types
        }
    }

    private validateSensorConfig(config: any): boolean {
        // Sensors should have polling interval
        if (config.pollingInterval && (config.pollingInterval < 1 || config.pollingInterval > 3600)) {
            return false;
        }
        return true;
    }

    private validateActuatorConfig(config: any): boolean {
        // Actuators should have response timeout
        if (config.timeout && (config.timeout < 1 || config.timeout > 300)) {
            return false;
        }
        return true;
    }

    private validateControllerConfig(config: any): boolean {
        // Controllers should have both polling interval and timeout
        if (config.pollingInterval && (config.pollingInterval < 1 || config.pollingInterval > 3600)) {
            return false;
        }
        if (config.timeout && (config.timeout < 1 || config.timeout > 300)) {
            return false;
        }
        return true;
    }

    private validateGatewayConfig(config: any): boolean {
        // Gateways should have IP address and port
        if (config.ipAddress && !this.isValidIP(config.ipAddress)) {
            return false;
        }
        if (config.port && (config.port < 1 || config.port > 65535)) {
            return false;
        }
        return true;
    }

    private isValidIP(ip: string): boolean {
        const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        return ipRegex.test(ip);
    }

    defaultMessage(args: ValidationArguments) {
        const deviceType = (args.object as any).deviceType;
        return `Device configuration is invalid for device type: ${deviceType}`;
    }
}

/**
 * Device configuration validation decorator
 * Validates device configuration based on device type
 * 
 * @param validationOptions - Additional validation options
 * 
 * @example
 * ```typescript
 * export class CreateDeviceDto {
 *   @IsEnum(DeviceType)
 *   deviceType: DeviceType;
 * 
 *   @ValidateNested()
 *   @Type(() => DeviceConfigurationDto)
 *   @DeviceConfigValid()
 *   configuration?: DeviceConfigurationDto;
 * }
 * ```
 */
export function DeviceConfigValid(validationOptions?: ValidationOptions) {
    return function (object: Object, propertyName: string) {
        registerDecorator({
            target: object.constructor,
            propertyName: propertyName,
            options: validationOptions,
            validator: DeviceConfigValidConstraint,
        });
    };
}

/**
 * Custom validator for unique array elements
 */
@ValidatorConstraint({ name: 'arrayUnique', async: false })
export class ArrayUniqueConstraint implements ValidatorConstraintInterface {
    validate(array: any[], args: ValidationArguments) {
        if (!Array.isArray(array)) {
            return false;
        }

        const uniqueValues = new Set(array);
        return uniqueValues.size === array.length;
    }

    defaultMessage(args: ValidationArguments) {
        return `${args.property} must contain unique values`;
    }
}

/**
 * Array unique decorator
 * Validates that all elements in an array are unique
 * 
 * @param validationOptions - Additional validation options
 * 
 * @example
 * ```typescript
 * export class CreateDeviceDto {
 *   @IsArray()
 *   @IsString({ each: true })
 *   @ArrayUnique()
 *   tags?: string[];
 * }
 * ```
 */
export function ArrayUnique(validationOptions?: ValidationOptions) {
    return function (object: Object, propertyName: string) {
        registerDecorator({
            target: object.constructor,
            propertyName: propertyName,
            options: validationOptions,
            validator: ArrayUniqueConstraint,
        });
    };
}

/**
 * Custom validator for conditional validation
 */
@ValidatorConstraint({ name: 'conditionalRequired', async: false })
export class ConditionalRequiredConstraint implements ValidatorConstraintInterface {
    validate(value: any, args: ValidationArguments) {
        const [relatedPropertyName, relatedValue] = args.constraints;
        const relatedPropertyValue = (args.object as any)[relatedPropertyName];
        
        // If the related property has the specified value, this field is required
        if (relatedPropertyValue === relatedValue) {
            return value !== undefined && value !== null && value !== '';
        }
        
        // Otherwise, this field is optional
        return true;
    }

    defaultMessage(args: ValidationArguments) {
        const [relatedPropertyName, relatedValue] = args.constraints;
        return `${args.property} is required when ${relatedPropertyName} is ${relatedValue}`;
    }
}

/**
 * Conditional required decorator
 * Makes a field required based on the value of another field
 * 
 * @param property - The property name to check
 * @param value - The value that makes this field required
 * @param validationOptions - Additional validation options
 * 
 * @example
 * ```typescript
 * export class CreateDeviceDto {
 *   @IsEnum(DeviceType)
 *   deviceType: DeviceType;
 * 
 *   @IsOptional()
 *   @IsString()
 *   @ConditionalRequired('deviceType', 'gateway')
 *   ipAddress?: string;
 * }
 * ```
 */
export function ConditionalRequired(
    property: string, 
    value: any, 
    validationOptions?: ValidationOptions
) {
    return function (object: Object, propertyName: string) {
        registerDecorator({
            target: object.constructor,
            propertyName: propertyName,
            options: validationOptions,
            constraints: [property, value],
            validator: ConditionalRequiredConstraint,
        });
    };
}
