/**
 * Modbus Service for VIIS RPC Control Node
 * Handles Modbus operations including read/write and mapping
 */

import {
    IModbusService,
    ModbusMappingResult,
    ServiceOptions,
    EnvironmentConfig,
    ManualOverrides,
    ManualOverride
} from "../interfaces/types";
import { ModbusData } from "../../../core/modbus-client";
import { MODBUS_FUNCTION_CODES, ERROR_MESSAGES, ENV_KEYS, DEFAULTS, HOLDING_SETML_BOM_OFFSETS } from "../constants";
import { Logger } from "../utils/logger";
import { ScalingUtils } from "../utils/scaling";
import { GlobalContextHelper } from "../../../ultils/global-context-helper";
import ClientRegistry from "../../../core/client-registry";
import { GLOBAL_CONTEXT_KEYS } from "../../viis-telemetry/viis-telemetry-constants";

export class ModbusService implements IModbusService {
    private defaultModbusClient: any; // Default client for single-board or fallback
    private node: any; // Node instance for ClientRegistry access
    private environmentConfig: EnvironmentConfig;
    private logger: Logger;
    private scalingUtils: ScalingUtils;
    private flowContext: any;
    private nodeId: string;
    private globalHelper: GlobalContextHelper;

    constructor(options: ServiceOptions, modbusClient: any, scalingUtils: ScalingUtils) {
        this.defaultModbusClient = modbusClient;
        this.node = options.node;
        this.scalingUtils = scalingUtils;
        this.flowContext = options.flowContext;
        this.nodeId = options.node.id;
        this.logger = new Logger(options.node, "MODBUS-SERVICE");
        this.globalHelper = new GlobalContextHelper(options.node.context());
        this.environmentConfig = this.loadEnvironmentConfig();

        // Log Modbus client state during initialization
        this.logger.log(`ModbusService initialized`);
    }

    /**
     * Get the appropriate Modbus client for a given boardId
     * In multi-board mode, gets client from ClientRegistry
     * In single-board mode, returns default client
     */
    private async getModbusClient(boardId?: string): Promise<any> {
        if (boardId) {
            // Multi-board mode: Get client for specific board
            try {
                const client = await ClientRegistry.getModbusClientV2(boardId, this.node);
                return client;
            } catch (error) {
                this.logger.error(`Failed to get client for board ${boardId}: ${error}`);
                return this.defaultModbusClient;
            }
        }

        // Single-board mode: Use default client
        return this.defaultModbusClient;
    }

    /**
     * Load Modbus configuration from environment variables
     * Supports both single-board and multi-board modes
     */
    private loadEnvironmentConfig(): EnvironmentConfig {
        try {
            // Check if multi-board mode
            const boardsConfigStr = this.globalHelper.getEnvVar('MODBUS_BOARDS', null);
            let allCoils = {};
            let allHolding = {};
            let allInput = {};

            if (boardsConfigStr) {
                // Multi-board mode: Load per-board mappings
                try {
                    let boards;

                    // Handle both already-parsed array and JSON string
                    if (Array.isArray(boardsConfigStr)) {
                        boards = boardsConfigStr;
                    } else if (typeof boardsConfigStr === 'string') {
                        boards = JSON.parse(boardsConfigStr);
                    } else {
                        this.logger.error(`Invalid MODBUS_BOARDS type: ${typeof boardsConfigStr}`);
                        boards = null;
                    }

                    if (Array.isArray(boards) && boards.length > 0) {
                        this.logger.log(`Multi-board mode detected with ${boards.length} boards`);

                        // Load mappings for each board
                        boards.forEach((board: any) => {
                            const boardId = board.id.toUpperCase();

                            // Load board-specific mappings
                            const boardCoils = this.globalHelper.getJsonEnvVar(`MODBUS_${boardId}_COILS`, {});
                            const boardHolding = this.globalHelper.getJsonEnvVar(`MODBUS_${boardId}_HOLDING_REGISTERS`, {});
                            const boardInput = this.globalHelper.getJsonEnvVar(`MODBUS_${boardId}_INPUT_REGISTERS`, {});

                            this.logger.debug(`Board ${board.id}: ${Object.keys(boardCoils).length} coils, ${Object.keys(boardHolding).length} holding, ${Object.keys(boardInput).length} input`);

                            // Merge all mappings (will be used for findModbusMapping)
                            allCoils = { ...allCoils, ...boardCoils };
                            allHolding = { ...allHolding, ...boardHolding };
                            allInput = { ...allInput, ...boardInput };
                        });
                    }
                } catch (e) {
                    this.logger.error(`Failed to parse MODBUS_BOARDS: ${e}`);
                }
            }

            // Single-board mode OR fallback: Load common mappings
            const commonCoils = this.globalHelper.getJsonEnvVar(ENV_KEYS.MODBUS_COILS, {});
            const commonHolding = this.globalHelper.getJsonEnvVar(ENV_KEYS.MODBUS_HOLDING_REGISTERS, {});
            const commonInput = this.globalHelper.getJsonEnvVar(ENV_KEYS.MODBUS_INPUT_REGISTERS, {});

            // Merge: Common mappings + per-board mappings (per-board takes priority)
            return {
                deviceId: this.globalHelper.getEnvVar(ENV_KEYS.DEVICE_ID, DEFAULTS.DEVICE_ID),
                modbusCoils: { ...commonCoils, ...allCoils },
                modbusInputRegisters: { ...commonInput, ...allInput },
                modbusHoldingRegisters: { ...commonHolding, ...allHolding },
            };
        } catch (error) {
            this.logger.error(`Failed to load environment config: ${(error as Error).message}`);
            return {
                deviceId: DEFAULTS.DEVICE_ID,
                modbusCoils: {},
                modbusInputRegisters: {},
                modbusHoldingRegisters: {},
            };
        }
    }

