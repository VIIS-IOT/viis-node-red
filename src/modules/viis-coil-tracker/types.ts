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
    previousCoilValue: boolean;
    eventSequence: number;
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
 * MQTT publish payload - Enhanced structure for frontend tracking
 */
export interface MqttTrackingPayload {
    // Meta Information
    type: 'coil_tracking';
    version: string;
    timestamp: string;
    device_id: string;

    // Tracking Session Info
    session: {
        id: string;
        tracking_key: string;
        status: 'started' | 'completed';
        coil: {
            key: string;
            board_id?: string;
            current_value: boolean;
            previous_value: boolean;
        };
    };

    // Timing Information
    timing: {
        started_at: string;
        completed_at: string | null;
        duration_seconds: number | null;
        elapsed_seconds: number;
    };

    // Telemetry Data
    telemetry: {
        start_snapshot: Record<string, any>;
        end_snapshot: Record<string, any> | null;
        delta: Record<string, number> | null;
    };

    // State Change Event
    event: {
        type: 'state_changed';
        trigger: 'coil_on' | 'coil_off';
        sequence: number;
    };
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
