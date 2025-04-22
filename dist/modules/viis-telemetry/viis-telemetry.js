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
const viis_telemetry_utils_1 = require("./viis-telemetry-utils");
module.exports = function (RED) {
    function ViisTelemetryNode(config) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e;
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
            // FLOW CONTEXT SCALE CONFIG
            const flowContext = this.context().flow;
            const SCALE_CONFIG_KEY = `scaleConfigs_${this.id}`;
            const DEBUG_LOG_KEY = `enableDebugLog_${this.id}`;
            const THRESHOLD_CONFIG_KEY = `thresholdConfig_${this.id}`;
            let initialScaleConfigs = [];
            try {
                initialScaleConfigs = config.scaleConfigs ? JSON.parse(config.scaleConfigs) : [];
                if (!Array.isArray(initialScaleConfigs))
                    initialScaleConfigs = [];
            }
            catch (_f) {
                initialScaleConfigs = [];
            }
            flowContext.set(SCALE_CONFIG_KEY, initialScaleConfigs);
            // --- Store enableDebugLog in flow context (like scale config) ---
            const initialEnableDebugLog = (_a = config.enableDebugLog) !== null && _a !== void 0 ? _a : false;
            flowContext.set(DEBUG_LOG_KEY, initialEnableDebugLog);
            let enableDebugLog = (_b = flowContext.get(DEBUG_LOG_KEY)) !== null && _b !== void 0 ? _b : false;
            node.warn(`Debug log is ${enableDebugLog ? 'enabled' : 'disabled'} (from flow context)`);
            // --- Store thresholdConfig in flow context (like scale config) ---
            let initialThresholdConfig = {};
            try {
                initialThresholdConfig = config.thresholdConfig ? JSON.parse(config.thresholdConfig) : {};
                if (typeof initialThresholdConfig !== 'object' || Array.isArray(initialThresholdConfig))
                    initialThresholdConfig = {};
            }
            catch (_g) {
                initialThresholdConfig = {};
            }
            flowContext.set(THRESHOLD_CONFIG_KEY, initialThresholdConfig);
            // --- Cấu hình periodic snapshot interval riêng cho từng loại ---
            const periodicSnapshotIntervalCoil = parseInt((_c = config.periodicSnapshotIntervalCoil) !== null && _c !== void 0 ? _c : '0', 10);
            const periodicSnapshotIntervalInput = parseInt((_d = config.periodicSnapshotIntervalInput) !== null && _d !== void 0 ? _d : '0', 10);
            const periodicSnapshotIntervalHolding = parseInt((_e = config.periodicSnapshotIntervalHolding) !== null && _e !== void 0 ? _e : '0', 10);
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
            nodeContext.set('previousState', {});
            nodeContext.set('lastSent', 0);
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
            // --- Publish telemetry sử dụng hàm đã test ---
            function processState(currentState, source) {
                return __awaiter(this, void 0, void 0, function* () {
                    var _a, _b, _c, _d;
                    const previousState = nodeContext.get('previousState') || {};
                    // Get thresholdConfig from flow context
                    const thresholdConfig = flowContext.get(THRESHOLD_CONFIG_KEY) || {};
                    const changedKeys = (0, viis_telemetry_utils_1.getChangedKeys)(currentState, previousState, thresholdConfig);
                    const now = Date.now();
                    let lastSent = (_a = nodeContext.get('lastSent')) !== null && _a !== void 0 ? _a : 0;
                    // Chọn interval phù hợp theo loại source
                    let periodicSnapshotInterval = 0;
                    if (source === 'Coils')
                        periodicSnapshotInterval = periodicSnapshotIntervalCoil;
                    else if (source === 'Input Registers')
                        periodicSnapshotInterval = periodicSnapshotIntervalInput;
                    else if (source === 'Holding Registers')
                        periodicSnapshotInterval = periodicSnapshotIntervalHolding;
                    if (Object.keys(changedKeys).length > 0) {
                        (0, viis_telemetry_utils_1.publishTelemetry)({
                            data: changedKeys,
                            emqxClient: localClient,
                            thingsboardClient: thingsboardClient,
                            emqxTopic: localConfig.pubSubTopic,
                            thingsboardTopic: 'v1/devices/me/telemetry'
                        });
                        nodeContext.set('lastSent', now);
                        (0, viis_telemetry_utils_1.debugLog)({ enable: (_b = flowContext.get(DEBUG_LOG_KEY)) !== null && _b !== void 0 ? _b : false, node, message: `[${source}] Published telemetry (threshold) ${JSON.stringify(thresholdConfig)}: ${JSON.stringify(changedKeys)}` });
                    }
                    else if (periodicSnapshotInterval > 0 && now - lastSent >= periodicSnapshotInterval) {
                        (0, viis_telemetry_utils_1.publishTelemetry)({
                            data: currentState,
                            emqxClient: localClient,
                            thingsboardClient: thingsboardClient,
                            emqxTopic: localConfig.pubSubTopic,
                            thingsboardTopic: 'v1/devices/me/telemetry'
                        });
                        nodeContext.set('lastSent', now);
                        (0, viis_telemetry_utils_1.debugLog)({ enable: (_c = flowContext.get(DEBUG_LOG_KEY)) !== null && _c !== void 0 ? _c : false, node, message: `[${source}] Published telemetry (periodic): ${JSON.stringify(currentState)}` });
                    }
                    else {
                        (0, viis_telemetry_utils_1.debugLog)({ enable: (_d = flowContext.get(DEBUG_LOG_KEY)) !== null && _d !== void 0 ? _d : false, node, message: `[${source}] No telemetry sent (no change, not timer)` });
                    }
                    Object.assign(previousState, currentState);
                    nodeContext.set('previousState', previousState);
                    node.send({ payload: currentState });
                    node.status({ fill: 'green', shape: 'dot', text: `${source}: Data checked` });
                });
            }
            // --- Apply scaling cho từng key khi đọc modbus ---
            function scaleTelemetry(keys, values, direction, flowContext, scaleConfigKey) {
                var _a;
                const result = {};
                const scaleConfigs = flowContext.get(scaleConfigKey) || [];
                keys.forEach((key, idx) => {
                    result[key] = (0, viis_telemetry_utils_1.applyScaling)(key, values[idx], direction, scaleConfigs);
                });
                // node.warn(`debug result: ${JSON.stringify(result)}`);
                (0, viis_telemetry_utils_1.debugLog)({ enable: (_a = flowContext.get(DEBUG_LOG_KEY)) !== null && _a !== void 0 ? _a : false, node, message: `[Scale] Applied scaling: ${JSON.stringify(result)}, scale config: ${JSON.stringify(scaleConfigs)}` });
                return result;
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
                    var _a, _b;
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
                                node.warn(`debug poling input registers: ${JSON.stringify(result)}`);
                                const keys = Object.keys(modbusInputRegisters);
                                const values = result.data;
                                const scaleCfg = flowContext.get(SCALE_CONFIG_KEY) || [];
                                (0, viis_telemetry_utils_1.debugLog)({
                                    enable: (_a = flowContext.get(DEBUG_LOG_KEY)) !== null && _a !== void 0 ? _a : false,
                                    node,
                                    message: `[InputRegisters][DEBUG] keys: ${JSON.stringify(keys)}, values: ${JSON.stringify(values)}, scaleConfigs: ${JSON.stringify(scaleCfg)}`
                                });
                                const currentState = scaleTelemetry(keys, values, 'read', flowContext, SCALE_CONFIG_KEY);
                                (0, viis_telemetry_utils_1.debugLog)({
                                    enable: (_b = flowContext.get(DEBUG_LOG_KEY)) !== null && _b !== void 0 ? _b : false,
                                    node,
                                    message: `[InputRegisters][DEBUG] scaled currentState: ${JSON.stringify(currentState)}`
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
                    catch (_c) {
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
                                const keys = Object.keys(modbusHoldingRegisters);
                                const values = result.data;
                                const currentState = scaleTelemetry(keys, values, 'read', flowContext, SCALE_CONFIG_KEY);
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
            // --- Helper để clear toàn bộ polling interval và reset state ---
            function clearPollingAndState() {
                if (coilInterval)
                    clearInterval(coilInterval);
                if (inputInterval)
                    clearInterval(inputInterval);
                if (holdingInterval)
                    clearInterval(holdingInterval);
                coilInterval = null;
                inputInterval = null;
                holdingInterval = null;
                nodeContext.set('previousState', {});
                nodeContext.set('lastSent', 0);
                // Nếu có publishCache hoặc các biến global khác, cũng phải clear
                for (const key in publishCache)
                    delete publishCache[key];
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
            // --- Ép buộc replace scaleConfigs, không bao giờ append ---
            node.on('input', (msg) => {
                var _a, _b;
                if (msg.scaleConfigs) {
                    try {
                        let newConfigs = Array.isArray(msg.scaleConfigs) ? msg.scaleConfigs : JSON.parse(msg.scaleConfigs);
                        if (!Array.isArray(newConfigs))
                            newConfigs = [];
                        flowContext.set(SCALE_CONFIG_KEY, newConfigs);
                        (0, viis_telemetry_utils_1.debugLog)({ enable: (_a = flowContext.get(DEBUG_LOG_KEY)) !== null && _a !== void 0 ? _a : false, node, message: '[Config] Scale configs replaced (no append): ' + JSON.stringify(newConfigs) });
                    }
                    catch (error) {
                        node.error(`Failed to update scaleConfigs: ${error.message}`);
                    }
                    resumePollingIfAllConnected();
                }
                // Allow dynamic update of enableDebugLog via msg.enableDebugLog
                if (typeof msg.enableDebugLog === 'boolean') {
                    flowContext.set(DEBUG_LOG_KEY, msg.enableDebugLog);
                    enableDebugLog = msg.enableDebugLog;
                    node.warn(`Debug log is ${enableDebugLog ? 'enabled' : 'disabled'} (updated via msg)`);
                }
                // Allow dynamic update of thresholdConfig via msg.thresholdConfig
                if (msg.thresholdConfig) {
                    try {
                        let newThresholdConfig = typeof msg.thresholdConfig === 'object' ? msg.thresholdConfig : JSON.parse(msg.thresholdConfig);
                        if (typeof newThresholdConfig !== 'object' || Array.isArray(newThresholdConfig))
                            newThresholdConfig = {};
                        flowContext.set(THRESHOLD_CONFIG_KEY, newThresholdConfig);
                        (0, viis_telemetry_utils_1.debugLog)({ enable: (_b = flowContext.get(DEBUG_LOG_KEY)) !== null && _b !== void 0 ? _b : false, node, message: '[Config] Threshold config replaced (no append): ' + JSON.stringify(newThresholdConfig) });
                    }
                    catch (error) {
                        node.error(`Failed to update thresholdConfig: ${error.message}`);
                    }
                    resumePollingIfAllConnected();
                }
            });
            // --- Cleanup triệt để khi node bị xoá ---
            node.on('close', () => __awaiter(this, void 0, void 0, function* () {
                var _a;
                clearPollingAndState();
                flowContext.set(SCALE_CONFIG_KEY, []);
                flowContext.set(DEBUG_LOG_KEY, false);
                flowContext.set(THRESHOLD_CONFIG_KEY, {});
                client_registry_1.default.releaseClient('modbus', node);
                client_registry_1.default.releaseClient('local', node);
                client_registry_1.default.releaseClient('mysql', node);
                yield thingsboardClient.disconnect();
                (0, viis_telemetry_utils_1.debugLog)({ enable: (_a = flowContext.get(DEBUG_LOG_KEY)) !== null && _a !== void 0 ? _a : false, node, message: '[Node] Closed and cleaned up.' });
            }));
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
        });
    }
    RED.nodes.registerType("viis-telemetry", ViisTelemetryNode);
};
