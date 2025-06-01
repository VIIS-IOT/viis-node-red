import { Node } from "node-red";
import { ModbusClientCore } from "../../../core/modbus-client";
import { TelemetryService } from "./telemetryService";
import { DatabaseService } from "./databaseService";
import { ThresholdChecker } from "../utils/thresholdChecker";
import { Logger } from "../utils/logger";
import {
    PollingConfig,
    ModbusData,
    TelemetryData,
    PollingState,
    ThresholdConfig,
    EnvironmentConfig
} from "../interfaces/types";
import {
    DEFAULT_CONFIG,
    REGISTER_TYPES,
    MODBUS_FUNCTION_CODES,
    STATUS_MESSAGES,
    ERROR_MESSAGES,
    GLOBAL_CONTEXT_KEYS
} from "../constants";

/**
 * Service for handling Modbus polling operations
 */
export class ModbusPollerService {
    private node: Node;
    private logger: Logger;
    private modbusClient: ModbusClientCore;
    private telemetryService: TelemetryService;
    private thresholdChecker: ThresholdChecker;
    private environmentConfig: EnvironmentConfig;

    // Polling configurations
    private coilConfig: PollingConfig;
    private inputConfig: PollingConfig;
    private holdingConfig: PollingConfig;
    private periodicSnapshotInterval: number;

    // Polling states
    private pollingStates: {
        coils: PollingState;
        inputs: PollingState;
        holdings: PollingState;
    };

    // Data storage
    private previousData: {
        coils: ModbusData;
        inputs: ModbusData;
        holdings: ModbusData;
    };

    private lastSnapshotTime: number = 0;
    private isInitialized: boolean = false;

    constructor(
        node: Node,
        logger: Logger,
        modbusClient: ModbusClientCore,
        telemetryService: TelemetryService,
        environmentConfig: EnvironmentConfig
    ) {
        this.node = node;
        this.logger = logger;
        this.modbusClient = modbusClient;
        this.telemetryService = telemetryService;
        this.environmentConfig = environmentConfig;
        this.thresholdChecker = new ThresholdChecker();

        // Initialize polling states
        this.pollingStates = {
            coils: { isPolling: false, lastPollTime: 0, consecutiveFailures: 0 },
            inputs: { isPolling: false, lastPollTime: 0, consecutiveFailures: 0 },
            holdings: { isPolling: false, lastPollTime: 0, consecutiveFailures: 0 }
        };

        // Initialize previous data storage
        this.previousData = {
            coils: {},
            inputs: {},
            holdings: {}
        };

        // Initialize default configurations
        this.coilConfig = {
            interval: DEFAULT_CONFIG.COIL_POLLING_INTERVAL,
            quantity: DEFAULT_CONFIG.COIL_QUANTITY,
            startAddress: DEFAULT_CONFIG.START_ADDRESS
        };

        this.inputConfig = {
            interval: DEFAULT_CONFIG.INPUT_POLLING_INTERVAL,
            quantity: DEFAULT_CONFIG.INPUT_QUANTITY,
            startAddress: DEFAULT_CONFIG.START_ADDRESS
        };

        this.holdingConfig = {
            interval: DEFAULT_CONFIG.HOLDING_POLLING_INTERVAL,
            quantity: DEFAULT_CONFIG.HOLDING_QUANTITY,
            startAddress: DEFAULT_CONFIG.START_ADDRESS
        };

        this.periodicSnapshotInterval = DEFAULT_CONFIG.PERIODIC_SNAPSHOT_INTERVAL;
    }

    /**
     * Initialize the polling service
     */
    async initialize(): Promise<void> {
        try {
            await this.telemetryService.initialize();
            this.isInitialized = true;
            this.logger.log("Modbus poller service initialized successfully");
        } catch (error) {
            this.logger.errorWithStack("Failed to initialize modbus poller service", error as Error);
            throw error;
        }
    }

