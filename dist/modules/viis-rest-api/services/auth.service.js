"use strict";
/**
 * @fileoverview Authentication Service for VIIS REST API
 * Handles user authentication, JWT token generation and verification
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const crypto_1 = __importDefault(require("crypto"));
const logger_1 = require("../utils/logger");
const common_types_1 = require("../types/common.types");
/**
 * Authentication service class
 */
class AuthService {
    constructor(databaseService, jwtSecret, node) {
        if (!databaseService) {
            throw new Error("DatabaseService is required for AuthService");
        }
        if (!jwtSecret) {
            throw new Error("JWT secret is required for AuthService");
        }
        if (!node) {
            throw new Error("Node instance is required for AuthService");
        }
        this.databaseService = databaseService;
        this.jwtSecret = jwtSecret;
        this.node = node;
    }
    /**
     * Initialize the authentication service
     */
    async initialize() {
        logger_1.logger.info(this.node, "Authentication service initialized");
    }
    /**
     * Cleanup resources
     */
    async cleanup() {
        logger_1.logger.info(this.node, "Authentication service cleanup completed");
    }
    /**
     * Ensure database service is available and initialized
     */
    ensureDatabaseService() {
        if (!this.databaseService) {
            logger_1.logger.error(this.node, "DatabaseService is not initialized in AuthService");
            throw new common_types_1.ApiError(common_types_1.ErrorType.DATABASE_ERROR, "Database service not available", 500);
        }
        if (!this.databaseService.isInitialized()) {
            logger_1.logger.error(this.node, "DatabaseService is not initialized");
            throw new common_types_1.ApiError(common_types_1.ErrorType.DATABASE_ERROR, "Database service not initialized", 500);
        }
    }
    /**
     * Authenticate user with username/email and password
     */
    async login(loginData) {
        try {
            const username = loginData.usr.toString().trim();
            const password = loginData.pwd.toString();
            console.log("add debug");
            logger_1.logger.info(this.node, `Login attempt for user 2: ${username}`);
            logger_1.logger.info(this.node, `fuck`);
            // logger.info(this.node, `AuthService.login - this exists: ${!!this}`);
            // logger.info(this.node, `AuthService.login - this.databaseService exists: ${!!this.databaseService}`);
            // Find user by username, email, or user_name
            const user = await this.findUser(username);
            if (!user) {
                logger_1.logger.warn(this.node, `User not found: ${username}`);
                throw new common_types_1.ApiError(common_types_1.ErrorType.AUTHENTICATION_ERROR, "Invalid username or password", 401);
            }
            // Check if user is deactivated
            if (user.is_deactivated === 1) {
                logger_1.logger.warn(this.node, `Deactivated user login attempt: ${username}`);
                throw new common_types_1.ApiError(common_types_1.ErrorType.AUTHENTICATION_ERROR, "Account is deactivated", 401);
            }
            // Find and validate credentials
            const credentials = await this.findUserCredentials(user.name);
            if (!credentials || credentials.enable !== 1) {
                logger_1.logger.warn(this.node, `Invalid or disabled credentials for user: ${username}`);
                throw new common_types_1.ApiError(common_types_1.ErrorType.AUTHENTICATION_ERROR, "Invalid username or password", 401);
            }
            // Verify password
            const isPasswordValid = await this.verifyPassword(password, credentials.password);
            if (!isPasswordValid) {
                logger_1.logger.warn(this.node, `Invalid password for user: ${username}`);
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
            logger_1.logger.info(this.node, `✅ Login successful for user: ${username}`);
            return {
                result: {
                    token,
                    user: userInfo
                }
            };
        }
        catch (error) {
            if (error instanceof common_types_1.ApiError) {
                throw error;
            }
            logger_1.logger.error(this.node, `Authentication error: ${error.message}`);
            throw new common_types_1.ApiError(common_types_1.ErrorType.AUTHENTICATION_ERROR, "Authentication failed", 401);
        }
    }
    /**
     * Verify JWT token
     */
    async verifyToken(token) {
        try {
            const decoded = jsonwebtoken_1.default.verify(token, this.jwtSecret);
            return decoded;
        }
        catch (error) {
            logger_1.logger.warn(this.node, `Invalid JWT token: ${error.message}`);
            throw new common_types_1.ApiError(common_types_1.ErrorType.AUTHENTICATION_ERROR, "Invalid or expired token", 401);
        }
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
        logger_1.logger.warn(this.node, `findUser called with username: ${username}`);
        logger_1.logger.warn(this.node, `this.databaseService exists: ${!!this.databaseService}`);
        this.ensureDatabaseService();
        const userRepo = this.databaseService.getCustomerUserRepository();
        return await userRepo.findOne({
            where: [
                { name: username },
                { email: username },
                { user_name: username }
            ]
        });
    }
    /**
     * Find user credentials
     */
    async findUserCredentials(username) {
        this.ensureDatabaseService();
        const credRepo = this.databaseService.getCustomerUserCredentialRepository();
        return await credRepo.findOne({
            where: { name: username }
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
}
exports.AuthService = AuthService;
