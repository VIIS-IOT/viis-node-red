"use strict";
/**
 * @fileoverview Authentication Service for VIIS REST API
 * Handles user authentication, JWT token generation and verification
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const crypto_1 = __importDefault(require("crypto"));
const node_red_1 = require("node-red");
const typedi_1 = require("typedi");
const logger_1 = require("../utils/logger");
const common_types_1 = require("../types/common.types");
const database_service_1 = require("./database.service");
const base_service_1 = require("./base.service");
const api_config_1 = require("../config/api.config");
/**
 * Authentication service class
 */
let AuthService = class AuthService extends base_service_1.BaseService {
    constructor(databaseService, jwtSecret, node, configManager) {
        // Create service context for BaseService
        const context = {
            node,
            databaseService,
            configManager
        };
        super(context, 'AuthService');
        if (!jwtSecret) {
            throw new Error("JWT secret is required for AuthService");
        }
        this.jwtSecret = jwtSecret;
    }
    /**
     * Initialize the authentication service
     */
    async onInitialize() {
        this.logInfo("Authentication service initialized");
    }
    /**
     * Cleanup resources
     */
    async onCleanup() {
        this.logInfo("Authentication service cleanup completed");
    }
    /**
     * Authenticate user with username/email and password
     */
    async login(loginData) {
        const username = loginData.usr.toString().trim();
        const password = loginData.pwd.toString();
        return this.executeOperation('login', async () => {
            this.logInfo(`Login attempt for user: ${username}`);
            // Find user by username, email, or user_name
            const user = await this.findUser(username);
            if (!user) {
                this.logWarn(`User not found: ${username}`);
                throw new common_types_1.ApiError(common_types_1.ErrorType.AUTHENTICATION_ERROR, "Invalid username or password", 401);
            }
            // Check if user is deactivated
            if (user.is_deactivated === 1) {
                this.logWarn(`Deactivated user login attempt: ${username}`);
                throw new common_types_1.ApiError(common_types_1.ErrorType.AUTHENTICATION_ERROR, "Account is deactivated", 401);
            }
            // Find and validate credentials
            const credentials = await this.findUserCredentials(user.name);
            if (!credentials || credentials.enable !== 1) {
                this.logWarn(`Invalid or disabled credentials for user: ${username}`);
                throw new common_types_1.ApiError(common_types_1.ErrorType.AUTHENTICATION_ERROR, "Invalid username or password", 401);
            }
            // Verify password
            const isPasswordValid = await this.verifyPassword(password, credentials.password);
            if (!isPasswordValid) {
                this.logWarn(`Invalid password for user: ${username}`);
                throw new common_types_1.ApiError(common_types_1.ErrorType.AUTHENTICATION_ERROR, "Invalid username or password", 401);
            }
            // Generate session ID
            const sessionId = this.generateSessionId();
            // Get dynamic role information
            const dynamicRole = await this.getUserDynamicRole(user.iot_dynamic_role);
            // Create JWT token
            const token = await this.generateJwtToken(user, credentials, dynamicRole, sessionId);
            // Prepare user info for response
            const userInfo = {
                user_id: user.user_id || user.name,
                first_name: user.first_name || '',
                last_name: user.last_name || '',
                email: user.email || '',
                customer_id: user.customer_id || '',
                is_admin: user.is_admin || 0,
                iot_dynamic_role: user.iot_dynamic_role || '',
                sections: (dynamicRole === null || dynamicRole === void 0 ? void 0 : dynamicRole.sections) || '',
                credential_id: credentials.id || '',
                enable: credentials.enable || 1
            };
            this.logInfo(`✅ Login successful for user: ${username}`);
            return {
                result: {
                    token,
                    user: userInfo
                }
            };
        }, { username });
    }
    /**
     * Verify JWT token
     */
    async verifyToken(token) {
        return this.executeOperation('verifyToken', async () => {
            try {
                const decoded = jsonwebtoken_1.default.verify(token, this.jwtSecret);
                this.logDebug('Token verified successfully', { userId: decoded.user_id });
                return decoded;
            }
            catch (error) {
                this.logWarn(`Invalid JWT token: ${error.message}`);
                throw new common_types_1.ApiError(common_types_1.ErrorType.AUTHENTICATION_ERROR, "Invalid or expired token", 401);
            }
        });
    }
    /**
     * Get user information by user ID
     */
    async getUserInfo(userId) {
        try {
            this.ensureDatabaseService();
            const userRepo = this.databaseService.getCustomerUserRepository();
            const user = await userRepo.findOne({
                where: { name: userId },
                relations: ['iot_customer'],
                select: [
                    'name', 'first_name', 'last_name', 'email',
                    'customer_id', 'is_admin', 'iot_dynamic_role',
                    'phone_number', 'user_id'
                ]
            });
            if (!user) {
                return null;
            }
            return {
                user_id: user.user_id || user.name,
                first_name: user.first_name || '',
                last_name: user.last_name || '',
                email: user.email || '',
                customer_id: user.customer_id || '',
                is_admin: user.is_admin || 0,
                iot_dynamic_role: user.iot_dynamic_role || '',
                sections: '', // Will be populated from dynamic role
                credential_id: '',
                enable: 1
            };
        }
        catch (error) {
            logger_1.logger.error(this.node, `Error getting user info: ${error.message}`);
            throw new common_types_1.ApiError(common_types_1.ErrorType.DATABASE_ERROR, "Failed to retrieve user information", 500);
        }
    }
    /**
     * Find user by username, email, or user_name
     */
    async findUser(username) {
        this.logWarn(`Finding user with identifier: ${username}`);
        this.ensureDatabaseService();
        const userRepo = this.databaseService.getCustomerUserRepository();
        const res = await userRepo.findOne({
            where: [
                { email: username },
            ]
        });
        return res;
    }
    /**
     * Find user credentials
     */
    async findUserCredentials(user_id) {
        this.ensureDatabaseService();
        const credRepo = this.databaseService.getCustomerUserCredentialRepository();
        return await credRepo.findOne({
            where: { user_id: user_id }
        });
    }
    /**
     * Get user dynamic role information
     */
    async getUserDynamicRole(roleName) {
        if (!roleName)
            return null;
        this.ensureDatabaseService();
        const roleRepo = this.databaseService.getIotDynamicRoleRepository();
        return await roleRepo.findOne({
            where: { name: roleName }
        });
    }
    /**
     * Verify password against stored hash
     */
    async verifyPassword(plainPassword, hashedPassword) {
        try {
            // Try bcrypt first (most secure)
            if (hashedPassword.startsWith('$2b$') || hashedPassword.startsWith('$2a$')) {
                return await bcrypt_1.default.compare(plainPassword, hashedPassword);
            }
            // Try MD5
            const md5Hash = crypto_1.default.createHash('md5').update(plainPassword).digest('hex');
            if (hashedPassword === md5Hash) {
                return true;
            }
            // Try SHA256
            const sha256Hash = crypto_1.default.createHash('sha256').update(plainPassword).digest('hex');
            if (hashedPassword === sha256Hash) {
                return true;
            }
            // Try plain text (least secure, for legacy support)
            if (hashedPassword === plainPassword) {
                return true;
            }
            return false;
        }
        catch (error) {
            logger_1.logger.error(this.node, `Password verification error: ${error.message}`);
            return false;
        }
    }
    /**
     * Generate session ID
     */
    generateSessionId() {
        return crypto_1.default.randomBytes(32).toString('hex');
    }
    /**
     * Generate JWT token
     */
    async generateJwtToken(user, credentials, dynamicRole, sessionId) {
        const payload = {
            first_name: user.first_name || '',
            last_name: user.last_name || '',
            email: user.email || '',
            user_type: user.user_type || 'Viis IoT User',
            user_id: user.user_id || user.name,
            user_role: [],
            is_admin: user.is_admin || 0,
            customer_id: user.customer_id || '',
            credential_id: credentials.id || '',
            enable: credentials.enable || 1,
            iot_dynamic_role: user.iot_dynamic_role || '',
            sections: (dynamicRole === null || dynamicRole === void 0 ? void 0 : dynamicRole.sections) || '',
            subscriptions: [],
            sid: sessionId
        };
        return jsonwebtoken_1.default.sign(payload, this.jwtSecret, {
            algorithm: 'HS512',
            expiresIn: '1y'
        });
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, typedi_1.Service)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService, String, typeof (_a = typeof node_red_1.Node !== "undefined" && node_red_1.Node) === "function" ? _a : Object, api_config_1.ApiConfigManager])
], AuthService);
