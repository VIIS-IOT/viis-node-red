"use strict";
/**
 * Polling service for viis-telemetry node
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ViisTelemetryPollingService = void 0;
const events_1 = require("events");
const viis_telemetry_utils_1 = require("./viis-telemetry-utils");
const error_notification_service_1 = require("../../services/error-notification.service");
const viis_telemetry_constants_1 = require("./viis-telemetry-constants");
/**
 * Manages polling operations for different Modbus register types
 */
class ViisTelemetryPollingService extends events_1.EventEmitter {
    constructor(node, nodeContext, modbusClient, boardId, deviceId) {
        super();
        this.isPollingPaused = false;
        this.isConfigUpdating = false;
        this.node = node;
        this.nodeContext = nodeContext;
        this.modbusClient = modbusClient;
        this.errorNotificationService = new error_notification_service_1.ErrorNotificationService(nodeContext);
        this.currentBoardId = boardId;
        this.deviceId = deviceId || node.id;
        this.pollingStates = {
            coils: { isPolling: false, consecutiveFailures: 0, interval: null },
            inputRegisters: { isPolling: false, consecutiveFailures: 0, interval: null },
            holdingRegisters: { isPolling: false, consecutiveFailures: 0, interval: null },
        };
    }
    /**
     * Start polling for all register types
     */
    startPolling(coilConfig, inputConfig, holdingConfig, registerMappings) {
        this.stopPolling();
        // Start coil polling
        this.pollingStates.coils.interval = setInterval(() => this.pollCoils(coilConfig, registerMappings.coils), coilConfig.interval);
        // Start input register polling
        this.pollingStates.inputRegisters.interval = setInterval(() => this.pollInputRegisters(inputConfig, registerMappings.inputRegisters), inputConfig.interval);
        // Start holding register polling
        this.pollingStates.holdingRegisters.interval = setInterval(() => this.pollHoldingRegisters(holdingConfig, registerMappings.holdingRegisters), holdingConfig.interval);
        this.node.status({ fill: "green", shape: "dot", text: "Polling started" });
    }
    /**
     * Stop all polling
     */
    stopPolling() {
        Object.values(this.pollingStates).forEach(state => {
            if (state.interval) {
                clearInterval(state.interval);
                state.interval = null;
            }
            state.isPolling = false;
        });
    }
    /**
     * Pause polling
     */
    pausePolling() {
        this.isPollingPaused = true;
        this.stopPolling();
    }
    /**
     * Resume polling if not paused
     */
    resumePolling() {
        this.isPollingPaused = false;
        // Reset failure counters
        Object.values(this.pollingStates).forEach(state => {
            state.consecutiveFailures = 0;
            state.isPolling = false;
        });
    }
    /**
     * Check if polling is active
     */
    isPollingActive() {
        return !this.isPollingPaused && Object.values(this.pollingStates).some(state => state.interval !== null);
    }
    /**
     * Set config updating flag
     */
    setConfigUpdating(updating) {
        this.isConfigUpdating = updating;
    }
    /**
     * Poll coils
     */
    async pollCoils(config, mapping) {
        const state = this.pollingStates.coils;
        // Skip if previous polling is still in progress
        if (state.isPolling) {
            this.node.warn('coils polling skipped - previous operation still in progress');
            return;
        }
        if (this.isPollingPaused || this.isConfigUpdating)
            return;
        if (state.consecutiveFailures >= viis_telemetry_constants_1.MAX_CONSECUTIVE_FAILURES) {
            this.handleMaxFailures('coils', state);
            return;
        }
        state.isPolling = true;
        try {
            const result = await this.retryOperation(() => this.modbusClient.readCoils(config.startAddress, config.quantity), config.interval);
            const currentState = this.processCoilData(result, mapping, config.startAddress);
            this.node.context().global.set(viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.COIL_REGISTER_DATA, currentState);
            this.emitTelemetryData(currentState, viis_telemetry_constants_1.REGISTER_TYPES.COILS);
            state.consecutiveFailures = 0;
        }
        catch (error) {
            await this.handlePollingError('coils', state, error);
        }
        finally {
            state.isPolling = false;
            if (this.isConfigUpdating) {
                this.resetPreviousState();
            }
        }
    }
    /**
     * Poll input registers
     */
    async pollInputRegisters(config, mapping) {
        const state = this.pollingStates.inputRegisters;
        // Skip if previous polling is still in progress
        if (state.isPolling) {
            this.node.warn('inputRegisters polling skipped - previous operation still in progress');
            return;
        }
        if (this.isPollingPaused || this.isConfigUpdating)
            return;
        if (state.consecutiveFailures >= viis_telemetry_constants_1.MAX_CONSECUTIVE_FAILURES) {
            this.handleMaxFailures('inputRegisters', state);
            return;
        }
        state.isPolling = true;
        try {
            const result = await this.retryOperation(() => this.modbusClient.readInputRegisters(config.startAddress, config.quantity), config.interval);
            const currentState = this.processRegisterData(result, mapping, 'read', 'input');
            this.node.context().global.set(viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.INPUT_REGISTER_DATA, currentState);
            this.emitTelemetryData(currentState, viis_telemetry_constants_1.REGISTER_TYPES.INPUT_REGISTERS);
            state.consecutiveFailures = 0;
        }
        catch (error) {
            await this.handlePollingError('inputRegisters', state, error);
        }
        finally {
            state.isPolling = false;
            if (this.isConfigUpdating) {
                this.resetPreviousState();
            }
        }
    }
    /**
     * Poll holding registers
     */
    async pollHoldingRegisters(config, mapping) {
        const state = this.pollingStates.holdingRegisters;
        // Skip if previous polling is still in progress
        if (state.isPolling) {
            this.node.warn('holdingRegisters polling skipped - previous operation still in progress');
            return;
        }
        if (this.isPollingPaused || this.isConfigUpdating)
            return;
        if (state.consecutiveFailures >= viis_telemetry_constants_1.MAX_CONSECUTIVE_FAILURES) {
            this.handleMaxFailures('holdingRegisters', state);
            return;
        }
        state.isPolling = true;
        try {
            const result = await this.retryOperation(() => this.modbusClient.readHoldingRegisters(config.startAddress, config.quantity), config.interval);
            const currentState = this.processRegisterData(result, mapping, 'read', 'holding');
            this.node.context().global.set(viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.HOLDING_REGISTER_DATA, currentState);
            // Emit with raw data for TFS parsing
            this.emitTelemetryData(currentState, viis_telemetry_constants_1.REGISTER_TYPES.HOLDING_REGISTERS, result.data);
            state.consecutiveFailures = 0;
        }
        catch (error) {
            await this.handlePollingError('holdingRegisters', state, error);
        }
        finally {
            state.isPolling = false;
            if (this.isConfigUpdating) {
                this.resetPreviousState();
            }
        }
    }
    /**
     * Process coil data
     */
    processCoilData(result, mapping, startAddress) {
        const currentState = {};
        const data = result.data;
        data.forEach((value, index) => {
            const key = Object.keys(mapping).find(k => mapping[k] === index + startAddress);
            if (key) {
                currentState[key] = value;
                // Special handling for main pump state
                if (key === "main_pump") {
                    this.nodeContext.set('mainPumpState', value);
                }
            }
        });
        return currentState;
    }
    /**
     * Process register data with scaling
     * Scaling is configured via SCALE_CONFIGS in global context
     */
    processRegisterData(result, mapping, direction, registerType = 'input') {
        const currentState = {};
        const values = result.data;
        const scaleConfigs = this.node.context().global.get(viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.SCALE_CONFIGS) || [];
        Object.entries(mapping).forEach(([key, index]) => {
            // Apply scaling from config - handles all scaling including fs01-fs06 division
            const value = (0, viis_telemetry_utils_1.applyScaling)(key, values[index], direction, scaleConfigs);
            currentState[key] = value;
        });
        return currentState;
    }
    /**
     * Emit telemetry data event
     */
    emitTelemetryData(data, source, rawData) {
        this.emit('telemetry-data', { data, source, rawData });
    }
    /**
     * Handle maximum failures reached
     */
    handleMaxFailures(type, state) {
        this.node.warn(`${type} polling suspended due to ${state.consecutiveFailures} failures. Retrying in ${viis_telemetry_constants_1.POLLING_BACKOFF_TIME / 1000}s`);
        setTimeout(() => {
            state.consecutiveFailures = 0;
            state.isPolling = false;
        }, viis_telemetry_constants_1.POLLING_BACKOFF_TIME);
    }
    /**
     * Handle polling error
     */
    async handlePollingError(type, state, error) {
        state.consecutiveFailures++;
        this.node.error(`${type} polling error: ${error.message}`);
        this.node.warn(`Consecutive ${type} failures: ${state.consecutiveFailures}/${viis_telemetry_constants_1.MAX_CONSECUTIVE_FAILURES}`);
        // Proactively write error notification when max failures reached
        if (state.consecutiveFailures >= viis_telemetry_constants_1.MAX_CONSECUTIVE_FAILURES) {
            await this.writeModbusConnectionError(type, error);
        }
    }
    /**
     * Retry operation with exponential backoff
     * Automatically reduces retries for fast polling intervals
     */
    async retryOperation(operation, pollInterval) {
        let lastError;
        // Reduce retries for fast polling (< 2s) to avoid request buildup
        const maxRetries = pollInterval && pollInterval < 2000 ? 1 : viis_telemetry_constants_1.MAX_RETRY_ATTEMPTS;
        const retryDelay = pollInterval && pollInterval < 2000 ? 200 : viis_telemetry_constants_1.RETRY_DELAY;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            }
            catch (error) {
                lastError = error;
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
                }
            }
        }
        throw lastError;
    }
    /**
     * Reset previous state
     */
    resetPreviousState() {
        this.nodeContext.set('previousState', {});
        this.isConfigUpdating = false;
    }
    /**
     * Proactively write Modbus connection error notification
     */
    async writeModbusConnectionError(registerType, error) {
        try {
            const errorData = {
                err_code: `MODBUS_${registerType.toUpperCase()}_CONNECTION_FAILURE`,
                message: `Failed to read ${registerType} after ${viis_telemetry_constants_1.MAX_RETRY_ATTEMPTS} retry attempts: ${error.message}`,
                severity: 'high',
                type: 'error',
                entity: this.deviceId,
                entity_label: `Device ${this.deviceId}`,
                metadata: {
                    register_type: registerType,
                    board_id: this.currentBoardId,
                    error_message: error.message,
                    consecutive_failures: viis_telemetry_constants_1.MAX_CONSECUTIVE_FAILURES,
                    max_retry_attempts: viis_telemetry_constants_1.MAX_RETRY_ATTEMPTS,
                    timestamp: new Date().toISOString()
                }
            };
            await this.errorNotificationService.createFromBusinessLogic(errorData);
            this.node.warn(`Error notification created for ${registerType} connection failure`);
        }
        catch (notificationError) {
            // Silently skip if database not ready
            if ((notificationError === null || notificationError === void 0 ? void 0 : notificationError.message) !== 'Database not initialized') {
                this.node.error(`Failed to create error notification: ${notificationError.message}`);
            }
        }
    }
}
exports.ViisTelemetryPollingService = ViisTelemetryPollingService;
