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
import { ProtectionGateService } from "./services/protection-gate-service";
import { ConfigService } from "./services/configService";
import { MqttConfig, MqttMessage } from "../../core/mqtt-client";
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
    boardId?: string;
    enableDebug?: boolean;
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

        // Initialize shared ProtectionGateService
        const protectionGate = new ProtectionGateService(configService.getConfigKeyValues());
        // Store in global context so other nodes (RPC, Schedule, Intent) can access it
        node.context().global.set('protectionGateService', protectionGate);
        node.log("ProtectionGateService initialized and stored in global context");

        // ========================================================================
        // Node State
        // ========================================================================

        let currentBoardId: string | undefined = config.boardId || "board1";
        let isMultiBoardMode: boolean = false;
        let currentModbusConfig: any = null;
        let modbusClient: any;
        let mqttClient: any;
        let publishTopic: string;
        let configCheckInterval: NodeJS.Timeout | null = null;
        let isProtectionCheckRunning = false;

        // Debug mode
        const enableDebug = config.enableDebug === true;

        // Debug helper
        const debugLog = (message: string) => {
            if (enableDebug) {
                node.warn(`[DEBUG] ${message}`);
            }
        };

        node.log(`Debug mode: ${enableDebug ? 'ENABLED' : 'DISABLED'}`);
        node.log(`Board ID: ${currentBoardId}`);

        // ========================================================================
        // Initialize MQTT (non-blocking)
        // ========================================================================

        const initMqtt = async () => {
            try {
                const deviceId = globalHelper.getEnvVar(ENV_KEYS.DEVICE_ID, "unknown");
                const mqttBroker = "thingsboard"; // Default to ThingsBoard

                const mqttConfig: MqttConfig = mqttBroker === "thingsboard"
                    ? {
                        broker: `mqtt://${globalHelper.getEnvVar(ENV_KEYS.THINGSBOARD_HOST, "mqtt.viis.tech")}:${globalHelper.getEnvVar(ENV_KEYS.THINGSBOARD_PORT, "1883")}`,
                        clientId: `node-red-protection-${Math.random().toString(16).substring(2, 10)}`,
                        username: globalHelper.getEnvVar(ENV_KEYS.DEVICE_ACCESS_TOKEN, ""),
                        password: globalHelper.getEnvVar(ENV_KEYS.THINGSBOARD_PASSWORD, ""),
                        qos: 1,
                    }
                    : {
                        broker: `mqtt://${globalHelper.getEnvVar(ENV_KEYS.EMQX_HOST, "emqx")}:${globalHelper.getEnvVar(ENV_KEYS.EMQX_PORT, "1883")}`,
                        clientId: `node-red-protection-${Math.random().toString(16).substring(2, 10)}`,
                        username: globalHelper.getEnvVar(ENV_KEYS.EMQX_USERNAME, ""),
                        password: globalHelper.getEnvVar(ENV_KEYS.EMQX_PASSWORD, ""),
                        qos: 1,
                    };

                publishTopic = mqttBroker === "thingsboard"
                    ? `v1/devices/me/telemetry`
                    : `v1/devices/me/telemetry/${deviceId}`;

                mqttClient = mqttBroker === "thingsboard"
                    ? await ClientRegistry.getThingsboardMqttClient(mqttConfig, node)
                    : await ClientRegistry.getLocalMqttClient(mqttConfig, node);

                node.log("MQTT client initialized for protection telemetry");
            } catch (error) {
                node.warn(`MQTT initialization failed: ${(error as Error).message}`);
                node.warn("Protection node will work locally without MQTT publishing");
            }
        };

        initMqtt().catch(err => {
            node.error(`MQTT init error: ${err.message}`);
        });

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
                node.status({ fill: "green", shape: "ring", text: "Ready (inject)" });
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

        const writeCoil = async (address: number, value: boolean): Promise<boolean> => {
            if (!modbusClient) {
                node.warn("Modbus client not ready");
                return false;
            }
            try {
                await modbusClient.writeCoil(address, value);
                node.log(`Write coil ${address}: ${value}`);

                // Read-back to verify write succeeded
                const readValue = await readCoil(address);
                debugLog(`Read-back verification for coil ${address}: ${readValue} (expected: ${value})`);

                // Update global context cache (coilRegisterData)
                try {
                    const coilRegisterData = node.context().global.get("coilRegisterData") || {};
                    // Find coil key by address
                    const coilKey = Object.keys(modbusCoils).find(key => modbusCoils[key] === address);
                    if (coilKey) {
                        coilRegisterData[coilKey] = readValue;
                        node.context().global.set("coilRegisterData", coilRegisterData);
                        debugLog(`Updated coilRegisterData: ${coilKey}=${readValue}`);
                    }
                } catch (cacheError) {
                    node.warn(`Failed to update coilRegisterData cache: ${(cacheError as Error).message}`);
                }

                // Publish to MQTT
                if (mqttClient && mqttClient.isConnected()) {
                    try {
                        const coilKey = Object.keys(modbusCoils).find(key => modbusCoils[key] === address);
                        if (coilKey) {
                            const payload = {
                                ts: Date.now(),
                                [coilKey]: readValue
                            };
                            await mqttClient.publish(publishTopic, JSON.stringify(payload));
                            debugLog(`Published to MQTT ${publishTopic}: ${coilKey}=${readValue}`);
                        }
                    } catch (mqttError) {
                        node.warn(`Failed to publish MQTT: ${(mqttError as Error).message}`);
                    }
                }

                return readValue === value; // Return true if read-back matches written value
            } catch (error) {
                node.error(`${ERROR_MESSAGES.MODBUS_WRITE_FAILED(address.toString())}: ${(error as Error).message}`);
                return false;
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
                debugLog("No configKeyValues found");
                node.status({ fill: "yellow", shape: "ring", text: STATUS_MESSAGES.NO_CONFIG });
                return;
            }

            // Refresh gate service config
            protectionGate.refreshConfig(configKeyValues);

            const sensorData = configService.getSensorData();

            // Sync sensor values to gate service
            for (const [sensorKey, sensorValue] of Object.entries(sensorData)) {
                protectionGate.updateSensorValue(sensorKey, sensorValue as number);
            }

            debugLog(`Checking ${Object.keys(configKeyValues).length} config keys`);

            // Auto-detect all protection configs from configKeyValues
            // Find all keys ending with _protect_max_time_on, _protect_min_time_on, etc.
            // Supports:
            // - Specific coil: lamp_control_1_protect_*
            // - All rule: lamp_protect_all_*
            // - Device type: lamp_protect_*
            const protectedCoils = new Set<string>();
            const coilKeys = Object.keys(modbusCoils);
            for (const key of Object.keys(configKeyValues)) {
                const match = key.match(/^(.+)_protect_(all_)?(max_time_on|min_time_on|min_off_time|min_stop_time|bypass|force_on|force_off|upper_temp|upper_limit|lower_temp|lower_limit|pulse_time_on|pulse_time_off|sensor_id)$/);
                if (match) {
                    const baseKey = match[1];

                    // Exact mapping support (e.g. lamp_control_1_protect_* -> lamp_control_1)
                    if (modbusCoils[baseKey] !== undefined) {
                        protectedCoils.add(baseKey);
                    }

                    // Generalized mapping support (e.g. lamp_protect_all_* -> lamp_control_1, lamp_control_2)
                    const prefix = `${baseKey}_`;
                    for (const coilKey of coilKeys) {
                        if (coilKey.startsWith(prefix)) {
                            protectedCoils.add(coilKey);
                        }
                    }

                    // For _protect_all_ keys, match all coils of that device type
                    // e.g. lamp_protect_all_* -> lamp_control_1, lamp_control_2, lamp_control_3...
                    if (match[2] === 'all_') {
                        const deviceType = baseKey; // "lamp" from "lamp_protect"
                        for (const coilKey of coilKeys) {
                            if (coilKey.startsWith(`${deviceType}_control_`)) {
                                protectedCoils.add(coilKey);
                            }
                        }
                    }
                }
            }

            debugLog(`Found ${protectedCoils.size} protected coils: ${Array.from(protectedCoils).join(", ")}`);

            // Process each protected coil (use Array.from for ES5 compatibility)
            const coilsArray = Array.from(protectedCoils);
            for (let i = 0; i < coilsArray.length; i++) {
                const coilKey = coilsArray[i];
                const deviceLabel = coilKey.toLowerCase();
                const coilAddress = modbusCoils[coilKey];

                debugLog(`Processing coil: ${coilKey}, address: ${coilAddress}`);

                // Skip if coil address not defined
                if (coilAddress === undefined) {
                    debugLog(`Coil ${coilKey} not in modbus mapping, skipping`);
                    continue;
                }

                // READ coil state directly from Modbus
                const currentState = await readCoil(coilAddress);
                debugLog(`Coil ${coilKey} current state: ${currentState}`);

                // Sync coil state to gate service
                protectionGate.syncCoilState(coilKey, currentState);

                // Get sensor value if applicable
                // Sensor mapping based on new function identifiers:
                // - Temperature: cool_monitor_Aquara_temp_1, cool_monitor_Aquara_temp_2
                // - Humidity: humid_sensor_1, humid_sensor_2, humid_monitor_Aquara_humid_1, humid_monitor_Aquara_humid_2
                // - CO2: co2_sensor_1
                let sensorValue: number | undefined;
                if (coilKey.includes('cool') || coilKey.includes('ac')) {
                    // Cooling devices use temperature sensors
                    sensorValue = sensorData['cool_monitor_Aquara_temp_1'] 
                        || sensorData['cool_monitor_Aquara_temp_2']
                        || sensorData['cool_Aquara_temp_1'] 
                        || sensorData['cool_Aquara_temp_2'];
                } else if (coilKey.includes('humid')) {
                    // Humidity devices use humidity sensors
                    sensorValue = sensorData['humid_sensor_1'] 
                        || sensorData['humid_sensor_2']
                        || sensorData['humid_monitor_Aquara_humid_1']
                        || sensorData['humid_monitor_Aquara_humid_2'];
                } else if (coilKey.includes('dehumid')) {
                    // Dehumidification uses humidity sensors
                    sensorValue = sensorData['humid_sensor_1'] 
                        || sensorData['humid_sensor_2']
                        || sensorData['humid_monitor_Aquara_humid_1']
                        || sensorData['humid_monitor_Aquara_humid_2'];
                } else if (coilKey.includes('co2')) {
                    // CO2 devices use CO2 sensor
                    sensorValue = sensorData['co2_sensor_1'];
                }

                if (sensorValue !== undefined) {
                    debugLog(`Sensor value for ${coilKey}: ${sensorValue}`);
                    protectionManager.updateSensorValue(coilKey, sensorValue);
                }

                // Get protection config using the coil key as device label
                const protectionConfig = configService.getProtectionConfigByLabel(deviceLabel);
                debugLog(`Protection config for ${deviceLabel}: ${JSON.stringify(protectionConfig)}`);

                const result = protectionManager.evaluateProtection(coilKey, currentState, protectionConfig);
                debugLog(`Protection result for ${coilKey}: ${result.action} - ${result.reason}`);

                // Handle protection actions
                if (!result.allowed || (result.allowed && result.action !== 'allow')) {
                    debugLog(`Action required for ${coilKey}: ${result.action}`);

                    // Create notification for significant events
                    if (result.action === 'auto_off' || result.action === 'block' ||
                        result.action === 'force_on' || result.action === 'force_off' ||
                        result.action === 'auto_on') {
                        await createProtectionNotification(coilKey, deviceLabel, result, coilAddress);
                    }

                    // WRITE coil if state needs to change
                    if (result.finalState !== currentState) {
                        const targetState = result.finalState;
                        debugLog(`Writing coil ${coilKey} to ${targetState}`);

                        const writeSuccess = await writeCoil(coilAddress, targetState);

                        if (writeSuccess) {
                            debugLog(`Coil ${coilKey} successfully updated to ${targetState}`);
                            // Update gate service state after successful write
                            protectionGate.updateState(coilKey, targetState);
                        } else {
                            node.warn(`Coil ${coilKey} write may have failed - read-back verification failed`);
                        }

                        // Send output message
                        node.send({
                            payload: {
                                [coilKey]: targetState,
                                reason: result.reason,
                                action: result.action,
                                writeSuccess: writeSuccess
                            }
                        });
                    }

                    node.log(`${deviceLabel}: ${result.reason}`);
                }
            }

            node.status({ fill: "green", shape: "dot", text: STATUS_MESSAGES.RUNNING });
        };

        // ========================================================================
        // Trigger / Config Reload
        // ========================================================================

        const runProtectionCheck = async (trigger: string, done?: (err?: Error) => void) => {
            if (isProtectionCheckRunning) {
                const warning = `Skip trigger (${trigger}): protection check is already running`;
                debugLog(warning);
                if (done) done();
                return;
            }

            isProtectionCheckRunning = true;

            try {
                debugLog(`Run protection check by trigger: ${trigger}`);
                await checkProtection();
                node.status({ fill: "green", shape: "dot", text: STATUS_MESSAGES.RUNNING });
                if (done) done();
            } catch (error) {
                const err = error as Error;
                node.error(`Protection check error: ${err.message}`);
                node.status({ fill: "red", shape: "ring", text: "Check failed" });
                if (done) done(err);
            } finally {
                isProtectionCheckRunning = false;
            }
        };

        node.on("input", (msg: any, send: any, done: any) => {
            if (msg && typeof msg === "object" && msg.boardId && msg.boardId !== currentBoardId) {
                currentBoardId = String(msg.boardId);
                debugLog(`Updated boardId from inject: ${currentBoardId}`);
            }

            runProtectionCheck("inject", done);
        });

        node.log("Protection node started (inject-trigger mode)");

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

        // ========================================================================
        // Cleanup
        // ========================================================================

        node.on("close", (done: any) => {
            if (configCheckInterval) {
                clearInterval(configCheckInterval);
                node.log("Config check interval stopped");
            }

            // Disconnect MQTT client
            if (mqttClient) {
                mqttClient.disconnect();
                node.log("MQTT client disconnected");
            }

            // Release Modbus client (multi-board aware)
            if (isMultiBoardMode && currentBoardId) {
                ClientRegistry.releaseClientV2("modbus-board", node, currentBoardId);
            } else {
                ClientRegistry.releaseClientV2("modbus", node);
            }

            // Release MQTT clients
            if (mqttClient) {
                const mqttBroker = "thingsboard"; // Match initialization
                if (mqttBroker === "thingsboard") {
                    ClientRegistry.releaseClient("thingsboard", node);
                } else {
                    ClientRegistry.releaseClient("local", node);
                }
            }

            node.log("Protection node closed");
            done();
        });
    }

    RED.nodes.registerType("viis-device-protection", ViisDeviceProtectionNode);
};
