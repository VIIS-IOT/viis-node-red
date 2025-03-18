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
    function ViisTelemetryNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const modbusConfig = {
            type: process.env.MODBUS_TYPE || "TCP",
            host: process.env.MODBUS_HOST || "localhost",
            tcpPort: parseInt(process.env.MODBUS_TCP_PORT || "1502", 10),
            serialPort: process.env.MODBUS_SERIAL_PORT || "/dev/ttyUSB0",
            baudRate: parseInt(process.env.MODBUS_BAUD_RATE || "9600", 10),
            parity: process.env.MODBUS_PARITY || "none",
            unitId: parseInt(process.env.MODBUS_UNIT_ID || "1", 10),
            timeout: parseInt(process.env.MODBUS_TIMEOUT || "5000", 10),
            reconnectInterval: parseInt(process.env.MODBUS_RECONNECT_INTERVAL || "5000", 10),
        };
        const deviceId = process.env.DEVICE_ID || "unknown";
        const modbusCoils = JSON.parse(process.env.MODBUS_COILS || "{}");
        const modbusInputRegisters = JSON.parse(process.env.MODBUS_INPUT_REGISTERS || "{}");
        const modbusHoldingRegisters = JSON.parse(process.env.MODBUS_HOLDING_REGISTERS || "{}");
        const localConfig = {
            host: process.env.EMQX_HOST || "emqx",
            port: process.env.EMQX_PORT ? parseInt(process.env.EMQX_PORT, 10) : 1883,
            username: process.env.EMQX_USERNAME || "",
            password: process.env.EMQX_PASSWORD || "",
            pubSubTopic: `viis/things/v2/${deviceId}/telemetry`,
        };
        const localMqttConfig = {
            broker: `mqtt://${localConfig.host}:${localConfig.port}`,
            clientId: `node-red-local-${Math.random().toString(16).substr(2, 8)}`,
            username: localConfig.username,
            password: localConfig.password,
            qos: 1,
        };
        const mysqlConfig = {
            host: process.env.DATABASE_HOST || "localhost",
            port: process.env.DATABASE_PORT ? parseInt(process.env.DATABASE_PORT, 10) : 3306,
            user: process.env.DATABASE_USER || "root",
            password: process.env.DATABASE_PASSWORD || "",
            database: process.env.DATABASE_NAME || "your_database",
            connectionLimit: process.env.DATABASE_CONNECTION_LIMIT ? parseInt(process.env.DATABASE_CONNECTION_LIMIT, 10) : 10,
        };
        const pollIntervalCoil = parseInt(config.pollIntervalCoil || "1000", 10);
        const pollIntervalInput = parseInt(config.pollIntervalInput || "1000", 10);
        const pollIntervalHolding = parseInt(config.pollIntervalHolding || "5000", 10);
        const coilStartAddress = parseInt(config.coilStartAddress || "0", 10);
        const coilQuantity = parseInt(config.coilQuantity || "40", 10);
        const inputStartAddress = parseInt(config.inputStartAddress || "0", 10);
        const inputQuantity = parseInt(config.inputQuantity || "26", 10);
        const holdingStartAddress = parseInt(config.holdingStartAddress || "0", 10);
        const holdingQuantity = parseInt(config.holdingQuantity || "29", 10);
        let scaleConfigs = [];
        try {
            scaleConfigs = JSON.parse(config.scaleConfigs || "[]");
            scaleConfigs.forEach((conf) => {
                if (!conf.key || !conf.operation || typeof conf.factor !== "number" || !["read", "write"].includes(conf.direction)) {
                    throw new Error(`Invalid scale config: ${JSON.stringify(conf)}`);
                }
            });
            console.log("Scale configs parsed successfully:", scaleConfigs);
        }
        catch (error) {
            node.error(`Failed to parse scaleConfigs: ${error.message}`);
            node.status({ fill: "red", shape: "ring", text: "Invalid scaleConfigs" });
            scaleConfigs = [
                { key: "current_ec", operation: "divide", factor: 1000, direction: "read" },
                { key: "current_ph", operation: "divide", factor: 10, direction: "read" },
                { key: "pump_pressure", operation: "divide", factor: 100, direction: "read" },
                { key: "set_ph", operation: "divide", factor: 10, direction: "read" },
                { key: "set_ec", operation: "divide", factor: 1000, direction: "read" },
                { key: "flow_rate", operation: "multiply", factor: 10, direction: "read" },
                { key: "temperature", operation: "divide", factor: 100, direction: "read" },
                { key: "power_level", operation: "multiply", factor: 1000, direction: "read" },
            ];
            node.warn(`Using default scaleConfigs due to parsing failure: ${JSON.stringify(scaleConfigs)}`);
        }
        const modbusClient = client_registry_1.default.getModbusClient(modbusConfig, node);
        const localClient = client_registry_1.default.getLocalMqttClient(localMqttConfig, node);
        const mysqlClient = client_registry_1.default.getMySqlClient(mysqlConfig, node);
        if (!modbusClient || !localClient || !mysqlClient) {
            node.error("Failed to retrieve clients from registry");
            node.status({ fill: "red", shape: "ring", text: "Client initialization failed" });
            return;
        }
        else {
            console.log("All clients initialized successfully: Modbus, MQTT, MySQL");
        }
        let previousStateCoils = {};
        let previousStateInput = {};
        let previousStateHolding = {};
        const CHANGE_THRESHOLD = 0.1;
        let isPollingPaused = false;
        let coilInterval = null;
        let inputInterval = null;
        let holdingInterval = null;
        function applyScaling(key, value, direction) {
            const scaleConfig = scaleConfigs.find((config) => config.key === key && config.direction === direction);
            if (!scaleConfig)
                return value;
            const scaledValue = scaleConfig.operation === "multiply" ? value * scaleConfig.factor : value / scaleConfig.factor;
            node.warn(`Scaling applied - key: ${key}, original: ${value}, scaled: ${scaledValue}, direction: ${direction}`);
            return scaledValue;
        }
        function getChangedKeys(current, previous) {
            const changed = {};
            for (const key in current) {
                const currVal = current[key];
                const prevVal = previous[key];
                if (prevVal === undefined ||
                    (typeof currVal === "number" && typeof prevVal === "number" && Math.abs(currVal - prevVal) >= CHANGE_THRESHOLD) ||
                    currVal !== prevVal) {
                    changed[key] = currVal;
                }
            }
            return changed;
        }
        function processState(currentState, source) {
            return __awaiter(this, void 0, void 0, function* () {
                let previousStateForSource = source === "Coils" ? previousStateCoils : source === "Input Registers" ? previousStateInput : previousStateHolding;
                const changedKeys = getChangedKeys(currentState, previousStateForSource);
                if (Object.keys(changedKeys).length > 0) {
                    const timestamp = Date.now();
                    const republishPayload = Object.entries(changedKeys)
                        .map(([key, value]) => ({
                        ts: Math.floor(timestamp / 1000),
                        key,
                        value,
                    }))
                        .concat({ ts: Math.floor(timestamp / 1000), key: "deviceId", value: deviceId });
                    localClient.publish(localConfig.pubSubTopic, JSON.stringify(republishPayload));
                    console.log(`${source}: Published changed data to MQTT`, republishPayload);
                    for (const [key, changedValue] of Object.entries(changedKeys)) {
                        let valueType, columnName, sqlValue = changedValue;
                        if (typeof changedValue === "boolean") {
                            valueType = "boolean";
                            sqlValue = changedValue ? 1 : 0;
                            columnName = "boolean_value";
                        }
                        else if (typeof changedValue === "number") {
                            valueType = Number.isInteger(changedValue) ? "int" : "float";
                            columnName = valueType === "int" ? "int_value" : "float_value";
                        }
                        else if (typeof changedValue === "string") {
                            try {
                                JSON.parse(changedValue);
                                valueType = "json";
                                columnName = "json_value";
                            }
                            catch (e) {
                                valueType = "string";
                                columnName = "string_value";
                            }
                            sqlValue = `'${changedValue}'`;
                        }
                        else {
                            valueType = "string";
                            columnName = "string_value";
                            sqlValue = `'${String(changedValue)}'`;
                        }
                        const query = `INSERT INTO tabiot_device_telemetry (device_id, timestamp, key_name, value_type, ${columnName})
VALUES ('${deviceId}', ${Math.floor(timestamp / 1000)}, '${key}', '${valueType}', ${sqlValue})
ON DUPLICATE KEY UPDATE ${columnName} = ${sqlValue};`;
                        try {
                            yield mysqlClient.query(query);
                            node.log(`Database updated for key ${key}`);
                        }
                        catch (err) {
                            node.error(`Failed to update DB for key ${key}: ${err.message}`);
                        }
                    }
                    if (source === "Coils")
                        previousStateCoils = Object.assign({}, currentState);
                    else if (source === "Input Registers")
                        previousStateInput = Object.assign({}, currentState);
                    else if (source === "Holding Registers")
                        previousStateHolding = Object.assign({}, currentState);
                    node.send({ payload: republishPayload });
                    node.status({ fill: "green", shape: "dot", text: `${source}: Data changed` });
                }
                else {
                    node.send({
                        payload: {
                            message: `${source}: No significant change detected`,
                            currentState,
                            previousState: previousStateForSource,
                            threshold: CHANGE_THRESHOLD,
                        },
                    });
                    node.status({ fill: "yellow", shape: "ring", text: `${source}: No change` });
                }
            });
        }
        function pollCoils() {
            return __awaiter(this, void 0, void 0, function* () {
                const maxRetries = 3;
                let retryCount = 0;
                while (retryCount < maxRetries) {
                    try {
                        const result = yield modbusClient.readCoils(coilStartAddress, coilQuantity);
                        const currentState = {};
                        result.data.forEach((value, index) => {
                            const key = Object.keys(modbusCoils).find((k) => modbusCoils[k] === index + coilStartAddress);
                            if (key)
                                currentState[key] = value;
                        });
                        node.context().global.set("coilRegisterData", currentState);
                        console.log("Coils polled successfully:", currentState);
                        yield processState(currentState, "Coils");
                        break;
                    }
                    catch (error) {
                        retryCount++;
                        const err = error;
                        node.error(`Coil polling error (attempt ${retryCount}/${maxRetries}): ${err.message}`);
                        if (retryCount === maxRetries) {
                            node.send({ payload: `Coil polling failed after ${maxRetries} attempts: ${err.message}` });
                        }
                        else {
                            yield new Promise((resolve) => setTimeout(resolve, 1000));
                        }
                    }
                }
            });
        }
        function pollInputRegisters() {
            return __awaiter(this, void 0, void 0, function* () {
                const maxRetries = 3;
                let retryCount = 0;
                while (retryCount < maxRetries) {
                    try {
                        const result = yield modbusClient.readInputRegisters(inputStartAddress, inputQuantity);
                        const currentState = {};
                        result.data.forEach((value, index) => {
                            const key = Object.keys(modbusInputRegisters).find((k) => modbusInputRegisters[k] === index + inputStartAddress);
                            if (key)
                                currentState[key] = applyScaling(key, value, "read");
                        });
                        node.context().global.set("inputRegisterData", currentState);
                        console.log("Input Registers polled successfully:", currentState);
                        yield processState(currentState, "Input Registers");
                        break;
                    }
                    catch (error) {
                        retryCount++;
                        const err = error;
                        node.error(`Input polling error (attempt ${retryCount}/${maxRetries}): ${err.message}`);
                        if (retryCount === maxRetries) {
                            node.send({ payload: `Input polling failed after ${maxRetries} attempts: ${err.message}` });
                        }
                        else {
                            yield new Promise((resolve) => setTimeout(resolve, 1000));
                        }
                    }
                }
            });
        }
        function pollHoldingRegisters() {
            return __awaiter(this, void 0, void 0, function* () {
                const maxRetries = 3;
                let retryCount = 0;
                while (retryCount < maxRetries) {
                    try {
                        const result = yield modbusClient.readHoldingRegisters(holdingStartAddress, holdingQuantity);
                        const currentState = {};
                        result.data.forEach((value, index) => {
                            const key = Object.keys(modbusHoldingRegisters).find((k) => modbusHoldingRegisters[k] === index + holdingStartAddress);
                            if (key)
                                currentState[key] = applyScaling(key, value, "read");
                        });
                        node.context().global.set("holdingRegisterData", currentState);
                        console.log("Holding Registers polled successfully:", currentState);
                        yield processState(currentState, "Holding Registers");
                        break;
                    }
                    catch (error) {
                        retryCount++;
                        const err = error;
                        node.error(`Holding polling error (attempt ${retryCount}/${maxRetries}): ${err.message}`);
                        if (retryCount === maxRetries) {
                            node.send({ payload: `Holding polling failed after ${maxRetries} attempts: ${err.message}` });
                        }
                        else {
                            yield new Promise((resolve) => setTimeout(resolve, 1000));
                        }
                    }
                }
            });
        }
        modbusClient.on("modbus-status", (status) => {
            if (status.status === "disconnected" && !isPollingPaused) {
                isPollingPaused = true;
                if (coilInterval)
                    clearInterval(coilInterval);
                if (inputInterval)
                    clearInterval(inputInterval);
                if (holdingInterval)
                    clearInterval(holdingInterval);
                coilInterval = null;
                inputInterval = null;
                holdingInterval = null;
                node.warn("Modbus disconnected, polling paused");
            }
            else if (status.status === "connected" && isPollingPaused) {
                resumePollingIfAllConnected();
            }
        });
        localClient.on("mqtt-status", (status) => {
            if (status.status === "disconnected" && !isPollingPaused) {
                isPollingPaused = true;
                if (coilInterval)
                    clearInterval(coilInterval);
                if (inputInterval)
                    clearInterval(inputInterval);
                if (holdingInterval)
                    clearInterval(holdingInterval);
                coilInterval = null;
                inputInterval = null;
                holdingInterval = null;
                node.warn("MQTT disconnected, polling paused");
            }
            else if (status.status === "connected" && isPollingPaused && modbusClient.isConnectedCheck()) {
                resumePollingIfAllConnected();
            }
        });
        function resumePollingIfAllConnected() {
            if (modbusClient.isConnectedCheck() && localClient.isConnected()) {
                isPollingPaused = false;
                coilInterval = setInterval(pollCoils, pollIntervalCoil);
                inputInterval = setInterval(pollInputRegisters, pollIntervalInput);
                holdingInterval = setInterval(pollHoldingRegisters, pollIntervalHolding);
                console.log("All clients connected, polling resumed");
            }
        }
        if (modbusClient.isConnectedCheck() && localClient.isConnected()) {
            coilInterval = setInterval(pollCoils, pollIntervalCoil);
            inputInterval = setInterval(pollInputRegisters, pollIntervalInput);
            holdingInterval = setInterval(pollHoldingRegisters, pollIntervalHolding);
            console.log("Polling started for Coils, Input, and Holding Registers");
        }
        else {
            node.status({ fill: "red", shape: "ring", text: "Waiting for all clients to connect" });
            isPollingPaused = true;
        }
        node.on("close", () => {
            if (coilInterval)
                clearInterval(coilInterval);
            if (inputInterval)
                clearInterval(inputInterval);
            if (holdingInterval)
                clearInterval(holdingInterval);
            client_registry_1.default.releaseClient("modbus", node);
            client_registry_1.default.releaseClient("local", node);
            client_registry_1.default.releaseClient("mysql", node);
            console.log("Node closed, resources released");
        });
    }
    RED.nodes.registerType("viis-telemetry", ViisTelemetryNode);
};
