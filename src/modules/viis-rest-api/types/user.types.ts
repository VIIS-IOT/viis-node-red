/**
 * @fileoverview User types and interfaces
 */

import { PaginationParams } from './common.types';

/**
 * User entity interface
 */
export interface User {
    name: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    customer_id?: string;
    is_admin?: number;
    iot_dynamic_role?: string;
    phone_number?: string;
    user_type?: string;
    user_id?: string;
    is_deactivated?: number;
    created_at?: Date;
    updated_at?: Date;
}

/**
 * User query parameters
 */
export interface UserQueryParams extends PaginationParams {
    customer_id?: string;
    is_admin?: number;
    iot_dynamic_role?: string;
    search?: string;
    is_deactivated?: number;
}

/**
 * User creation request
 */
export interface CreateUserRequest {
    name: string;
    first_name?: string;
    last_name?: string;
    email: string;
    customer_id: string;
    is_admin?: number;
    iot_dynamic_role?: string;
    phone_number?: string;
    password: string;
}

/**
 * User update request
 */
export interface UpdateUserRequest {
    first_name?: string;
    last_name?: string;
    email?: string;
    customer_id?: string;
    is_admin?: number;
    iot_dynamic_role?: string;
    phone_number?: string;
    is_deactivated?: number;
}

/**
 * User response interface
 */
export interface UserResponse {
    name: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    customer_id?: string;
    is_admin?: number;
    iot_dynamic_role?: string;
    phone_number?: string;
    user_type?: string;
    user_id?: string;
    is_deactivated?: number;
    created_at?: Date;
    updated_at?: Date;
}
