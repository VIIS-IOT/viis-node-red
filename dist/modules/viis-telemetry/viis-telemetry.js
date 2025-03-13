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
        // Cấu hình Modbus
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
        // Lấy thông tin device và mapping từ môi trường
        const deviceId = process.env.DEVICE_ID || "unknown";
        const modbusCoils = JSON.parse(process.env.MODBUS_COILS || "{}");
        const modbusInputRegisters = JSON.parse(process.env.MODBUS_INPUT_REGISTERS || "{}");
        const modbusHoldingRegisters = JSON.parse(process.env.MODBUS_HOLDING_REGISTERS || "{}");
        // Cấu hình MQTT cho ThingsBoard
        const thingsboardConfig = {
            host: process.env.THINGSBOARD_HOST || "mqtt.viis.tech",
            port: process.env.THINGSBOARD_PORT ? parseInt(process.env.THINGSBOARD_PORT, 10) : 1883,
            username: process.env.DEVICE_ACCESS_TOKEN || "",
            password: process.env.THINGSBOARD_PASSWORD || "",
            subscribeTopic: "v1/devices/me/rpc/request/+",
            publishTopic: "v1/devices/me/telemetry",
        };
        // Cấu hình MQTT cho EMQX Local
        const localConfig = {
            host: process.env.EMQX_HOST || "emqx",
            port: process.env.EMQX_PORT ? parseInt(process.env.EMQX_PORT, 10) : 1883,
            username: process.env.EMQX_USERNAME || "",
            password: process.env.EMQX_PASSWORD || "",
            pubSubTopic: `v1/devices/me/telemetry/${deviceId}`,
        };
        // Tạo URL broker cho MQTT
        const thingsboardBroker = `mqtt://${thingsboardConfig.host}:${thingsboardConfig.port}`;
        const localBroker = `mqtt://${localConfig.host}:${localConfig.port}`;
        // Cấu hình cho MQTT client ThingsBoard
        const thingsboardMqttConfig = {
            broker: thingsboardBroker,
            clientId: `node-red-thingsboard-${Math.random().toString(16).substr(2, 8)}`,
            username: thingsboardConfig.username,
            password: thingsboardConfig.password,
            qos: 1,
        };
        // Cấu hình cho MQTT client EMQX Local
        const localMqttConfig = {
            broker: localBroker,
            clientId: `node-red-local-${Math.random().toString(16).substr(2, 8)}`,
            username: localConfig.username,
            password: localConfig.password,
            qos: 1,
        };
        // Lấy các client từ registry
        const modbusClient = client_registry_1.default.getModbusClient(modbusConfig, node);
        const thingsboardClient = client_registry_1.default.getThingsboardMqttClient(thingsboardMqttConfig, node);
        const localClient = client_registry_1.default.getLocalMqttClient(localMqttConfig, node);
        // Kiểm tra lỗi khởi tạo
        if (!modbusClient || !thingsboardClient || !localClient) {
            node.error("Failed to retrieve clients from registry");
            node.status({ fill: "red", shape: "ring", text: "Client initialization failed" });
            return;
        }
        // Lấy cấu hình từ node properties
        const pollIntervalCoil = parseInt(config.pollIntervalCoil || "1000", 10);
        const pollIntervalInput = parseInt(config.pollIntervalInput || "1000", 10);
        const pollIntervalHolding = parseInt(config.pollIntervalHolding || "5000", 10);
        const coilStartAddress = parseInt(config.coilStartAddress || "0", 10);
        const coilQuantity = parseInt(config.coilQuantity || "32", 10);
        const inputStartAddress = parseInt(config.inputStartAddress || "0", 10);
        const inputQuantity = parseInt(config.inputQuantity || "26", 10);
        const holdingStartAddress = parseInt(config.holdingStartAddress || "0", 10);
        const holdingQuantity = parseInt(config.holdingQuantity || "29", 10);
        // Parse cấu hình scaling từ config
        let scaleConfigs = [];
        try {
            scaleConfigs = JSON.parse(config.scaleConfigs || "[]");
            // Validate scaleConfigs
            scaleConfigs.forEach(conf => {
                if (!conf.key || !conf.operation || typeof conf.factor !== 'number' || !['read', 'write'].includes(conf.direction)) {
                    throw new Error(`Invalid scale config: ${JSON.stringify(conf)}`);
                }
            });
        }
        catch (error) {
            node.error(`Failed to parse scaleConfigs: ${error.message}`);
            node.status({ fill: "red", shape: "ring", text: "Invalid scaleConfigs" });
            // Cung cấp cấu hình mặc định nếu parse thất bại
            scaleConfigs = [
                { key: "current_ec", operation: "divide", factor: 1000, direction: "read" },
                { key: "current_ph", operation: "divide", factor: 10, direction: "read" },
                { key: "pump_pressure", operation: "divide", factor: 100, direction: "read" },
                { key: "set_ph", operation: "divide", factor: 10, direction: "read" },
                { key: "set_ec", operation: "divide", factor: 1000, direction: "read" },
                { key: "flow_rate", operation: "multiply", factor: 10, direction: "read" },
                { key: "temperature", operation: "divide", factor: 100, direction: "read" },
                { key: "power_level", operation: "multiply", factor: 1000, direction: "read" }
            ];
        }
        let coilInterval = null;
        let inputInterval = null;
        let holdingInterval = null;
        let isPollingPaused = false;
        // State lưu trữ để kiểm tra thay đổi
        let previousStateCoils = {};
        let previousStateInput = {};
        let previousStateHolding = {};
        const CHANGE_THRESHOLD = 0.1;
        // Hàm áp dụng scaling
        function applyScaling(key, value, direction) {
            const scaleConfig = scaleConfigs.find(config => config.key === key && config.direction === direction);
            if (!scaleConfig)
                return value;
            node.warn(`Scaling key: ${key}, value: ${value}, direction: ${direction}, config: ${JSON.stringify(scaleConfig)}`);
            return scaleConfig.operation === "multiply"
                ? value * scaleConfig.factor
                : value / scaleConfig.factor;
        }
        // Hàm polling dữ liệu từ Coils
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
                                currentState[key] = value; // Không cần scale cho boolean
                        });
                        // Lưu dữ liệu vào global variable coilRegisterData
                        node.context().global.set("coilRegisterData", currentState);
                        processState(currentState, "Coils");
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
                            yield new Promise(resolve => setTimeout(resolve, 1000));
                        }
                    }
                }
            });
        }
        // Hàm polling dữ liệu từ Input Registers
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
                                currentState[key] = applyScaling(key, value, 'read'); // Áp dụng scaling cho read
                        });
                        // Lưu dữ liệu vào global variable inputRegisterData
                        node.context().global.set("inputRegisterData", currentState);
                        processState(currentState, "Input Registers");
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
                            yield new Promise(resolve => setTimeout(resolve, 1000));
                        }
                    }
                }
            });
        }
        // Hàm polling dữ liệu từ Holding Registers
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
                                currentState[key] = applyScaling(key, value, 'read'); // Áp dụng scaling cho read
                        });
                        // Lưu dữ liệu vào global variable holdingRegisterData
                        node.context().global.set("holdingRegisterData", currentState);
                        processState(currentState, "Holding Registers");
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
                            yield new Promise(resolve => setTimeout(resolve, 1000));
                        }
                    }
                }
            });
        }
        // Hàm xử lý state chung
        function processState(currentState, source) {
            let previousStateForSource;
            switch (source) {
                case "Coils":
                    previousStateForSource = previousStateCoils;
                    break;
                case "Input Registers":
                    previousStateForSource = previousStateInput;
                    break;
                case "Holding Registers":
                    previousStateForSource = previousStateHolding;
                    break;
                default:
                    previousStateForSource = {};
            }
            const hasChanged = hasSignificantChange(currentState, previousStateForSource);
            if (hasChanged) {
                const timestamp = Date.now();
                const mqttPayload = Object.assign({ ts: timestamp }, currentState);
                const payloadString = JSON.stringify(mqttPayload);
                thingsboardClient.publish(thingsboardConfig.publishTopic, payloadString);
                localClient.publish(localConfig.pubSubTopic, payloadString);
                switch (source) {
                    case "Coils":
                        previousStateCoils = Object.assign({}, currentState);
                        break;
                    case "Input Registers":
                        previousStateInput = Object.assign({}, currentState);
                        break;
                    case "Holding Registers":
                        previousStateHolding = Object.assign({}, currentState);
                        break;
                }
                node.send({ payload: mqttPayload });
                node.status({ fill: "green", shape: "dot", text: `${source}: Data changed` });
            }
            else {
                node.send({
                    payload: {
                        message: `${source}: No significant change detected`,
                        currentState: currentState,
                        previousState: previousStateForSource,
                        threshold: CHANGE_THRESHOLD,
                    },
                });
                node.status({ fill: "yellow", shape: "ring", text: `${source}: No change` });
            }
        }
        // Hàm kiểm tra thay đổi đáng kể
        function hasSignificantChange(current, previous) {
            if (Object.keys(previous).length === 0)
                return true;
            for (const key of Object.keys(current)) {
                const currVal = current[key];
                const prevVal = previous[key];
                if (prevVal === undefined)
                    return true;
                if (typeof currVal === "number" && typeof prevVal === "number") {
                    if (Math.abs(currVal - prevVal) >= CHANGE_THRESHOLD) {
                        node.log(`Change detected in ${key}: ${prevVal} -> ${currVal}`);
                        return true;
                    }
                }
                else if (currVal !== prevVal) {
                    node.log(`Change detected in ${key}: ${prevVal} -> ${currVal}`);
                    return true;
                }
            }
            return false;
        }
        modbusClient.on("modbus-status", (status) => {
            if (status.status === "disconnected" && !isPollingPaused) {
                node.log("Pausing polling due to Modbus disconnection...");
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
            }
            else if (status.status === "connected" && isPollingPaused) {
                node.log("Resuming polling after Modbus reconnection...");
                resumePollingIfAllConnected();
            }
        });
        // Start polling only if all clients are connected initially
        if (modbusClient.isConnectedCheck() && thingsboardClient.isConnected() && localClient.isConnected()) {
            coilInterval = setInterval(pollCoils, pollIntervalCoil);
            inputInterval = setInterval(pollInputRegisters, pollIntervalInput);
            holdingInterval = setInterval(pollHoldingRegisters, pollIntervalHolding);
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
            client_registry_1.default.releaseClient("thingsboard", node);
            client_registry_1.default.releaseClient("local", node);
            node.log("Node closed and client references released");
        });
        thingsboardClient.on("mqtt-status", (status) => {
            if (status.status === "disconnected" && !isPollingPaused) {
                node.log("Pausing polling due to ThingsBoard MQTT disconnection...");
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
            }
            else if (status.status === "connected" && isPollingPaused && localClient.isConnected()) {
                node.log("Resuming polling after ThingsBoard MQTT reconnection...");
                resumePollingIfAllConnected();
            }
        });
        localClient.on("mqtt-status", (status) => {
            if (status.status === "disconnected" && !isPollingPaused) {
                node.log("Pausing polling due to Local MQTT disconnection...");
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
            }
            else if (status.status === "connected" && isPollingPaused && thingsboardClient.isConnected()) {
                node.log("Resuming polling after Local MQTT reconnection...");
                resumePollingIfAllConnected();
            }
        });
        function resumePollingIfAllConnected() {
            if (modbusClient.isConnectedCheck() && thingsboardClient.isConnected() && localClient.isConnected()) {
                isPollingPaused = false;
                coilInterval = setInterval(pollCoils, pollIntervalCoil);
                inputInterval = setInterval(pollInputRegisters, pollIntervalInput);
                holdingInterval = setInterval(pollHoldingRegisters, pollIntervalHolding);
            }
        }
    }
    RED.nodes.registerType("viis-telemetry", ViisTelemetryNode);
};
