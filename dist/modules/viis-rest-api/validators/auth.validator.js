"use strict";
/**
 * @fileoverview Authentication validator using class-validator
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthValidator = void 0;
const typedi_1 = require("typedi");
const base_validator_1 = require("./base.validator");
const auth_dto_1 = require("../dto/auth.dto");
/**
 * Authentication validator class
 */
let AuthValidator = class AuthValidator extends base_validator_1.BaseValidator {
    /**
     * Validate login request
     */
    async validateLogin(data) {
        return this.validate(auth_dto_1.LoginDto, data);
    }
    /**
     * Validate token
     */
    async validateToken(data) {
        return this.validate(auth_dto_1.TokenDto, data);
    }
    /**
     * Validate change password request
     */
    async validateChangePassword(data) {
        return this.validate(auth_dto_1.ChangePasswordDto, data);
    }
    /**
     * Extract token from authorization header
     */
    extractTokenFromHeader(authHeader) {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new Error('Invalid authorization header format');
        }
        return authHeader.substring(7); // Remove 'Bearer ' prefix
    }
    /**
     * Validate authorization header format
     */
    validateAuthHeader(authHeader) {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new Error('Invalid authorization header format');
        }
    }
    /**
     * Validate and extract token from request headers
     */
    async validateAndExtractToken(headers) {
        const authHeader = headers.authorization;
        this.validateAuthHeader(authHeader);
        return this.extractTokenFromHeader(authHeader);
    }
};
exports.AuthValidator = AuthValidator;
exports.AuthValidator = AuthValidator = __decorate([
    (0, typedi_1.Service)()
], AuthValidator);
