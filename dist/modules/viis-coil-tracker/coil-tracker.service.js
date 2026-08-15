"use strict";
/**
 * Core Coil Tracker Service
 * Monitors coil states from global context and tracks ON/OFF duration
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoilTrackerService = void 0;
const dataSource_1 = require("../../orm/dataSource");
const TabiotCoilTrackingSession_1 = require("../../orm/entities/coil-tracking/TabiotCoilTrackingSession");
const viis_telemetry_constants_1 = require("../viis-telemetry/viis-telemetry-constants");
class CoilTrackerService {
    constructor(node, globalHelper, mysqlClient, mqttClient) {
        this.node = node;
        this.globalHelper = globalHelper;
        this.mysqlClient = mysqlClient;
        this.mqttClient = mqttClient;
        this.activeSessions = new Map();
        this.trackingRules = [];
        this.monitoringInterval = null;
        this.MONITORING_INTERVAL_MS = 1000; // Check every 1 second
        this.deviceId = 'unknown';
        this.sessionRepository = null;
        this.PAYLOAD_VERSION = '1.0';
        this.eventSequenceCounter = 0;
        this.deviceId = this.globalHelper.getEnvVar('DEVICE_ID', 'unknown');
    }
    /**
     * Initialize the service, including database repository if needed
     */
    async initialize() {
        if (this.mysqlClient) {
            try {
                const dataSource = await dataSource_1.DataSourceManager.acquire(this.node.context());
                this.sessionRepository = dataSource.getRepository(TabiotCoilTrackingSession_1.TabiotCoilTrackingSession);
                this.node.log('Coil tracking session repository initialized');
            }
            catch (error) {
                this.node.error(`Failed to initialize session repository: ${error.message}`);
                this.sessionRepository = null;
            }
        }
    }
    /**
     * Set tracking rules and validate
     */
    setTrackingRules(rules) {
        this.trackingRules = rules.filter(rule => rule.enabled);
        this.node.log(`Tracking rules loaded: ${this.trackingRules.length} active rules`);
    }
    /**
     * Start monitoring coil states
     */
    startMonitoring() {
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
    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
            this.node.log('Coil tracking monitoring stopped');
        }
    }
    /**
     * Check all tracked coil states
     */
    checkCoilStates() {
        if (this.trackingRules.length === 0) {
            return;
        }
        try {
            // Get current coil register data from global context
            const coilRegisterData = this.node.context().global.get(viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.COIL_REGISTER_DATA) || {};
            // Check each tracking rule
            for (const rule of this.trackingRules) {
                this.checkSingleCoilState(rule, coilRegisterData);
            }
        }
        catch (error) {
            this.node.error(`Error checking coil states: ${error.message}`);
        }
    }
    /**
     * Check a single coil state for changes
     */
    checkSingleCoilState(rule, coilRegisterData) {
        const currentCoilValue = Boolean(coilRegisterData[rule.coilKey]);
        const sessionKey = this.getSessionKey(rule);
        const activeSession = this.activeSessions.get(sessionKey);
        if (currentCoilValue) {
            // Coil is ON
            if (!activeSession) {
                // New session started (OFF -> ON transition)
                this.handleSessionStart(rule, coilRegisterData);
            }
            else {
                // Update last known value and previous value
                activeSession.previousCoilValue = activeSession.lastCoilValue;
                activeSession.lastCoilValue = currentCoilValue;
            }
        }
        else {
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
    async handleSessionStart(rule, coilRegisterData) {
        const sessionKey = this.getSessionKey(rule);
        const sessionId = this.generateSessionId(rule.trackingKey);
        const startTime = new Date();
        // Capture related data
        const startSnapshot = this.captureRelatedData(rule, coilRegisterData);
        // Create new session
        const session = {
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
        const event = {
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
    async handleSessionComplete(rule, coilRegisterData, session) {
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
        const event = {
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
    captureRelatedData(rule, coilRegisterData) {
        const relatedData = {};
        if (rule.captureRelatedData && rule.captureRelatedData.length > 0) {
            const inputRegisterData = this.node.context().global.get(viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.INPUT_REGISTER_DATA) || {};
            const holdingRegisterData = this.node.context().global.get(viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.HOLDING_REGISTER_DATA) || {};
            for (const key of rule.captureRelatedData) {
                if (coilRegisterData[key] !== undefined) {
                    relatedData[key] = coilRegisterData[key];
                }
                else if (inputRegisterData[key] !== undefined) {
                    relatedData[key] = inputRegisterData[key];
                }
                else if (holdingRegisterData[key] !== undefined) {
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
    async publishMqttEvent(event) {
        var _a, _b, _c, _d;
        try {
            const topic = `v1/devices/me/telemetry/${this.deviceId}`;
            const now = new Date();
            const elapsedSeconds = Math.floor((now.getTime() - event.startTime.getTime()) / 1000);
            // Calculate delta between start and end snapshots
            const delta = this.calculateDelta(event.relatedData, event.event === 'complete' && event.durationSeconds !== undefined
                ? ((_a = this.activeSessions.get(this.getSessionKeyFromEvent(event))) === null || _a === void 0 ? void 0 : _a.startSnapshot) || {}
                : null);
            const payload = {
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
                    completed_at: ((_b = event.endTime) === null || _b === void 0 ? void 0 : _b.toISOString()) || null,
                    duration_seconds: event.durationSeconds || null,
                    elapsed_seconds: elapsedSeconds
                },
                // Telemetry Data
                telemetry: {
                    start_snapshot: event.event === 'complete'
                        ? ((_c = this.activeSessions.get(this.getSessionKeyFromEvent(event))) === null || _c === void 0 ? void 0 : _c.startSnapshot) || {}
                        : event.relatedData,
                    end_snapshot: event.event === 'complete' ? event.relatedData : null,
                    delta: delta
                },
                // State Change Event
                event: {
                    type: 'state_changed',
                    trigger: event.event === 'start' ? 'coil_on' : 'coil_off',
                    sequence: ((_d = this.activeSessions.get(this.getSessionKeyFromEvent(event))) === null || _d === void 0 ? void 0 : _d.eventSequence) || this.eventSequenceCounter
                }
            };
            await this.mqttClient.publish(topic, JSON.stringify(payload));
            this.node.log(`MQTT published: ${topic}`);
        }
        catch (error) {
            this.node.error(`Failed to publish MQTT: ${error.message}`);
        }
    }
    /**
     * Save new session to database
     */
    async saveSessionToDatabase(session) {
        try {
            if (!this.sessionRepository) {
                this.node.error('Session repository not available');
                return;
            }
            const entity = new TabiotCoilTrackingSession_1.TabiotCoilTrackingSession();
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
        }
        catch (error) {
            this.node.error(`Failed to save session to database: ${error.message}`);
        }
    }
    /**
     * Update completed session in database
     */
    async updateSessionInDatabase(session) {
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
        }
        catch (error) {
            this.node.error(`Failed to update session in database: ${error.message}`);
        }
    }
    /**
     * Send output message
     */
    sendOutputMessage(event) {
        var _a;
        const msg = {
            topic: `coil-tracking/${event.trackingKey}/${event.event}`,
            payload: {
                event: event.event,
                trackingKey: event.trackingKey,
                sessionId: event.sessionId,
                startTime: event.startTime.toISOString(),
                endTime: (_a = event.endTime) === null || _a === void 0 ? void 0 : _a.toISOString(),
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
    getSessionKey(rule) {
        return `${rule.trackingKey}_${rule.coilKey}_${rule.boardId || 'default'}`;
    }
    /**
     * Generate unique session ID
     */
    generateSessionId(trackingKey) {
        return `${trackingKey}_${Date.now()}`;
    }
    /**
     * Get active sessions count
     */
    getActiveSessionsCount() {
        return this.activeSessions.size;
    }
    /**
     * Get tracking rules count
     */
    getTrackingRulesCount() {
        return this.trackingRules.length;
    }
    /**
     * Calculate delta between two snapshots
     */
    calculateDelta(endSnapshot, startSnapshot) {
        if (!startSnapshot) {
            return null;
        }
        const delta = {};
        for (const key in endSnapshot) {
            if (key === 'ts')
                continue; // Skip timestamp
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
    getSessionKeyFromEvent(event) {
        return `${event.trackingKey}_${event.coilKey}_${event.boardId || 'default'}`;
    }
}
exports.CoilTrackerService = CoilTrackerService;