    /**
     * Update polling configurations
     */
    updateConfigurations(
        coilConfig: Partial<PollingConfig>,
        inputConfig: Partial<PollingConfig>,
        holdingConfig: Partial<PollingConfig>,
        thresholdConfig: ThresholdConfig,
        periodicSnapshotInterval: number
    ): void {
        // Update polling configurations
        this.coilConfig = { ...this.coilConfig, ...coilConfig };
        this.inputConfig = { ...this.inputConfig, ...inputConfig };
        this.holdingConfig = { ...this.holdingConfig, ...holdingConfig };
        this.periodicSnapshotInterval = periodicSnapshotInterval;

        // Update threshold checker
        this.thresholdChecker.updateThresholdConfig(thresholdConfig);

        this.logger.debug("Polling configurations updated");
    }

    /**
     * Start polling operations
     */
    startPolling(): void {
        if (!this.isInitialized) {
            this.logger.error("Service not initialized");
            return;
        }

        this.logger.log("Starting Modbus polling operations");

        // Start polling for each register type
        this.startCoilPolling();
        this.startInputPolling();
        this.startHoldingPolling();

        this.node.status({ fill: "green", shape: "dot", text: STATUS_MESSAGES.READY });
    }

    /**
     * Stop polling operations
     */
    stopPolling(): void {
        this.logger.log("Stopping Modbus polling operations");

        // Clear all timers
        if (this.pollingStates.coils.timer) {
            clearInterval(this.pollingStates.coils.timer);
            this.pollingStates.coils.timer = undefined;
        }

        if (this.pollingStates.inputs.timer) {
            clearInterval(this.pollingStates.inputs.timer);
            this.pollingStates.inputs.timer = undefined;
        }

        if (this.pollingStates.holdings.timer) {
            clearInterval(this.pollingStates.holdings.timer);
            this.pollingStates.holdings.timer = undefined;
        }

        // Reset polling states
        this.pollingStates.coils.isPolling = false;
        this.pollingStates.inputs.isPolling = false;
        this.pollingStates.holdings.isPolling = false;

        this.node.status({ fill: "red", shape: "ring", text: STATUS_MESSAGES.DISCONNECTED });
    }

    /**
     * Start coil polling
     */
    private startCoilPolling(): void {
        if (this.pollingStates.coils.timer) {
            clearInterval(this.pollingStates.coils.timer);
        }

        this.pollingStates.coils.timer = setInterval(async () => {
            await this.pollCoils();
        }, this.coilConfig.interval);

        this.logger.debug(`Started coil polling with interval: ${this.coilConfig.interval}ms`);
    }

    /**
     * Start input polling
     */
    private startInputPolling(): void {
        if (this.pollingStates.inputs.timer) {
            clearInterval(this.pollingStates.inputs.timer);
        }

        this.pollingStates.inputs.timer = setInterval(async () => {
            await this.pollInputs();
        }, this.inputConfig.interval);

        this.logger.debug(`Started input polling with interval: ${this.inputConfig.interval}ms`);
    }

    /**
     * Start holding register polling
     */
    private startHoldingPolling(): void {
        if (this.pollingStates.holdings.timer) {
            clearInterval(this.pollingStates.holdings.timer);
        }

        this.pollingStates.holdings.timer = setInterval(async () => {
            await this.pollHoldings();
        }, this.holdingConfig.interval);

        this.logger.debug(`Started holding register polling with interval: ${this.holdingConfig.interval}ms`);
    }

    /**
     * Poll coils
     */
    private async pollCoils(): Promise<void> {
        if (this.pollingStates.coils.isPolling) return;

        this.pollingStates.coils.isPolling = true;
        this.pollingStates.coils.lastPollTime = Date.now();

        try {
            this.node.status({ fill: "blue", shape: "dot", text: STATUS_MESSAGES.POLLING_COILS });
            this.logger.logPolling(REGISTER_TYPES.COILS, this.coilConfig.startAddress, this.coilConfig.quantity);

            const result = await this.modbusClient.readCoils(this.coilConfig.startAddress, this.coilConfig.quantity);
            const currentData = this.processCoilData(result.data as boolean[], this.environmentConfig.modbusCoils);

            // Store in global context
            this.node.context().global.set(GLOBAL_CONTEXT_KEYS.COIL_REGISTER_DATA, currentData);

            // Process telemetry
            await this.processTelemetryData(currentData, this.previousData.coils, REGISTER_TYPES.COILS);

            // Update previous data
            this.previousData.coils = { ...currentData };
            this.pollingStates.coils.consecutiveFailures = 0;

        } catch (error) {
            this.handlePollingError(REGISTER_TYPES.COILS, error as Error);
        } finally {
            this.pollingStates.coils.isPolling = false;
        }
    }

