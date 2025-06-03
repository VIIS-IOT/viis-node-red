/**
 * @fileoverview Authentication Service for VIIS REST API
 * Handles user authentication, JWT token generation and validation
 */

import { Node } from 'node-red';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { DatabaseService } from './databaseService';
import { IotCustomerUser } from '../../../orm/entities/customer/customer_user';
import { IotCustomerUserCredentials } from '../../../orm/entities/customer/customer_user_credentials';
import { TabiotCustomer } from '../../../orm/entities/customer/customer';
import { IotDynamicRole } from '../../../orm/entities/dynamicRole/dynamicRole';
import { logger } from '../utils/logger';

/**
 * Login request interface
 */
export interface LoginRequest {
    usr: string;
    pwd: string;
}

/**
 * Login response interface
 */
export interface LoginResponse {
    result: {
        token: string;
        user: {
            user_id: string;
            first_name: string;
            last_name: string;
            email: string;
            customer_id: string;
            is_admin: number;
            iot_dynamic_role: string;
            phone_number: string;
            sections: string;
            credential_id: string;
            enable: number;
            reset_password_key: null;
            last_reset_password_key_generated_on: null;
            user_role: any[];
        };
    };
}

/**
 * JWT payload interface
 */
export interface JwtPayload {
    first_name: string;
    last_name: string;
    email: string;
    user_type: string;
    user_id: string;
    user_role: any[];
    is_admin: number;
    customer_id: string;
    credential_id: string;
    enable: number;
    iot_dynamic_role: string;
    sections: string;
    subscriptions: any[];
    sid: string;
    iat: number;
    exp: number;
}

/**
 * Authentication service for handling user login and JWT operations
 */
export class AuthService {
    private databaseService: DatabaseService;
    private jwtSecret: string;
    private node: Node;

    /**
     * Creates a new authentication service
     * @param databaseService - Database service instance
     * @param jwtSecret - JWT secret key
     * @param node - Node-RED node instance for logging
     */
    constructor(databaseService: DatabaseService, jwtSecret: string, node: Node) {
        this.databaseService = databaseService;
        this.jwtSecret = jwtSecret;
        this.node = node;
    }

