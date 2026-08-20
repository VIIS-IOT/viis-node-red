"use strict";
/**
 * Configuration management for viis-telemetry node
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ViisTelemetryConfigManager = void 0;
const viis_telemetry_constants_1 = require("./viis-telemetry-constants");
const global_context_helper_1 = require("../../ultils/global-context-helper");
const demeter_mqtt_topics_1 = require("../../core/demeter-mqtt-topics");
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
            thingsboard: (0, demeter_mqtt_topics_1.buildDeviceTelemetryTopic)(deviceId, this.globalHelper),
        };
    }
    /**
     * Get environment-based configuration
     * Supports both single-board and multi-board modes
     * @param boardId - Board ID for multi-board mode (e.g., 'board1')
     */
    getEnvironmentConfig(boardId) {
        if (this.globalHelper) {
            // Check if multi-board mode by detecting MODBUS_BOARDS (try lowercase first)
            let boardsConfig = this.globalHelper.getEnvVar('modbus_boards', null);
            if (!boardsConfig) {
                boardsConfig = this.globalHelper.getEnvVar('MODBUS_BOARDS', null);
            }
            const isMultiBoard = !!boardsConfig;
            if (isMultiBoard && boardId) {
                // Multi-board mode: Load board-specific env vars
                // Try lowercase first (env-loader uses lowercase), then uppercase (legacy)
                const boardIdLower = boardId.toLowerCase();
                const boardIdUpper = boardId.toUpperCase();
                // Try lowercase keys first (from env-loader)
                let coils = this.globalHelper.getJsonEnvVar(`modbus_${boardIdLower}_coils`, null);
                let inputRegs = this.globalHelper.getJsonEnvVar(`modbus_${boardIdLower}_input_registers`, null);
                let holdingRegs = this.globalHelper.getJsonEnvVar(`modbus_${boardIdLower}_holding_registers`, null);
                // Fallback to uppercase keys if lowercase not found
                if (coils === null) {
                    coils = this.globalHelper.getJsonEnvVar(`MODBUS_${boardIdUpper}_COILS`, {});
                }
                if (inputRegs === null) {
                    inputRegs = this.globalHelper.getJsonEnvVar(`MODBUS_${boardIdUpper}_INPUT_REGISTERS`, {});
                }
                if (holdingRegs === null) {
                    holdingRegs = this.globalHelper.getJsonEnvVar(`MODBUS_${boardIdUpper}_HOLDING_REGISTERS`, {});
                }
                return {
                    deviceId: this.globalHelper.getEnvVar('DEVICE_ID', 'unknown'),
                    modbusCoils: coils || {},
                    modbusInputRegisters: inputRegs || {},
                    modbusHoldingRegisters: holdingRegs || {},
                };
            }
            // Single-board mode: Load standard env vars
            return {
                deviceId: this.globalHelper.getEnvVar('DEVICE_ID', 'unknown'),
                modbusCoils: this.globalHelper.getJsonEnvVar('MODBUS_COILS', {}),
                modbusInputRegisters: this.globalHelper.getJsonEnvVar('MODBUS_INPUT_REGISTERS', {}),
                modbusHoldingRegisters: this.globalHelper.getJsonEnvVar('MODBUS_HOLDING_REGISTERS', {}),
            };
        }
        // No global helper: return defaults only (no process.env fallback)
        return {
            deviceId: 'unknown',
            modbusCoils: {},
            modbusInputRegisters: {},
            modbusHoldingRegisters: {},
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
