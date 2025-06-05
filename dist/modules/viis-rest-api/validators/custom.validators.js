"use strict";
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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConditionalRequiredConstraint = exports.ArrayUniqueConstraint = exports.DeviceConfigValidConstraint = exports.PasswordMatchConstraint = void 0;
exports.PasswordMatch = PasswordMatch;
exports.DeviceConfigValid = DeviceConfigValid;
exports.ArrayUnique = ArrayUnique;
exports.ConditionalRequired = ConditionalRequired;
const class_validator_1 = require("class-validator");
/**
 * Custom validator for password confirmation matching
 */
let PasswordMatchConstraint = class PasswordMatchConstraint {
    validate(confirmPassword, args) {
        const [relatedPropertyName] = args.constraints;
        const relatedValue = args.object[relatedPropertyName];
        return confirmPassword === relatedValue;
    }
    defaultMessage(args) {
        const [relatedPropertyName] = args.constraints;
        return `Password confirmation must match ${relatedPropertyName}`;
    }
};
exports.PasswordMatchConstraint = PasswordMatchConstraint;
exports.PasswordMatchConstraint = PasswordMatchConstraint = __decorate([
    (0, class_validator_1.ValidatorConstraint)({ name: 'passwordMatch', async: false })
], PasswordMatchConstraint);
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
function PasswordMatch(property, validationOptions) {
    return function (object, propertyName) {
        (0, class_validator_1.registerDecorator)({
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
let DeviceConfigValidConstraint = class DeviceConfigValidConstraint {
    validate(config, args) {
        if (!config || typeof config !== 'object') {
            return false;
        }
        // Validate based on device type from the parent object
        const deviceType = args.object.deviceType;
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
    validateSensorConfig(config) {
        // Sensors should have polling interval
        if (config.pollingInterval && (config.pollingInterval < 1 || config.pollingInterval > 3600)) {
            return false;
        }
        return true;
    }
    validateActuatorConfig(config) {
        // Actuators should have response timeout
        if (config.timeout && (config.timeout < 1 || config.timeout > 300)) {
            return false;
        }
        return true;
    }
    validateControllerConfig(config) {
        // Controllers should have both polling interval and timeout
        if (config.pollingInterval && (config.pollingInterval < 1 || config.pollingInterval > 3600)) {
            return false;
        }
        if (config.timeout && (config.timeout < 1 || config.timeout > 300)) {
            return false;
        }
        return true;
    }
    validateGatewayConfig(config) {
        // Gateways should have IP address and port
        if (config.ipAddress && !this.isValidIP(config.ipAddress)) {
            return false;
        }
        if (config.port && (config.port < 1 || config.port > 65535)) {
            return false;
        }
        return true;
    }
    isValidIP(ip) {
        const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        return ipRegex.test(ip);
    }
    defaultMessage(args) {
        const deviceType = args.object.deviceType;
        return `Device configuration is invalid for device type: ${deviceType}`;
    }
};
exports.DeviceConfigValidConstraint = DeviceConfigValidConstraint;
exports.DeviceConfigValidConstraint = DeviceConfigValidConstraint = __decorate([
    (0, class_validator_1.ValidatorConstraint)({ name: 'deviceConfigValid', async: false })
], DeviceConfigValidConstraint);
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
function DeviceConfigValid(validationOptions) {
    return function (object, propertyName) {
        (0, class_validator_1.registerDecorator)({
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
let ArrayUniqueConstraint = class ArrayUniqueConstraint {
    validate(array, args) {
        if (!Array.isArray(array)) {
            return false;
        }
        const uniqueValues = new Set(array);
        return uniqueValues.size === array.length;
    }
    defaultMessage(args) {
        return `${args.property} must contain unique values`;
    }
};
exports.ArrayUniqueConstraint = ArrayUniqueConstraint;
exports.ArrayUniqueConstraint = ArrayUniqueConstraint = __decorate([
    (0, class_validator_1.ValidatorConstraint)({ name: 'arrayUnique', async: false })
], ArrayUniqueConstraint);
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
function ArrayUnique(validationOptions) {
    return function (object, propertyName) {
        (0, class_validator_1.registerDecorator)({
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
let ConditionalRequiredConstraint = class ConditionalRequiredConstraint {
    validate(value, args) {
        const [relatedPropertyName, relatedValue] = args.constraints;
        const relatedPropertyValue = args.object[relatedPropertyName];
        // If the related property has the specified value, this field is required
        if (relatedPropertyValue === relatedValue) {
            return value !== undefined && value !== null && value !== '';
        }
        // Otherwise, this field is optional
        return true;
    }
    defaultMessage(args) {
        const [relatedPropertyName, relatedValue] = args.constraints;
        return `${args.property} is required when ${relatedPropertyName} is ${relatedValue}`;
    }
};
exports.ConditionalRequiredConstraint = ConditionalRequiredConstraint;
exports.ConditionalRequiredConstraint = ConditionalRequiredConstraint = __decorate([
    (0, class_validator_1.ValidatorConstraint)({ name: 'conditionalRequired', async: false })
], ConditionalRequiredConstraint);
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
function ConditionalRequired(property, value, validationOptions) {
    return function (object, propertyName) {
        (0, class_validator_1.registerDecorator)({
            target: object.constructor,
            propertyName: propertyName,
            options: validationOptions,
            constraints: [property, value],
            validator: ConditionalRequiredConstraint,
        });
    };
}
