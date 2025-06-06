/**
 * @fileoverview Authentication Service for VIIS REST API
 * Handles user authentication, JWT token generation and verification
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { Node } from 'node-red';
import { Service, Inject } from 'typedi';
import { logger } from '../utils/logger';
import {
    LoginRequest,
    LoginResponse,
    JwtPayload,
    UserInfo
} from '../types/auth.types';
import { IService, ApiError, ErrorType } from '../types/common.types';
import { DatabaseService } from './database.service';
import { BaseService, ServiceContext } from './base.service';
import { ApiConfigManager } from '../config/api.config';
import {
    NODE_TOKEN,
    JWT_SECRET_TOKEN,
    CONFIG_MANAGER_TOKEN,
    SERVICE_CONTEXT_TOKEN
} from '../container/container.setup';

/**
 * Authentication service class
 */
@Service()
export class AuthService extends BaseService {
    private jwtSecret: string;

    constructor(databaseService: DatabaseService, jwtSecret: string, node: Node, configManager: ApiConfigManager) {
        // Create service context for BaseService
        const context: ServiceContext = {
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
    protected async onInitialize(): Promise<void> {
        this.logInfo("Authentication service initialized");
    }

    /**
     * Cleanup resources
     */
    protected async onCleanup(): Promise<void> {
        this.logInfo("Authentication service cleanup completed");
    }

    /**
     * Authenticate user with username/email and password
     */
    async login(loginData: LoginRequest): Promise<LoginResponse> {
        const username = loginData.usr.toString().trim();
        const password = loginData.pwd.toString();

        return this.executeOperation('login', async () => {
            this.logInfo(`Login attempt for user: ${username}`);

            // Find user by username, email, or user_name
            const user = await this.findUser(username);
            if (!user) {
                this.logWarn(`User not found: ${username}`);
                throw new ApiError(
                    ErrorType.AUTHENTICATION_ERROR,
                    "Invalid username or password",
                    401
                );
            }

            // Check if user is deactivated
            if (user.is_deactivated === 1) {
                this.logWarn(`Deactivated user login attempt: ${username}`);
                throw new ApiError(
                    ErrorType.AUTHENTICATION_ERROR,
                    "Account is deactivated",
                    401
                );
            }

            // Find and validate credentials
            const credentials = await this.findUserCredentials(user.name);
            if (!credentials || credentials.enable !== 1) {
                this.logWarn(`Invalid or disabled credentials for user: ${username}`);
                throw new ApiError(
                    ErrorType.AUTHENTICATION_ERROR,
                    "Invalid username or password",
                    401
                );
            }

            // Verify password
            const isPasswordValid = await this.verifyPassword(password, credentials.password);
            if (!isPasswordValid) {
                this.logWarn(`Invalid password for user: ${username}`);
                throw new ApiError(
                    ErrorType.AUTHENTICATION_ERROR,
                    "Invalid username or password",
                    401
                );
            }

            // Generate session ID
            const sessionId = this.generateSessionId();

            // Get dynamic role information
            const dynamicRole = await this.getUserDynamicRole(user.iot_dynamic_role);

            // Create JWT token
            const token = await this.generateJwtToken(user, credentials, dynamicRole, sessionId);

            // Prepare user info for response
            const userInfo: UserInfo = {
                user_id: user.user_id || user.name,
                first_name: user.first_name || '',
                last_name: user.last_name || '',
                email: user.email || '',
                customer_id: user.customer_id || '',
                is_admin: user.is_admin || 0,
                iot_dynamic_role: user.iot_dynamic_role || '',
                sections: dynamicRole?.sections || '',
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
    async verifyToken(token: string): Promise<JwtPayload> {
        return this.executeOperation('verifyToken', async () => {
            try {
                const decoded = jwt.verify(token, this.jwtSecret) as JwtPayload;
                this.logDebug('Token verified successfully', { userId: decoded.user_id });
                return decoded;
            } catch (error) {
                this.logWarn(`Invalid JWT token: ${(error as Error).message}`);
                throw new ApiError(
                    ErrorType.AUTHENTICATION_ERROR,
                    "Invalid or expired token",
                    401
                );
            }
        });
    }

    /**
     * Get user information by user ID
     */
    async getUserInfo(userId: string): Promise<UserInfo | null> {
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

        } catch (error) {
            logger.error(this.node, `Error getting user info: ${(error as Error).message}`);
            throw new ApiError(
                ErrorType.DATABASE_ERROR,
                "Failed to retrieve user information",
                500
            );
        }
    }

    /**
     * Find user by username, email, or user_name
     */
    private async findUser(username: string): Promise<any> {
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
    private async findUserCredentials(user_id: string): Promise<any> {
        this.ensureDatabaseService();
        const credRepo = this.databaseService.getCustomerUserCredentialRepository();

        return await credRepo.findOne({
            where: { user_id: user_id }
        });
    }

    /**
     * Get user dynamic role information
     */
    private async getUserDynamicRole(roleName?: string): Promise<any> {
        if (!roleName) return null;

        this.ensureDatabaseService();
        const roleRepo = this.databaseService.getIotDynamicRoleRepository();

        return await roleRepo.findOne({
            where: { name: roleName }
        });
    }

    /**
     * Verify password against stored hash
     */
    private async verifyPassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
        try {
            // Try bcrypt first (most secure)
            if (hashedPassword.startsWith('$2b$') || hashedPassword.startsWith('$2a$')) {
                return await bcrypt.compare(plainPassword, hashedPassword);
            }

            // Try MD5
            const md5Hash = crypto.createHash('md5').update(plainPassword).digest('hex');
            if (hashedPassword === md5Hash) {
                return true;
            }

            // Try SHA256
            const sha256Hash = crypto.createHash('sha256').update(plainPassword).digest('hex');
            if (hashedPassword === sha256Hash) {
                return true;
            }

            // Try plain text (least secure, for legacy support)
            if (hashedPassword === plainPassword) {
                return true;
            }

            return false;

        } catch (error) {
            logger.error(this.node, `Password verification error: ${(error as Error).message}`);
            return false;
        }
    }

    /**
     * Generate session ID
     */
    private generateSessionId(): string {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Generate JWT token
     */
    private async generateJwtToken(
        user: any,
        credentials: any,
        dynamicRole: any,
        sessionId: string
    ): Promise<string> {
        const payload: JwtPayload = {
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
            sections: dynamicRole?.sections || '',
            subscriptions: [],
            sid: sessionId
        };

        return jwt.sign(payload, this.jwtSecret, {
            algorithm: 'HS512',
            expiresIn: '1y'
        });
    }
}
