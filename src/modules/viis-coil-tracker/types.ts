/**
 * TypeScript type definitions for viis-coil-tracker node
 */

import { Node, NodeDef } from "node-red";

/**
 * Tracking rule configuration
 */
export interface TrackingRule {
    trackingKey: string;
    coilKey: string;
    boardId?: string;
    captureRelatedData: string[];
    enabled: boolean;
}

/**
 * Node configuration definition
 */
export interface ViisCoilTrackerConfig extends NodeDef {
    name: string;
    trackers: TrackingRule[];
    storeToDatabase: boolean;
    publishMqtt: boolean;
    boardMode?: 'auto' | 'single' | 'multi';
}

/**
 * Active tracking session
 */
export interface TrackingSession {
    sessionId: string;
    trackingKey: string;
    coilKey: string;
    boardId?: string;
    deviceId: string;
    startTime: Date;
    endTime?: Date;
    durationSeconds?: number;
    status: 'active' | 'completed';
    startSnapshot: Record<string, any>;
    endSnapshot?: Record<string, any>;
    lastCoilValue: boolean;
}

/**
 * State change event data
 */
export interface StateChangeEvent {
    event: 'start' | 'complete';
    trackingKey: string;
    coilKey: string;
    sessionId: string;
    boardId?: string;
    deviceId: string;
    startTime: Date;
    endTime?: Date;
    durationSeconds?: number;
    coilValue: boolean;
    relatedData: Record<string, any>;
    timestamp: Date;
}

/**
 * MQTT publish payload
 */
export interface MqttTrackingPayload {
    event: 'state_change';
    tracking_key: string;
    coil_key: string;
    session_id: string;
    board_id?: string;
    device_id: string;
    state: 'started' | 'completed';
    timestamp: string;
    duration_seconds?: number;
    data: Record<string, any>;
}

/**
 * Database session record
 */
export interface DatabaseSessionRecord {
    name: string;
    tracking_key: string;
    coil_key: string;
    board_id?: string;
    device_id: string;
    start_time: Date;
    end_time?: Date;
    duration_seconds?: number;
    status: 'active' | 'completed';
    start_snapshot: string; // JSON string
    end_snapshot?: string; // JSON string
    creation: Date;
    modified: Date;
}
