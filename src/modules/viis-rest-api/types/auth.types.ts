/**
 * @fileoverview Authentication types and interfaces
 */

/**
 * Login request interface
 */
export interface LoginRequest {
    usr: string;
    pwd: string;
}

/**
 * JWT Payload interface
 */
export interface JwtPayload {
    first_name: string;
    last_name: string;
    email: string;
    user_type: string;
    user_id: string;
    user_role: string[];
    is_admin: number;
    customer_id: string;
    credential_id: string;
    enable: number;
    iot_dynamic_role: string;
    sections: string;
    subscriptions: string[];
    sid: string;
    iat?: number;
    exp?: number;
}

/**
 * User information interface
 */
export interface UserInfo {
    user_id: string;
    first_name: string;
    last_name: string;
    email: string;
    customer_id: string;
    is_admin: number;
    iot_dynamic_role: string;
    sections: string;
    credential_id: string;
    enable: number;
}

/**
 * Login response interface
 */
export interface LoginResponse {
    result: {
        token: string;
        user: UserInfo;
    };
}

/**
 * Token verification response interface
 */
export interface TokenVerificationResponse {
    valid: boolean;
    user: {
        user_id: string;
        email: string;
        customer_id: string;
        is_admin: number;
        iot_dynamic_role: string;
    };
}

/**
 * Authenticated request interface
 */
export interface AuthenticatedRequest extends Request {
    user?: JwtPayload;
    token?: string;
}

/**
 * Password hash types
 */
export enum PasswordHashType {
    BCRYPT = 'bcrypt',
    MD5 = 'md5',
    SHA256 = 'sha256',
    PLAIN = 'plain'
}