    /**
     * Poll input registers
     */
    private async pollInputs(): Promise<void> {
        if (this.pollingStates.inputs.isPolling) return;

        this.pollingStates.inputs.isPolling = true;
        this.pollingStates.inputs.lastPollTime = Date.now();

        try {
            this.node.status({ fill: "blue", shape: "dot", text: STATUS_MESSAGES.POLLING_INPUTS });
            this.logger.logPolling(REGISTER_TYPES.INPUTS, this.inputConfig.startAddress, this.inputConfig.quantity);

            const result = await this.modbusClient.readInputRegisters(this.inputConfig.startAddress, this.inputConfig.quantity);
            const currentData = this.processRegisterData(result.data as number[], this.environmentConfig.modbusInputRegisters);

            // Store in global context
            this.node.context().global.set(GLOBAL_CONTEXT_KEYS.INPUT_REGISTER_DATA, currentData);

            // Process telemetry
            await this.processTelemetryData(currentData, this.previousData.inputs, REGISTER_TYPES.INPUTS);

            // Update previous data
            this.previousData.inputs = { ...currentData };
            this.pollingStates.inputs.consecutiveFailures = 0;

        } catch (error) {
            this.handlePollingError(REGISTER_TYPES.INPUTS, error as Error);
        } finally {
            this.pollingStates.inputs.isPolling = false;
        }
    }

    /**
     * Poll holding registers
     */
    private async pollHoldings(): Promise<void> {
        if (this.pollingStates.holdings.isPolling) return;

        this.pollingStates.holdings.isPolling = true;
        this.pollingStates.holdings.lastPollTime = Date.now();

        try {
            this.node.status({ fill: "blue", shape: "dot", text: STATUS_MESSAGES.POLLING_HOLDINGS });
            this.logger.logPolling(REGISTER_TYPES.HOLDINGS, this.holdingConfig.startAddress, this.holdingConfig.quantity);

            const result = await this.modbusClient.readHoldingRegisters(this.holdingConfig.startAddress, this.holdingConfig.quantity);
            const currentData = this.processRegisterData(result.data as number[], this.environmentConfig.modbusHoldingRegisters);

            // Store in global context
            this.node.context().global.set(GLOBAL_CONTEXT_KEYS.HOLDING_REGISTER_DATA, currentData);

            // Process telemetry
            await this.processTelemetryData(currentData, this.previousData.holdings, REGISTER_TYPES.HOLDINGS);

            // Update previous data
            this.previousData.holdings = { ...currentData };
            this.pollingStates.holdings.consecutiveFailures = 0;

        } catch (error) {
            this.handlePollingError(REGISTER_TYPES.HOLDINGS, error as Error);
        } finally {
            this.pollingStates.holdings.isPolling = false;
        }
    }

    /**
     * Process coil data into key-value pairs
     */
    private processCoilData(data: boolean[], mapping: Record<string, number>): ModbusData {
        const result: ModbusData = {};

        for (const [key, address] of Object.entries(mapping)) {
            const index = address - this.coilConfig.startAddress;
            if (index >= 0 && index < data.length) {
                result[key] = data[index];
            }
        }

        return result;
    }

    /**
     * Process register data into key-value pairs
     */
    private processRegisterData(data: number[], mapping: Record<string, number>): ModbusData {
        const result: ModbusData = {};

        for (const [key, address] of Object.entries(mapping)) {
            const index = address - this.inputConfig.startAddress; // Use appropriate config
            if (index >= 0 && index < data.length) {
                result[key] = data[index];
            }
        }

        return result;
    }

