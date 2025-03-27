"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateDto = validateDto;
// src/utils/validation.ts
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
function validateDto(dtoClass, data) {
    return __awaiter(this, void 0, void 0, function* () {
        const dtoInstance = (0, class_transformer_1.plainToClass)(dtoClass, data);
        const errors = yield (0, class_validator_1.validate)(dtoInstance);
        if (errors.length > 0) {
            const errorMessages = errors
                .map((err) => Object.values(err.constraints || {}).join(', '))
                .join('; ');
            throw new Error(`Validation failed: ${errorMessages}`);
        }
        return dtoInstance;
    });
}
