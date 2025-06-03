"use strict";
/**
 * Polling service for viis-telemetry node
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ViisTelemetryPollingService = void 0;
const events_1 = require("events");
const viis_telemetry_utils_1 = require("./viis-telemetry-utils");
const viis_telemetry_constants_1 = require("./viis-telemetry-constants");
/**
 * Manages polling operations for different Modbus register types
 */
class ViisTelemetryPollingService extends events_1.EventEmitter {
    constructor(node, nodeContext, modbusClient) {
        super();
        this.isPollingPaused = false;
        this.isConfigUpdating = false;
        this.node = node;
        this.nodeContext = nodeContext;
        this.modbusClient = modbusClient;
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
        if (state.isPolling || this.isPollingPaused || this.isConfigUpdating)
            return;
        if (state.consecutiveFailures >= viis_telemetry_constants_1.MAX_CONSECUTIVE_FAILURES) {
            this.handleMaxFailures('coils', state);
            return;
        }
        state.isPolling = true;
        try {
            const result = await this.retryOperation(() => this.modbusClient.readCoils(config.startAddress, config.quantity));
            const currentState = this.processCoilData(result, mapping, config.startAddress);
            this.node.context().global.set(viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.COIL_REGISTER_DATA, currentState);
            this.emitTelemetryData(currentState, viis_telemetry_constants_1.REGISTER_TYPES.COILS);
            state.consecutiveFailures = 0;
        }
        catch (error) {
            this.handlePollingError('coils', state, error);
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
        if (state.isPolling || this.isPollingPaused || this.isConfigUpdating)
            return;
        if (state.consecutiveFailures >= viis_telemetry_constants_1.MAX_CONSECUTIVE_FAILURES) {
            this.handleMaxFailures('inputRegisters', state);
            return;
        }
        state.isPolling = true;
        try {
            const result = await this.retryOperation(() => this.modbusClient.readInputRegisters(config.startAddress, config.quantity));
            const currentState = this.processRegisterData(result, mapping, 'read');
            this.node.context().global.set(viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.INPUT_REGISTER_DATA, currentState);
            this.emitTelemetryData(currentState, viis_telemetry_constants_1.REGISTER_TYPES.INPUT_REGISTERS);
            state.consecutiveFailures = 0;
        }
        catch (error) {
            this.handlePollingError('inputRegisters', state, error);
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
        if (state.isPolling || this.isPollingPaused || this.isConfigUpdating)
            return;
        if (state.consecutiveFailures >= viis_telemetry_constants_1.MAX_CONSECUTIVE_FAILURES) {
            this.handleMaxFailures('holdingRegisters', state);
            return;
        }
        state.isPolling = true;
        try {
            const result = await this.retryOperation(() => this.modbusClient.readHoldingRegisters(config.startAddress, config.quantity));
            const currentState = this.processRegisterData(result, mapping, 'read');
            this.node.context().global.set(viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.HOLDING_REGISTER_DATA, currentState);
            this.emitTelemetryData(currentState, viis_telemetry_constants_1.REGISTER_TYPES.HOLDING_REGISTERS);
            state.consecutiveFailures = 0;
        }
        catch (error) {
            this.handlePollingError('holdingRegisters', state, error);
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
     */
    processRegisterData(result, mapping, direction) {
        const currentState = {};
        const values = result.data;
        const scaleConfigs = this.node.context().global.get(viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.SCALE_CONFIGS) || [];
        Object.entries(mapping).forEach(([key, index]) => {
            currentState[key] = (0, viis_telemetry_utils_1.applyScaling)(key, values[index], direction, scaleConfigs);
        });
        return currentState;
    }
    /**
     * Emit telemetry data event
     */
    emitTelemetryData(data, source) {
        this.emit('telemetry-data', { data, source });
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
    handlePollingError(type, state, error) {
        state.consecutiveFailures++;
        this.node.error(`${type} polling error: ${error.message}`);
        this.node.warn(`Consecutive ${type} failures: ${state.consecutiveFailures}/${viis_telemetry_constants_1.MAX_CONSECUTIVE_FAILURES}`);
    }
    /**
     * Retry operation with exponential backoff
     */
    async retryOperation(operation) {
        let lastError;
        for (let attempt = 1; attempt <= viis_telemetry_constants_1.MAX_RETRY_ATTEMPTS; attempt++) {
            try {
                return await operation();
            }
            catch (error) {
                lastError = error;
                if (attempt < viis_telemetry_constants_1.MAX_RETRY_ATTEMPTS) {
                    await new Promise(resolve => setTimeout(resolve, viis_telemetry_constants_1.RETRY_DELAY * attempt));
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
}
exports.ViisTelemetryPollingService = ViisTelemetryPollingService;