    /**
     * Process telemetry data - check thresholds and handle periodic snapshots
     */
    private async processTelemetryData(currentData: ModbusData, previousData: ModbusData, registerType: string): Promise<void> {
        try {
            const now = Date.now();

            // Check for threshold changes
            const changedKeys = this.thresholdChecker.getChangedKeys(currentData, previousData);
            const hasChanges = Object.keys(changedKeys).length > 0;

            // Check if periodic snapshot is due
            const isPeriodicSnapshotDue = this.periodicSnapshotInterval > 0 &&
                (now - this.lastSnapshotTime) >= this.periodicSnapshotInterval;

            // Determine what data to publish
            let dataToPublish: TelemetryData | null = null;

            if (hasChanges) {
                // Publish changed keys due to threshold
                dataToPublish = changedKeys;
                this.logger.debug(`${registerType}: Publishing threshold changes - ${JSON.stringify(changedKeys)}`);
            } else if (isPeriodicSnapshotDue) {
                // Publish all current data as periodic snapshot
                dataToPublish = currentData;
                this.lastSnapshotTime = now;
                this.logger.logPeriodicSnapshot(currentData);
            }

            // Publish and save telemetry if needed
            if (dataToPublish) {
                this.node.status({ fill: "yellow", shape: "dot", text: STATUS_MESSAGES.PUBLISHING });
                await this.telemetryService.processTelemetryData(dataToPublish, now);
                this.node.status({ fill: "green", shape: "dot", text: STATUS_MESSAGES.READY });
            }

        } catch (error) {
            this.logger.errorWithStack("Failed to process telemetry data", error as Error);
            this.node.status({ fill: "red", shape: "ring", text: STATUS_MESSAGES.ERROR });
        }
    }

    /**
     * Handle polling errors
     */
    private handlePollingError(registerType: string, error: Error): void {
        const state = this.getPollingState(registerType);
        state.consecutiveFailures++;

        this.logger.errorWithStack(`${registerType} polling failed (attempt ${state.consecutiveFailures})`, error);

        if (state.consecutiveFailures >= DEFAULT_CONFIG.MAX_CONSECUTIVE_FAILURES) {
            this.logger.error(`${registerType}: Maximum consecutive failures reached. Stopping polling.`);
            this.node.status({ fill: "red", shape: "ring", text: STATUS_MESSAGES.MAX_FAILURES });

            // Stop this specific polling
            if (state.timer) {
                clearInterval(state.timer);
                state.timer = undefined;
            }
        } else {
            this.node.status({ fill: "yellow", shape: "ring", text: `${registerType} error (${state.consecutiveFailures})` });
        }
    }

    /**
     * Get polling state for a register type
     */
    private getPollingState(registerType: string): PollingState {
        switch (registerType) {
            case REGISTER_TYPES.COILS:
                return this.pollingStates.coils;
            case REGISTER_TYPES.INPUTS:
                return this.pollingStates.inputs;
            case REGISTER_TYPES.HOLDINGS:
                return this.pollingStates.holdings;
            default:
                throw new Error(`Unknown register type: ${registerType}`);
        }
    }

    /**
     * Get current polling status
     */
    getPollingStatus(): { coils: boolean; inputs: boolean; holdings: boolean } {
        return {
            coils: this.pollingStates.coils.isPolling,
            inputs: this.pollingStates.inputs.isPolling,
            holdings: this.pollingStates.holdings.isPolling
        };
    }

    /**
     * Get current data for all register types
     */
    getCurrentData(): { coils: ModbusData; inputs: ModbusData; holdings: ModbusData } {
        return {
            coils: { ...this.previousData.coils },
            inputs: { ...this.previousData.inputs },
            holdings: { ...this.previousData.holdings }
        };
    }

    /**
     * Reset all polling states and data
     */
    reset(): void {
        this.stopPolling();

        // Reset previous data
        this.previousData.coils = {};
        this.previousData.inputs = {};
        this.previousData.holdings = {};

        // Reset polling states
        Object.values(this.pollingStates).forEach(state => {
            state.consecutiveFailures = 0;
            state.lastPollTime = 0;
        });

        this.lastSnapshotTime = 0;
        this.logger.log("Polling service reset");
    }

    /**
     * Check if service is ready
     */
    isReady(): boolean {
        return this.isInitialized && this.telemetryService.isReady();
    }
}
