/**
 * @fileoverview Type definitions for the VIIS Sync Customer User module
 */

import { NodeMessageInFlow } from 'node-red';

/**
 * Extended Node message with custom payload
 */
export interface ExtendedNodeMessage extends NodeMessageInFlow {
    payload: any;
    [key: string]: any;
}

/**
 * Server Customer data structure
 */
export interface ServerCustomer {
    name: string;
    id?: string;
    customerName?: string;
    createdTime?: string;
    email?: string;
    phone?: string;
    description?: string;
    address?: string;
    city?: string;
    country?: string;
    province?: string;
    zipPostalCode?: string;
    zipCode?: string;
    logo?: string;
    district?: string;
    ward?: string;
    packageId?: string;
    type?: string;
    developerMode?: number;
    developerWebhookId?: string;
    developerRuleId?: string;
    test?: number;
    isReceiveConnectionNoti?: number;
    isReceiveNotificationNoti?: number;
    users?: ServerCustomerUser[];
}

/**
 * Server Dynamic Role data structure
 */
export interface ServerDynamicRole {
    name: string;                    // Required
    label?: string;
    role?: string;
    sections?: string;
    iot_customer?: string;           // Customer reference
}

/**
 * Server Customer User data structure
 */
export interface ServerCustomerUser {
    name: string;
    user_id?: string;
    user_name?: string;
    created_time?: string;
    user_avatar?: string;
    email?: string;
    full_name?: string;
    phone_number?: string;
    address?: string;
    date_join?: string;
    date_active?: string;
    date_warranty?: string;
    first_name?: string;
    last_name?: string;
    district?: string;
    ward?: string;
    province?: string;
    is_admin?: number;
    description?: string;
    employee_id?: string;
    user_type?: string;
    role_label?: string;
    is_deactivated?: number;
    customer_id?: string;
    iot_dynamic_role?: string;
    dynamicRole?: ServerDynamicRole;  // Add dynamic role information
    credentials?: ServerCustomerUserCredentials;
}

/**
 * Server Customer User Credentials data structure
 */
export interface ServerCustomerUserCredentials {
    id?: string;
    user_id?: string;
    credential_id?: string;
    credential_type?: string;
    user_name?: string;
    email?: string;
    phone?: string;
    password?: string;
    salt?: string;
    is_active?: number;
    is_first_login?: number;
    last_login?: string;
    last_failed?: string;
    failed_attempt?: number;
    is_locked?: number;
    created_time?: string;
    last_changed_time?: string;
}
