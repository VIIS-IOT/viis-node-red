"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateDto = validateDto;
// src/utils/validation.ts
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
async function validateDto(dtoClass, data) {
    const dtoInstance = (0, class_transformer_1.plainToClass)(dtoClass, data);
    const errors = await (0, class_validator_1.validate)(dtoInstance);
    if (errors.length > 0) {
        const errorMessages = errors
            .map((err) => Object.values(err.constraints || {}).join(', '))
            .join('; ');
        throw new Error(`Validation failed: ${errorMessages}`);
    }
    return dtoInstance;
}
