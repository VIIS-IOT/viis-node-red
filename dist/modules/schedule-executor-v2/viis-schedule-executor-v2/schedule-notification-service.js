"use strict";
/**
 * Schedule Notification Service V2
 * Responsibility: Publish MQTT telemetry, audit logs, and config updates
 *
 * Extracted from V1's ScheduleService notification methods
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScheduleNotificationService = void 0;
const global_context_helper_1 = require("../../../ultils/global-context-helper");
const uuid_1 = require("uuid");
class ScheduleNotificationService {
    constructor(node, debugEnable = false) {
        this.PUBLISHED_VALUE_CACHE_KEY = "scheduleExecutorV2PublishedValueCache";
        this.node = node;
        this.debugEnable = debugEnable;
        this.globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
    }
    debugLog(message) {
        if (this.debugEnable && this.node) {
            this.node.warn(message);
        }
    }
    // ==================== VALUE CACHE (dedup) ====================
    getPublishedValueCache() {
        var _a;
        return ((_a = this.node) === null || _a === void 0 ? void 0 : _a.context().global.get(this.PUBLISHED_VALUE_CACHE_KEY)) || {};
    }
    setPublishedValueCache(cache) {
        var _a;
        (_a = this.node) === null || _a === void 0 ? void 0 : _a.context().global.set(this.PUBLISHED_VALUE_CACHE_KEY, cache);
    }
    valueHash(value) {
        try {
            return JSON.stringify(value);
        }
        catch (_a) {
            return String(value);
        }
    }
    hasPublishedValueChanged(cacheKey, value) {
        const cache = this.getPublishedValueCache();
        return cache[cacheKey] !== this.valueHash(value);
    }
    updatePublishedValueCache(entries) {
        const cache = this.getPublishedValueCache();
        for (const [key, value] of Object.entries(entries)) {
            cache[key] = this.valueHash(value);
        }
        this.setPublishedValueCache(cache);
    }
    // ==================== MQTT HELPER ====================
    getDeviceId() {
        return this.globalHelper ? this.globalHelper.getEnvVar("DEVICE_ID", "unknown") : "unknown";
    }
    getThingsboardTopic() {
        return "v1/devices/me/telemetry";
    }
    getEmqxTopic() {
        return `viis/things/v2/${this.getDeviceId()}/telemetry`;
    }
    /**
     * Publish payload to both ThingsBoard and EMQX
     * Returns true if at least one broker succeeded
     */
    async publishToBoth(thingsboardClient, emqxClient, payload, label) {
        const payloadString = JSON.stringify(payload);
        let anySuccess = false;
        // Publish to ThingsBoard
        try {
            await thingsboardClient.publish(this.getThingsboardTopic(), payloadString);
            this.debugLog(`Published ${label} to ThingsBoard`);
            anySuccess = true;
        }
        catch (error) {
            this.debugLog(`Failed to publish ${label} to ThingsBoard: ${error.message}`);
        }
        // Publish to EMQX
        try {
            await emqxClient.publish(this.getEmqxTopic(), payloadString);
            this.debugLog(`Published ${label} to EMQX`);
            anySuccess = true;
        }
        catch (error) {
            this.debugLog(`Failed to publish ${label} to EMQX: ${error.message}`);
        }
        return anySuccess;
    }
    // ==================== SCHEDULE TELEMETRY ====================
    /**
     * Publish schedule telemetry to MQTT (ThingsBoard + EMQX)
     * Publishes all written Modbus keys in one object
     */
    async publishScheduleTelemetry(thingsboardClient, emqxClient, schedule, action, commands, configKeyValues) {
        var _a, _b;
        try {
            const changedValues = {};
            // Check Modbus commands for changes
            for (const cmd of [...commands.holdingCommands, ...commands.coilCommands]) {
                const cacheKey = `telemetry:${cmd.key}`;
                if (this.hasPublishedValueChanged(cacheKey, cmd.value)) {
                    changedValues[cmd.key] = cmd.value;
                }
            }
            // Check config values for changes
            if (configKeyValues && Object.keys(configKeyValues).length > 0) {
                for (const [key, value] of Object.entries(configKeyValues)) {
                    const cacheKey = `telemetry:${key}`;
                    if (this.hasPublishedValueChanged(cacheKey, value)) {
                        changedValues[key] = value;
                    }
                }
            }
            if (Object.keys(changedValues).length === 0) {
                this.debugLog(`Skipping unchanged telemetry for ${schedule.name} (${action})`);
                return;
            }
            // Build telemetry payload
            const telemetryData = Object.assign({ ts: Date.now(), _schedule_action: action, _schedule_id: schedule.name, _schedule_label: schedule.label }, changedValues);
            // Deduplication: skip if same data published within 5 seconds
            const lastPublishedKey = `telemetryLastPublishedV2_${schedule.name}_${action}`;
            const lastPublished = (_a = this.node) === null || _a === void 0 ? void 0 : _a.context().global.get(lastPublishedKey);
            const hashData = Object.assign({}, telemetryData);
            delete hashData.ts;
            const currentHash = JSON.stringify(hashData);
            const now = Date.now();
            if (lastPublished && lastPublished.hash === currentHash && (now - lastPublished.timestamp) < 5000) {
                this.debugLog(`Skipping duplicate telemetry for ${schedule.name} (${action})`);
                return;
            }
            await this.publishToBoth(thingsboardClient, emqxClient, telemetryData, `telemetry ${schedule.name}`);
            // Update tracking
            (_b = this.node) === null || _b === void 0 ? void 0 : _b.context().global.set(lastPublishedKey, { hash: currentHash, timestamp: now });
            this.updatePublishedValueCache(Object.fromEntries(Object.entries(changedValues).map(([key, value]) => [`telemetry:${key}`, value])));
            const modbusKeyCount = commands.holdingCommands.length + commands.coilCommands.length;
            if (this.node) {
                this.node.warn(`📊 TELEMETRY: ${schedule.name} | ${action} | ${modbusKeyCount} Modbus + ${Object.keys(configKeyValues || {}).length} Config keys`);
            }
        }
        catch (error) {
            if (this.node) {
                this.node.warn(`❌ TELEMETRY ERROR: ${schedule.name} | ${error.message}`);
            }
        }
    }
    // ==================== AUDIT LOG ====================
    /**
     * Publish audit log for schedule execution
     */
    async publishAuditLog(thingsboardClient, emqxClient, schedule, action, commands, success = true, errorMessage) {
        try {
            const requestId = (0, uuid_1.v4)();
            const allCommands = [...commands.holdingCommands, ...commands.coilCommands];
            const actionText = action === 'start' ? 'bắt đầu' : 'kết thúc';
            const statusText = success ? 'thành công' : 'thất bại';
            const changedKeys = allCommands.map(cmd => `${cmd.key}=${cmd.value}`).join(', ');
            let message;
            if (success) {
                message = `Lịch trình "${schedule.label || schedule.name}" ${actionText}: ${changedKeys || 'không có thay đổi'}`;
            }
            else {
                message = `Lịch trình "${schedule.label || schedule.name}" ${actionText} ${statusText}: ${errorMessage || 'Lỗi không xác định'}`;
            }
            const logs = {
                from: "DEVICE_EXE_SCHEDULE",
                requestId: requestId,
                message: message,
                metadata: {
                    status: success ? "SUCCESS" : "FAIL",
                    schedule_id: schedule.name,
                    schedule_label: schedule.label,
                    action: action,
                    changed_keys: allCommands.map(cmd => ({
                        key: cmd.key,
                        value: cmd.value,
                        address: cmd.address,
                        fc: cmd.fc
                    })),
                    timestamp: Date.now(),
                    error: errorMessage || null
                }
            };
            await this.publishToBoth(thingsboardClient, emqxClient, { logs }, `audit log ${schedule.name}`);
            if (this.node) {
                this.node.warn(`📝 AUDIT LOG: ${schedule.name} | ${action} | ${allCommands.length} keys | ${success ? 'SUCCESS' : 'FAIL'}`);
            }
        }
        catch (error) {
            if (this.node) {
                this.node.warn(`❌ AUDIT LOG ERROR: ${schedule.name} | ${error.message}`);
            }
        }
    }
    // ==================== CONFIG UPDATE ====================
    /**
     * Publish config parameter update via MQTT
     */
    async publishConfigUpdate(thingsboardClient, emqxClient, configParam) {
        try {
            const cacheKey = `config:${configParam.key}`;
            if (!this.hasPublishedValueChanged(cacheKey, configParam.value)) {
                this.debugLog(`Skipping unchanged config: ${configParam.key}=${configParam.value}`);
                return;
            }
            const payload = {
                ts: configParam.timestamp,
                [configParam.key]: configParam.value,
                note: `Config parameter updated (no Modbus mapping) for schedule ${configParam.scheduleId}`,
                type: configParam.type,
                source: "schedule-executor-v2"
            };
            await this.publishToBoth(thingsboardClient, emqxClient, payload, `config ${configParam.key}`);
            this.updatePublishedValueCache({ [cacheKey]: configParam.value });
        }
        catch (error) {
            this.debugLog(`Failed to publish config ${configParam.key}: ${error.message}`);
        }
    }
}
exports.ScheduleNotificationService = ScheduleNotificationService;
