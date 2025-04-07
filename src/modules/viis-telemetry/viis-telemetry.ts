import { NodeAPI, NodeDef, Node } from "node-red";
import { ModbusData } from "../../core/modbus-client";
import ClientRegistry from "../../core/client-registry";
import { MySqlConfig } from "../../core/mysql-client";
import { MqttConfig, MqttClientCore } from "../../core/mqtt-client";

interface ViisTelemetryNodeDef extends NodeDef {
    pollIntervalCoil: string;
    pollIntervalInput: string;
    pollIntervalHolding: string;
    coilStartAddress: string;
    coilQuantity: string;
    inputStartAddress: string;
    inputQuantity: string;
    holdingStartAddress: string;
    holdingQuantity: string;
    scaleConfigs: string;
}

interface TelemetryData {
    [key: string]: number | boolean | string;
}

interface ScaleConfig {
    key: string;
    operation: "multiply" | "divide";
    factor: number;
    direction: "read" | "write";
}

module.exports = function (RED: NodeAPI) {
    async function ViisTelemetryNode(this: Node, config: ViisTelemetryNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Cấu hình Modbus
        const modbusConfig = {
            type: (process.env.MODBUS_TYPE as "TCP" | "RTU") || "TCP",
            host: process.env.MODBUS_HOST || "localhost",
            tcpPort: parseInt(process.env.MODBUS_TCP_PORT || "1502", 10),
            serialPort: process.env.MODBUS_SERIAL_PORT || "/dev/ttyUSB0",
            baudRate: parseInt(process.env.MODBUS_BAUD_RATE || "9600", 10),
            parity: (process.env.MODBUS_PARITY as "none" | "even" | "odd") || "none",
            unitId: parseInt(process.env.MODBUS_UNIT_ID || "1", 10),
            timeout: parseInt(process.env.MODBUS_TIMEOUT || "5000", 10),
            reconnectInterval: parseInt(process.env.MODBUS_RECONNECT_INTERVAL || "5000", 10),
        };

        const deviceId = process.env.DEVICE_ID || "unknown";
        const modbusCoils = JSON.parse(process.env.MODBUS_COILS || "{}") as { [key: string]: number };
        const modbusInputRegisters = JSON.parse(process.env.MODBUS_INPUT_REGISTERS || "{}") as { [key: string]: number };
        const modbusHoldingRegisters = JSON.parse(process.env.MODBUS_HOLDING_REGISTERS || "{}") as { [key: string]: number };

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
            qos: 1 as const,
        };

        // Cấu hình cho ThingsBoard MQTT broker
        const thingsboardMqttConfig: MqttConfig = {
            broker: `mqtt://${process.env.THINGSBOARD_HOST || "mqtt.viis.tech"}:${process.env.THINGSBOARD_PORT || "1883"}`,
            clientId: `node-red-thingsboard-telemetry-${Math.random().toString(16).substr(2, 8)}`,
            username: process.env.DEVICE_ACCESS_TOKEN || "",
            password: process.env.THINGSBOARD_PASSWORD || "",
            qos: 1 as const,
        };

        const mysqlConfig: MySqlConfig = {
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

        let scaleConfigs: ScaleConfig[] = [];
        try {
            scaleConfigs = JSON.parse(config.scaleConfigs || "[]") as ScaleConfig[];
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
        } catch (error) {
            node.error(`Failed to parse scaleConfigs: ${(error as Error).message}`);
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
        const modbusClient = ClientRegistry.getModbusClient(modbusConfig, node);
        const localClient = await ClientRegistry.getLocalMqttClient(localMqttConfig, node);
        const mysqlClient = ClientRegistry.getMySqlClient(mysqlConfig, node);
        const thingsboardClient = await ClientRegistry.getThingsboardMqttClient(thingsboardMqttConfig, node);

        if (!modbusClient || !localClient || !mysqlClient || !thingsboardClient) {
            node.error("Failed to retrieve clients from registry");
            node.status({ fill: "red", shape: "ring", text: "Client initialization failed" });
            return;
        } else {
            console.log("All clients initialized successfully: Modbus, Local MQTT, MySQL, ThingsBoard MQTT");
        }

        let previousStateCoils: TelemetryData = {};
        let previousStateInput: TelemetryData = {};
        let previousStateHolding: TelemetryData = {};
        const CHANGE_THRESHOLD = 0.1;
        let isPollingPaused = false;
        let coilInterval: NodeJS.Timeout | null = null;
        let inputInterval: NodeJS.Timeout | null = null;
        let holdingInterval: NodeJS.Timeout | null = null;

        function applyScaling(key: string, value: number, direction: "read" | "write"): number {
            const scaleConfig = scaleConfigs.find((config) => config.key === key && config.direction === direction);
            if (!scaleConfig) return value;
            const scaledValue = scaleConfig.operation === "multiply" ? value * scaleConfig.factor : value / scaleConfig.factor;
            node.warn(`Scaling applied - key: ${key}, original: ${value}, scaled: ${scaledValue}, direction: ${direction}`);
            return scaledValue;
        }

        function getChangedKeys(current: TelemetryData, previous: TelemetryData): TelemetryData {
            const changed: TelemetryData = {};
            for (const key in current) {
                const currVal = current[key];
                const prevVal = previous[key];
                console.log(`Comparing key: ${key}, current: ${currVal}, previous: ${prevVal}`);
                if (prevVal === undefined) {
                    // Nếu giá trị trước đó không tồn tại, coi là thay đổi
                    changed[key] = currVal;
                    console.log(`Key changed: ${key}, old: undefined, new: ${currVal} (No previous value)`);
                } else if (typeof currVal === "number" && typeof prevVal === "number") {
                    // Đối với số, chỉ coi là thay đổi nếu vượt qua CHANGE_THRESHOLD
                    if (Math.abs(currVal - prevVal) >= CHANGE_THRESHOLD) {
                        changed[key] = currVal;
                        console.log(`Key changed: ${key}, old: ${prevVal}, new: ${currVal} (Threshold: ${CHANGE_THRESHOLD})`);
                    } else {
                        console.log(`Key unchanged: ${key}, old: ${prevVal}, new: ${currVal} (Difference ${Math.abs(currVal - prevVal)} < Threshold: ${CHANGE_THRESHOLD})`);
                    }
                } else if (currVal !== prevVal) {
                    // Đối với các kiểu dữ liệu khác (boolean, string, ...), kiểm tra !==
                    changed[key] = currVal;
                    console.log(`Key changed: ${key}, old: ${prevVal}, new: ${currVal} (Non-numeric change)`);
                } else {
                    console.log(`Key unchanged: ${key}, old: ${prevVal}, new: ${currVal} (No significant change)`);
                }
            }
            return changed;
        }

        async function processState(currentState: TelemetryData, source: string) {
            let previousStateForSource: TelemetryData =
                source === "Coils" ? previousStateCoils :
                    source === "Input Registers" ? previousStateInput :
                        source === "Holding Registers" ? previousStateHolding :
                            previousStateInput; // Trường hợp hợp nhất polling
            const changedKeys = getChangedKeys(currentState, previousStateForSource);
            //debug for input registers
            if (source === "Input Registers") {
                node.warn(`Current State Input Registers: ${JSON.stringify(currentState)}`);
                node.warn(`Previous State Input Registers: ${JSON.stringify(previousStateForSource)}`);
                node.warn(`Changed Keys Input Registers: ${JSON.stringify(changedKeys)}`);
            }
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
                await localClient.publish(localConfig.pubSubTopic, JSON.stringify(republishPayload));
                console.log(`${source}: Published changed data to Local MQTT`, republishPayload);

                // Publish lên ThingsBoard
                await thingsboardClient.publish("v1/devices/me/telemetry", JSON.stringify(mqttPayload));
                console.log(`${source}: Published changed data to ThingsBoard MQTT`, mqttPayload);

                // Lưu vào database
                for (const [key, changedValue] of Object.entries(changedKeys)) {
                    let valueType: string, columnName: string, sqlValue: number | boolean | string = changedValue;
                    if (typeof changedValue === "boolean") {
                        valueType = "boolean";
                        sqlValue = changedValue ? 1 : 0;
                        columnName = "boolean_value";
                    } else if (typeof changedValue === "number") {
                        valueType = Number.isInteger(changedValue) ? "int" : "float";
                        columnName = valueType === "int" ? "int_value" : "float_value";
                    } else if (typeof changedValue === "string") {
                        try {
                            JSON.parse(changedValue);
                            valueType = "json";
                            columnName = "json_value";
                        } catch (e) {
                            valueType = "string";
                            columnName = "string_value";
                        }
                        sqlValue = `'${changedValue}'`;
                    } else {
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
                        await mysqlClient.query(query);
                        node.log(`Database updated for key ${key}`);
                    } catch (err: any) {
                        node.error(`Failed to update DB for key ${key}: ${err.message}`);
                    }
                }

                // Chỉ cập nhật previousState khi có thay đổi
                if (source === "Coils") {
                    previousStateCoils = { ...currentState };
                    node.log(`Updated previousStateCoils with new values`);
                } else if (source === "Input Registers") {
                    previousStateInput = { ...currentState };
                    node.log(`Updated previousStateInput with new values`);
                } else if (source === "Holding Registers") {
                    previousStateHolding = { ...currentState };
                    node.log(`Updated previousStateHolding with new values`);
                } else if (source === "All Registers") {
                    previousStateInput = { ...currentState }; // Trường hợp hợp nhất polling
                    node.log(`Updated previousStateInput with new values (All Registers)`);
                }

                node.send({ payload: republishPayload });
                node.status({ fill: "green", shape: "dot", text: `${source}: Data changed` });
            } else {
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
        }

        async function pollCoils() {
            const maxRetries = 3;
            let retryCount = 0;
            while (retryCount < maxRetries) {
                try {
                    const result: ModbusData = await modbusClient.readCoils(coilStartAddress, coilQuantity); const currentState: TelemetryData = {};
                    (result.data as boolean[]).forEach((value, index) => {
                        const key = Object.keys(modbusCoils).find((k) => modbusCoils[k] === index + coilStartAddress);
                        if (key) currentState[key] = value;
                    });
                    node.context().global.set("coilRegisterData", currentState);
                    await processState(currentState, "Coils");
                    break;
                } catch (error) {
                    retryCount++;
                    const err = error as Error;
                    node.error(`Coil polling error (attempt ${retryCount}/${maxRetries}): ${err.message}`);
                    if (retryCount === maxRetries) {
                        node.send({ payload: `Coil polling failed after ${maxRetries} attempts: ${err.message}` });
                    } else {
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                    }
                }
            }
        }

        async function pollInputRegisters() {
            const maxRetries = 3;
            let retryCount = 0;
            while (retryCount < maxRetries) {
                try {
                    const result: ModbusData = await modbusClient.readInputRegisters(inputStartAddress, inputQuantity);
                    const currentState: TelemetryData = {};
                    (result.data as number[]).forEach((value, index) => {
                        const key = Object.keys(modbusInputRegisters).find((k) => modbusInputRegisters[k] === index + inputStartAddress);
                        if (key) currentState[key] = applyScaling(key, value, "read");
                    });
                    node.context().global.set("inputRegisterData", currentState);
                    console.log("Input Register Data:", currentState);
                    await processState(currentState, "Input Registers");
                    break;
                } catch (error) {
                    retryCount++;
                    const err = error as Error;
                    node.error(`Input polling error (attempt ${retryCount}/${maxRetries}): ${err.message}`);
                    if (retryCount === maxRetries) {
                        node.send({ payload: `Input polling failed after ${maxRetries} attempts: ${err.message}` });
                    } else {
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                    }
                }
            }
        }

        async function pollHoldingRegisters() {
            const maxRetries = 3;
            let retryCount = 0;
            while (retryCount < maxRetries) {
                try {
                    const result: ModbusData = await modbusClient.readHoldingRegisters(holdingStartAddress, holdingQuantity);
                    const currentState: TelemetryData = {};
                    (result.data as number[]).forEach((value, index) => {
                        const key = Object.keys(modbusHoldingRegisters).find((k) => modbusHoldingRegisters[k] === index + holdingStartAddress);
                        if (key) currentState[key] = applyScaling(key, value, "read");
                    });
                    node.context().global.set("holdingRegisterData", currentState);
                    await processState(currentState, "Holding Registers");
                    break;
                } catch (error) {
                    retryCount++;
                    const err = error as Error;
                    node.error(`Holding polling error (attempt ${retryCount}/${maxRetries}): ${err.message}`);
                    if (retryCount === maxRetries) {
                        node.send({ payload: `Holding polling failed after ${maxRetries} attempts: ${err.message}` });
                    } else {
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                    }
                }
            }
        }

        // Lắng nghe sự kiện trạng thái của modbus
        modbusClient.on("modbus-status", (status: { status: string; error?: string }) => {
            if (status.status === "disconnected" && !isPollingPaused) {
                isPollingPaused = true;
                if (coilInterval) clearInterval(coilInterval);
                if (inputInterval) clearInterval(inputInterval);
                if (holdingInterval) clearInterval(holdingInterval);
                coilInterval = null;
                inputInterval = null;
                holdingInterval = null;
                node.warn("Modbus disconnected, polling paused");
            } else if (status.status === "connected" && isPollingPaused) {
                resumePollingIfAllConnected();
            }
        });

        // Lắng nghe sự kiện trạng thái của local MQTT
        localClient.on("mqtt-status", (status: { status: string; error?: string }) => {
            if (status.status === "disconnected" && !isPollingPaused) {
                isPollingPaused = true;
                if (coilInterval) clearInterval(coilInterval);
                if (inputInterval) clearInterval(inputInterval);
                if (holdingInterval) clearInterval(holdingInterval);
                coilInterval = null;
                inputInterval = null;
                holdingInterval = null;
                node.warn("Local MQTT disconnected, polling paused");
            } else if (status.status === "connected" && isPollingPaused && modbusClient.isConnectedCheck() && localClient.isConnected() && thingsboardClient.isConnected()) {
                resumePollingIfAllConnected();
            }
        });

        // Lắng nghe sự kiện trạng thái của ThingsBoard MQTT
        thingsboardClient.on("mqtt-status", (status: { status: string; error?: string }) => {
            if (status.status === "disconnected" && !isPollingPaused) {
                isPollingPaused = true;
                if (coilInterval) clearInterval(coilInterval);
                if (inputInterval) clearInterval(inputInterval);
                if (holdingInterval) clearInterval(holdingInterval);
                coilInterval = null;
                inputInterval = null;
                holdingInterval = null;
                node.warn("ThingsBoard MQTT disconnected, polling paused");
            } else if (status.status === "connected" && isPollingPaused && modbusClient.isConnectedCheck() && localClient.isConnected() && thingsboardClient.isConnected()) {
                resumePollingIfAllConnected();
            }
        });

        function resumePollingIfAllConnected() {
            if (modbusClient.isConnectedCheck() && localClient.isConnected() && thingsboardClient.isConnected()) {
                isPollingPaused = false;
                coilInterval = setInterval(pollCoils, pollIntervalCoil);
                inputInterval = setInterval(pollInputRegisters, pollIntervalInput);
                holdingInterval = setInterval(pollHoldingRegisters, pollIntervalHolding);
                console.log("All clients connected, polling resumed");
            }
        }

        // Khởi động polling nếu tất cả client đã kết nối
        if (modbusClient.isConnectedCheck() && localClient.isConnected() && thingsboardClient.isConnected()) {
            coilInterval = setInterval(pollCoils, pollIntervalCoil);
            inputInterval = setInterval(pollInputRegisters, pollIntervalInput);
            holdingInterval = setInterval(pollHoldingRegisters, pollIntervalHolding);
        } else {
            node.status({ fill: "red", shape: "ring", text: "Waiting for all clients to connect" });
            isPollingPaused = true;
        }

        node.on("close", () => {
            if (coilInterval) clearInterval(coilInterval);
            if (inputInterval) clearInterval(inputInterval);
            if (holdingInterval) clearInterval(holdingInterval);
            ClientRegistry.releaseClient("modbus", node);
            ClientRegistry.releaseClient("local", node);
            ClientRegistry.releaseClient("mysql", node);
            thingsboardClient.disconnect();
            console.log("Node closed, resources released");
        });
    }

    RED.nodes.registerType("viis-telemetry", ViisTelemetryNode);
};