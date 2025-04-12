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
            const deviceId = process.env.DEVICE_ID || "unknown";
            const modbusCoils = JSON.parse(process.env.MODBUS_COILS || "{}");
            const modbusInputRegisters = JSON.parse(process.env.MODBUS_INPUT_REGISTERS || "{}");
            const modbusHoldingRegisters = JSON.parse(process.env.MODBUS_HOLDING_REGISTERS || "{}");
            // Cấu hình cho local MQTT broker
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
            // Cấu hình cho ThingsBoard MQTT broker
            const thingsboardMqttConfig = {
                broker: `mqtt://${process.env.THINGSBOARD_HOST || "mqtt.viis.tech"}:${process.env.THINGSBOARD_PORT || "1883"}`,
                clientId: `node-red-thingsboard-telemetry-${Math.random().toString(16).substr(2, 8)}`,
                username: process.env.DEVICE_ACCESS_TOKEN || "",
                password: process.env.THINGSBOARD_PASSWORD || "",
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
            // Đảm bảo polling interval không nhỏ hơn giá trị tối thiểu (500ms)
            const MIN_POLLING_INTERVAL = 500; // 500ms là giá trị tối thiểu an toàn
            let pollIntervalCoil = parseInt(config.pollIntervalCoil || "1000", 10);
            let pollIntervalInput = parseInt(config.pollIntervalInput || "1000", 10);
            let pollIntervalHolding = parseInt(config.pollIntervalHolding || "5000", 10);
            // Kiểm tra và điều chỉnh giá trị nếu cần
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
                // Kiểm tra xem có cấu hình cho current_ec không
                if (!scaleConfigs.some(conf => conf.key === "current_ec" && conf.direction === "read")) {
                    node.warn("No scaling config found for current_ec, adding default");
                    scaleConfigs.push({ key: "current_ec", operation: "divide", factor: 1000, direction: "read" });
                }
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
                node.warn(`Using default scaleConfigs: ${JSON.stringify(scaleConfigs)}`);
            }
            // Lấy các client với await
            const modbusClient = client_registry_1.default.getModbusClient(modbusConfig, node);
            const localClient = yield client_registry_1.default.getLocalMqttClient(localMqttConfig, node);
            const mysqlClient = client_registry_1.default.getMySqlClient(mysqlConfig, node);
            const thingsboardClient = yield client_registry_1.default.getThingsboardMqttClient(thingsboardMqttConfig, node);
            if (!modbusClient || !localClient || !mysqlClient || !thingsboardClient) {
                node.error("Failed to retrieve clients from registry");
                node.status({ fill: "red", shape: "ring", text: "Client initialization failed" });
                return;
            }
            else {
                console.log("All clients initialized successfully: Modbus, Local MQTT, MySQL, ThingsBoard MQTT");
            }
            // Khởi tạo context để lưu trữ trạng thái
            const nodeContext = this.context();
            // Khởi tạo các trạng thái trong context nếu chưa tồn tại
            if (!nodeContext.get('previousStateCoils')) {
                nodeContext.set('previousStateCoils', {});
            }
            if (!nodeContext.get('previousStateInput')) {
                nodeContext.set('previousStateInput', {});
            }
            if (!nodeContext.get('previousStateHolding')) {
                nodeContext.set('previousStateHolding', {});
            }
            if (!nodeContext.get('lastEcUpdate')) {
                nodeContext.set('lastEcUpdate', 0);
            }
            if (!nodeContext.get('mainPumpState')) {
                nodeContext.set('mainPumpState', false);
            }
            const CHANGE_THRESHOLD = 0.1;
            let isPollingPaused = false;
            let coilInterval = null;
            let inputInterval = null;
            let holdingInterval = null;
            // Flags để theo dõi trạng thái polling
            let isPollingCoils = false;
            let isPollingInputs = false;
            let isPollingHoldings = false;
            // Biến đếm số lần thất bại liên tiếp
            let consecutiveCoilFailures = 0;
            let consecutiveInputFailures = 0;
            let consecutiveHoldingFailures = 0;
            // Ngưỡng số lần thất bại liên tiếp trước khi tạm dừng polling
            const MAX_CONSECUTIVE_FAILURES = 5;
            // Thời gian tạm dừng polling sau khi đạt ngưỡng thất bại (ms)
            const POLLING_BACKOFF_TIME = 30000; // 30 giây
            function applyScaling(key, value, direction) {
                const scaleConfig = scaleConfigs.find((config) => config.key === key && config.direction === direction);
                if (!scaleConfig)
                    return value;
                const scaledValue = scaleConfig.operation === "multiply" ? value * scaleConfig.factor : value / scaleConfig.factor;
                // node.warn(`Scaling applied - key: ${key}, original: ${value}, scaled: ${scaledValue}, direction: ${direction}`);
                return scaledValue;
            }
            // Sửa đổi hàm getChangedKeys để xử lý logic đặc thù cho current_ec và sử dụng context
            function getChangedKeys(current, previous) {
                const changed = {};
                const now = Date.now();
                const mainPumpState = nodeContext.get('mainPumpState');
                let lastEcUpdate = nodeContext.get('lastEcUpdate');
                for (const key in current) {
                    const currVal = current[key];
                    const prevVal = previous[key];
                    if (key === "current_ec" && mainPumpState) {
                        // Khi main_pump bật, kiểm tra thời gian 5 giây
                        if (now - lastEcUpdate >= 5000) { // 5000ms = 5 giây
                            changed[key] = currVal;
                            lastEcUpdate = now; // Cập nhật thời gian cuối cùng
                            nodeContext.set('lastEcUpdate', lastEcUpdate); // Lưu vào context
                            console.log(`Key forced update: ${key}, value: ${currVal} (main_pump ON, 5s interval)`);
                        }
                    }
                    else {
                        // Logic kiểm tra ngưỡng như cũ cho các key khác hoặc khi main_pump tắt
                        if (prevVal === undefined) {
                            changed[key] = currVal;
                            console.log(`Key changed: ${key}, old: undefined, new: ${currVal} (No previous value)`);
                        }
                        else if (typeof currVal === "number" && typeof prevVal === "number") {
                            if (Math.abs(currVal - prevVal) >= CHANGE_THRESHOLD) {
                                changed[key] = currVal;
                                console.log(`Key changed: ${key}, old: ${prevVal}, new: ${currVal} (Threshold: ${CHANGE_THRESHOLD})`);
                            }
                            else {
                                console.log(`Key unchanged: ${key}, old: ${prevVal}, new: ${currVal} (Difference ${Math.abs(currVal - prevVal)} < Threshold: ${CHANGE_THRESHOLD})`);
                            }
                        }
                        else if (currVal !== prevVal) {
                            changed[key] = currVal;
                            console.log(`Key changed: ${key}, old: ${prevVal}, new: ${currVal} (Non-numeric change)`);
                        }
                        else {
                            console.log(`Key unchanged: ${key}, old: ${prevVal}, new: ${currVal} (No significant change)`);
                        }
                    }
                }
                return changed;
            }
            function processState(currentState, source) {
                return __awaiter(this, void 0, void 0, function* () {
                    // Lấy trạng thái trước đó từ context
                    let previousStateForSource;
                    if (source === "Coils") {
                        previousStateForSource = nodeContext.get('previousStateCoils');
                    }
                    else if (source === "Input Registers") {
                        previousStateForSource = nodeContext.get('previousStateInput');
                    }
                    else if (source === "Holding Registers") {
                        previousStateForSource = nodeContext.get('previousStateHolding');
                    }
                    else {
                        // Trường hợp hợp nhất polling
                        previousStateForSource = nodeContext.get('previousStateInput');
                    }
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
                        const mqttPayload = Object.entries(changedKeys).map(([key, value]) => ({
                            ts: timestamp,
                            [key]: value,
                        }));
                        // Publish lên local broker
                        yield localClient.publish(localConfig.pubSubTopic, JSON.stringify(republishPayload));
                        console.log(`${source}: Published changed data to Local MQTT`, republishPayload);
                        // Publish lên ThingsBoard
                        yield thingsboardClient.publish("v1/devices/me/telemetry", JSON.stringify(mqttPayload));
                        console.log(`${source}: Published changed data to ThingsBoard MQTT`, mqttPayload);
                        // Lưu vào database
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
                            const query = `
                        INSERT INTO tabiot_device_telemetry
                        (device_id, timestamp, key_name, value_type, ${columnName})
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
                        node.send({ payload: republishPayload });
                        node.status({ fill: "green", shape: "dot", text: `${source}: Data changed` });
                    }
                    else {
                        // node.send({
                        //     payload: {
                        //         message: `${source}: No significant change detected`,
                        //         currentState,
                        //         previousState: previousStateForSource,
                        //         threshold: CHANGE_THRESHOLD,
                        //     },
                        // });
                        node.status({ fill: "yellow", shape: "ring", text: `${source}: No change` });
                    }
                    // Cập nhật trạng thái trước đó vào context
                    if (source === "Coils") {
                        nodeContext.set('previousStateCoils', Object.assign({}, currentState));
                        // node.log(`Updated previousStateCoils with new values`);
                    }
                    else if (source === "Input Registers") {
                        nodeContext.set('previousStateInput', Object.assign({}, currentState));
                        // node.log(`Updated previousStateInput with new values`);
                    }
                    else if (source === "Holding Registers") {
                        nodeContext.set('previousStateHolding', Object.assign({}, currentState));
                        // node.log(`Updated previousStateHolding with new values`);
                    }
                    else if (source === "All Registers") {
                        nodeContext.set('previousStateInput', Object.assign({}, currentState)); // Trường hợp hợp nhất polling
                        // node.log(`Updated previousStateInput with new values (All Registers)`);
                    }
                });
            }
            // Cập nhật trạng thái main_pump từ pollCoils và lưu vào context
            function pollCoils() {
                return __awaiter(this, void 0, void 0, function* () {
                    // Nếu đang polling hoặc polling bị tạm dừng, bỏ qua
                    if (isPollingCoils || isPollingPaused) {
                        return;
                    }
                    // Kiểm tra nếu đã đạt ngưỡng thất bại liên tiếp
                    if (consecutiveCoilFailures >= MAX_CONSECUTIVE_FAILURES) {
                        node.warn(`Coil polling temporarily suspended due to ${consecutiveCoilFailures} consecutive failures. Will retry in ${POLLING_BACKOFF_TIME / 1000} seconds.`);
                        // Đặt lịch thử lại sau khoảng thời gian backoff
                        setTimeout(() => {
                            consecutiveCoilFailures = 0; // Reset counter
                            node.log("Resuming coil polling after backoff period");
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
                                    // Cập nhật trạng thái main_pump vào context
                                    if (key === "main_pump") {
                                        nodeContext.set('mainPumpState', value);
                                    }
                                });
                                node.context().global.set("coilRegisterData", currentState);
                                yield processState(currentState, "Coils");
                                // Reset counter khi thành công
                                consecutiveCoilFailures = 0;
                                break;
                            }
                            catch (error) {
                                retryCount++;
                                const err = error;
                                node.error(`Coil polling error (attempt ${retryCount}/${maxRetries}): ${err.message}`);
                                if (retryCount === maxRetries) {
                                    node.send({ payload: `Coil polling failed after ${maxRetries} attempts: ${err.message}` });
                                    // Tăng counter thất bại
                                    consecutiveCoilFailures++;
                                    node.warn(`Consecutive coil polling failures: ${consecutiveCoilFailures}/${MAX_CONSECUTIVE_FAILURES}`);
                                }
                                else {
                                    yield new Promise((resolve) => setTimeout(resolve, 1000));
                                }
                            }
                        }
                    }
                    finally {
                        // Đảm bảo flag luôn được reset, ngay cả khi có lỗi
                        isPollingCoils = false;
                    }
                });
            }
            // Sửa đổi pollInputRegisters để đảm bảo current_ec được xử lý đúng và xử lý polling đồng thời
            function pollInputRegisters() {
                return __awaiter(this, void 0, void 0, function* () {
                    // Nếu đang polling hoặc polling bị tạm dừng, bỏ qua
                    if (isPollingInputs || isPollingPaused) {
                        return;
                    }
                    // Kiểm tra nếu đã đạt ngưỡng thất bại liên tiếp
                    if (consecutiveInputFailures >= MAX_CONSECUTIVE_FAILURES) {
                        node.warn(`Input polling temporarily suspended due to ${consecutiveInputFailures} consecutive failures. Will retry in ${POLLING_BACKOFF_TIME / 1000} seconds.`);
                        // Đặt lịch thử lại sau khoảng thời gian backoff
                        setTimeout(() => {
                            consecutiveInputFailures = 0; // Reset counter
                            node.log("Resuming input polling after backoff period");
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
                                console.log("Input Register Data:", currentState);
                                yield processState(currentState, "Input Registers");
                                // Reset counter khi thành công
                                consecutiveInputFailures = 0;
                                break;
                            }
                            catch (error) {
                                retryCount++;
                                const err = error;
                                node.error(`Input polling error (attempt ${retryCount}/${maxRetries}): ${err.message}`);
                                if (retryCount === maxRetries) {
                                    node.send({ payload: `Input polling failed after ${maxRetries} attempts: ${err.message}` });
                                    // Tăng counter thất bại
                                    consecutiveInputFailures++;
                                    node.warn(`Consecutive input polling failures: ${consecutiveInputFailures}/${MAX_CONSECUTIVE_FAILURES}`);
                                }
                                else {
                                    yield new Promise((resolve) => setTimeout(resolve, 1000));
                                }
                            }
                        }
                    }
                    finally {
                        // Đảm bảo flag luôn được reset, ngay cả khi có lỗi
                        isPollingInputs = false;
                    }
                });
            }
            function pollHoldingRegisters() {
                return __awaiter(this, void 0, void 0, function* () {
                    // Nếu đang polling hoặc polling bị tạm dừng, bỏ qua
                    if (isPollingHoldings || isPollingPaused) {
                        return;
                    }
                    // Kiểm tra nếu đã đạt ngưỡng thất bại liên tiếp
                    if (consecutiveHoldingFailures >= MAX_CONSECUTIVE_FAILURES) {
                        node.warn(`Holding polling temporarily suspended due to ${consecutiveHoldingFailures} consecutive failures. Will retry in ${POLLING_BACKOFF_TIME / 1000} seconds.`);
                        // Đặt lịch thử lại sau khoảng thời gian backoff
                        setTimeout(() => {
                            consecutiveHoldingFailures = 0; // Reset counter
                            node.log("Resuming holding polling after backoff period");
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
                                // Reset counter khi thành công
                                consecutiveHoldingFailures = 0;
                                break;
                            }
                            catch (error) {
                                retryCount++;
                                const err = error;
                                node.error(`Holding polling error (attempt ${retryCount}/${maxRetries}): ${err.message}`);
                                if (retryCount === maxRetries) {
                                    node.send({ payload: `Holding polling failed after ${maxRetries} attempts: ${err.message}` });
                                    // Tăng counter thất bại
                                    consecutiveHoldingFailures++;
                                    node.warn(`Consecutive holding polling failures: ${consecutiveHoldingFailures}/${MAX_CONSECUTIVE_FAILURES}`);
                                }
                                else {
                                    yield new Promise((resolve) => setTimeout(resolve, 1000));
                                }
                            }
                        }
                    }
                    finally {
                        // Đảm bảo flag luôn được reset, ngay cả khi có lỗi
                        isPollingHoldings = false;
                    }
                });
            }
            // Lắng nghe sự kiện trạng thái của modbus
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
            // Lắng nghe sự kiện trạng thái của local MQTT
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
                }
                else if (status.status === "connected" && isPollingPaused && modbusClient.isConnectedCheck() && localClient.isConnected() && thingsboardClient.isConnected()) {
                    resumePollingIfAllConnected();
                }
            });
            // Lắng nghe sự kiện trạng thái của ThingsBoard MQTT
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
                }
                else if (status.status === "connected" && isPollingPaused && modbusClient.isConnectedCheck() && localClient.isConnected() && thingsboardClient.isConnected()) {
                    resumePollingIfAllConnected();
                }
            });
            function resumePollingIfAllConnected() {
                if (modbusClient.isConnectedCheck() && localClient.isConnected() && thingsboardClient.isConnected()) {
                    // Reset các biến đếm thất bại khi kết nối lại
                    consecutiveCoilFailures = 0;
                    consecutiveInputFailures = 0;
                    consecutiveHoldingFailures = 0;
                    // Reset các flag polling
                    isPollingCoils = false;
                    isPollingInputs = false;
                    isPollingHoldings = false;
                    // Bỏ tạm dừng polling
                    isPollingPaused = false;
                    // Xóa các interval cũ nếu có
                    if (coilInterval)
                        clearInterval(coilInterval);
                    if (inputInterval)
                        clearInterval(inputInterval);
                    if (holdingInterval)
                        clearInterval(holdingInterval);
                    // Thiết lập interval mới
                    coilInterval = setInterval(pollCoils, pollIntervalCoil);
                    inputInterval = setInterval(pollInputRegisters, pollIntervalInput);
                    holdingInterval = setInterval(pollHoldingRegisters, pollIntervalHolding);
                    node.status({ fill: "green", shape: "dot", text: "All clients connected, polling resumed" });
                    console.log("All clients connected, polling resumed");
                }
            }
            // Khởi động polling nếu tất cả client đã kết nối
            if (modbusClient.isConnectedCheck() && localClient.isConnected() && thingsboardClient.isConnected()) {
                // Reset các biến đếm thất bại
                consecutiveCoilFailures = 0;
                consecutiveInputFailures = 0;
                consecutiveHoldingFailures = 0;
                // Reset các flag polling
                isPollingCoils = false;
                isPollingInputs = false;
                isPollingHoldings = false;
                // Thiết lập interval
                coilInterval = setInterval(pollCoils, pollIntervalCoil);
                inputInterval = setInterval(pollInputRegisters, pollIntervalInput);
                holdingInterval = setInterval(pollHoldingRegisters, pollIntervalHolding);
                node.status({ fill: "green", shape: "dot", text: "Polling started" });
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
                thingsboardClient.disconnect();
                console.log("Node closed, resources released");
            });
        });
    }
    RED.nodes.registerType("viis-telemetry", ViisTelemetryNode);
};
