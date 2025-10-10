"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_registry_1 = __importDefault(require("../../core/client-registry"));
const global_context_helper_1 = require("../../ultils/global-context-helper");
module.exports = function (RED) {
    function ViisRpcControlFromInputNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        // Log when node is initialized
        node.warn("VIIS RPC Control From Input Node initialized");
        console.log("VIIS RPC Control From Input Node initialized");
        // Initialize GlobalContextHelper for environment variables
        const globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
        // Multi-board state variables
        let currentBoardId = config.boardId;
        let isMultiBoardMode = false;
        let currentModbusConfig = null;
        // Flow context cho config
        const flowContext = node.context().flow;
        const SCALE_CONFIG_KEY = `scaleConfigs_${node.id}`;
        const CONFIG_KEYS_KEY = `configKeys_${node.id}`;
        const CONFIG_VALUES_KEY = `configKeyValues_${node.id}`;
        const MANUAL_OVERRIDES_KEY = `manualModbusOverrides_${node.id}`;
        // Parse configurations
        let configKeys = {};
        let scaleConfigs = [];
        try {
            configKeys = config.configKeys ? JSON.parse(config.configKeys) : {};
            if (typeof configKeys !== 'object' || Array.isArray(configKeys) || configKeys === null)
                configKeys = {};
        }
        catch (_a) {
            configKeys = {};
        }
        try {
            scaleConfigs = config.scaleConfigs ? JSON.parse(config.scaleConfigs) : [];
            if (!Array.isArray(scaleConfigs))
                scaleConfigs = [];
        }
        catch (_b) {
            scaleConfigs = [];
        }
        // Validate và lưu vào flow context
        flowContext.set(CONFIG_KEYS_KEY, configKeys);
        flowContext.set(SCALE_CONFIG_KEY, scaleConfigs);
        if (!flowContext.get(CONFIG_VALUES_KEY))
            flowContext.set(CONFIG_VALUES_KEY, {});
        if (!flowContext.get(MANUAL_OVERRIDES_KEY))
            flowContext.set(MANUAL_OVERRIDES_KEY, {});
        // Helper functions
        function getConfigKeys() {
            return flowContext.get(CONFIG_KEYS_KEY) || {};
        }
        function getScaleConfigs() {
            return flowContext.get(SCALE_CONFIG_KEY) || [];
        }
        function getConfigKeyValues() {
            return flowContext.get(CONFIG_VALUES_KEY) || {};
        }
        function setConfigKeyValues(values) {
            flowContext.set(CONFIG_VALUES_KEY, values);
        }
        // Helper function to read fresh config from global context (for hot-reload)
        const readModbusConfig = () => {
            // Check for multi-board configuration
            const boardsConfigStr = globalHelper.getEnvVar('MODBUS_BOARDS', null);
            if (boardsConfigStr) {
                try {
                    const boards = JSON.parse(boardsConfigStr);
                    if (Array.isArray(boards) && boards.length > 0) {
                        return {
                            mode: 'multi',
                            boards: boards,
                            defaultBoard: globalHelper.getEnvVar('MODBUS_DEFAULT_BOARD', boards[0].id)
                        };
                    }
                }
                catch (e) {
                    node.error(`Failed to parse MODBUS_BOARDS: ${e}`);
                }
            }
            // Single-board mode (backward compatible)
            return {
                mode: 'single',
                config: {
                    type: globalHelper.getEnvVar('MODBUS_TYPE', 'TCP'),
                    host: globalHelper.getEnvVar('MODBUS_HOST', 'localhost'),
                    tcpPort: globalHelper.getNumericEnvVar('MODBUS_TCP_PORT', 502),
                    serialPort: globalHelper.getEnvVar('MODBUS_SERIAL_PORT', '/dev/ttyUSB0'),
                    baudRate: globalHelper.getNumericEnvVar('MODBUS_BAUD_RATE', 9600),
                    parity: globalHelper.getEnvVar('MODBUS_PARITY', 'none'),
                    unitId: globalHelper.getNumericEnvVar('MODBUS_UNIT_ID', 1),
                    timeout: globalHelper.getNumericEnvVar('MODBUS_TIMEOUT', 5000),
                    reconnectInterval: globalHelper.getNumericEnvVar('MODBUS_RECONNECT_INTERVAL', 5000),
                }
            };
        };
        const readEnvConfig = () => {
            return {
                modbusCoils: globalHelper.getJsonEnvVar('MODBUS_COILS', {}),
                modbusInputRegisters: globalHelper.getJsonEnvVar('MODBUS_INPUT_REGISTERS', {}),
                modbusHoldingRegisters: globalHelper.getJsonEnvVar('MODBUS_HOLDING_REGISTERS', {}),
                deviceId: globalHelper.getEnvVar('DEVICE_ID', 'unknown'),
            };
        };
        // Read initial config
        let currentEnvConfig = readEnvConfig();
        let modbusCoils = currentEnvConfig.modbusCoils;
        let modbusInputRegisters = currentEnvConfig.modbusInputRegisters;
        let modbusHoldingRegisters = currentEnvConfig.modbusHoldingRegisters;
        let deviceId = currentEnvConfig.deviceId;
        // Initialize Modbus configuration
        const configData = readModbusConfig();
        currentModbusConfig = Object.assign({}, configData);
        // Auto-detect mode
        if (configData.mode === 'multi') {
            isMultiBoardMode = true;
            node.log(`Multi-board mode detected with ${configData.boards.length} boards`);
            const multiConfig = {
                mode: 'multi',
                defaultBoard: configData.defaultBoard,
                boards: configData.boards
            };
            client_registry_1.default.initializeMultiBoardConfig(multiConfig, node);
        }
        else {
            isMultiBoardMode = false;
            node.log(`Single-board mode: ${configData.config.type} ${configData.config.host}:${configData.config.tcpPort}`);
        }
        // MQTT config from global context
        const mqttConfig = config.mqttBroker === "thingsboard"
            ? {
                broker: `mqtt://${globalHelper.getEnvVar('THINGSBOARD_HOST', 'mqtt.viis.tech')}:${globalHelper.getNumericEnvVar('THINGSBOARD_PORT', 1883)}`,
                clientId: `node-red-thingsboard-rpc-${Math.random().toString(16).substr(2, 8)}`,
                username: globalHelper.getEnvVar('DEVICE_ACCESS_TOKEN', ''),
                password: globalHelper.getEnvVar('THINGSBOARD_PASSWORD', ''),
                qos: 1,
            }
            : {
                broker: `mqtt://${globalHelper.getEnvVar('EMQX_HOST', 'emqx')}:${globalHelper.getNumericEnvVar('EMQX_PORT', 1883)}`,
                clientId: `node-red-local-rpc-${Math.random().toString(16).substr(2, 8)}`,
                username: globalHelper.getEnvVar('EMQX_USERNAME', ''),
                password: globalHelper.getEnvVar('EMQX_PASSWORD', ''),
                qos: 1,
            };
        const publishTopic = config.mqttBroker === "thingsboard"
            ? "v1/devices/me/telemetry"
            : `v1/devices/me/telemetry/${deviceId}`;
        // Lấy clients  
        let modbusClient;
        if (isMultiBoardMode) {
            const boardToUse = currentBoardId || configData.defaultBoard;
            node.log(`Getting client for board: ${boardToUse}`);
            modbusClient = client_registry_1.default.getModbusClientV2(boardToUse, node);
        }
        else {
            modbusClient = client_registry_1.default.getModbusClientV2(configData.config, node);
        }
        let mqttClient = null;
        // Khởi tạo MQTT client nếu cần (async/sync)
        if (config.mqttBroker) {
            try {
                // Lấy MQTT client theo cách synchronous
                if (config.mqttBroker === "thingsboard") {
                    client_registry_1.default.getThingsboardMqttClient(mqttConfig, node)
                        .then(client => {
                        mqttClient = client;
                        node.log(`Thingsboard MQTT client initialized: ${mqttClient.isConnected()}`);
                    })
                        .catch(error => {
                        node.error(`Failed to initialize Thingsboard MQTT client: ${error.message}`);
                    });
                }
                else {
                    client_registry_1.default.getLocalMqttClient(mqttConfig, node)
                        .then(client => {
                        mqttClient = client;
                        node.log(`Local MQTT client initialized: ${mqttClient.isConnected()}`);
                    })
                        .catch(error => {
                        node.error(`Failed to initialize Local MQTT client: ${error.message}`);
                    });
                }
            }
            catch (error) {
                node.error(`Failed to initialize MQTT client: ${error.message}`);
            }
        }
        if (!modbusClient) {
            node.error("Failed to initialize modbus client");
            node.status({ fill: "red", shape: "ring", text: "Modbus client initialization failed" });
            return;
        }
        // Hot-reload: Check for config changes every 30 seconds
        const configCheckInterval = setInterval(async () => {
            try {
                const newEnvConfig = readEnvConfig();
                const newConfig = readModbusConfig();
                // Check if mode has changed or if critical config has changed
                let hasChanged = false;
                let changeDescription = "";
                if (currentModbusConfig.mode !== newConfig.mode) {
                    hasChanged = true;
                    changeDescription = `mode changed from ${currentModbusConfig.mode} to ${newConfig.mode}`;
                }
                else if (newConfig.mode === 'single' && currentModbusConfig.mode === 'single') {
                    const oldCfg = currentModbusConfig.config;
                    const newCfg = newConfig.config;
                    hasChanged =
                        oldCfg.host !== newCfg.host ||
                            oldCfg.tcpPort !== newCfg.tcpPort ||
                            oldCfg.type !== newCfg.type;
                    if (hasChanged) {
                        changeDescription = `${newCfg.host}:${newCfg.tcpPort}`;
                    }
                }
                else if (newConfig.mode === 'multi' && currentModbusConfig.mode === 'multi') {
                    const oldBoards = JSON.stringify(currentModbusConfig.boards);
                    const newBoards = JSON.stringify(newConfig.boards);
                    hasChanged = oldBoards !== newBoards;
                    if (hasChanged) {
                        changeDescription = `board configuration updated`;
                    }
                }
                if (hasChanged) {
                    node.warn(`[HOT-RELOAD] Config change detected: ${changeDescription}`);
                    if (newConfig.mode === 'multi') {
                        const multiConfig = {
                            mode: 'multi',
                            defaultBoard: newConfig.defaultBoard,
                            boards: newConfig.boards
                        };
                        client_registry_1.default.initializeMultiBoardConfig(multiConfig, node);
                        const boardToUse = currentBoardId || newConfig.defaultBoard;
                        modbusClient = client_registry_1.default.getModbusClientV2(boardToUse, node);
                    }
                    else {
                        const reloaded = await client_registry_1.default.reloadModbusConfig(newConfig.config, node);
                        if (reloaded) {
                            modbusClient = client_registry_1.default.getModbusClientV2(newConfig.config, node);
                        }
                    }
                    currentModbusConfig = Object.assign({}, newConfig);
                    isMultiBoardMode = newConfig.mode === 'multi';
                    node.warn(`[HOT-RELOAD] Modbus reloaded: ${changeDescription}`);
                    node.status({ fill: "green", shape: "dot", text: `Reloaded: ${changeDescription}` });
                    setTimeout(() => {
                        node.status({ fill: "green", shape: "dot", text: "Ready" });
                    }, 3000);
                }
                // Update all env variables
                if (currentEnvConfig.deviceId !== newEnvConfig.deviceId) {
                    node.warn(`[HOT-RELOAD] Device ID changed: ${currentEnvConfig.deviceId} -> ${newEnvConfig.deviceId}`);
                    deviceId = newEnvConfig.deviceId;
                }
                modbusCoils = newEnvConfig.modbusCoils;
                modbusInputRegisters = newEnvConfig.modbusInputRegisters;
                modbusHoldingRegisters = newEnvConfig.modbusHoldingRegisters;
                currentEnvConfig = newEnvConfig;
            }
            catch (error) {
                node.error(`[HOT-RELOAD] Config check error: ${error.message}`);
            }
        }, 30000); // Check every 30 seconds
        node.log("[HOT-RELOAD] Config monitoring enabled (30s interval)");
        // Utility functions
        function scaleValue(key, value, direction) {
            const config = getScaleConfigs().find((c) => c.key === key && c.direction === direction);
            if (!config)
                return value;
            const shouldMultiply = config.operation === "multiply";
            const scaledValue = shouldMultiply ? value * config.factor : value / config.factor;
            return scaledValue;
        }
        function validateAndConvertValue(key, value) {
            const expectedType = getConfigKeys()[key];
            if (!expectedType)
                return value;
            try {
                switch (expectedType) {
                    case "number":
                        const num = Number(value);
                        if (isNaN(num))
                            throw new Error(`Invalid number value for ${key}`);
                        return num;
                    case "boolean":
                        if (typeof value === "string")
                            return value.toLowerCase() === "true";
                        return Boolean(value);
                    case "string":
                        return String(value);
                    default:
                        return value;
                }
            }
            catch (error) {
                throw new Error(`Value conversion failed for ${key}: ${error.message}`);
            }
        }
        function findModbusMapping(key) {
            if (modbusHoldingRegisters[key] !== undefined) {
                return { address: modbusHoldingRegisters[key], fc: 6, value: 0 };
            }
            if (modbusCoils[key] !== undefined) {
                return { address: modbusCoils[key], fc: 5, value: false };
            }
            if (modbusInputRegisters[key] !== undefined) {
                return { address: modbusInputRegisters[key], fc: 4, value: 0 };
            }
            return null;
        }
        async function writeToModbus(key, mapping, value) {
            try {
                let writeValue = value;
                if (typeof value === "number") {
                    writeValue = scaleValue(key, value, "write");
                }
                if (mapping.fc === 6) {
                    await modbusClient.writeRegister(mapping.address, writeValue);
                    node.log(`Wrote to modbus register: address=${mapping.address}, value=${writeValue}`);
                }
                else if (mapping.fc === 5) {
                    await modbusClient.writeCoil(mapping.address, value);
                    node.log(`Wrote to modbus coil: address=${mapping.address}, value=${writeValue}`);
                }
                // Lưu thông tin lệnh thủ công
                const manualOverrides = flowContext.get(MANUAL_OVERRIDES_KEY) || {};
                manualOverrides[`${mapping.address}-${mapping.fc}`] = {
                    fc: mapping.fc,
                    value: writeValue,
                    timestamp: Date.now()
                };
                flowContext.set(MANUAL_OVERRIDES_KEY, manualOverrides);
            }
            catch (error) {
                throw new Error(`Modbus write failed for ${key}: ${error.message}`);
            }
        }
        async function readFromModbus(key, mapping) {
            try {
                const readFc = mapping.fc === 6 ? 3 : mapping.fc === 5 ? 1 : 4;
                let result;
                if (readFc === 1) {
                    result = await modbusClient.readCoils(mapping.address, 1);
                }
                else if (readFc === 3) {
                    result = await modbusClient.readHoldingRegisters(mapping.address, 1);
                }
                else {
                    result = await modbusClient.readInputRegisters(mapping.address, 1);
                }
                let readValue = result.data[0];
                if (typeof readValue === "number") {
                    readValue = scaleValue(key, readValue, "read");
                }
                return readValue;
            }
            catch (error) {
                throw new Error(`Modbus read failed for ${key}: ${error.message}`);
            }
        }
        // Utility để publish kết quả lên MQTT
        async function publishResult(key, value) {
            if (!mqttClient) {
                console.log("there is no mqttClient connected");
                return;
            }
            ;
            try {
                const mqttPayload = {
                    ts: Date.now(),
                    [key]: value,
                };
                await mqttClient.publish(publishTopic, JSON.stringify(mqttPayload));
                node.log(`Published to MQTT: ${key}=${value}`);
            }
            catch (error) {
                node.error(`MQTT publish error for ${key}: ${error.message}`);
            }
        }
        // Filter out parameters with "undefined" values (string or actual undefined)
        function filterUndefinedParams(params) {
            const filteredParams = {};
            const filteredKeys = [];
            for (const [key, value] of Object.entries(params)) {
                // Filter out "undefined" string values and actual undefined values
                if (value === "undefined" || value === undefined) {
                    filteredKeys.push(key);
                    continue;
                }
                filteredParams[key] = value;
            }
            if (filteredKeys.length > 0) {
                node.warn(`Filtered out parameters with undefined values: ${filteredKeys.join(", ")}`);
            }
            return filteredParams;
        }
        async function handleRpcRequest(rpcBody) {
            try {
                if (rpcBody.method === "set_state" && rpcBody.params) {
                    // Filter out undefined parameters
                    const filteredParams = filterUndefinedParams(rpcBody.params);
                    if (Object.keys(filteredParams).length === 0) {
                        node.warn("All parameters were filtered out due to undefined values");
                        node.status({ fill: "yellow", shape: "ring", text: "No valid parameters" });
                        return;
                    }
                    for (const [key, rawValue] of Object.entries(filteredParams)) {
                        const mapping = findModbusMapping(key);
                        if (mapping) {
                            const value = validateAndConvertValue(key, rawValue);
                            node.warn(`Writing to modbus: key=${key}, value=${value}`);
                            await writeToModbus(key, mapping, value);
                            const readValue = await readFromModbus(key, mapping);
                            // Tạo payload để send đi qua node output
                            const resultPayload = {
                                ts: Date.now(),
                                [key]: readValue,
                            };
                            node.send({ payload: resultPayload });
                            // Publish lên MQTT nếu có kết nối
                            if (mqttClient) {
                                await publishResult(key, readValue);
                            }
                            node.status({ fill: "green", shape: "dot", text: `Set: ${key}=${readValue}` });
                        }
                        else {
                            const value = validateAndConvertValue(key, rawValue);
                            const currentConfig = getConfigKeyValues();
                            currentConfig[key] = value;
                            setConfigKeyValues(currentConfig);
                            const resultPayload = {
                                ts: Date.now(),
                                [key]: value,
                                note: "Config key updated (no Modbus mapping)",
                            };
                            node.send({ payload: resultPayload });
                            // Publish lên MQTT nếu có kết nối
                            if (mqttClient) {
                                await publishResult(key, value);
                            }
                            node.status({ fill: "yellow", shape: "dot", text: `Config key: ${key}=${value}` });
                        }
                    }
                }
                else {
                    node.warn(`Unsupported RPC method: ${rpcBody.method}`);
                    node.status({ fill: "yellow", shape: "ring", text: "Unsupported method" });
                }
            }
            catch (error) {
                node.error(`RPC handling error: ${error.message}`);
                node.status({ fill: "red", shape: "ring", text: "RPC error" });
            }
        }
        // Handle input messages
        node.on('input', function (msg) {
            // Log receipt of message
            node.warn("VIIS-RPC-CONTROL-INPUT: INPUT RECEIVED");
            console.log("VIIS-RPC-CONTROL-INPUT: INPUT RECEIVED");
            // Chỉ log payload để tránh circular reference
            try {
                if (msg.payload) {
                    node.warn(`Input payload: ${JSON.stringify(msg.payload)}`);
                }
                if (msg.method && msg.params) {
                    node.warn(`Input method: ${msg.method}, params: ${JSON.stringify(msg.params)}`);
                }
            }
            catch (error) {
                node.warn(`Unable to log message details: ${error.message}`);
            }
            // Set node status
            node.status({ fill: "blue", shape: "dot", text: "Processing input" });
            // Xử lý dynamic config updates nếu có
            if (msg.scaleConfigs) {
                try {
                    let newConfigs = Array.isArray(msg.scaleConfigs) ? msg.scaleConfigs : JSON.parse(msg.scaleConfigs);
                    if (!Array.isArray(newConfigs))
                        newConfigs = [];
                    flowContext.set(SCALE_CONFIG_KEY, newConfigs);
                    node.warn(`[Config] scaleConfigs updated: ${JSON.stringify(newConfigs)}`);
                }
                catch (error) {
                    node.error(`Failed to update scaleConfigs: ${error.message}`);
                }
            }
            if (msg.configKeys) {
                try {
                    let newKeys = typeof msg.configKeys === 'object' ? msg.configKeys : JSON.parse(msg.configKeys);
                    if (typeof newKeys !== 'object' || Array.isArray(newKeys) || newKeys === null)
                        newKeys = {};
                    flowContext.set(CONFIG_KEYS_KEY, newKeys);
                    node.warn(`[Config] configKeys updated: ${JSON.stringify(newKeys)}`);
                }
                catch (error) {
                    node.error(`Failed to update configKeys: ${error.message}`);
                }
            }
            // Xử lý RPC command từ input
            const rpcBody = {};
            if (msg.payload && typeof msg.payload === 'object' && msg.payload.method === 'set_state') {
                // Format: { payload: { method: "set_state", params: { key: value } } }
                rpcBody.method = msg.payload.method;
                rpcBody.params = msg.payload.params;
                node.warn(`Processing RPC from payload, method: ${rpcBody.method}`);
            }
            else if (typeof msg.method === 'string' && msg.method === 'set_state' && msg.params) {
                // Format: { method: "set_state", params: { key: value } }
                rpcBody.method = msg.method;
                rpcBody.params = msg.params;
                node.warn(`Processing RPC from direct properties, method: ${rpcBody.method}`);
            }
            else if (typeof msg.payload === 'object') {
                // Format: { payload: { key: value } } -> convert to set_state format
                rpcBody.method = 'set_state';
                rpcBody.params = msg.payload;
                node.warn(`Converting payload to RPC format, method: ${rpcBody.method}`);
            }
            else {
                node.warn('Invalid input format. Expected RPC command format or direct values.');
                node.status({ fill: "red", shape: "ring", text: "Invalid format" });
                return;
            }
            if (rpcBody.method && rpcBody.params) {
                // Process the RPC command
                handleRpcRequest(rpcBody);
            }
        });
        // Cleanup on close
        node.on('close', function () {
            try {
                // Stop config check interval
                if (configCheckInterval) {
                    clearInterval(configCheckInterval);
                    node.log("[CLEANUP] Config check interval stopped");
                }
                flowContext.set(SCALE_CONFIG_KEY, []);
                flowContext.set(CONFIG_KEYS_KEY, {});
                flowContext.set(CONFIG_VALUES_KEY, {});
                flowContext.set(MANUAL_OVERRIDES_KEY, {});
                // Giải phóng các clients
                if (isMultiBoardMode && currentBoardId) {
                    client_registry_1.default.releaseClientV2("modbus-board", node, currentBoardId);
                }
                else {
                    client_registry_1.default.releaseClientV2("modbus", node);
                }
                if (config.mqttBroker === "thingsboard") {
                    client_registry_1.default.releaseClient("thingsboard", node);
                }
                else if (config.mqttBroker) {
                    client_registry_1.default.releaseClient("local", node);
                }
                node.warn("VIIS RPC Control Input Node closed and context cleaned");
            }
            catch (error) {
                node.error(`Close error: ${error.message}`);
            }
        });
    }
    RED.nodes.registerType("viis-rpc-control-from-input", ViisRpcControlFromInputNode);
};
