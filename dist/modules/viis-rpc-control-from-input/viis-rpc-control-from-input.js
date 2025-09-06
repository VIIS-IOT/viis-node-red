"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_registry_1 = __importDefault(require("../../core/client-registry"));
module.exports = function (RED) {
    function ViisRpcControlFromInputNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        // Log when node is initialized
        node.warn("VIIS RPC Control From Input Node initialized");
        console.log("VIIS RPC Control From Input Node initialized");
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
        // Environment variables
        const modbusCoils = JSON.parse(process.env.MODBUS_COILS || "{}");
        const modbusInputRegisters = JSON.parse(process.env.MODBUS_INPUT_REGISTERS || "{}");
        const modbusHoldingRegisters = JSON.parse(process.env.MODBUS_HOLDING_REGISTERS || "{}");
        // Initialize modbus client
        // Environment variables
        const deviceId = process.env.DEVICE_ID || "unknown";
        // Modbus config
        const modbusConfig = {
            type: process.env.MODBUS_TYPE || "TCP",
            host: process.env.MODBUS_HOST || "localhost",
            tcpPort: parseInt(process.env.MODBUS_TCP_PORT || "502", 10),
            serialPort: process.env.MODBUS_SERIAL_PORT || "/dev/ttyUSB0",
            baudRate: parseInt(process.env.MODBUS_BAUD_RATE || "9600", 10),
            parity: process.env.MODBUS_PARITY || "none",
            unitId: parseInt(process.env.MODBUS_UNIT_ID || "1", 10),
            timeout: parseInt(process.env.MODBUS_TIMEOUT || "5000", 10),
            reconnectInterval: parseInt(process.env.MODBUS_RECONNECT_INTERVAL || "5000", 10),
        };
        // MQTT config
        const mqttConfig = config.mqttBroker === "thingsboard"
            ? {
                broker: `mqtt://${process.env.THINGSBOARD_HOST || "mqtt.viis.tech"}:${process.env.THINGSBOARD_PORT || "1883"}`,
                clientId: `node-red-thingsboard-rpc-${Math.random().toString(16).substr(2, 8)}`,
                username: process.env.DEVICE_ACCESS_TOKEN || "",
                password: process.env.THINGSBOARD_PASSWORD || "",
                qos: 1,
            }
            : {
                broker: `mqtt://${process.env.EMQX_HOST || "emqx"}:${process.env.EMQX_PORT || "1883"}`,
                clientId: `node-red-local-rpc-${Math.random().toString(16).substr(2, 8)}`,
                username: process.env.EMQX_USERNAME || "",
                password: process.env.EMQX_PASSWORD || "",
                qos: 1,
            };
        const publishTopic = config.mqttBroker === "thingsboard"
            ? "v1/devices/me/telemetry"
            : `v1/devices/me/telemetry/${deviceId}`;
        // Lấy clients
        const modbusClient = client_registry_1.default.getModbusClient(modbusConfig, node);
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
                flowContext.set(SCALE_CONFIG_KEY, []);
                flowContext.set(CONFIG_KEYS_KEY, {});
                flowContext.set(CONFIG_VALUES_KEY, {});
                flowContext.set(MANUAL_OVERRIDES_KEY, {});
                // Giải phóng các clients
                client_registry_1.default.releaseClient("modbus", node);
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
