"use strict";
/**
 * Telemetry Repository with Repository Pattern
 * Abstracts database operations for testability
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockTelemetryRepository = exports.DatabaseTelemetryRepository = void 0;
const dataSource_1 = require("../../../orm/dataSource");
const TabiotDeviceTelemetry_1 = require("../../../orm/entities/device-telemetry/TabiotDeviceTelemetry");
const constants_1 = require("../constants");
/**
 * Database implementation of telemetry repository
 */
class DatabaseTelemetryRepository {
    constructor(nodeContext, deviceId, logger) {
        this.dataSource = null;
        this.telemetryRepo = null;
        this.dbInitStarted = false;
        this.dbInitFailed = false;
        this.dbInitAttempt = 0;
        this.dbInitNextRetryAt = 0;
        this.isSaving = false;
        this.pendingPayload = null;
        this.lastSavedTimestamp = 0;
        this.isClosing = false;
        this.nodeContext = nodeContext;
        this.deviceId = deviceId;
        this.logger = logger;
    }
    async initialize() {
        if (this.dbInitFailed || this.dbInitStarted)
            return;
        const now = Date.now();
        if (this.dbInitNextRetryAt && now < this.dbInitNextRetryAt)
            return;
        this.dbInitStarted = true;
        try {
            this.dataSource = await (0, dataSource_1.createDataSource)(this.nodeContext);
            if (!this.dataSource.isInitialized) {
                await this.dataSource.initialize();
            }
            this.telemetryRepo = this.dataSource.getRepository(TabiotDeviceTelemetry_1.TabiotDeviceTelemetry);
            this.logger.info("[AIS] Database initialized for local telemetry storage");
        }
        catch (err) {
            this.handleInitError(err);
        }
        finally {
            this.dbInitStarted = false;
        }
    }
    handleInitError(err) {
        this.dbInitAttempt++;
        this.dbInitStarted = false;
        if (this.dbInitAttempt >= constants_1.DB_MAX_INIT_ATTEMPTS) {
            this.dbInitFailed = true;
        }
        const delayMs = Math.min(constants_1.DB_MAX_RETRY_DELAY_MS, constants_1.DB_RETRY_BACKOFF_BASE * Math.pow(2, Math.min(this.dbInitAttempt, constants_1.DB_RETRY_MAX_EXPONENT)));
        this.dbInitNextRetryAt = Date.now() + delayMs;
        this.logger.warn(`[AIS] Failed to initialize database: ${err.message}`);
    }
    isInitialized() {
        return this.telemetryRepo !== null;
    }
    getMonotonicTimestamp() {
        const now = Date.now();
        if (now <= this.lastSavedTimestamp) {
            this.lastSavedTimestamp = this.lastSavedTimestamp + 1;
            return this.lastSavedTimestamp;
        }
        this.lastSavedTimestamp = now;
        return now;
    }
    sanitizeKey(key) {
        return key.replace(/[^a-zA-Z0-9_]/g, "_");
    }
    buildEntities(timestamp, payload) {
        const entities = [];
        const addScalar = (key, value) => {
            const entity = new TabiotDeviceTelemetry_1.TabiotDeviceTelemetry();
            entity.device_id = this.deviceId;
            entity.timestamp = timestamp;
            entity.key_name = `ais_${this.sanitizeKey(key)}`;
            if (typeof value === "number") {
                entity.value_type = "float";
                entity.float_value = value;
            }
            else if (typeof value === "boolean") {
                entity.value_type = "boolean";
                entity.boolean_value = value;
            }
            else {
                entity.value_type = "string";
                entity.string_value = String(value).slice(0, 255);
            }
            entities.push(entity);
        };
        for (const [key, value] of Object.entries(payload)) {
            if (value === undefined || value === null)
                continue;
            if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
                addScalar(key, value);
            }
        }
        // Add full JSON snapshot
        const snapshot = new TabiotDeviceTelemetry_1.TabiotDeviceTelemetry();
        snapshot.device_id = this.deviceId;
        snapshot.timestamp = timestamp;
        snapshot.key_name = "ais_payload";
        snapshot.value_type = "json";
        snapshot.json_value = payload;
        entities.push(snapshot);
        return entities;
    }
    async save(payload) {
        if (this.isClosing || this.dbInitFailed)
            return;
        if (this.isSaving) {
            this.pendingPayload = payload;
            return;
        }
        if (!this.telemetryRepo) {
            await this.initialize();
            if (!this.telemetryRepo)
                return;
        }
        const timestamp = this.getMonotonicTimestamp();
        const entities = this.buildEntities(timestamp, payload);
        if (entities.length === 0)
            return;
        this.isSaving = true;
        try {
            await this.telemetryRepo.save(entities);
            this.logger.debug(`[AIS] Saved ${entities.length} telemetry records to database`);
        }
        catch (err) {
            this.logger.warn(`[AIS] Failed to save telemetry: ${err.message}`);
        }
        finally {
            this.isSaving = false;
            const nextPayload = this.pendingPayload;
            this.pendingPayload = null;
            if (nextPayload) {
                void this.save(nextPayload);
            }
        }
    }
    async close() {
        var _a;
        this.isClosing = true;
        if ((_a = this.dataSource) === null || _a === void 0 ? void 0 : _a.isInitialized) {
            await this.dataSource.destroy();
        }
    }
    setClosing(closing) {
        this.isClosing = closing;
    }
}
exports.DatabaseTelemetryRepository = DatabaseTelemetryRepository;
/**
 * Mock repository for testing
 */
class MockTelemetryRepository {
    constructor() {
        this.savedPayloads = [];
        this._isInitialized = false;
    }
    async initialize() {
        this._isInitialized = true;
    }
    isInitialized() {
        return this._isInitialized;
    }
    async save(payload) {
        this.savedPayloads.push(payload);
    }
    async close() {
        this._isInitialized = false;
    }
    getSavedPayloads() {
        return this.savedPayloads;
    }
    clearPayloads() {
        this.savedPayloads = [];
    }
}
exports.MockTelemetryRepository = MockTelemetryRepository;
