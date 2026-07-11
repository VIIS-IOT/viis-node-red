/**
 * Core Coil Tracker Service
 * Monitors coil states from global context and tracks ON/OFF duration
 */

import { Node } from "node-red";
import { GlobalContextHelper } from "../../ultils/global-context-helper";
import { MySqlClientCore } from "../../core/mysql-client";
import { MqttClientCore } from "../../core/mqtt-client";
import {
    TrackingRule,
    TrackingSession,
    StateChangeEvent,
    MqttTrackingPayload,
    DatabaseSessionRecord
} from "./types";
import { DataSourceManager } from "../../orm/dataSource";
import { TabiotCoilTrackingSession } from "../../orm/entities/coil-tracking/TabiotCoilTrackingSession";
import { Repository } from "typeorm";
import { GLOBAL_CONTEXT_KEYS } from "../viis-telemetry/viis-telemetry-constants";

export class CoilTrackerService {
    private activeSessions: Map<string, TrackingSession> = new Map();
    private trackingRules: TrackingRule[] = [];
    private monitoringInterval: NodeJS.Timeout | null = null;
    private readonly MONITORING_INTERVAL_MS = 1000; // Check every 1 second
    private deviceId: string = 'unknown';
    private sessionRepository: Repository<TabiotCoilTrackingSession> | null = null;
    private readonly PAYLOAD_VERSION = '1.0';
    private eventSequenceCounter: number = 0;

    constructor(
        private node: Node,
        private globalHelper: GlobalContextHelper,
        private mysqlClient?: MySqlClientCore,
        private mqttClient?: MqttClientCore
    ) {
        this.deviceId = this.globalHelper.getEnvVar('DEVICE_ID', 'unknown');
    }

    /**
     * Initialize the service, including database repository if needed
     */
    public async initialize(): Promise<void> {
        if (this.mysqlClient) {
            try {
                const dataSource = await DataSourceManager.acquire(this.node.context());
                this.sessionRepository = dataSource.getRepository(TabiotCoilTrackingSession);
                this.node.log('Coil tracking session repository initialized');
            } catch (error) {
                this.node.error(`Failed to initialize session repository: ${(error as Error).message}`);
                this.sessionRepository = null;
            }
        }
    }

    /**
     * Set tracking rules and validate
     */
    public setTrackingRules(rules: TrackingRule[]): void {
        this.trackingRules = rules.filter(rule => rule.enabled);
        this.node.log(`Tracking rules loaded: ${this.trackingRules.length} active rules`);
    }

    /**
     * Start monitoring coil states
     */
    public startMonitoring(): void {
        if (this.monitoringInterval) {
            this.node.warn('Monitoring already started');
            return;
        }

        this.node.log(`Starting coil tracking monitoring (interval: ${this.MONITORING_INTERVAL_MS}ms)`);

        this.monitoringInterval = setInterval(() => {
            this.checkCoilStates();
        }, this.MONITORING_INTERVAL_MS);
    }

