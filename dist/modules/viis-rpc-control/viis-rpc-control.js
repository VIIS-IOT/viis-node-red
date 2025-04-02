"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_registry_1 = __importDefault(require("../../core/client-registry"));
module.exports = function (RED) {
    function ViisRpcControlNode(config) {
        return __awaiter(this, void 0, void 0, function* () {
            RED.nodes.createNode(this, config);
            const node = this;
            const globalContext = node.context().global;
            if (!globalContext.get("manualModbusOverrides")) {
                globalContext.set("manualModbusOverrides", {});
            }
            // Environment variables
            const deviceId = process.env.DEVICE_ID || "unknown";
            const modbusCoils = JSON.parse(process.env.MODBUS_COILS || "{}");
            const modbusInputRegisters = JSON.parse(process.env.MODBUS_INPUT_REGISTERS || "{}");
            const modbusHoldingRegisters = JSON.parse(process.env.MODBUS_HOLDING_REGISTERS || "{}");
            // Parse configurations
            let configKeys = {};
            let scaleConfigs = [];
            try {
                configKeys = JSON.parse(config.configKeys || "{}");
                scaleConfigs = JSON.parse(config.scaleConfigs || "[]");
                // Validate configKeys
                Object.entries(configKeys).forEach(([key, type]) => {
                    if (!["number", "boolean", "string"].includes(type)) {
                        throw new Error(`Invalid type "${type}" for key "${key}"`);
                    }
                });
                // Validate scaleConfigs
                scaleConfigs.forEach((conf) => {
                    if (!conf.key || !conf.operation || typeof conf.factor !== "number" || !["read", "write"].includes(conf.direction)) {
                        throw new Error(`Invalid scale config: ${JSON.stringify(conf)}`);
                    }
                });
                // Store configurations globally
                node.context().global.set("configKeys", configKeys);
                if (!node.context().global.get("configKeyValues")) {
                    node.context().global.set("configKeyValues", {});
                }
                node.context().global.set("scaleConfigs", scaleConfigs);
            }
            catch (error) {
                node.error(`Configuration parsing error: ${error.message}`);
                node.status({ fill: "red", shape: "ring", text: "Invalid configuration" });
                return;
            }
            // Initialize clients
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
            const subscribeTopic = config.mqttBroker === "thingsboard"
                ? "v1/devices/me/rpc/request/+"
                : `v1/devices/me/rpc/request/${deviceId}`;
            const publishTopic = config.mqttBroker === "thingsboard"
                ? "v1/devices/me/telemetry"
                : `v1/devices/me/telemetry/${deviceId}`;
            // Lấy clients với await
            const modbusClient = client_registry_1.default.getModbusClient(modbusConfig, node);
            const mqttClient = config.mqttBroker === "thingsboard"
                ? yield client_registry_1.default.getThingsboardMqttClient(mqttConfig, node)
                : yield client_registry_1.default.getLocalMqttClient(mqttConfig, node);
            if (!modbusClient || !mqttClient) {
                node.error("Failed to initialize clients");
                node.status({ fill: "red", shape: "ring", text: "Client initialization failed" });
                return;
            }
            node.log(`MQTT client initialized and connected: ${mqttClient.isConnected()}`);
            // Utility functions
            function scaleValue(key, value, direction) {
                const config = scaleConfigs.find((c) => c.key === key && c.direction === direction);
                if (!config)
                    return value;
                const shouldMultiply = config.operation === "multiply";
                const scaledValue = shouldMultiply ? value * config.factor : value / config.factor;
                node.log(`Scaled ${key} (${direction}): ${value} -> ${scaledValue}`);
                return scaledValue;
            }
            function validateAndConvertValue(key, value) {
                const expectedType = configKeys[key];
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
            function writeToModbus(key, mapping, value) {
                return __awaiter(this, void 0, void 0, function* () {
                    try {
                        let writeValue = value;
                        if (typeof value === "number") {
                            writeValue = scaleValue(key, value, "write");
                        }
                        if (mapping.fc === 6) {
                            yield modbusClient.writeRegister(mapping.address, writeValue);
                        }
                        else if (mapping.fc === 5) {
                            yield modbusClient.writeCoil(mapping.address, value);
                        }
                        node.log(`Wrote to Modbus: key=${key}, address=${mapping.address}, value=${writeValue}, fc=${mapping.fc}`);
                        // Lưu thông tin lệnh thủ công vào global context
                        const manualOverrides = globalContext.get("manualModbusOverrides");
                        manualOverrides[`${mapping.address}-${mapping.fc}`] = {
                            fc: mapping.fc,
                            value: writeValue,
                            timestamp: Date.now()
                        };
                        globalContext.set("manualModbusOverrides", manualOverrides);
                        node.log(`Stored manual override: address=${mapping.address}, fc=${mapping.fc}, value=${writeValue}`);
                    }
                    catch (error) {
                        throw new Error(`Modbus write failed for ${key}: ${error.message}`);
                    }
                });
            }
            function readFromModbus(key, mapping) {
                return __awaiter(this, void 0, void 0, function* () {
                    try {
                        const readFc = mapping.fc === 6 ? 3 : mapping.fc === 5 ? 1 : 4;
                        let result;
                        if (readFc === 1) {
                            result = yield modbusClient.readCoils(mapping.address, 1);
                        }
                        else if (readFc === 3) {
                            result = yield modbusClient.readHoldingRegisters(mapping.address, 1);
                        }
                        else {
                            result = yield modbusClient.readInputRegisters(mapping.address, 1);
                        }
                        let readValue = result.data[0];
                        if (typeof readValue === "number") {
                            readValue = scaleValue(key, readValue, "read");
                        }
                        node.log(`Read from Modbus: key=${key}, address=${mapping.address}, value=${readValue}, fc=${readFc}`);
                        return readValue;
                    }
                    catch (error) {
                        throw new Error(`Modbus read failed for ${key}: ${error.message}`);
                    }
                });
            }
            function publishResult(key, value) {
                return __awaiter(this, void 0, void 0, function* () {
                    const mqttPayload = {
                        ts: Date.now(),
                        [key]: value,
                    };
                    yield mqttClient.publish(publishTopic, JSON.stringify(mqttPayload));
                    node.send({ payload: mqttPayload });
                    node.status({ fill: "green", shape: "dot", text: `Published: ${key}` });
                });
            }
            function handleConfigRequest(params) {
                const currentConfigKeyValues = node.context().global.get("configKeyValues") || {};
                const updatedConfigKeyValues = Object.assign({}, currentConfigKeyValues);
                Object.entries(params).forEach(([key, rawValue]) => {
                    if (key in configKeys) {
                        const value = validateAndConvertValue(key, rawValue);
                        updatedConfigKeyValues[key] = value;
                    }
                });
                node.context().global.set("configKeyValues", updatedConfigKeyValues);
                const mqttPayload = Object.assign({ ts: Date.now() }, params);
                mqttClient.publish(publishTopic, JSON.stringify(mqttPayload)); // Không await ở đây vì không cần chặn
                node.send({ payload: mqttPayload });
                node.status({ fill: "green", shape: "dot", text: "Config processed" });
            }
            function handleRpcRequest(rpcBody) {
                return __awaiter(this, void 0, void 0, function* () {
                    try {
                        if (rpcBody.method === "set_state" && rpcBody.params) {
                            for (const [key, rawValue] of Object.entries(rpcBody.params)) {
                                const mapping = findModbusMapping(key);
                                if (mapping) {
                                    const value = validateAndConvertValue(key, rawValue);
                                    yield writeToModbus(key, mapping, value);
                                    const readValue = yield readFromModbus(key, mapping);
                                    yield publishResult(key, readValue);
                                }
                                else {
                                    const value = validateAndConvertValue(key, rawValue);
                                    const currentConfig = node.context().global.get("configKeyValues") || {};
                                    currentConfig[key] = value;
                                    node.context().global.set("configKeyValues", currentConfig);
                                    const mqttPayload = {
                                        ts: Date.now(),
                                        [key]: value,
                                        note: "Config key updated (no Modbus mapping)",
                                    };
                                    yield mqttClient.publish(publishTopic, JSON.stringify(mqttPayload));
                                    node.send({ payload: mqttPayload });
                                    node.status({ fill: "green", shape: "dot", text: `Config updated: ${key}` });
                                }
                            }
                        }
                    }
                    catch (error) {
                        node.error(`RPC handling error: ${error.message}`);
                        node.status({ fill: "red", shape: "ring", text: "RPC error" });
                    }
                });
            }
            // Set up MQTT subscription
            try {
                yield mqttClient.subscribe(subscribeTopic);
                node.log(`Subscribed to topic: ${subscribeTopic}`);
            }
            catch (error) {
                node.error(`Failed to subscribe to ${subscribeTopic}: ${error.message}`);
                node.status({ fill: "red", shape: "ring", text: "Subscription failed" });
                return;
            }
            mqttClient.on("mqtt-message", ({ message }) => {
                if (!message.topic.startsWith(subscribeTopic.replace("+", "")))
                    return;
                try {
                    const payload = JSON.parse(message.message.toString());
                    node.log(`Received RPC payload: ${JSON.stringify(payload)}`);
                    handleRpcRequest(payload);
                }
                catch (error) {
                    node.error(`MQTT message processing error: ${error.message}`);
                    node.status({ fill: "red", shape: "ring", text: "Parse error" });
                }
            });
            // Cleanup
            node.on("close", (done) => __awaiter(this, void 0, void 0, function* () {
                try {
                    yield mqttClient.disconnect();
                    client_registry_1.default.releaseClient("modbus", node);
                    if (config.mqttBroker === "thingsboard") {
                        client_registry_1.default.releaseClient("thingsboard", node);
                    }
                    else {
                        client_registry_1.default.releaseClient("local", node);
                    }
                    node.log("Node closed and clients released");
                    done();
                }
                catch (error) {
                    node.error(`Cleanup error: ${error.message}`);
                    done();
                }
            }));
        });
    }
    RED.nodes.registerType("viis-rpc-control", ViisRpcControlNode);
};