    /**
     * Find which board contains the given key
     * Returns boardId or null if not found in any board-specific mapping
     */
    private findBoardIdForKey(key: string): string | null {
        const boardsConfigStr = this.globalHelper.getEnvVar('MODBUS_BOARDS', null);

        if (!boardsConfigStr) {
            return null; // Single-board mode
        }

        try {
            let boards;

            // Handle both already-parsed array and JSON string
            if (Array.isArray(boardsConfigStr)) {
                boards = boardsConfigStr;
            } else if (typeof boardsConfigStr === 'string') {
                boards = JSON.parse(boardsConfigStr);
            } else {
                return null;
            }

            if (!Array.isArray(boards) || boards.length === 0) {
                return null;
            }

            // Search each board's mappings
            for (const board of boards) {
                const boardId = board.id.toUpperCase();

                // Check coils
                const boardCoils = this.globalHelper.getJsonEnvVar(`MODBUS_${boardId}_COILS`, {});
                if (boardCoils[key] !== undefined) {
                    return board.id; // Return original case boardId
                }

                // Check holding registers
                const boardHolding = this.globalHelper.getJsonEnvVar(`MODBUS_${boardId}_HOLDING_REGISTERS`, {});
                if (boardHolding[key] !== undefined) {
                    return board.id;
                }

                // Check input registers
                const boardInput = this.globalHelper.getJsonEnvVar(`MODBUS_${boardId}_INPUT_REGISTERS`, {});
                if (boardInput[key] !== undefined) {
                    return board.id;
                }
            }

            return null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Find Modbus mapping for a given key
     * In multi-board mode, automatically detects which board the key belongs to
     */
    findModbusMapping(key: string): ModbusMappingResult | null {
        const { modbusHoldingRegisters, modbusCoils, modbusInputRegisters } = this.environmentConfig;

        // Auto-detect boardId in multi-board mode
        const boardId = this.findBoardIdForKey(key);

        // Check holding registers first (read/write)
        if (modbusHoldingRegisters[key] !== undefined) {
            return {
                address: modbusHoldingRegisters[key],
                fc: MODBUS_FUNCTION_CODES.WRITE_SINGLE_REGISTER,
                value: 0,
                boardId: boardId || undefined // Include boardId if found
            };
        }

        // Check coils (read/write)
        if (modbusCoils[key] !== undefined) {
            return {
                address: modbusCoils[key],
                fc: MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL,
                value: false,
                boardId: boardId || undefined // Include boardId if found
            };
        }

        // Check input registers (read-only)
        if (modbusInputRegisters[key] !== undefined) {
            return {
                address: modbusInputRegisters[key],
                fc: MODBUS_FUNCTION_CODES.READ_INPUT_REGISTERS,
                value: 0,
                boardId: boardId || undefined // Include boardId if found
            };
        }

        return null;
    }

    /**
     * Apply special offset for HOLDING_SETML_BOM keys (decoupled feature)
     */
    private applyHoldingSetmlBomOffset(key: string, value: number | boolean): number | boolean {
        // Check if offset feature is enabled
        if (!HOLDING_SETML_BOM_OFFSETS.ENABLED) {
            return value;
        }

        // Only apply offset to numeric values and specific keys
        if (typeof value === "number" && key in HOLDING_SETML_BOM_OFFSETS.OFFSETS) {
            const offset = HOLDING_SETML_BOM_OFFSETS.OFFSETS[key as keyof typeof HOLDING_SETML_BOM_OFFSETS.OFFSETS];
            const offsetValue = value + offset;
            this.logger.warn(`[OFFSET] Applied offset to ${key}: ${value} + ${offset} = ${offsetValue}`);
            return offsetValue;
        }

        return value;
    }

    /**
     * Write value to Modbus device
     * Automatically uses correct board client in multi-board mode
     */
    async writeToModbus(key: string, mapping: ModbusMappingResult, value: number | boolean): Promise<void> {
        try {
            const originalValue = value;
            let writeValue = value;

            // Apply special offset for HOLDING_SETML_BOM keys (decoupled feature)
            writeValue = this.applyHoldingSetmlBomOffset(key, writeValue);

            // Debug: Log the type of writeValue
            // this.node.warn(`[RPC] WRITE-DEBUG ${key}: value=${writeValue} typeof=${typeof writeValue}`);

            // Apply scaling for numeric values - also handle string numbers
            if (typeof writeValue === "string" && !isNaN(Number(writeValue))) {
                writeValue = Number(writeValue);
            }
            if (typeof writeValue === "number") {
                writeValue = this.scalingUtils.scaleValue(key, writeValue, "write");
            }

            // Log: Original command vs Scaled command
            const fcName = mapping.fc === 6 ? 'WRITE_REGISTER' : mapping.fc === 5 ? 'WRITE_COIL' : `FC${mapping.fc}`;
            // this.node.warn(`[RPC] WRITE ${key}: original=${originalValue} → scaled=${writeValue} | addr=${mapping.address} fc=${fcName}${mapping.boardId ? ` board=${mapping.boardId}` : ''}`);

            // Get appropriate Modbus client (auto-selects board in multi-board mode)
            const modbusClient = await this.getModbusClient(mapping.boardId);

            // Check if Modbus client is connected
            if (!modbusClient) {
                throw new Error("Modbus client is not initialized");
            }

            if (!modbusClient.isConnected) {
                throw new Error("Modbus client not connected");
            }

            // Perform the write operation based on function code
            if (mapping.fc === 6) { // WRITE_SINGLE_REGISTER
                await modbusClient.writeRegister(mapping.address, writeValue as number);
                // Note: Cache update removed from here - will be updated after read-back verification
            } else if (mapping.fc === 5) { // WRITE_SINGLE_COIL
                await modbusClient.writeCoil(mapping.address, writeValue as boolean);
                // Note: Cache update removed from here - will be updated after read-back verification
            } else {
                throw new Error(`Unsupported write function code: ${mapping.fc}`);
            }

            // Store manual override information
            this.storeManualOverride(mapping.address, mapping.fc, writeValue);

        } catch (error) {
            const errorMsg = (error as Error).message;

            // Check if this is a connection error and provide more context
            if (this.isConnectionError(errorMsg)) {
                throw new Error(`Connection lost during write for ${key}: ${errorMsg}`);
            }

            throw new Error(ERROR_MESSAGES.MODBUS_WRITE_FAILED(key) + `: ${errorMsg}`);
        }
    }

    /**
     * Read value from Modbus device
     * Automatically uses correct board client in multi-board mode
     */
    async readFromModbus(key: string, mapping: ModbusMappingResult): Promise<number | boolean> {
        try {
            // Get appropriate Modbus client (auto-selects board in multi-board mode)
            const modbusClient = await this.getModbusClient(mapping.boardId);

            const readFc = this.getReadFunctionCode(mapping.fc);
            let result: ModbusData;

            // Perform the read operation based on function code
            switch (readFc) {
                case MODBUS_FUNCTION_CODES.READ_COILS:
                    result = await modbusClient.readCoils(mapping.address, 1);
                    break;
                case MODBUS_FUNCTION_CODES.READ_HOLDING_REGISTERS:
                    result = await modbusClient.readHoldingRegisters(mapping.address, 1);
                    break;
                case MODBUS_FUNCTION_CODES.READ_INPUT_REGISTERS:
                    result = await modbusClient.readInputRegisters(mapping.address, 1);
                    break;
                default:
                    throw new Error(`Unsupported read function code: ${readFc}`);
            }

            const rawValue = result.data[0];
            let readValue = rawValue;

            // Apply scaling for numeric values
            if (typeof readValue === "number") {
                readValue = this.scalingUtils.scaleValue(key, readValue, "read");
            }

            // Log: Response from Modbus
            const fcName = readFc === 1 ? 'READ_COILS' : readFc === 3 ? 'READ_HOLDING' : readFc === 4 ? 'READ_INPUT' : `FC${readFc}`;
            // this.node.warn(`[RPC] READ ${key}: raw=${rawValue} → scaled=${readValue} | addr=${mapping.address} fc=${fcName}${mapping.boardId ? ` board=${mapping.boardId}` : ''}`);

            return readValue;

        } catch (error) {
            const errorMessage = ERROR_MESSAGES.MODBUS_READ_FAILED(key) + `: ${(error as Error).message}`;
            this.logger.error(errorMessage);
            throw new Error(errorMessage);
        }
    }

    /**
     * Get the appropriate read function code for a write function code
     */
    private getReadFunctionCode(writeFc: number): number {
        switch (writeFc) {
            case MODBUS_FUNCTION_CODES.WRITE_SINGLE_REGISTER:
                return MODBUS_FUNCTION_CODES.READ_HOLDING_REGISTERS;
            case MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL:
                return MODBUS_FUNCTION_CODES.READ_COILS;
            case MODBUS_FUNCTION_CODES.READ_INPUT_REGISTERS:
                return MODBUS_FUNCTION_CODES.READ_INPUT_REGISTERS;
            default:
                return writeFc;
        }
    }

    /**
     * Update global context cache after successful Modbus write AND read-back verification
     * This public method should be called ONLY after confirming the write succeeded
     * Keeps holdingRegisterData and coilRegisterData in sync with actual device state
     */
    updateGlobalContextCacheAfterVerification(key: string, value: number | boolean, fc: number): void {
        try {
            const globalContext = this.node.context().global;

            if (fc === MODBUS_FUNCTION_CODES.WRITE_SINGLE_REGISTER) {
                // Update holding register cache
                const holdingData = globalContext.get(GLOBAL_CONTEXT_KEYS.HOLDING_REGISTER_DATA) || {};
                holdingData[key] = value;
                holdingData.ts = Date.now(); // Update timestamp
                globalContext.set(GLOBAL_CONTEXT_KEYS.HOLDING_REGISTER_DATA, holdingData);
                this.logger.debug(`Updated global cache - holdingRegisterData.${key} = ${value}`);
            } else if (fc === MODBUS_FUNCTION_CODES.WRITE_SINGLE_COIL) {
                // Update coil register cache
                const coilData = globalContext.get(GLOBAL_CONTEXT_KEYS.COIL_REGISTER_DATA) || {};
                coilData[key] = value;
                coilData.ts = Date.now(); // Update timestamp
                globalContext.set(GLOBAL_CONTEXT_KEYS.COIL_REGISTER_DATA, coilData);
                this.logger.debug(`Updated global cache - coilRegisterData.${key} = ${value}`);
            }
        } catch (error) {
            this.logger.warn(`Failed to update global context cache: ${(error as Error).message}`);
            // Don't throw - cache update is non-critical, write already succeeded
        }
    }

    /**
     * Store manual override information for tracking
     */
    private storeManualOverride(address: number, fc: number, value: any): void {
        const manualOverrides = this.getManualOverrides();
        const addressKey = `${address}-${fc}`;

        manualOverrides[addressKey] = {
            fc,
            value,
            timestamp: Date.now()
        };

        this.setManualOverrides(manualOverrides);
        this.logger.debug(`Stored manual override: address=${address}, fc=${fc}, value=${value}`);
    }

    /**
     * Get manual overrides from flow context
     */
    private getManualOverrides(): ManualOverrides {
        const contextKey = `manualModbusOverrides_${this.nodeId}`;
        return this.flowContext.get(contextKey) || {};
    }

    /**
     * Set manual overrides in flow context
     */
    private setManualOverrides(overrides: ManualOverrides): void {
        const contextKey = `manualModbusOverrides_${this.nodeId}`;
        this.flowContext.set(contextKey, overrides);
    }

    /**
     * Check if an address has a recent manual override
     */
    hasRecentManualOverride(address: number, fc: number, maxAgeMs: number = 30000): boolean {
        const manualOverrides = this.getManualOverrides();
        const addressKey = `${address}-${fc}`;
        const override = manualOverrides[addressKey];

        if (!override) {
            return false;
        }

        const age = Date.now() - override.timestamp;
        return age <= maxAgeMs;
    }

    /**
     * Get environment configuration
     */
    getEnvironmentConfig(): EnvironmentConfig {
        return this.environmentConfig;
    }

    /**
     * Refresh environment configuration
     */
    refreshEnvironmentConfig(): void {
        this.environmentConfig = this.loadEnvironmentConfig();
        this.logger.log("Environment configuration refreshed");
    }

    /**
     * Get all configured Modbus keys
     */
    getAllModbusKeys(): string[] {
        const { modbusHoldingRegisters, modbusCoils, modbusInputRegisters } = this.environmentConfig;
        return [
            ...Object.keys(modbusHoldingRegisters),
            ...Object.keys(modbusCoils),
            ...Object.keys(modbusInputRegisters)
        ];
    }

    /**
     * Check if a key has Modbus mapping
     */
    hasModbusMapping(key: string): boolean {
        return this.findModbusMapping(key) !== null;
    }

    /**
     * Get modbus holding registers mapping
     */
    getModbusHoldingRegisters(): Record<string, number> {
        return this.environmentConfig.modbusHoldingRegisters || {};
    }

    /**
     * Get modbus coils mapping
     */
    getModbusCoils(): Record<string, number> {
        return this.environmentConfig.modbusCoils || {};
    }

    /**
     * Check if an error is related to connection issues
     */
    private isConnectionError(errorMessage: string): boolean {
        const connectionErrorPatterns = [
            "Port Not Open",
            "Timed out",
            "ECONNREFUSED",
            "ETIMEDOUT",
            "ECONNRESET",
            "EPIPE",
            "EHOSTUNREACH",
            "ENETUNREACH",
            "socket hang up",
            "socket closed",
            "Connection lost",
            "timeout",
            "TIMEOUT"
        ];

        return connectionErrorPatterns.some(pattern =>
            errorMessage.toLowerCase().includes(pattern.toLowerCase())
        );
    }

    /**
     * Check if HOLDING_SETML_BOM offset feature is enabled
     */
    isHoldingSetmlBomOffsetEnabled(): boolean {
        return HOLDING_SETML_BOM_OFFSETS.ENABLED;
    }

    /**
     * Get the offset value for a specific HOLDING_SETML_BOM key
     */
    getHoldingSetmlBomOffset(key: string): number | null {
        if (!HOLDING_SETML_BOM_OFFSETS.ENABLED) {
            return null;
        }

        if (key in HOLDING_SETML_BOM_OFFSETS.OFFSETS) {
            return HOLDING_SETML_BOM_OFFSETS.OFFSETS[key as keyof typeof HOLDING_SETML_BOM_OFFSETS.OFFSETS];
        }

        return null;
    }

    /**
     * Get all HOLDING_SETML_BOM offset configurations
     */
    getHoldingSetmlBomOffsetConfig(): typeof HOLDING_SETML_BOM_OFFSETS {
        return HOLDING_SETML_BOM_OFFSETS;
    }

    /**
     * Check Modbus connection and attempt to reconnect if needed.
     * In multi-board mode, pass boardId to reconnect the correct board's client.
     * Falls back to defaultModbusClient when boardId is not provided.
     */
    async checkConnection(boardId?: string): Promise<void> {
        try {
            // Use board-specific client in multi-board mode, otherwise fall back to default
            const modbusClient = boardId
                ? await this.getModbusClient(boardId)
                : this.defaultModbusClient;

            if (!modbusClient) {
                throw new Error("Modbus client is not initialized");
            }

            // Check if client reports as connected
            if (!modbusClient.isConnectedCheck()) {
                this.logger.log("Modbus client disconnected, attempting to reconnect...");

                try {
                    await modbusClient.reconnect();
                    this.logger.log("Modbus reconnection successful");

                    // Wait a moment for connection to stabilize
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    return;
                } catch (reconnectError) {
                    throw new Error(`Reconnection failed: ${(reconnectError as Error).message}`);
                }
            }

            // Try a simple read operation to verify connection (skip for now to avoid additional errors)
            // The connection check via isConnectedCheck() should be sufficient
            this.logger.debug("[MODBUS-SERVICE] Modbus connection verified successfully");

        } catch (error) {
            const errorMsg = `Modbus connection check failed: ${(error as Error).message}`;
            this.logger.error(errorMsg);
            throw new Error(errorMsg);
        }
    }
}
