/**
 * Validation Service for VIIS RPC Control Node
 * Handles value validation and type conversion
 */

import { 
    IValidationService, 
    IConfigService, 
    ServiceOptions,
    SupportedDataType 
} from "../interfaces/types";
import { ERROR_MESSAGES } from "../constants";
import { Logger } from "../utils/logger";

export class ValidationService implements IValidationService {
    private configService: IConfigService;
    private logger: Logger;

    constructor(options: ServiceOptions, configService: IConfigService) {
        this.configService = configService;
        this.logger = new Logger(options.node, "VALIDATION-SERVICE");
    }

    /**
     * Validate and convert a value based on its expected type
     */
    validateAndConvertValue(key: string, value: any): any {
        const configKeys = this.configService.getConfigKeys();
        const expectedType = configKeys[key];

        // If key doesn't exist in configKeys, auto-detect type and add it
        if (!expectedType) {
            const detectedType = this.detectValueType(value);
            this.configService.addConfigKey(key, value);
            return this.convertValueByType(key, value, detectedType);
        }

        return this.convertValueByType(key, value, expectedType);
    }

    /**
     * Convert value to the specified type
     */
    convertValueByType(key: string, value: any, expectedType: SupportedDataType): any {
        try {
            switch (expectedType) {
                case "number":
                    return this.convertToNumber(key, value);
                case "boolean":
                    return this.convertToBoolean(value);
                case "string":
                    return this.convertToString(value);
                default:
                    this.logger.warn(`Unknown type ${expectedType} for key ${key}, returning original value`);
                    return value;
            }
        } catch (error) {
            const errorMessage = ERROR_MESSAGES.VALUE_CONVERSION_FAILED(key) + `: ${(error as Error).message}`;
            this.logger.error(errorMessage);
            throw new Error(errorMessage);
        }
    }

    /**
     * Auto-detect the type of a value
     */
    private detectValueType(value: any): SupportedDataType {
        if (typeof value === "boolean") {
            return "boolean";
        }
        
        if (typeof value === "number" || (!isNaN(Number(value)) && value !== "" && value !== null)) {
            return "number";
        }
        
        if (typeof value === "string" && (value.toLowerCase() === "true" || value.toLowerCase() === "false")) {
            return "boolean";
        }
        
        return "string";
    }

    /**
     * Convert value to number with validation
     */
    private convertToNumber(key: string, value: any): number {
        if (typeof value === "number") {
            if (isNaN(value) || !isFinite(value)) {
                throw new Error(ERROR_MESSAGES.INVALID_NUMBER(key));
            }
            return value;
        }

        if (typeof value === "string") {
            const trimmed = value.trim();
            if (trimmed === "") {
                throw new Error(ERROR_MESSAGES.INVALID_NUMBER(key));
            }
            
            const num = Number(trimmed);
            if (isNaN(num) || !isFinite(num)) {
                throw new Error(ERROR_MESSAGES.INVALID_NUMBER(key));
            }
            return num;
        }

        if (typeof value === "boolean") {
            return value ? 1 : 0;
        }

        throw new Error(ERROR_MESSAGES.INVALID_NUMBER(key));
    }

    /**
     * Convert value to boolean
     */
    private convertToBoolean(value: any): boolean {
        if (typeof value === "boolean") {
            return value;
        }

        if (typeof value === "string") {
            const lower = value.toLowerCase().trim();
            if (lower === "true" || lower === "1" || lower === "yes" || lower === "on") {
                return true;
            }
            if (lower === "false" || lower === "0" || lower === "no" || lower === "off" || lower === "") {
                return false;
            }
            // For other strings, return true if non-empty
            return value.trim().length > 0;
        }

        if (typeof value === "number") {
            return value !== 0;
        }

        // For other types, use JavaScript's truthiness
        return Boolean(value);
    }

    /**
     * Convert value to string
     */
    private convertToString(value: any): string {
        if (value === null || value === undefined) {
            return "";
        }

        if (typeof value === "string") {
            return value;
        }

        if (typeof value === "boolean") {
            return value ? "true" : "false";
        }

        if (typeof value === "number") {
            if (isNaN(value)) {
                return "NaN";
            }
            if (!isFinite(value)) {
                return value > 0 ? "Infinity" : "-Infinity";
            }
            return value.toString();
        }

        // For objects and arrays, convert to JSON
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    /**
     * Validate multiple values at once
     */
    validateAndConvertValues(values: Record<string, any>): Record<string, any> {
        const convertedValues: Record<string, any> = {};
        
        for (const [key, value] of Object.entries(values)) {
            try {
                convertedValues[key] = this.validateAndConvertValue(key, value);
            } catch (error) {
                this.logger.error(`Failed to validate value for key ${key}: ${(error as Error).message}`);
                throw error;
            }
        }
        
        return convertedValues;
    }

    /**
     * Check if a value is valid for a given type without converting
     */
    isValidForType(value: any, type: SupportedDataType): boolean {
        try {
            this.convertValueByType("test", value, type);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get the expected type for a key
     */
    getExpectedType(key: string): SupportedDataType | null {
        const configKeys = this.configService.getConfigKeys();
        return configKeys[key] || null;
    }

    /**
     * Validate that a key exists in configuration
     */
    isKeyConfigured(key: string): boolean {
        const configKeys = this.configService.getConfigKeys();
        return key in configKeys;
    }
}
