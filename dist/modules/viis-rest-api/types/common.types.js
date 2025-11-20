"use strict";
/**
 * @fileoverview Common types and interfaces for VIIS REST API
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiError = exports.ErrorType = void 0;
/**
 * Error types
 */
var ErrorType;
(function (ErrorType) {
    ErrorType["VALIDATION_ERROR"] = "VALIDATION_ERROR";
    ErrorType["AUTHENTICATION_ERROR"] = "AUTHENTICATION_ERROR";
    ErrorType["AUTHORIZATION_ERROR"] = "AUTHORIZATION_ERROR";
    ErrorType["NOT_FOUND_ERROR"] = "NOT_FOUND_ERROR";
    ErrorType["INTERNAL_ERROR"] = "INTERNAL_ERROR";
    ErrorType["DATABASE_ERROR"] = "DATABASE_ERROR";
    ErrorType["RATE_LIMIT_ERROR"] = "RATE_LIMIT_ERROR";
})(ErrorType || (exports.ErrorType = ErrorType = {}));
/**
 * Custom API Error class
 */
class ApiError extends Error {
    constructor(type, message, statusCode = 500, details) {
        super(message);
        this.type = type;
        this.statusCode = statusCode;
        this.details = details;
        this.name = 'ApiError';
    }
}
exports.ApiError = ApiError;
