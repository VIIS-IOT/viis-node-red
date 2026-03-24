/**
 * VIIS Device Protection Node v2.0
 * 
 * Advanced protection logic with Min/Max/Bypass/Force support
 * 
 * Architecture follows viis-rpc-control pattern:
 * - ConfigService for configuration management
 * - ProtectionManager for business logic
 * - ErrorNotificationService for alerts
 * - Constants for centralized configuration
 */

import { NodeAPI, NodeDef, Node } from "node-red";
import ClientRegistry, { MultiModbusConfig } from "../../core/client-registry";
import { GlobalContextHelper } from "../../ultils/global-context-helper";
import { ErrorNotificationService } from "../../services/error-notification.service";
import { ProtectionManager, ProtectionResult } from "./protection-manager";
import { ConfigService } from "./services/configService";
import { 
    CONTEXT_KEYS, 
    ENV_KEYS, 
    MODBUS_CONFIG, 
    PROTECTION_CONFIG,
    DEVICE_TYPES,
    ERROR_MESSAGES,
    STATUS_MESSAGES 
} from "./constants";

interface ViisDeviceProtectionNodeDef extends NodeDef {
    boardMode?: 'auto' | 'single' | 'multi';
    boardId?: string;
}

module.exports = function (RED: NodeAPI) {
    function ViisDeviceProtectionNode(this: Node, config: ViisDeviceProtectionNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;

        // ========================================================================
        // Initialize Services
        // ========================================================================
        
        const globalHelper = new GlobalContextHelper(node.context());
        const errorNotificationService = new ErrorNotificationService(node.context());
        const configService = new ConfigService(node);
        const protectionManager = new ProtectionManager();

        // ========================================================================
        // Node State
        // ========================================================================

        let currentBoardId: string | undefined = config.boardId;
        let isMultiBoardMode: boolean = false;
        let currentModbusConfig: any = null;
        let modbusClient: any;
        let configCheckInterval: NodeJS.Timeout | null = null;

        // Modbus mappings - Follow common_pattern.md
        // Primary: Use modbus_board1_coils for multi-board setup
        // Fallback: Use modbusCoils for backward compatibility
        let modbusCoils: Record<string, number> = {};
        let modbusHoldingRegisters: Record<string, number> = {};
        let modbusInputRegisters: Record<string, number> = {};

        // Try to get multi-board mappings first (common pattern)
        const boardIdForMapping = currentBoardId || "board1";
        modbusCoils = (node.context().global.get(`modbus_${boardIdForMapping}_coils`) || {}) as Record<string, number>;
        modbusHoldingRegisters = (node.context().global.get(`modbus_${boardIdForMapping}_holding_registers`) || {}) as Record<string, number>;
        modbusInputRegisters = (node.context().global.get(`modbus_${boardIdForMapping}_input_registers`) || {}) as Record<string, number>;

        // Fallback to legacy modbusCoils if multi-board mapping not found
        if (Object.keys(modbusCoils).length === 0) {
            modbusCoils = (node.context().global.get("modbusCoils") || {}) as Record<string, number>;
        }
        if (Object.keys(modbusHoldingRegisters).length === 0) {
            modbusHoldingRegisters = (node.context().global.get("modbusHoldingRegisters") || {}) as Record<string, number>;
        }
        if (Object.keys(modbusInputRegisters).length === 0) {
            modbusInputRegisters = (node.context().global.get("modbusInputRegisters") || {}) as Record<string, number>;
        }

        // Final fallback to environment variables
        if (Object.keys(modbusCoils).length === 0) {
            modbusCoils = globalHelper.getJsonEnvVar(ENV_KEYS.MODBUS_COILS, {}) as Record<string, number>;
        }

        node.log(`Modbus coils loaded: ${Object.keys(modbusCoils).length} coils`);
        node.log(`Coil keys: ${JSON.stringify(Object.keys(modbusCoils))}`);

        // Debug: Log a sample coil address
        if (modbusCoils["lamp_control_1"]) {
            node.log(`lamp_control_1 address: ${modbusCoils["lamp_control_1"]}`);
        } else {
            node.warn(`lamp_control_1 NOT FOUND in modbusCoils!`);
            node.warn(`Available keys: ${JSON.stringify(Object.keys(modbusCoils))}`);
        }

        // ========================================================================
        // Modbus Configuration
        // ========================================================================

        const readModbusConfig = () => {
            const boardsConfig = globalHelper.getEnvVar(ENV_KEYS.MODBUS_BOARDS, null);

            if (boardsConfig) {
                try {
                    let boards;
                    if (Array.isArray(boardsConfig)) {
                        boards = boardsConfig;
                    } else if (typeof boardsConfig === 'string') {
                        boards = JSON.parse(boardsConfig);
                    } else {
                        node.error(`${ERROR_MESSAGES.CONFIG_LOAD_FAILED}: Invalid MODBUS_BOARDS type`);
                        boards = null;
                    }

                    if (Array.isArray(boards) && boards.length > 0) {
                        return {
                            mode: 'multi',
                            boards: boards,
                            defaultBoard: globalHelper.getEnvVar(ENV_KEYS.MODBUS_DEFAULT_BOARD, boards[0].id)
                        };
                    }
                } catch (e) {
                    node.error(`${ERROR_MESSAGES.CONFIG_LOAD_FAILED}: ${e}`);
                }
            }

            return {
                mode: 'single',
                config: {
                    type: (globalHelper.getEnvVar(ENV_KEYS.MODBUS_TYPE, MODBUS_CONFIG.DEFAULT_TYPE) as "TCP" | "RTU"),
                    host: globalHelper.getEnvVar(ENV_KEYS.MODBUS_HOST, MODBUS_CONFIG.DEFAULT_HOST),
                    tcpPort: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_TCP_PORT, MODBUS_CONFIG.DEFAULT_TCP_PORT),
                    serialPort: globalHelper.getEnvVar(ENV_KEYS.MODBUS_SERIAL_PORT, MODBUS_CONFIG.DEFAULT_SERIAL_PORT),
                    baudRate: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_BAUD_RATE, MODBUS_CONFIG.DEFAULT_BAUD_RATE),
                    parity: (globalHelper.getEnvVar(ENV_KEYS.MODBUS_PARITY, MODBUS_CONFIG.DEFAULT_PARITY) as "none" | "even" | "odd"),
                    unitId: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_UNIT_ID, MODBUS_CONFIG.DEFAULT_UNIT_ID),
                    timeout: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_TIMEOUT, MODBUS_CONFIG.DEFAULT_TIMEOUT),
                    reconnectInterval: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_RECONNECT_INTERVAL, MODBUS_CONFIG.DEFAULT_RECONNECT_INTERVAL),
                }
            };
        };

        // Initialize Modbus
        const configData = readModbusConfig();
        currentModbusConfig = { ...configData };

        if (configData.mode === 'multi') {
            isMultiBoardMode = true;
            node.log(`Multi-board mode: ${configData.boards.length} boards`);
            const multiConfig: MultiModbusConfig = {
                mode: 'multi',
                defaultBoard: configData.defaultBoard,
                boards: configData.boards
            };
            ClientRegistry.initializeMultiBoardConfig(multiConfig, node);
        } else {
            node.log(`Single-board mode`);
        }

        // ========================================================================
        // Async Initialization
        // ========================================================================

        const initModbusClient = async () => {
            try {
                if (isMultiBoardMode) {
                    const boardToUse = currentBoardId || configData.defaultBoard;
                    modbusClient = await ClientRegistry.getModbusClientV2(boardToUse, node);
                } else {
                    modbusClient = await ClientRegistry.getModbusClientV2(configData.config, node);
                }

                if (!modbusClient) {
                    node.error(ERROR_MESSAGES.CLIENT_INIT_FAILED);
                    node.status({ fill: "red", shape: "ring", text: STATUS_MESSAGES.MODBUS_FAILED });
                    return false;
                }

                node.log("Modbus client initialized");
                node.status({ fill: "green", shape: "dot", text: STATUS_MESSAGES.RUNNING });
                return true;
            } catch (err) {
                node.error(`Modbus init error: ${(err as Error).message}`);
                return false;
            }
        };

        initModbusClient().catch(err => {
            node.error(`Modbus init error: ${err.message}`);
        });

        // ========================================================================
        // Modbus Operations
        // ========================================================================

        const readCoil = async (address: number): Promise<boolean> => {
            if (!modbusClient) {
                node.warn("Modbus client not ready");
                return false;
            }
            try {
                const result = await modbusClient.readCoils(address, 1);
                const state = Boolean(result.data[0]);
                return state;
            } catch (error) {
                node.error(`Read coil error at ${address}: ${(error as Error).message}`);
                return false;
            }
        };

        const writeCoil = async (address: number, value: boolean): Promise<void> => {
            if (!modbusClient) {
                node.warn("Modbus client not ready");
                return;
            }
            try {
                await modbusClient.writeCoil(address, value);
                node.log(`Write coil ${address}: ${value}`);
            } catch (error) {
                node.error(`${ERROR_MESSAGES.MODBUS_WRITE_FAILED(address.toString())}: ${(error as Error).message}`);
            }
        };

        // ========================================================================
        // Protection Logic
        // ========================================================================

        const createProtectionNotification = async (
            deviceKey: string,
            deviceLabel: string,
            result: ProtectionResult,
            coilAddress?: number
        ) => {
            try {
                await errorNotificationService.createFromBusinessLogic({
                    err_code: `PROTECTION_${deviceLabel}_${result.action?.toUpperCase()}`,
                    message: `${deviceLabel}: ${result.reason}`,
                    severity: result.action === 'block' || result.action === 'auto_off' ? 'high' : 'medium',
                    type: 'alert',
                    entity: node.id,
                    metadata: {
                        device_key: deviceKey,
                        device_label: deviceLabel,
                        action: result.action,
                        reason: result.reason,
                        coil_address: coilAddress,
                        elapsed_on_time: result.metadata?.elapsedOnTime,
                        elapsed_off_time: result.metadata?.elapsedOffTime,
                        violation: result.metadata?.violation,
                        sensor_value: result.metadata?.sensorValue,
                        board_id: currentBoardId || 'default',
                        timestamp: new Date().toISOString()
                    }
                });
                node.log(`Created notification for ${deviceLabel}: ${result.reason}`);
            } catch (notifError) {
                node.error(`${ERROR_MESSAGES.NOTIFICATION_CREATE_FAILED}: ${(notifError as Error).message}`);
            }
        };

        const checkProtection = async () => {
            const configKeyValues = configService.getConfigKeyValues();
            
            if (!configKeyValues || Object.keys(configKeyValues).length === 0) {
                node.status({ fill: "yellow", shape: "ring", text: STATUS_MESSAGES.NO_CONFIG });
                return;
            }

            const sensorData = configService.getSensorData();

            // Auto-detect all protection configs from configKeyValues
            // Find all keys ending with _protect_max_time_on, _protect_min_time_on, etc.
            const protectedCoils = new Set<string>();
            for (const key of Object.keys(configKeyValues)) {
                const match = key.match(/^(.+)_protect_(max_time_on|min_time_on|min_off_time|min_stop_time|bypass|force_on|force_off|upper_temp|upper_limit|lower_temp|lower_limit)$/);
                if (match) {
                    protectedCoils.add(match[1]); // coil name like "lamp_control_1"
                }
            }

            // Process each protected coil (use Array.from for ES5 compatibility)
            const coilsArray = Array.from(protectedCoils);
            for (let i = 0; i < coilsArray.length; i++) {
                const coilKey = coilsArray[i];
                const deviceLabel = coilKey.toLowerCase();
                const coilAddress = modbusCoils[coilKey];

                // Skip if coil address not defined
                if (coilAddress === undefined) {
                    // Silent skip - coil not in modbus mapping
                    // node.debug(`Coil ${coilKey} not in modbus mapping, skipping`);
                    continue;
                }

                // READ coil state directly from Modbus
                const currentState = await readCoil(coilAddress);

                // Get sensor value if applicable
                let sensorValue: number | undefined;
                if (coilKey.includes('cool') || coilKey.includes('ac')) {
                    sensorValue = sensorData['cool_Aquara_temp_1'] || sensorData['cool_Aquara_temp_2'];
                } else if (coilKey.includes('humid')) {
                    sensorValue = sensorData['humid_sensor_1'] || sensorData['humid_sensor_2'];
                } else if (coilKey.includes('co2')) {
                    sensorValue = sensorData['co2_sensor_1'];
                }

                if (sensorValue !== undefined) {
                    protectionManager.updateSensorValue(coilKey, sensorValue);
                }

                // Get protection config using the coil key as device label
                const protectionConfig = configService.getProtectionConfigByLabel(deviceLabel);
                const result = protectionManager.evaluateProtection(coilKey, currentState, protectionConfig);

                // Handle protection actions
                if (!result.allowed || (result.allowed && result.action !== 'allow')) {
                    // Create notification for significant events
                    if (result.action === 'auto_off' || result.action === 'block' || 
                        result.action === 'force_on' || result.action === 'force_off' ||
                        result.action === 'auto_on') {
                        await createProtectionNotification(coilKey, deviceLabel, result, coilAddress);
                    }

                    // WRITE coil if state needs to change
                    if (result.finalState !== currentState) {
                        if (result.action === 'auto_off' || result.action === 'force_off') {
                            await writeCoil(coilAddress, false);
                            node.send({ 
                                payload: { 
                                    [coilKey]: false, 
                                    reason: result.reason,
                                    action: result.action 
                                } 
                            });
                        } else if (result.action === 'auto_on' || result.action === 'force_on') {
                            await writeCoil(coilAddress, true);
                            node.send({ 
                                payload: { 
                                    [coilKey]: true, 
                                    reason: result.reason,
                                    action: result.action 
                                } 
                            });
                        }
                    }

                    node.log(`${deviceLabel}: ${result.reason}`);
                }
            }

            node.status({ fill: "green", shape: "dot", text: STATUS_MESSAGES.RUNNING });
        };

        // ========================================================================
        // Intervals
        // ========================================================================

        // Run protection check every 1 second
        const interval = setInterval(checkProtection, PROTECTION_CONFIG.CHECK_INTERVAL_MS);

        // Config auto-reload every 30 seconds
        configCheckInterval = setInterval(async () => {
            try {
                const newConfig = readModbusConfig();
                let hasChanged = false;
                let changeDescription = "";

                if (currentModbusConfig.mode !== newConfig.mode) {
                    hasChanged = true;
                    changeDescription = `mode: ${currentModbusConfig.mode} → ${newConfig.mode}`;
                } else if (newConfig.mode === 'single') {
                    const oldCfg = currentModbusConfig.config;
                    const newCfg = newConfig.config;
                    hasChanged = oldCfg.host !== newCfg.host || oldCfg.tcpPort !== newCfg.tcpPort;
                    if (hasChanged) changeDescription = `host: ${newCfg.host}:${newCfg.tcpPort}`;
                }

                if (hasChanged) {
                    node.warn(`Config change: ${changeDescription}`);
                    
                    if (newConfig.mode === 'multi') {
                        ClientRegistry.initializeMultiBoardConfig({
                            mode: 'multi',
                            defaultBoard: newConfig.defaultBoard,
                            boards: newConfig.boards
                        }, node);
                        modbusClient = await ClientRegistry.getModbusClientV2(
                            currentBoardId || newConfig.defaultBoard, node
                        );
                    } else {
                        await ClientRegistry.reloadModbusConfig(newConfig.config, node);
                        modbusClient = await ClientRegistry.getModbusClientV2(newConfig.config, node);
                    }

                    currentModbusConfig = { ...newConfig };
                    isMultiBoardMode = newConfig.mode === 'multi';
                    node.log(`Modbus reloaded: ${changeDescription}`);
                }

                // Update coil mappings - Follow common pattern
                const boardIdForMapping = currentBoardId || "board1";
                modbusCoils = ((node.context().global.get(`modbus_${boardIdForMapping}_coils`) ||
                              node.context().global.get("modbusCoils") ||
                              globalHelper.getJsonEnvVar(ENV_KEYS.MODBUS_COILS, {})) as Record<string, number>);
                modbusHoldingRegisters = ((node.context().global.get(`modbus_${boardIdForMapping}_holding_registers`) ||
                                         node.context().global.get("modbusHoldingRegisters") || {}) as Record<string, number>);
                modbusInputRegisters = ((node.context().global.get(`modbus_${boardIdForMapping}_input_registers`) ||
                                       node.context().global.get("modbusInputRegisters") || {}) as Record<string, number>);
            } catch (error) {
                node.error(`Config check error: ${(error as Error).message}`);
            }
        }, PROTECTION_CONFIG.CONFIG_CHECK_INTERVAL_MS);

        node.log("Protection node started (v2.0 with Min/Max/Bypass/Force)");

        // ========================================================================
        // Cleanup
        // ========================================================================

        node.on("close", (done: any) => {
            clearInterval(interval);
            if (configCheckInterval) {
                clearInterval(configCheckInterval);
                node.log("Config check interval stopped");
            }

            if (isMultiBoardMode && currentBoardId) {
                ClientRegistry.releaseClientV2("modbus-board", node, currentBoardId);
            } else {
                ClientRegistry.releaseClientV2("modbus", node);
            }

            node.log("Protection node closed");
            done();
        });
    }

    RED.nodes.registerType("viis-device-protection", ViisDeviceProtectionNode);
};