    /**
     * Stop monitoring
     */
    public stopMonitoring(): void {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
            this.node.log('Coil tracking monitoring stopped');
        }
    }

    /**
     * Check all tracked coil states
     */
    private checkCoilStates(): void {
        if (this.trackingRules.length === 0) {
            return;
        }

        try {
            // Get current coil register data from global context
            const coilRegisterData: Record<string, any> = this.node.context().global.get(GLOBAL_CONTEXT_KEYS.COIL_REGISTER_DATA) || {};

            // Check each tracking rule
            for (const rule of this.trackingRules) {
                this.checkSingleCoilState(rule, coilRegisterData);
            }
        } catch (error) {
            this.node.error(`Error checking coil states: ${(error as Error).message}`);
        }
    }

    /**
     * Check a single coil state for changes
     */
    private checkSingleCoilState(rule: TrackingRule, coilRegisterData: Record<string, any>): void {
        const currentCoilValue = Boolean(coilRegisterData[rule.coilKey]);
        const sessionKey = this.getSessionKey(rule);
        const activeSession = this.activeSessions.get(sessionKey);

        if (currentCoilValue) {
            // Coil is ON
            if (!activeSession) {
                // New session started (OFF -> ON transition)
                this.handleSessionStart(rule, coilRegisterData);
            } else {
                // Update last known value and previous value
                activeSession.previousCoilValue = activeSession.lastCoilValue;
                activeSession.lastCoilValue = currentCoilValue;
            }
        } else {
            // Coil is OFF
            if (activeSession && activeSession.lastCoilValue === true) {
                // Session completed (ON -> OFF transition)
                activeSession.previousCoilValue = activeSession.lastCoilValue;
                this.handleSessionComplete(rule, coilRegisterData, activeSession);
            }
        }
    }

    /**
     * Handle session start (OFF -> ON transition)
     */
    private async handleSessionStart(rule: TrackingRule, coilRegisterData: Record<string, any>): Promise<void> {
        const sessionKey = this.getSessionKey(rule);
        const sessionId = this.generateSessionId(rule.trackingKey);
        const startTime = new Date();

        // Capture related data
        const startSnapshot = this.captureRelatedData(rule, coilRegisterData);

        // Create new session
        const session: TrackingSession = {
            sessionId,
            trackingKey: rule.trackingKey,
            coilKey: rule.coilKey,
            boardId: rule.boardId,
            deviceId: this.deviceId,
            startTime,
            status: 'active',
            startSnapshot,
            lastCoilValue: true,
            previousCoilValue: false,
            eventSequence: ++this.eventSequenceCounter
        };

        this.activeSessions.set(sessionKey, session);

        this.node.log(`Session started: ${rule.trackingKey} (${sessionId})`);

        // Create state change event
        const event: StateChangeEvent = {
            event: 'start',
            trackingKey: rule.trackingKey,
            coilKey: rule.coilKey,
            sessionId,
            boardId: rule.boardId,
            deviceId: this.deviceId,
            startTime,
            coilValue: true,
            relatedData: startSnapshot,
            timestamp: startTime
        };

        // Publish MQTT
        if (this.mqttClient) {
            await this.publishMqttEvent(event);
        }

        // Save to database
        if (this.mysqlClient) {
            await this.saveSessionToDatabase(session);
        }

        // Send output message
        this.sendOutputMessage(event);
    }

    /**
     * Handle session complete (ON -> OFF transition)
     */
    private async handleSessionComplete(
        rule: TrackingRule,
        coilRegisterData: Record<string, any>,
        session: TrackingSession
    ): Promise<void> {
        const sessionKey = this.getSessionKey(rule);
        const endTime = new Date();
        const durationSeconds = Math.floor((endTime.getTime() - session.startTime.getTime()) / 1000);

        // Capture related data at end
        const endSnapshot = this.captureRelatedData(rule, coilRegisterData);

        // Update session
        session.endTime = endTime;
        session.durationSeconds = durationSeconds;
        session.status = 'completed';
        session.endSnapshot = endSnapshot;
        session.lastCoilValue = false;

        this.node.log(`Session completed: ${rule.trackingKey} (${session.sessionId}) - Duration: ${durationSeconds}s`);

        // Create state change event
        const event: StateChangeEvent = {
            event: 'complete',
            trackingKey: rule.trackingKey,
            coilKey: rule.coilKey,
            sessionId: session.sessionId,
            boardId: rule.boardId,
            deviceId: this.deviceId,
            startTime: session.startTime,
            endTime,
            durationSeconds,
            coilValue: false,
            relatedData: endSnapshot,
            timestamp: endTime
        };

        // Publish MQTT
        if (this.mqttClient) {
            await this.publishMqttEvent(event);
        }

        // Update database
        if (this.mysqlClient) {
            await this.updateSessionInDatabase(session);
        }

        // Send output message
        this.sendOutputMessage(event);

        // Remove from active sessions
        this.activeSessions.delete(sessionKey);
    }

    /**
     * Capture related telemetry data
     */
    private captureRelatedData(rule: TrackingRule, coilRegisterData: Record<string, any>): Record<string, any> {
        const relatedData: Record<string, any> = {};

        if (rule.captureRelatedData && rule.captureRelatedData.length > 0) {
            const inputRegisterData = this.node.context().global.get(GLOBAL_CONTEXT_KEYS.INPUT_REGISTER_DATA) || {};
            const holdingRegisterData = this.node.context().global.get(GLOBAL_CONTEXT_KEYS.HOLDING_REGISTER_DATA) || {};

            for (const key of rule.captureRelatedData) {
                if (coilRegisterData[key] !== undefined) {
                    relatedData[key] = coilRegisterData[key];
                } else if (inputRegisterData[key] !== undefined) {
                    relatedData[key] = inputRegisterData[key];
                } else if (holdingRegisterData[key] !== undefined) {
                    relatedData[key] = holdingRegisterData[key];
                }
            }
        }

        // Always add timestamp
        relatedData.ts = Date.now();

        return relatedData;
    }

    /**
     * Publish MQTT event
     */
    private async publishMqttEvent(event: StateChangeEvent): Promise<void> {
        try {
            const topic = `v1/devices/me/telemetry/${this.deviceId}`;
            const now = new Date();
            const elapsedSeconds = Math.floor((now.getTime() - event.startTime.getTime()) / 1000);

            // Calculate delta between start and end snapshots
            const delta = this.calculateDelta(
                event.relatedData,
                event.event === 'complete' && event.durationSeconds !== undefined
                    ? this.activeSessions.get(this.getSessionKeyFromEvent(event))?.startSnapshot || {}
                    : null
            );

            const payload: MqttTrackingPayload = {
                // Meta Information
                type: 'coil_tracking',
                version: this.PAYLOAD_VERSION,
                timestamp: event.timestamp.toISOString(),
                device_id: event.deviceId,

                // Tracking Session Info
                session: {
                    id: event.sessionId,
                    tracking_key: event.trackingKey,
                    status: event.event === 'start' ? 'started' : 'completed',
                    coil: {
                        key: event.coilKey,
                        board_id: event.boardId,
                        current_value: event.coilValue,
                        previous_value: !event.coilValue
                    }
                },

                // Timing Information
                timing: {
                    started_at: event.startTime.toISOString(),
                    completed_at: event.endTime?.toISOString() || null,
                    duration_seconds: event.durationSeconds || null,
                    elapsed_seconds: elapsedSeconds
                },

                // Telemetry Data
                telemetry: {
                    start_snapshot: event.event === 'complete' 
                        ? this.activeSessions.get(this.getSessionKeyFromEvent(event))?.startSnapshot || {}
                        : event.relatedData,
                    end_snapshot: event.event === 'complete' ? event.relatedData : null,
                    delta: delta
                },

                // State Change Event
                event: {
                    type: 'state_changed',
                    trigger: event.event === 'start' ? 'coil_on' : 'coil_off',
                    sequence: this.activeSessions.get(this.getSessionKeyFromEvent(event))?.eventSequence || this.eventSequenceCounter
                }
            };

            await this.mqttClient!.publish(topic, JSON.stringify(payload));
            this.node.log(`MQTT published: ${topic}`);
        } catch (error) {
            this.node.error(`Failed to publish MQTT: ${(error as Error).message}`);
        }
    }

    /**
     * Save new session to database
     */
    private async saveSessionToDatabase(session: TrackingSession): Promise<void> {
        try {
            if (!this.sessionRepository) {
                this.node.error('Session repository not available');
                return;
            }

            const entity = new TabiotCoilTrackingSession();
            entity.name = session.sessionId;
            entity.tracking_key = session.trackingKey;
            entity.coil_key = session.coilKey;
            entity.board_id = session.boardId || null;
            entity.device_id = session.deviceId;
            entity.start_time = session.startTime;
            entity.status = session.status;
            entity.start_snapshot = session.startSnapshot;

            await this.sessionRepository.save(entity);
            this.node.log(`Session saved to database: ${session.sessionId}`);
        } catch (error) {
            this.node.error(`Failed to save session to database: ${(error as Error).message}`);
        }
    }

    /**
     * Update completed session in database
     */
    private async updateSessionInDatabase(session: TrackingSession): Promise<void> {
        try {
            if (!this.sessionRepository) {
                this.node.error('Session repository not available');
                return;
            }

            const entity = await this.sessionRepository.findOne({
                where: { name: session.sessionId }
            });

            if (!entity) {
                this.node.error(`Session not found in database: ${session.sessionId}`);
                return;
            }

            entity.end_time = session.endTime || undefined;
            entity.duration_seconds = session.durationSeconds;
            entity.status = session.status;
            entity.end_snapshot = session.endSnapshot;

            await this.sessionRepository.save(entity);
            this.node.log(`Session updated in database: ${session.sessionId}`);
        } catch (error) {
            this.node.error(`Failed to update session in database: ${(error as Error).message}`);
        }
    }

    /**
     * Send output message
     */
    private sendOutputMessage(event: StateChangeEvent): void {
        const msg = {
            topic: `coil-tracking/${event.trackingKey}/${event.event}`,
            payload: {
                event: event.event,
                trackingKey: event.trackingKey,
                sessionId: event.sessionId,
                startTime: event.startTime.toISOString(),
                endTime: event.endTime?.toISOString(),
                durationSeconds: event.durationSeconds,
                coilValue: event.coilValue,
                relatedData: event.relatedData
            }
        };

        this.node.send(msg);
    }

    /**
     * Generate unique session key for tracking
     */
    private getSessionKey(rule: TrackingRule): string {
        return `${rule.trackingKey}_${rule.coilKey}_${rule.boardId || 'default'}`;
    }

    /**
     * Generate unique session ID
     */
    private generateSessionId(trackingKey: string): string {
        return `${trackingKey}_${Date.now()}`;
    }

    /**
     * Get active sessions count
     */
    public getActiveSessionsCount(): number {
        return this.activeSessions.size;
    }

    /**
     * Get tracking rules count
     */
    public getTrackingRulesCount(): number {
        return this.trackingRules.length;
    }

    /**
     * Calculate delta between two snapshots
     */
    private calculateDelta(
        endSnapshot: Record<string, any>,
        startSnapshot: Record<string, any> | null
    ): Record<string, number> | null {
        if (!startSnapshot) {
            return null;
        }

        const delta: Record<string, number> = {};
        
        for (const key in endSnapshot) {
            if (key === 'ts') continue; // Skip timestamp
            
            const endValue = endSnapshot[key];
            const startValue = startSnapshot[key];
            
            if (typeof endValue === 'number' && typeof startValue === 'number') {
                delta[key] = endValue - startValue;
            }
        }
        
        return Object.keys(delta).length > 0 ? delta : null;
    }

    /**
     * Get session key from event data
     */
    private getSessionKeyFromEvent(event: StateChangeEvent): string {
        return `${event.trackingKey}_${event.coilKey}_${event.boardId || 'default'}`;
    }
}
