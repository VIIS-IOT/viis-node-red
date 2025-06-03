"use strict";
/**
 * Configuration management for viis-telemetry node
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ViisTelemetryConfigManager = void 0;
const viis_telemetry_constants_1 = require("./viis-telemetry-constants");
const global_context_helper_1 = require("../../ultils/global-context-helper");
/**
 * Configuration manager for viis-telemetry node
 */
class ViisTelemetryConfigManager {
    constructor(nodeConfig, nodeContext) {
        this.nodeConfig = nodeConfig;
        this.nodeContext = nodeContext;
        this.globalHelper = nodeContext ? new global_context_helper_1.GlobalContextHelper(nodeContext) : undefined;
    }
    /**
     * Get validated polling configuration
     */
    getPollingConfig() {
        return {
            coil: {
                interval: this.validatePollingInterval(this.nodeConfig.pollIntervalCoil, viis_telemetry_constants_1.DEFAULT_POLLING_INTERVALS.COIL),
                startAddress: this.parseIntWithDefault(this.nodeConfig.coilStartAddress, viis_telemetry_constants_1.DEFAULT_REGISTER_CONFIG.COIL.START_ADDRESS),
                quantity: this.parseIntWithDefault(this.nodeConfig.coilQuantity, viis_telemetry_constants_1.DEFAULT_REGISTER_CONFIG.COIL.QUANTITY),
                periodicSnapshotInterval: this.parseIntWithDefault(this.nodeConfig.periodicSnapshotIntervalCoil, 0),
            },
            input: {
                interval: this.validatePollingInterval(this.nodeConfig.pollIntervalInput, viis_telemetry_constants_1.DEFAULT_POLLING_INTERVALS.INPUT),
                startAddress: this.parseIntWithDefault(this.nodeConfig.inputStartAddress, viis_telemetry_constants_1.DEFAULT_REGISTER_CONFIG.INPUT.START_ADDRESS),
                quantity: this.parseIntWithDefault(this.nodeConfig.inputQuantity, viis_telemetry_constants_1.DEFAULT_REGISTER_CONFIG.INPUT.QUANTITY),
                periodicSnapshotInterval: this.parseIntWithDefault(this.nodeConfig.periodicSnapshotIntervalInput, 0),
            },
            holding: {
                interval: this.validatePollingInterval(this.nodeConfig.pollIntervalHolding, viis_telemetry_constants_1.DEFAULT_POLLING_INTERVALS.HOLDING),
                startAddress: this.parseIntWithDefault(this.nodeConfig.holdingStartAddress, viis_telemetry_constants_1.DEFAULT_REGISTER_CONFIG.HOLDING.START_ADDRESS),
                quantity: this.parseIntWithDefault(this.nodeConfig.holdingQuantity, viis_telemetry_constants_1.DEFAULT_REGISTER_CONFIG.HOLDING.QUANTITY),
                periodicSnapshotInterval: this.parseIntWithDefault(this.nodeConfig.periodicSnapshotIntervalHolding, 0),
            },
        };
    }
    /**
     * Get MQTT topic configuration
     */
    getMqttTopicConfig(deviceId) {
        return {
            emqx: viis_telemetry_constants_1.MQTT_TOPICS.EMQX_PATTERN.replace('{deviceId}', deviceId),
            thingsboard: viis_telemetry_constants_1.MQTT_TOPICS.THINGSBOARD,
        };
    }
    /**
     * Get environment-based configuration
     */
    getEnvironmentConfig() {
        if (this.globalHelper) {
            return {
                deviceId: this.globalHelper.getEnvVar('DEVICE_ID', 'unknown'),
                modbusCoils: this.globalHelper.getJsonEnvVar('MODBUS_COILS', {}),
                modbusInputRegisters: this.globalHelper.getJsonEnvVar('MODBUS_INPUT_REGISTERS', {}),
                modbusHoldingRegisters: this.globalHelper.getJsonEnvVar('MODBUS_HOLDING_REGISTERS', {}),
            };
        }
        // Fallback to process.env if no global helper
        return {
            deviceId: process.env.DEVICE_ID || 'unknown',
            modbusCoils: this.parseJsonWithDefault(process.env.MODBUS_COILS, {}),
            modbusInputRegisters: this.parseJsonWithDefault(process.env.MODBUS_INPUT_REGISTERS, {}),
            modbusHoldingRegisters: this.parseJsonWithDefault(process.env.MODBUS_HOLDING_REGISTERS, {}),
        };
    }
    /**
     * Get debug log setting
     */
    getDebugLogEnabled() {
        var _a;
        return (_a = this.nodeConfig.enableDebugLog) !== null && _a !== void 0 ? _a : false;
    }
    /**
     * Get threshold configuration
     */
    getThresholdConfig() {
        return this.parseJsonWithDefault(this.nodeConfig.thresholdConfig, {});
    }
    /**
     * Validate and ensure minimum polling interval
     */
    validatePollingInterval(value, defaultValue) {
        const parsed = parseInt(value, 10);
        if (isNaN(parsed) || parsed < viis_telemetry_constants_1.MIN_POLLING_INTERVAL) {
            return Math.max(defaultValue, viis_telemetry_constants_1.MIN_POLLING_INTERVAL);
        }
        return parsed;
    }
    /**
     * Parse integer with default fallback
     */
    parseIntWithDefault(value, defaultValue) {
        const parsed = parseInt(value, 10);
        return isNaN(parsed) ? defaultValue : parsed;
    }
    /**
     * Parse JSON with default fallback
     */
    parseJsonWithDefault(value, defaultValue) {
        if (!value)
            return defaultValue;
        try {
            const parsed = JSON.parse(value);
            return parsed !== null && parsed !== void 0 ? parsed : defaultValue;
        }
        catch (_a) {
            return defaultValue;
        }
    }
}
exports.ViisTelemetryConfigManager = ViisTelemetryConfigManager;
