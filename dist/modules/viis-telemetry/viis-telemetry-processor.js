"use strict";
/**
 * Telemetry processing service for viis-telemetry node
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ViisTelemetryProcessor = void 0;
const viis_telemetry_utils_1 = require("./viis-telemetry-utils");
const viis_telemetry_constants_1 = require("./viis-telemetry-constants");
/**
 * Processes telemetry data and handles publishing logic
 */
class ViisTelemetryProcessor {
    constructor(node, nodeContext, flowContext, localMqttClient, thingsboardMqttClient, config, periodicSnapshotConfig) {
        this.node = node;
        this.nodeContext = nodeContext;
        this.flowContext = flowContext;
        this.localMqttClient = localMqttClient;
        this.thingsboardMqttClient = thingsboardMqttClient;
        this.config = config;
        this.periodicSnapshotConfig = periodicSnapshotConfig;
    }
    /**
     * Process telemetry data and determine if publishing is needed
     */
    async processTelemetryData(event) {
        var _a;
        const { data: currentState, source } = event;
        const previousState = this.getPreviousState();
        const thresholdConfig = this.getThresholdConfig();
        const changedKeys = (0, viis_telemetry_utils_1.getChangedKeys)(currentState, previousState, thresholdConfig);
        // PMR-005: detect threshold-config change and reset state to republish full snapshot.
        // savedKeyCountKey is namespaced with this.node.id so multi-instance flows are isolated.
        const currentKeyCount = Object.keys(thresholdConfig).length;
        const savedKeyCountKey = `${viis_telemetry_constants_1.CONTEXT_KEYS.THRESHOLD_CONFIG}_count_${this.node.id}`;
        const savedKeyCount = (_a = this.flowContext.get(savedKeyCountKey)) !== null && _a !== void 0 ? _a : -1;
        const configChanged = savedKeyCount !== -1 && savedKeyCount !== currentKeyCount;
        const now = Date.now();
        const lastSent = this.getLastSent();
        const periodicInterval = this.getPeriodicSnapshotInterval(source);
        if (configChanged) {
            // Config was updated externally (e.g. via input handler). Reset previousState
            // so the next diff is computed against a clean baseline and a full snapshot
            // is published this cycle.
            this.resetState();
            const freshChangedKeys = (0, viis_telemetry_utils_1.getChangedKeys)(currentState, {}, thresholdConfig);
            await this.publishTelemetryData(freshChangedKeys);
            this.setLastSent(now);
            this.logDebug(`[${source}] Published full snapshot after config change (${savedKeyCount} → ${currentKeyCount} keys)`);
        }
        // Check if we should publish based on changes
        else if (Object.keys(changedKeys).length > 0) {
            await this.publishTelemetryData(changedKeys);
            this.setLastSent(now);
            this.logDebug(`[${source}] Published telemetry (threshold) ${JSON.stringify(thresholdConfig)}: ${JSON.stringify(changedKeys)}`);
        }
        // Check if we should publish based on periodic snapshot
        else if (periodicInterval > 0 && now - lastSent >= periodicInterval) {
            await this.publishTelemetryData(currentState);
            this.setLastSent(now);
            this.logDebug(`[${source}] Published telemetry (periodic): ${JSON.stringify(currentState)}`);
        }
        // No publishing needed
        else {
            this.logDebug(`[${source}] No telemetry sent (no change, not timer)`);
        }
        // Persist the baseline key count for the next cycle's comparison.
        this.flowContext.set(savedKeyCountKey, currentKeyCount);
        // Update previous state and send output
        this.updatePreviousState(currentState);
        this.sendNodeOutput(currentState);
        this.updateNodeStatus(source);
    }
    /**
     * Update threshold configuration
     */
    updateThresholdConfig(newConfig) {
        this.flowContext.set(this.config.thresholdConfigKey, newConfig);
        this.logDebug(`[Config] Threshold config updated: ${JSON.stringify(newConfig)}`);
    }
    /**
     * Update debug log setting
     */
    updateDebugLogSetting(enabled) {
        this.flowContext.set(this.config.debugLogKey, enabled);
        this.logDebug(`Debug log is ${enabled ? 'enabled' : 'disabled'} (updated via msg)`);
    }
    /**
     * Reset processor state
     */
    resetState() {
        this.nodeContext.set(viis_telemetry_constants_1.CONTEXT_KEYS.PREVIOUS_STATE, {});
        this.nodeContext.set(viis_telemetry_constants_1.CONTEXT_KEYS.LAST_SENT, 0);
    }
    /**
     * Get previous telemetry state
     */
    getPreviousState() {
        return this.nodeContext.get(viis_telemetry_constants_1.CONTEXT_KEYS.PREVIOUS_STATE) || {};
    }
    /**
     * Update previous telemetry state
     */
    updatePreviousState(currentState) {
        const previousState = this.getPreviousState();
        Object.assign(previousState, currentState);
        this.nodeContext.set(viis_telemetry_constants_1.CONTEXT_KEYS.PREVIOUS_STATE, previousState);
    }
    /**
     * Get threshold configuration
     */
    getThresholdConfig() {
        return this.flowContext.get(this.config.thresholdConfigKey) || {};
    }
    /**
     * Get last sent timestamp
     */
    getLastSent() {
        return this.nodeContext.get(viis_telemetry_constants_1.CONTEXT_KEYS.LAST_SENT) || 0;
    }
    /**
     * Set last sent timestamp
     */
    setLastSent(timestamp) {
        this.nodeContext.set(viis_telemetry_constants_1.CONTEXT_KEYS.LAST_SENT, timestamp);
    }
    /**
     * Get periodic snapshot interval for source
     */
    getPeriodicSnapshotInterval(source) {
        switch (source) {
            case 'Coils':
                return this.periodicSnapshotConfig.coil;
            case 'Input Registers':
                return this.periodicSnapshotConfig.input;
            case 'Holding Registers':
                return this.periodicSnapshotConfig.holding;
            default:
                return 0;
        }
    }
    /**
     * Publish telemetry data to both MQTT brokers
     */
    async publishTelemetryData(data) {
        try {
            await (0, viis_telemetry_utils_1.publishTelemetry)({
                data,
                emqxClient: this.localMqttClient,
                thingsboardClient: this.thingsboardMqttClient,
                emqxTopic: this.config.emqxTopic,
                thingsboardTopic: this.config.thingsboardTopic,
            });
        }
        catch (error) {
            this.node.error(`Failed to publish telemetry: ${error.message}`);
            // Don't throw - let the service continue even if MQTT publish fails
            this.node.warn('Continuing local operations despite MQTT publish failure');
        }
    }
    /**
     * Send data to node output
     */
    sendNodeOutput(data) {
        this.node.send({ payload: data });
    }
    /**
     * Update node visual status
     */
    updateNodeStatus(source) {
        this.node.status({
            fill: 'green',
            shape: 'dot',
            text: `${source}: Data processed`
        });
    }
    /**
     * Log debug message if enabled
     */
    logDebug(message) {
        const debugEnabled = this.flowContext.get(this.config.debugLogKey) || false;
        (0, viis_telemetry_utils_1.debugLog)({
            enable: debugEnabled,
            node: this.node,
            message,
        });
    }
}
exports.ViisTelemetryProcessor = ViisTelemetryProcessor;