    /**
     * Authenticate user with username/email and password
     * @param loginData - Login credentials
     * @returns Login response with JWT token and user data
     */
    async login(loginData: LoginRequest): Promise<LoginResponse> {
        try {
            // Validate input
            if (!loginData.usr || !loginData.pwd) {
                throw new Error("Username and password are required");
            }

            const username = loginData.usr.toString().trim();
            const password = loginData.pwd.toString();

            logger.info(this.node, `Login attempt for user: ${username}`);

            // Find user by username, email, or user_name
            const user = await this.findUser(username);
            if (!user) {
                logger.warn(this.node, `User not found: ${username}`);
                throw new Error("Invalid username or password");
            }

            // Check if user is deactivated
            if (user.is_deactivated === 1) {
                logger.warn(this.node, `Deactivated user login attempt: ${username}`);
                throw new Error("Account is deactivated");
            }

            // Find and validate credentials
            const credentials = await this.findUserCredentials(user.name);
            if (!credentials || credentials.enable !== 1) {
                logger.warn(this.node, `Invalid or disabled credentials for user: ${username}`);
                throw new Error("Invalid username or password");
            }

            // Verify password
            const isPasswordValid = await this.verifyPassword(password, credentials.password);
            if (!isPasswordValid) {
                logger.warn(this.node, `Invalid password for user: ${username}`);
                throw new Error("Invalid username or password");
            }

            // Load additional user details
            const { customer, dynamicRole } = await this.loadUserDetails(user);

            // Generate JWT token
            const token = await this.generateJwtToken(user, credentials, customer, dynamicRole);

            // Prepare response
            const response: LoginResponse = {
                result: {
                    token,
                    user: {
                        user_id: user.user_id || user.name,
                        first_name: user.first_name || '',
                        last_name: user.last_name || '',
                        email: user.email || '',
                        customer_id: user.customer_id || '',
                        is_admin: user.is_admin || 0,
                        iot_dynamic_role: user.iot_dynamic_role || '',
                        phone_number: user.phone_number || '',
                        sections: dynamicRole?.sections || '',
                        credential_id: credentials.id || '',
                        enable: credentials.enable || 1,
                        reset_password_key: null,
                        last_reset_password_key_generated_on: null,
                        user_role: []
                    }
                }
            };

            logger.info(this.node, `✅ Login successful: ${user.name} (${user.email}) from customer: ${user.customer_id}`);
            return response;

        } catch (error) {
            logger.error(this.node, `Authentication error: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Verify JWT token
     * @param token - JWT token to verify
     * @returns Decoded JWT payload
     */
    async verifyToken(token: string): Promise<JwtPayload> {
        try {
            const decoded = jwt.verify(token, this.jwtSecret) as JwtPayload;
            return decoded;
        } catch (error) {
            logger.warn(this.node, `Invalid JWT token: ${(error as Error).message}`);
            throw new Error("Invalid or expired token");
        }
    }

    /**
     * Find user by username, email, or user_name
     */
    private async findUser(username: string): Promise<IotCustomerUser | null> {
        const customerUserRepo = this.databaseService.getCustomerUserRepository();
        
        return await customerUserRepo.findOne({
            where: [
                { name: username },
                { email: username },
                { user_name: username }
            ],
            relations: ['iot_customer']
        });
    }

    /**
     * Find user credentials
     */
    private async findUserCredentials(userId: string): Promise<IotCustomerUserCredentials | null> {
        const credentialsRepo = this.databaseService.getCustomerUserCredentialsRepository();
        
        return await credentialsRepo.findOne({
            where: { user_id: userId }
        });
    }

    /**
     * Verify password using multiple methods
     */
    private async verifyPassword(inputPassword: string, storedPassword: string): Promise<boolean> {
        if (!storedPassword) {
            return false;
        }

        // Method 1: Direct comparison (plain text)
        if (inputPassword === storedPassword) {
            logger.debug(this.node, "Password verified (direct match)");
            return true;
        }

        // Method 2: BCrypt hash verification
        if (storedPassword.startsWith('$2b$') || storedPassword.startsWith('$2a$')) {
            const isValid = await bcrypt.compare(inputPassword, storedPassword);
            if (isValid) {
                logger.debug(this.node, "Password verified (bcrypt)");
                return true;
            }
        }

        // Method 3: MD5 hash verification (legacy)
        if (storedPassword.length === 32) {
            const md5Hash = crypto.createHash('md5').update(inputPassword).digest('hex');
            if (md5Hash === storedPassword) {
                logger.debug(this.node, "Password verified (md5)");
                return true;
            }
        }

        // Method 4: SHA256 hash verification
        if (storedPassword.length === 64) {
            const sha256Hash = crypto.createHash('sha256').update(inputPassword).digest('hex');
            if (sha256Hash === storedPassword) {
                logger.debug(this.node, "Password verified (sha256)");
                return true;
            }
        }

        return false;
    }

    /**
     * Load additional user details (customer and dynamic role)
     */
    private async loadUserDetails(user: IotCustomerUser): Promise<{
        customer: TabiotCustomer | null;
        dynamicRole: IotDynamicRole | null;
    }> {
        const customerRepo = this.databaseService.getCustomerRepository();
        const dynamicRoleRepo = this.databaseService.getDynamicRoleRepository();

        // Load customer details
        let customer: TabiotCustomer | null = null;
        if (user.customer_id) {
            customer = await customerRepo.findOne({
                where: { name: user.customer_id }
            });
        }

        // Load dynamic role details
        let dynamicRole: IotDynamicRole | null = null;
        if (user.iot_dynamic_role) {
            dynamicRole = await dynamicRoleRepo.findOne({
                where: { name: user.iot_dynamic_role }
            });
        }

        return { customer, dynamicRole };
    }

    /**
     * Generate JWT token
     */
    private async generateJwtToken(
        user: IotCustomerUser,
        credentials: IotCustomerUserCredentials,
        customer: TabiotCustomer | null,
        dynamicRole: IotDynamicRole | null
    ): Promise<string> {
        // Generate session ID
        const sessionId = `SES-${crypto.randomUUID()}`;

        // Create JWT payload
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
            sid: sessionId,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60 * 365) // 1 year expiration
        };

        // Generate JWT token
        const token = jwt.sign(payload, this.jwtSecret, { algorithm: 'HS512' });
        
        logger.debug(this.node, `JWT token generated for user: ${user.name}`);
        return token;
    }
}
