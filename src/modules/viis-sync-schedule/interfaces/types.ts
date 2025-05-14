/**
 * Type definitions for the VIIS Sync Schedule module
 */

import { NodeMessageInFlow } from 'node-red';

/**
 * Extended Node-RED message with additional properties for API requests
 */
export interface ExtendedNodeMessage extends NodeMessageInFlow {
    /** Request information */
    req?: {
        /** HTTP method */
        method: string;
        /** Request URL */
        url: string;
        /** Query parameters */
        query: any;
        /** Request payload */
        payload: any;
    };
}

/**
 * Represents a schedule plan from the server
 */
export interface ServerSchedulePlan {
    /** Unique identifier */
    name: string;
    /** Human-readable label */
    label: string;
    /** Creation timestamp */
    creation: string;
    /** Last modification timestamp */
    modified: string;
    /** Number of schedules in this plan */
    schedule_count: number;
    /** Plan status */
    status: string;
    /** Whether the plan is deleted */
    is_deleted: number;
    /** Whether the plan is enabled */
    enable: number;
    /** Customer ID */
    customer_id: string;
    /** Whether the plan is synced with the server */
    is_synced: number;
    /** Whether the plan originated from local device */
    is_from_local: number;
    /** Device ID */
    device_id: string;
    /** Start date (YYYY-MM-DD) */
    start_date: string;
    /** End date (YYYY-MM-DD) */
    end_date: string;
    /** List of schedules in this plan */
    schedules: ServerSchedule[];
}

/**
 * Represents a schedule from the server
 */
export interface ServerSchedule {
    /** Unique identifier */
    name: string;
    /** Human-readable label */
    label: string;
    /** Device ID */
    device_id: string;
    /** Schedule status */
    status: string;
    /** Action to perform when schedule is triggered */
    action: any;
    /** Whether the schedule is enabled */
    enable: boolean;
    /** Set time (HH:MM:SS) */
    set_time: string;
    /** Start time (HH:MM:SS) */
    start_time: string;
    /** End time (HH:MM:SS) */
    end_time: string;
    /** Start date (YYYY-MM-DD) */
    start_date: string;
    /** End date (YYYY-MM-DD) */
    end_date: string;
    /** Schedule type */
    type: string;
    /** Interval for recurring schedules */
    interval: string;
    /** Whether the schedule is synced with the server */
    is_synced: boolean;
    /** Whether the schedule originated from local device */
    is_from_local: boolean;
    /** Whether the schedule is deleted */
    is_deleted: number;
    /** Parent schedule plan ID */
    schedule_plan_id: string;
    /** Parent schedule plan label */
    schedule_plan_label: string;
    /** Creation timestamp */
    creation?: string;
    /** Last modification timestamp */
    modified?: string;
}

/**
 * Server API response format
 */
export interface ServerResponse<T> {
    /** HTTP status code */
    status: number;
    /** Response message */
    message: string;
    /** Response data */
    data: T;
}
