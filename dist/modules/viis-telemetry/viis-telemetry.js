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
        return __awaiter(this, void 0, void 0, function* () {
            RED.nodes.createNode(this, config);
            const node = this;
            const nodeContext = this.context();
            // Configuration for Modbus
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
            // Configuration for local MQTT broker
            const localConfig = {
                host: process.env.EMQX_HOST || "emqx",
                port: parseInt(process.env.EMQX_PORT || "1883", 10),
                username: process.env.EMQX_USERNAME || "",
                password: process.env.EMQX_PASSWORD || "",
                pubSubTopic: `viis/things/v2/${deviceId}/telemetry`,
            };
            const localMqttConfig = {
                broker: `mqtt://${localConfig.host}:${localConfig.port}`,
                clientId: `node-red-local-${Math.random().toString(16).substring(2, 10)}`,
                username: localConfig.username,
                password: localConfig.password,
                qos: 1,
            };
            // Configuration for ThingsBoard MQTT broker
            const thingsboardMqttConfig = {
                broker: `mqtt://${process.env.THINGSBOARD_HOST || "mqtt.viis.tech"}:${process.env.THINGSBOARD_PORT || "1883"}`,
                clientId: `node-red-thingsboard-telemetry-${Math.random().toString(16).substring(2, 10)}`,
                username: process.env.DEVICE_ACCESS_TOKEN || "",
                password: process.env.THINGSBOARD_PASSWORD || "",
                qos: 1,
            };
            const mysqlConfig = {
                host: process.env.DATABASE_HOST || "localhost",
                port: parseInt(process.env.DATABASE_PORT || "3306", 10),
                user: process.env.DATABASE_USER || "root",
                password: process.env.DATABASE_PASSWORD || "",
                database: process.env.DATABASE_NAME || "your_database",
                connectionLimit: parseInt(process.env.DATABASE_CONNECTION_LIMIT || "10", 10),
            };
            // Ensure polling intervals are safe
            const MIN_POLLING_INTERVAL = 500;
            let pollIntervalCoil = parseInt(config.pollIntervalCoil, 10) || 1000;
            let pollIntervalInput = parseInt(config.pollIntervalInput, 10) || 1000;
            let pollIntervalHolding = parseInt(config.pollIntervalHolding, 10) || 5000;
            if (isNaN(pollIntervalCoil) || pollIntervalCoil < MIN_POLLING_INTERVAL) {
                node.warn(`Invalid coil polling interval: ${config.pollIntervalCoil}. Using minimum value: ${MIN_POLLING_INTERVAL}ms`);
                pollIntervalCoil = MIN_POLLING_INTERVAL;
            }
            if (isNaN(pollIntervalInput) || pollIntervalInput < MIN_POLLING_INTERVAL) {
                node.warn(`Invalid input polling interval: ${config.pollIntervalInput}. Using minimum value: ${MIN_POLLING_INTERVAL}ms`);
                pollIntervalInput = MIN_POLLING_INTERVAL;
            }
            if (isNaN(pollIntervalHolding) || pollIntervalHolding < MIN_POLLING_INTERVAL) {
                node.warn(`Invalid holding polling interval: ${config.pollIntervalHolding}. Using minimum value: ${MIN_POLLING_INTERVAL}ms`);
                pollIntervalHolding = MIN_POLLING_INTERVAL;
            }
            const coilStartAddress = parseInt(config.coilStartAddress, 10) || 0;
            const coilQuantity = parseInt(config.coilQuantity, 10) || 32;
            const inputStartAddress = parseInt(config.inputStartAddress, 10) || 0;
            const inputQuantity = parseInt(config.inputQuantity, 10) || 26;
            const holdingStartAddress = parseInt(config.holdingStartAddress, 10) || 0;
            const holdingQuantity = parseInt(config.holdingQuantity, 10) || 29;
            // Initialize scaleConfigs with deep copy
            let scaleConfigs = [];
            try {
                scaleConfigs = config.scaleConfigs ? JSON.parse(config.scaleConfigs) : [];
                scaleConfigs.forEach((conf) => {
                    if (!conf.key || !conf.operation || typeof conf.factor !== "number" || !["read", "write"].includes(conf.direction)) {
                        throw new Error(`Invalid scale config: ${JSON.stringify(conf)}`);
                    }
                });
            }
            catch (error) {
                node.error(`Failed to parse scaleConfigs: ${error.message}`);
                node.status({ fill: "red", shape: "ring", text: "Invalid scaleConfigs" });
                scaleConfigs = [
                    { key: "current_ec", operation: "divide", factor: 1000, direction: "read" },
                    { key: "current_ph", operation: "divide", factor: 1000, direction: "read" },
                    { key: "INPUT_SENSOR1_EC", operation: "divide", factor: 1000, direction: "read" },
                    { key: "INPUT_SENSOR1_PH", operation: "divide", factor: 100, direction: "read" },
                    { key: "INPUT_SENSOR2_EC", operation: "divide", factor: 1000, direction: "read" },
                    { key: "INPUT_SENSOR2_PH", operation: "divide", factor: 100, direction: "read" },
                    { key: "INPUT_SENSOR1_TEMP", operation: "divide", factor: 100, direction: "read" },
                    { key: "INPUT_SENSOR2_TEMP", operation: "divide", factor: 100, direction: "read" },
                ];
                node.warn(`Using default scaleConfigs: ${JSON.stringify(scaleConfigs)}`);
            }
            // Get clients
            const modbusClient = client_registry_1.default.getModbusClient(modbusConfig, node);
            const localClient = yield client_registry_1.default.getLocalMqttClient(localMqttConfig, node);
            const mysqlClient = client_registry_1.default.getMySqlClient(mysqlConfig, node);
            const thingsboardClient = yield client_registry_1.default.getThingsboardMqttClient(thingsboardMqttConfig, node);
            if (!modbusClient || !localClient || !mysqlClient || !thingsboardClient) {
                node.error("Failed to retrieve clients from registry");
                node.status({ fill: "red", shape: "ring", text: "Client initialization failed" });
                return;
            }
            // Initialize context
            nodeContext.set('previousState', nodeContext.get('previousState') || {});
            nodeContext.set('lastEcUpdate', nodeContext.get('lastEcUpdate') || 0);
            nodeContext.set('mainPumpState', nodeContext.get('mainPumpState') || false);
            const CHANGE_THRESHOLD = 0.1;
            const MIN_PUBLISH_INTERVAL = 1000;
            let isPollingPaused = false;
            let isConfigUpdating = false;
            let coilInterval = null;
            let inputInterval = null;
            let holdingInterval = null;
            // Polling flags
            let isPollingCoils = false;
            let isPollingInputs = false;
            let isPollingHoldings = false;
            // Failure counters
            let consecutiveCoilFailures = 0;
            let consecutiveInputFailures = 0;
            let consecutiveHoldingFailures = 0;
            const MAX_CONSECUTIVE_FAILURES = 5;
            const POLLING_BACKOFF_TIME = 30000;
            // Publish cache to prevent duplicates
            const publishCache = {};
            function applyScaling(key, value, direction) {
                const scaleConfig = scaleConfigs.find((config) => config.key === key && config.direction === direction);
                if (!scaleConfig)
                    return value;
                const scaledValue = scaleConfig.operation === "multiply" ? value * scaleConfig.factor : value / scaleConfig.factor;
                return Number(scaledValue.toFixed(2));
            }
            function getChangedKeys(current, previous) {
                const changed = {};
                const now = Date.now();
                const mainPumpState = nodeContext.get('mainPumpState');
                let lastEcUpdate = nodeContext.get('lastEcUpdate');
                for (const key in current) {
                    let currVal = current[key];
                    let prevVal = previous[key];
                    // Round numeric values for consistent comparison
                    if (typeof currVal === "number") {
                        currVal = Number(currVal.toFixed(2));
                    }
                    if (typeof prevVal === "number") {
                        prevVal = Number(prevVal.toFixed(2));
                    }
                    // Check publish cache
                    const lastPublish = publishCache[key];
                    if (lastPublish && lastPublish.value === currVal && now - lastPublish.timestamp < MIN_PUBLISH_INTERVAL) {
                        node.log(`Skipped publish for ${key}: value ${currVal}, last published ${now - lastPublish.timestamp}ms ago`);
                        continue;
                    }
                    // Special handling for current_ec
                    if (key === "current_ec" && mainPumpState) {
                        if (now - lastEcUpdate >= 5000) {
                            changed[key] = currVal;
                            lastEcUpdate = now;
                            nodeContext.set('lastEcUpdate', lastEcUpdate);
                            publishCache[key] = { value: currVal, timestamp: now };
                            node.log(`Published ${key}: ${currVal} (main_pump ON, 5s interval)`);
                        }
                        continue;
                    }
                    // Handle new keys
                    if (prevVal === undefined) {
                        changed[key] = currVal;
                        publishCache[key] = { value: currVal, timestamp: now };
                        node.log(`Published ${key}: ${currVal} (new key)`);
                        continue;
                    }
                    // Compare values
                    if (typeof currVal === "number" && typeof prevVal === "number") {
                        if (Math.abs(currVal - prevVal) >= CHANGE_THRESHOLD) {
                            changed[key] = currVal;
                            publishCache[key] = { value: currVal, timestamp: now };
                            node.log(`Published ${key}: ${currVal} (changed by ${Math.abs(currVal - prevVal)} >= ${CHANGE_THRESHOLD})`);
                        }
                    }
                    else if (currVal !== prevVal) {
                        changed[key] = currVal;
                        publishCache[key] = { value: currVal, timestamp: now };
                        node.log(`Published ${key}: ${currVal} (non-numeric change)`);
                    }
                }
                return changed;
            }
            function processState(currentState, source) {
                return __awaiter(this, void 0, void 0, function* () {
                    const previousState = nodeContext.get('previousState') || {};
                    const changedKeys = getChangedKeys(currentState, previousState);
                    if (Object.keys(changedKeys).length > 0) {
                        const timestamp = Date.now();
                        const republishPayload = [
                            ...Object.entries(changedKeys).map(([key, value]) => ({
                                ts: Math.floor(timestamp / 1000),
                                key,
                                value,
                            })),
                            { ts: Math.floor(timestamp / 1000), key: "deviceId", value: deviceId },
                        ];
                        const mqttPayload = {
                            ts: timestamp,
                            values: changedKeys,
                        };
                        // Sequential MQTT publishes
                        try {
                            yield localClient.publish(localConfig.pubSubTopic, JSON.stringify(republishPayload));
                            yield thingsboardClient.publish("v1/devices/me/telemetry", JSON.stringify(mqttPayload));
                            node.log(`Published to MQTT(${source}): ${JSON.stringify(mqttPayload)}`);
                        }
                        catch (err) {
                            node.error(`MQTT publish error(${source}): ${err.message}`);
                        }
                        // Update database
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
                            else {
                                valueType = "string";
                                columnName = "string_value";
                                sqlValue = `'${String(changedValue).replace(/'/g, "''")}'`; // Escape single quotes
                            }
                            const query = `
                        INSERT INTO tabiot_device_telemetry
                        (device_id, timestamp, key_name, value_type, ${columnName})
                        VALUES (?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE ${columnName} = ?`;
                            try {
                                yield mysqlClient.query(query, [
                                    deviceId,
                                    Math.floor(timestamp / 1000),
                                    key,
                                    valueType,
                                    sqlValue,
                                    sqlValue,
                                ]);
                            }
                            catch (err) {
                                node.error(`Failed to update DB for key ${key}: ${err.message}`);
                            }
                        }
                        // Update centralized state
                        Object.assign(previousState, currentState);
                        nodeContext.set('previousState', previousState);
                        node.send({ payload: republishPayload });
                        node.status({ fill: "green", shape: "dot", text: `${source}: Data changed` });
                    }
                    else {
                        node.status({ fill: "yellow", shape: "ring", text: `${source}: No change` });
                    }
                });
            }
            function pollCoils() {
                return __awaiter(this, void 0, void 0, function* () {
                    if (isPollingCoils || isPollingPaused || isConfigUpdating)
                        return;
                    if (consecutiveCoilFailures >= MAX_CONSECUTIVE_FAILURES) {
                        node.warn(`Coil polling suspended due to ${consecutiveCoilFailures} failures. Retrying in ${POLLING_BACKOFF_TIME / 1000}s`);
                        setTimeout(() => {
                            consecutiveCoilFailures = 0;
                            isPollingCoils = false;
                        }, POLLING_BACKOFF_TIME);
                        return;
                    }
                    isPollingCoils = true;
                    const maxRetries = 3;
                    let retryCount = 0;
                    try {
                        while (retryCount < maxRetries) {
                            try {
                                const result = yield modbusClient.readCoils(coilStartAddress, coilQuantity);
                                const currentState = {};
                                result.data.forEach((value, index) => {
                                    const key = Object.keys(modbusCoils).find((k) => modbusCoils[k] === index + coilStartAddress);
                                    if (key)
                                        currentState[key] = value;
                                    if (key === "main_pump") {
                                        nodeContext.set('mainPumpState', value);
                                    }
                                });
                                node.context().global.set("coilRegisterData", currentState);
                                yield processState(currentState, "Coils");
                                consecutiveCoilFailures = 0;
                                break;
                            }
                            catch (error) {
                                retryCount++;
                                node.error(`Coil polling error (attempt ${retryCount}/${maxRetries}): ${error.message}`);
                                if (retryCount === maxRetries) {
                                    consecutiveCoilFailures++;
                                    node.warn(`Consecutive coil failures: ${consecutiveCoilFailures}/${MAX_CONSECUTIVE_FAILURES}`);
                                    throw error;
                                }
                                yield new Promise((resolve) => setTimeout(resolve, 1000));
                            }
                        }
                    }
                    catch (_a) {
                        // Error handled in retry loop
                    }
                    finally {
                        isPollingCoils = false;
                        if (isConfigUpdating) {
                            nodeContext.set('previousState', {});
                            isConfigUpdating = false;
                        }
                    }
                });
            }
            function pollInputRegisters() {
                return __awaiter(this, void 0, void 0, function* () {
                    if (isPollingInputs || isPollingPaused || isConfigUpdating)
                        return;
                    if (consecutiveInputFailures >= MAX_CONSECUTIVE_FAILURES) {
                        node.warn(`Input polling suspended due to ${consecutiveInputFailures} failures. Retrying in ${POLLING_BACKOFF_TIME / 1000}s`);
                        setTimeout(() => {
                            consecutiveInputFailures = 0;
                            isPollingInputs = false;
                        }, POLLING_BACKOFF_TIME);
                        return;
                    }
                    isPollingInputs = true;
                    const maxRetries = 3;
                    let retryCount = 0;
                    try {
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
                                yield processState(currentState, "Input Registers");
                                consecutiveInputFailures = 0;
                                break;
                            }
                            catch (error) {
                                retryCount++;
                                node.error(`Input polling error (attempt ${retryCount}/${maxRetries}): ${error.message}`);
                                if (retryCount === maxRetries) {
                                    consecutiveInputFailures++;
                                    node.warn(`Consecutive input failures: ${consecutiveInputFailures}/${MAX_CONSECUTIVE_FAILURES}`);
                                    throw error;
                                }
                                yield new Promise((resolve) => setTimeout(resolve, 1000));
                            }
                        }
                    }
                    catch (_a) {
                        // Error handled in retry loop
                    }
                    finally {
                        isPollingInputs = false;
                        if (isConfigUpdating) {
                            nodeContext.set('previousState', {});
                            isConfigUpdating = false;
                        }
                    }
                });
            }
            function pollHoldingRegisters() {
                return __awaiter(this, void 0, void 0, function* () {
                    if (isPollingHoldings || isPollingPaused || isConfigUpdating)
                        return;
                    if (consecutiveHoldingFailures >= MAX_CONSECUTIVE_FAILURES) {
                        node.warn(`Holding polling suspended due to ${consecutiveHoldingFailures} failures. Retrying in ${POLLING_BACKOFF_TIME / 1000}s`);
                        setTimeout(() => {
                            consecutiveHoldingFailures = 0;
                            isPollingHoldings = false;
                        }, POLLING_BACKOFF_TIME);
                        return;
                    }
                    isPollingHoldings = true;
                    const maxRetries = 3;
                    let retryCount = 0;
                    try {
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
                                yield processState(currentState, "Holding Registers");
                                consecutiveHoldingFailures = 0;
                                break;
                            }
                            catch (error) {
                                retryCount++;
                                node.error(`Holding polling error (attempt ${retryCount}/${maxRetries}): ${error.message}`);
                                if (retryCount === maxRetries) {
                                    consecutiveHoldingFailures++;
                                    node.warn(`Consecutive holding failures: ${consecutiveHoldingFailures}/${MAX_CONSECUTIVE_FAILURES}`);
                                    throw error;
                                }
                                yield new Promise((resolve) => setTimeout(resolve, 1000));
                            }
                        }
                    }
                    catch (_a) {
                        // Error handled in retry loop
                    }
                    finally {
                        isPollingHoldings = false;
                        if (isConfigUpdating) {
                            nodeContext.set('previousState', {});
                            isConfigUpdating = false;
                        }
                    }
                });
            }
            // Listen for client status changes
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
                    node.status({ fill: "red", shape: "ring", text: "Modbus disconnected" });
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
                    node.warn("Local MQTT disconnected, polling paused");
                    node.status({ fill: "red", shape: "ring", text: "Local MQTT disconnected" });
                }
                else if (status.status === "connected" && isPollingPaused) {
                    resumePollingIfAllConnected();
                }
            });
            thingsboardClient.on("mqtt-status", (status) => {
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
                    node.warn("ThingsBoard MQTT disconnected, polling paused");
                    node.status({ fill: "red", shape: "ring", text: "ThingsBoard MQTT disconnected" });
                }
                else if (status.status === "connected" && isPollingPaused) {
                    resumePollingIfAllConnected();
                }
            });
            function resumePollingIfAllConnected() {
                if (modbusClient.isConnectedCheck() && localClient.isConnected() && thingsboardClient.isConnected()) {
                    consecutiveCoilFailures = 0;
                    consecutiveInputFailures = 0;
                    consecutiveHoldingFailures = 0;
                    isPollingCoils = false;
                    isPollingInputs = false;
                    isPollingHoldings = false;
                    isPollingPaused = false;
                    if (coilInterval)
                        clearInterval(coilInterval);
                    if (inputInterval)
                        clearInterval(inputInterval);
                    if (holdingInterval)
                        clearInterval(holdingInterval);
                    coilInterval = setInterval(pollCoils, pollIntervalCoil);
                    inputInterval = setInterval(pollInputRegisters, pollIntervalInput);
                    holdingInterval = setInterval(pollHoldingRegisters, pollIntervalHolding);
                    node.status({ fill: "green", shape: "dot", text: "All clients connected, polling resumed" });
                }
            }
            // Start polling if all clients are connected
            if (modbusClient.isConnectedCheck() && localClient.isConnected() && thingsboardClient.isConnected()) {
                coilInterval = setInterval(pollCoils, pollIntervalCoil);
                inputInterval = setInterval(pollInputRegisters, pollIntervalInput);
                holdingInterval = setInterval(pollHoldingRegisters, pollIntervalHolding);
                node.status({ fill: "green", shape: "dot", text: "Polling started" });
            }
            else {
                node.status({ fill: "red", shape: "ring", text: "Waiting for all clients to connect" });
                isPollingPaused = true;
            }
            // Handle configuration updates
            node.on("input", (msg) => {
                if (msg.scaleConfigs) {
                    try {
                        isConfigUpdating = true;
                        scaleConfigs = JSON.parse(JSON.stringify(msg.scaleConfigs));
                        scaleConfigs.forEach((conf) => {
                            if (!conf.key || !conf.operation || typeof conf.factor !== "number" || !["read", "write"].includes(conf.direction)) {
                                throw new Error(`Invalid scale config: ${JSON.stringify(conf)}`);
                            }
                        });
                        node.warn("Scale configs updated, resetting state");
                    }
                    catch (error) {
                        node.error(`Failed to update scaleConfigs: ${error.message}`);
                        isConfigUpdating = false;
                    }
                }
            });
            node.on("close", () => __awaiter(this, void 0, void 0, function* () {
                if (coilInterval)
                    clearInterval(coilInterval);
                if (inputInterval)
                    clearInterval(inputInterval);
                if (holdingInterval)
                    clearInterval(holdingInterval);
                client_registry_1.default.releaseClient("modbus", node);
                client_registry_1.default.releaseClient("local", node);
                client_registry_1.default.releaseClient("mysql", node);
                yield thingsboardClient.disconnect();
            }));
        });
    }
    RED.nodes.registerType("viis-telemetry", ViisTelemetryNode);
};
