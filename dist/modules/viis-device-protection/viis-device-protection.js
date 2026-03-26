"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_registry_1 = __importDefault(require("../../core/client-registry"));
const global_context_helper_1 = require("../../ultils/global-context-helper");
const error_notification_service_1 = require("../../services/error-notification.service");
const protection_manager_1 = require("./protection-manager");
const configService_1 = require("./services/configService");
const constants_1 = require("./constants");
module.exports = function (RED) {
    function ViisDeviceProtectionNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        // ========================================================================
        // Initialize Services
        // ========================================================================
        const globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
        const errorNotificationService = new error_notification_service_1.ErrorNotificationService(node.context());
        const configService = new configService_1.ConfigService(node);
        const protectionManager = new protection_manager_1.ProtectionManager();
        // ========================================================================
        // Node State
        // ========================================================================
        let currentBoardId = config.boardId || "board1";
        let isMultiBoardMode = false;
        let currentModbusConfig = null;
        let modbusClient;
        let mqttClient;
        let publishTopic;
        let configCheckInterval = null;
        let isProtectionCheckRunning = false;
        // Debug mode
        const enableDebug = config.enableDebug === true;
        // Debug helper
        const debugLog = (message) => {
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
                const deviceId = globalHelper.getEnvVar(constants_1.ENV_KEYS.DEVICE_ID, "unknown");
                const mqttBroker = "thingsboard"; // Default to ThingsBoard
                const mqttConfig = mqttBroker === "thingsboard"
                    ? {
                        broker: `mqtt://${globalHelper.getEnvVar(constants_1.ENV_KEYS.THINGSBOARD_HOST, "mqtt.viis.tech")}:${globalHelper.getEnvVar(constants_1.ENV_KEYS.THINGSBOARD_PORT, "1883")}`,
                        clientId: `node-red-protection-${Math.random().toString(16).substring(2, 10)}`,
                        username: globalHelper.getEnvVar(constants_1.ENV_KEYS.DEVICE_ACCESS_TOKEN, ""),
                        password: globalHelper.getEnvVar(constants_1.ENV_KEYS.THINGSBOARD_PASSWORD, ""),
                        qos: 1,
                    }
                    : {
                        broker: `mqtt://${globalHelper.getEnvVar(constants_1.ENV_KEYS.EMQX_HOST, "emqx")}:${globalHelper.getEnvVar(constants_1.ENV_KEYS.EMQX_PORT, "1883")}`,
                        clientId: `node-red-protection-${Math.random().toString(16).substring(2, 10)}`,
                        username: globalHelper.getEnvVar(constants_1.ENV_KEYS.EMQX_USERNAME, ""),
                        password: globalHelper.getEnvVar(constants_1.ENV_KEYS.EMQX_PASSWORD, ""),
                        qos: 1,
                    };
                publishTopic = mqttBroker === "thingsboard"
                    ? `v1/devices/me/telemetry`
                    : `v1/devices/me/telemetry/${deviceId}`;
                mqttClient = mqttBroker === "thingsboard"
                    ? await client_registry_1.default.getThingsboardMqttClient(mqttConfig, node)
                    : await client_registry_1.default.getLocalMqttClient(mqttConfig, node);
                node.log("MQTT client initialized for protection telemetry");
            }
            catch (error) {
                node.warn(`MQTT initialization failed: ${error.message}`);
                node.warn("Protection node will work locally without MQTT publishing");
            }
        };
        initMqtt().catch(err => {
            node.error(`MQTT init error: ${err.message}`);
        });
        // Modbus mappings - Follow common_pattern.md
        // Primary: Use modbus_board1_coils for multi-board setup
        // Fallback: Use modbusCoils for backward compatibility
        let modbusCoils = {};
        let modbusHoldingRegisters = {};
        let modbusInputRegisters = {};
        // Try to get multi-board mappings first (common pattern)
        const boardIdForMapping = currentBoardId || "board1";
        modbusCoils = (node.context().global.get(`modbus_${boardIdForMapping}_coils`) || {});
        modbusHoldingRegisters = (node.context().global.get(`modbus_${boardIdForMapping}_holding_registers`) || {});
        modbusInputRegisters = (node.context().global.get(`modbus_${boardIdForMapping}_input_registers`) || {});
        // Fallback to legacy modbusCoils if multi-board mapping not found
        if (Object.keys(modbusCoils).length === 0) {
            modbusCoils = (node.context().global.get("modbusCoils") || {});
        }
        if (Object.keys(modbusHoldingRegisters).length === 0) {
            modbusHoldingRegisters = (node.context().global.get("modbusHoldingRegisters") || {});
        }
        if (Object.keys(modbusInputRegisters).length === 0) {
            modbusInputRegisters = (node.context().global.get("modbusInputRegisters") || {});
        }
        // Final fallback to environment variables
        if (Object.keys(modbusCoils).length === 0) {
            modbusCoils = globalHelper.getJsonEnvVar(constants_1.ENV_KEYS.MODBUS_COILS, {});
        }
        node.log(`Modbus coils loaded: ${Object.keys(modbusCoils).length} coils`);
        node.log(`Coil keys: ${JSON.stringify(Object.keys(modbusCoils))}`);
        // Debug: Log a sample coil address
        if (modbusCoils["lamp_control_1"]) {
            node.log(`lamp_control_1 address: ${modbusCoils["lamp_control_1"]}`);
        }
        else {
            node.warn(`lamp_control_1 NOT FOUND in modbusCoils!`);
            node.warn(`Available keys: ${JSON.stringify(Object.keys(modbusCoils))}`);
        }
        // ========================================================================
        // Modbus Configuration
        // ========================================================================
        const readModbusConfig = () => {
            const boardsConfig = globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_BOARDS, null);
            if (boardsConfig) {
                try {
                    let boards;
                    if (Array.isArray(boardsConfig)) {
                        boards = boardsConfig;
                    }
                    else if (typeof boardsConfig === 'string') {
                        boards = JSON.parse(boardsConfig);
                    }
                    else {
                        node.error(`${constants_1.ERROR_MESSAGES.CONFIG_LOAD_FAILED}: Invalid MODBUS_BOARDS type`);
                        boards = null;
                    }
                    if (Array.isArray(boards) && boards.length > 0) {
                        return {
                            mode: 'multi',
                            boards: boards,
                            defaultBoard: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_DEFAULT_BOARD, boards[0].id)
                        };
                    }
                }
                catch (e) {
                    node.error(`${constants_1.ERROR_MESSAGES.CONFIG_LOAD_FAILED}: ${e}`);
                }
            }
            return {
                mode: 'single',
                config: {
                    type: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_TYPE, constants_1.MODBUS_CONFIG.DEFAULT_TYPE),
                    host: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_HOST, constants_1.MODBUS_CONFIG.DEFAULT_HOST),
                    tcpPort: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_TCP_PORT, constants_1.MODBUS_CONFIG.DEFAULT_TCP_PORT),
                    serialPort: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_SERIAL_PORT, constants_1.MODBUS_CONFIG.DEFAULT_SERIAL_PORT),
                    baudRate: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_BAUD_RATE, constants_1.MODBUS_CONFIG.DEFAULT_BAUD_RATE),
                    parity: globalHelper.getEnvVar(constants_1.ENV_KEYS.MODBUS_PARITY, constants_1.MODBUS_CONFIG.DEFAULT_PARITY),
                    unitId: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_UNIT_ID, constants_1.MODBUS_CONFIG.DEFAULT_UNIT_ID),
                    timeout: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_TIMEOUT, constants_1.MODBUS_CONFIG.DEFAULT_TIMEOUT),
                    reconnectInterval: globalHelper.getNumericEnvVar(constants_1.ENV_KEYS.MODBUS_RECONNECT_INTERVAL, constants_1.MODBUS_CONFIG.DEFAULT_RECONNECT_INTERVAL),
                }
            };
        };
        // Initialize Modbus
        const configData = readModbusConfig();
        currentModbusConfig = Object.assign({}, configData);
        if (configData.mode === 'multi') {
            isMultiBoardMode = true;
            node.log(`Multi-board mode: ${configData.boards.length} boards`);
            const multiConfig = {
                mode: 'multi',
                defaultBoard: configData.defaultBoard,
                boards: configData.boards
            };
            client_registry_1.default.initializeMultiBoardConfig(multiConfig, node);
        }
        else {
            node.log(`Single-board mode`);
        }
        // ========================================================================
        // Async Initialization
        // ========================================================================
        const initModbusClient = async () => {
            try {
                if (isMultiBoardMode) {
                    const boardToUse = currentBoardId || configData.defaultBoard;
                    modbusClient = await client_registry_1.default.getModbusClientV2(boardToUse, node);
                }
                else {
                    modbusClient = await client_registry_1.default.getModbusClientV2(configData.config, node);
                }
                if (!modbusClient) {
                    node.error(constants_1.ERROR_MESSAGES.CLIENT_INIT_FAILED);
                    node.status({ fill: "red", shape: "ring", text: constants_1.STATUS_MESSAGES.MODBUS_FAILED });
                    return false;
                }
                node.log("Modbus client initialized");
                node.status({ fill: "green", shape: "ring", text: "Ready (inject)" });
                return true;
            }
            catch (err) {
                node.error(`Modbus init error: ${err.message}`);
                return false;
            }
        };
        initModbusClient().catch(err => {
            node.error(`Modbus init error: ${err.message}`);
        });
        // ========================================================================
        // Modbus Operations
        // ========================================================================
        const readCoil = async (address) => {
            if (!modbusClient) {
                node.warn("Modbus client not ready");
                return false;
            }
            try {
                const result = await modbusClient.readCoils(address, 1);
                const state = Boolean(result.data[0]);
                return state;
            }
            catch (error) {
                node.error(`Read coil error at ${address}: ${error.message}`);
                return false;
            }
        };
        const writeCoil = async (address, value) => {
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
                }
                catch (cacheError) {
                    node.warn(`Failed to update coilRegisterData cache: ${cacheError.message}`);
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
                    }
                    catch (mqttError) {
                        node.warn(`Failed to publish MQTT: ${mqttError.message}`);
                    }
                }
                return readValue === value; // Return true if read-back matches written value
            }
            catch (error) {
                node.error(`${constants_1.ERROR_MESSAGES.MODBUS_WRITE_FAILED(address.toString())}: ${error.message}`);
                return false;
            }
        };
        // ========================================================================
        // Protection Logic
        // ========================================================================
        const createProtectionNotification = async (deviceKey, deviceLabel, result, coilAddress) => {
            var _a, _b, _c, _d, _e;
            try {
                await errorNotificationService.createFromBusinessLogic({
                    err_code: `PROTECTION_${deviceLabel}_${(_a = result.action) === null || _a === void 0 ? void 0 : _a.toUpperCase()}`,
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
                        elapsed_on_time: (_b = result.metadata) === null || _b === void 0 ? void 0 : _b.elapsedOnTime,
                        elapsed_off_time: (_c = result.metadata) === null || _c === void 0 ? void 0 : _c.elapsedOffTime,
                        violation: (_d = result.metadata) === null || _d === void 0 ? void 0 : _d.violation,
                        sensor_value: (_e = result.metadata) === null || _e === void 0 ? void 0 : _e.sensorValue,
                        board_id: currentBoardId || 'default',
                        timestamp: new Date().toISOString()
                    }
                });
                node.log(`Created notification for ${deviceLabel}: ${result.reason}`);
            }
            catch (notifError) {
                node.error(`${constants_1.ERROR_MESSAGES.NOTIFICATION_CREATE_FAILED}: ${notifError.message}`);
            }
        };
        const checkProtection = async () => {
            const configKeyValues = configService.getConfigKeyValues();
            if (!configKeyValues || Object.keys(configKeyValues).length === 0) {
                debugLog("No configKeyValues found");
                node.status({ fill: "yellow", shape: "ring", text: constants_1.STATUS_MESSAGES.NO_CONFIG });
                return;
            }
            const sensorData = configService.getSensorData();
            debugLog(`Checking ${Object.keys(configKeyValues).length} config keys`);
            // Auto-detect all protection configs from configKeyValues
            // Find all keys ending with _protect_max_time_on, _protect_min_time_on, etc.
            // Supports new function identifiers:
            // - lamp_protect_*, fan_protect_intake_*, fan_protect_circ_*, etc.
            // - cool_protect_1_*, cool_protect_2_*, humid_protect_*, dehumid_protect_*, co2_protect_*
            const protectedCoils = new Set();
            const coilKeys = Object.keys(modbusCoils);
            for (const key of Object.keys(configKeyValues)) {
                const match = key.match(/^(.+)_protect_(max_time_on|min_time_on|min_off_time|min_stop_time|bypass|force_on|force_off|upper_temp|upper_limit|lower_temp|lower_limit|pulse_time_on|pulse_time_off)$/);
                if (match) {
                    const baseKey = match[1];
                    // Exact mapping support (e.g. lamp_control_1_protect_* -> lamp_control_1)
                    if (modbusCoils[baseKey] !== undefined) {
                        protectedCoils.add(baseKey);
                    }
                    // Generalized mapping support (e.g. lamp_control_protect_* -> lamp_control_1, lamp_control_2)
                    const prefix = `${baseKey}_`;
                    for (const coilKey of coilKeys) {
                        if (coilKey.startsWith(prefix)) {
                            protectedCoils.add(coilKey);
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
                // Get sensor value if applicable
                // Sensor mapping based on new function identifiers:
                // - Temperature: cool_monitor_Aquara_temp_1, cool_monitor_Aquara_temp_2
                // - Humidity: humid_sensor_1, humid_sensor_2, humid_monitor_Aquara_humid_1, humid_monitor_Aquara_humid_2
                // - CO2: co2_sensor_1
                let sensorValue;
                if (coilKey.includes('cool') || coilKey.includes('ac')) {
                    // Cooling devices use temperature sensors
                    sensorValue = sensorData['cool_monitor_Aquara_temp_1']
                        || sensorData['cool_monitor_Aquara_temp_2']
                        || sensorData['cool_Aquara_temp_1']
                        || sensorData['cool_Aquara_temp_2'];
                }
                else if (coilKey.includes('humid')) {
                    // Humidity devices use humidity sensors
                    sensorValue = sensorData['humid_sensor_1']
                        || sensorData['humid_sensor_2']
                        || sensorData['humid_monitor_Aquara_humid_1']
                        || sensorData['humid_monitor_Aquara_humid_2'];
                }
                else if (coilKey.includes('dehumid')) {
                    // Dehumidification uses humidity sensors
                    sensorValue = sensorData['humid_sensor_1']
                        || sensorData['humid_sensor_2']
                        || sensorData['humid_monitor_Aquara_humid_1']
                        || sensorData['humid_monitor_Aquara_humid_2'];
                }
                else if (coilKey.includes('co2')) {
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
                        }
                        else {
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
            node.status({ fill: "green", shape: "dot", text: constants_1.STATUS_MESSAGES.RUNNING });
        };
        // ========================================================================
        // Trigger / Config Reload
        // ========================================================================
        const runProtectionCheck = async (trigger, done) => {
            if (isProtectionCheckRunning) {
                const warning = `Skip trigger (${trigger}): protection check is already running`;
                debugLog(warning);
                if (done)
                    done();
                return;
            }
            isProtectionCheckRunning = true;
            try {
                debugLog(`Run protection check by trigger: ${trigger}`);
                await checkProtection();
                node.status({ fill: "green", shape: "dot", text: constants_1.STATUS_MESSAGES.RUNNING });
                if (done)
                    done();
            }
            catch (error) {
                const err = error;
                node.error(`Protection check error: ${err.message}`);
                node.status({ fill: "red", shape: "ring", text: "Check failed" });
                if (done)
                    done(err);
            }
            finally {
                isProtectionCheckRunning = false;
            }
        };
        node.on("input", (msg, send, done) => {
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
                }
                else if (newConfig.mode === 'single') {
                    const oldCfg = currentModbusConfig.config;
                    const newCfg = newConfig.config;
                    hasChanged = oldCfg.host !== newCfg.host || oldCfg.tcpPort !== newCfg.tcpPort;
                    if (hasChanged)
                        changeDescription = `host: ${newCfg.host}:${newCfg.tcpPort}`;
                }
                if (hasChanged) {
                    node.warn(`Config change: ${changeDescription}`);
                    if (newConfig.mode === 'multi') {
                        client_registry_1.default.initializeMultiBoardConfig({
                            mode: 'multi',
                            defaultBoard: newConfig.defaultBoard,
                            boards: newConfig.boards
                        }, node);
                        modbusClient = await client_registry_1.default.getModbusClientV2(currentBoardId || newConfig.defaultBoard, node);
                    }
                    else {
                        await client_registry_1.default.reloadModbusConfig(newConfig.config, node);
                        modbusClient = await client_registry_1.default.getModbusClientV2(newConfig.config, node);
                    }
                    currentModbusConfig = Object.assign({}, newConfig);
                    isMultiBoardMode = newConfig.mode === 'multi';
                    node.log(`Modbus reloaded: ${changeDescription}`);
                }
                // Update coil mappings - Follow common pattern
                const boardIdForMapping = currentBoardId || "board1";
                modbusCoils = (node.context().global.get(`modbus_${boardIdForMapping}_coils`) ||
                    node.context().global.get("modbusCoils") ||
                    globalHelper.getJsonEnvVar(constants_1.ENV_KEYS.MODBUS_COILS, {}));
                modbusHoldingRegisters = (node.context().global.get(`modbus_${boardIdForMapping}_holding_registers`) ||
                    node.context().global.get("modbusHoldingRegisters") || {});
                modbusInputRegisters = (node.context().global.get(`modbus_${boardIdForMapping}_input_registers`) ||
                    node.context().global.get("modbusInputRegisters") || {});
            }
            catch (error) {
                node.error(`Config check error: ${error.message}`);
            }
        }, constants_1.PROTECTION_CONFIG.CONFIG_CHECK_INTERVAL_MS);
        // ========================================================================
        // Cleanup
        // ========================================================================
        node.on("close", (done) => {
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
                client_registry_1.default.releaseClientV2("modbus-board", node, currentBoardId);
            }
            else {
                client_registry_1.default.releaseClientV2("modbus", node);
            }
            // Release MQTT clients
            if (mqttClient) {
                const mqttBroker = "thingsboard"; // Match initialization
                if (mqttBroker === "thingsboard") {
                    client_registry_1.default.releaseClient("thingsboard", node);
                }
                else {
                    client_registry_1.default.releaseClient("local", node);
                }
            }
            node.log("Protection node closed");
            done();
        });
    }
    RED.nodes.registerType("viis-device-protection", ViisDeviceProtectionNode);
};
