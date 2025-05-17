import { NodeAPI, NodeDef, Node } from "node-red";
import ClientRegistry from "../../core/client-registry";
import { ModbusData } from "../../core/modbus-client";
import { MqttConfig, MqttClientCore, MqttMessage } from "../../core/mqtt-client";

interface ViisRpcControlNodeDef extends NodeDef {
    mqttBroker: string;
    configKeys: string;
    scaleConfigs: string;
}

interface ScaleConfig {
    key: string;
    operation: "multiply" | "divide";
    factor: number;
    direction: "read" | "write";
}

interface ConfigKey {
    [key: string]: "number" | "boolean" | "string"; // Danh sách key và kiểu mong muốn
}

interface ConfigKeyValues {
    [key: string]: number | boolean | string; // Lưu giá trị thực tế từ RPC
}

interface RpcMessage {
    method?: string;
    params?: Record<string, any>;
    [key: string]: any;
}

interface ModbusMappingResult {
    address: number;
    fc: number;
    value: number | boolean;
}

module.exports = function (RED: NodeAPI) {
    async function ViisRpcControlNode(this: Node, config: ViisRpcControlNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;
        // Sử dụng flow context thay cho global context cho config đặc thù node
        const flowContext = node.context().flow;
        // Các key context riêng biệt, tránh xung đột
        const SCALE_CONFIG_KEY = `scaleConfigs_${node.id}`;
        const CONFIG_KEYS_KEY = `configKeys_${node.id}`;
        const CONFIG_VALUES_KEY = `configKeyValues_${node.id}`;
        const MANUAL_OVERRIDES_KEY = `manualModbusOverrides_${node.id}`;

        // Parse configurations (chuẩn hóa như viis-telemetry)
        let configKeys: ConfigKey = {};
        let scaleConfigs: ScaleConfig[] = [];
        try {
            configKeys = config.configKeys ? JSON.parse(config.configKeys) : {};
            if (typeof configKeys !== 'object' || Array.isArray(configKeys) || configKeys === null) configKeys = {};
        } catch {
            configKeys = {};
        }
        try {
            scaleConfigs = config.scaleConfigs ? JSON.parse(config.scaleConfigs) : [];
            if (!Array.isArray(scaleConfigs)) scaleConfigs = [];
        } catch {
            scaleConfigs = [];
        }
        // Validate configKeys
        Object.entries(configKeys).forEach(([key, type]) => {
            if (!['number', 'boolean', 'string'].includes(type)) {
                throw new Error(`Invalid type "${type}" for key "${key}"`);
            }
        });
        // Validate scaleConfigs
        scaleConfigs.forEach((conf) => {
            if (!conf.key || !conf.operation || typeof conf.factor !== "number" || !["read", "write"].includes(conf.direction)) {
                throw new Error(`Invalid scale config: ${JSON.stringify(conf)}`);
            }
        });
        // Store vào flow context
        flowContext.set(CONFIG_KEYS_KEY, configKeys);
        flowContext.set(SCALE_CONFIG_KEY, scaleConfigs);
        if (!flowContext.get(CONFIG_VALUES_KEY)) flowContext.set(CONFIG_VALUES_KEY, {});
        if (!flowContext.get(MANUAL_OVERRIDES_KEY)) flowContext.set(MANUAL_OVERRIDES_KEY, {});

        // Các hàm util lấy config từ flow context
        function getConfigKeys(): ConfigKey {
            return flowContext.get(CONFIG_KEYS_KEY) as ConfigKey || {};
        }
        function getScaleConfigs(): ScaleConfig[] {
            return flowContext.get(SCALE_CONFIG_KEY) as ScaleConfig[] || [];
        }
        function getConfigKeyValues(): ConfigKeyValues {
            return flowContext.get(CONFIG_VALUES_KEY) as ConfigKeyValues || {};
        }
        function setConfigKeyValues(values: ConfigKeyValues): void {
            flowContext.set(CONFIG_VALUES_KEY, values);
        }

        

        // Environment variables
        const deviceId = process.env.DEVICE_ID || "unknown";
        const modbusCoils = JSON.parse(process.env.MODBUS_COILS || "{}");
        const modbusInputRegisters = JSON.parse(process.env.MODBUS_INPUT_REGISTERS || "{}");
        const modbusHoldingRegisters = JSON.parse(process.env.MODBUS_HOLDING_REGISTERS || "{}");

        // Initialize clients
        const modbusConfig = {
            type: (process.env.MODBUS_TYPE as "TCP" | "RTU") || "TCP",
            host: process.env.MODBUS_HOST || "localhost",
            tcpPort: parseInt(process.env.MODBUS_TCP_PORT || "502", 10),
            serialPort: process.env.MODBUS_SERIAL_PORT || "/dev/ttyUSB0",
            baudRate: parseInt(process.env.MODBUS_BAUD_RATE || "9600", 10),
            parity: (process.env.MODBUS_PARITY as "none" | "even" | "odd") || "none",
            unitId: parseInt(process.env.MODBUS_UNIT_ID || "1", 10),
            timeout: parseInt(process.env.MODBUS_TIMEOUT || "5000", 10),
            reconnectInterval: parseInt(process.env.MODBUS_RECONNECT_INTERVAL || "5000", 10),
        };

        const mqttConfig: MqttConfig = config.mqttBroker === "thingsboard"
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
        const modbusClient = ClientRegistry.getModbusClient(modbusConfig, node);
        const mqttClient = config.mqttBroker === "thingsboard"
            ? await ClientRegistry.getThingsboardMqttClient(mqttConfig, node)
            : await ClientRegistry.getLocalMqttClient(mqttConfig, node);

        if (!modbusClient || !mqttClient) {
            node.error("Failed to initialize clients");
            node.status({ fill: "red", shape: "ring", text: "Client initialization failed" });
            return;
        }

        node.log(`MQTT client initialized and connected: ${mqttClient.isConnected()}`);

        // Utility functions
        function scaleValue(key: string, value: number, direction: "read" | "write"): number {
            const config = getScaleConfigs().find((c) => c.key === key && c.direction === direction);
            if (!config) return value;
            const shouldMultiply = config.operation === "multiply";
            const scaledValue = shouldMultiply ? value * config.factor : value / config.factor;
            //node.log(`Scaled ${key} (${direction}): ${value} -> ${scaledValue}`);
            return scaledValue;
        }

        function validateAndConvertValue(key: string, value: any): any {
            const expectedType = getConfigKeys()[key];
            if (!expectedType) return value;
            try {
                switch (expectedType) {
                    case "number":
                        const num = Number(value);
                        if (isNaN(num)) throw new Error(`Invalid number value for ${key}`);
                        return num;
                    case "boolean":
                        if (typeof value === "string") return value.toLowerCase() === "true";
                        return Boolean(value);
                    case "string":
                        return String(value);
                    default:
                        return value;
                }
            } catch (error) {
                throw new Error(`Value conversion failed for ${key}: ${(error as Error).message}`);
            }
        }

        function findModbusMapping(key: string): ModbusMappingResult | null {
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

        async function writeToModbus(key: string, mapping: ModbusMappingResult, value: number | boolean): Promise<void> {
            try {
                let writeValue = value;
                if (typeof value === "number") {
                    writeValue = scaleValue(key, value, "write");
                }
                if (mapping.fc === 6) {
                    await modbusClient.writeRegister(mapping.address, writeValue as number);
                } else if (mapping.fc === 5) {
                    await modbusClient.writeCoil(mapping.address, value as boolean);
                }
                //node.log(`Wrote to Modbus: key=${key}, address=${mapping.address}, value=${writeValue}, fc=${mapping.fc}`);
                // Lưu thông tin lệnh thủ công vào flow context (manual overrides)
                const manualOverrides = flowContext.get(MANUAL_OVERRIDES_KEY) as { [address: string]: { fc: number, value: any, timestamp: number } };
                manualOverrides[`${mapping.address}-${mapping.fc}`] = {
                    fc: mapping.fc,
                    value: writeValue,
                    timestamp: Date.now()
                };
                flowContext.set(MANUAL_OVERRIDES_KEY, manualOverrides);
                //node.log(`Stored manual override: address=${mapping.address}, fc=${mapping.fc}, value=${writeValue}`);
            } catch (error) {
                throw new Error(`Modbus write failed for ${key}: ${(error as Error).message}`);
            }
        }

        async function readFromModbus(key: string, mapping: ModbusMappingResult): Promise<number | boolean> {
            try {
                const readFc = mapping.fc === 6 ? 3 : mapping.fc === 5 ? 1 : 4;
                let result: ModbusData;

                if (readFc === 1) {
                    result = await modbusClient.readCoils(mapping.address, 1);
                } else if (readFc === 3) {
                    result = await modbusClient.readHoldingRegisters(mapping.address, 1);
                } else {
                    result = await modbusClient.readInputRegisters(mapping.address, 1);
                }

                let readValue = result.data[0];
                if (typeof readValue === "number") {
                    readValue = scaleValue(key, readValue, "read");
                }
                //node.log(`Read from Modbus: key=${key}, address=${mapping.address}, value=${readValue}, fc=${readFc}`);
                return readValue;
            } catch (error) {
                throw new Error(`Modbus read failed for ${key}: ${(error as Error).message}`);
            }
        }

        async function publishResult(key: string, value: number | boolean): Promise<void> {
            const mqttPayload = {
                ts: Date.now(),
                [key]: value,
            };
            await mqttClient.publish(publishTopic, JSON.stringify(mqttPayload));
            node.send({ payload: mqttPayload });
            node.status({ fill: "green", shape: "dot", text: `Published: ${key}` });
        }

        function handleConfigRequest(params: Record<string, any>): void {
            const currentConfigKeyValues = getConfigKeyValues();
            const updatedConfigKeyValues = { ...currentConfigKeyValues };

            Object.entries(params).forEach(([key, rawValue]) => {
                if (key in getConfigKeys()) {
                    const value = validateAndConvertValue(key, rawValue);
                    updatedConfigKeyValues[key] = value;
                }
            });

            setConfigKeyValues(updatedConfigKeyValues);

            const mqttPayload = {
                ts: Date.now(),
                ...params,
            };
            mqttClient.publish(publishTopic, JSON.stringify(mqttPayload)); // Không await ở đây vì không cần chặn
            node.send({ payload: mqttPayload });
            node.status({ fill: "green", shape: "dot", text: "Config processed" });
        }

        async function handleRpcRequest(rpcBody: RpcMessage): Promise<void> {
            try {
                if (rpcBody.method === "set_state" && rpcBody.params) {
                    for (const [key, rawValue] of Object.entries(rpcBody.params)) {
                        const mapping = findModbusMapping(key);
                        if (mapping) {
                            const value = validateAndConvertValue(key, rawValue);
                            await writeToModbus(key, mapping, value);
                            const readValue = await readFromModbus(key, mapping);
                            await publishResult(key, readValue);
                        } else {
                            const value = validateAndConvertValue(key, rawValue);
                            const currentConfig = getConfigKeyValues();
                            currentConfig[key] = value;
                            setConfigKeyValues(currentConfig);

                            const mqttPayload = {
                                ts: Date.now(),
                                [key]: value,
                                note: "Config key updated (no Modbus mapping)",
                            };
                            await mqttClient.publish(publishTopic, JSON.stringify(mqttPayload));
                            node.send({ payload: mqttPayload });
                            node.status({ fill: "green", shape: "dot", text: `Config updated: ${key}` });
                        }
                    }
                }
            } catch (error) {
                node.error(`RPC handling error: ${(error as Error).message}`);
                node.status({ fill: "red", shape: "ring", text: "RPC error" });
            }
        }

        // Set up MQTT subscription
        try {
            await mqttClient.subscribe(subscribeTopic);
            //node.log(`Subscribed to topic: ${subscribeTopic}`);
        } catch (error) {
            node.error(`Failed to subscribe to ${subscribeTopic}: ${(error as Error).message}`);
            node.status({ fill: "red", shape: "ring", text: "Subscription failed" });
            return;
        }

        mqttClient.on("mqtt-message", ({ message }: { message: MqttMessage }) => {
            if (!message.topic.startsWith(subscribeTopic.replace("+", ""))) return;
            ClientRegistry.logConnectionCounts(node);
            try {
                const payload = JSON.parse(message.message.toString());
                //node.log(`Received RPC payload: ${JSON.stringify(payload)}`);
                handleRpcRequest(payload);
            } catch (error) {
                node.error(`MQTT message processing error: ${(error as Error).message}`);
                node.status({ fill: "red", shape: "ring", text: "Parse error" });
            }
        });


        // Cho phép cập nhật động scaleConfigs, configKeys và xử lý RPC commands qua msg
        node.on('input', (msg: any) => {
            console.log('VIIS-RPC-CONTROL: INPUT RECEIVED');
            node.warn('VIIS-RPC-CONTROL: INPUT RECEIVED');
            node.status({ fill: "blue", shape: "dot", text: "Message received" });
            if (msg.scaleConfigs) {
                try {
                    let newConfigs = Array.isArray(msg.scaleConfigs) ? msg.scaleConfigs : JSON.parse(msg.scaleConfigs);
                    if (!Array.isArray(newConfigs)) newConfigs = [];
                    flowContext.set(SCALE_CONFIG_KEY, newConfigs);
                    node.warn('[Config] scaleConfigs replaced (no append): ' + JSON.stringify(newConfigs));
                } catch (error) {
                    node.error(`Failed to update scaleConfigs: ${(error as Error).message}`);
                }
            }
            if (msg.configKeys) {
                try {
                    let newKeys = typeof msg.configKeys === 'object' ? msg.configKeys : JSON.parse(msg.configKeys);
                    if (typeof newKeys !== 'object' || Array.isArray(newKeys) || newKeys === null) newKeys = {};
                    flowContext.set(CONFIG_KEYS_KEY, newKeys);
                    node.warn('[Config] configKeys replaced (no append): ' + JSON.stringify(newKeys));
                } catch (error) {
                    node.error(`Failed to update configKeys: ${(error as Error).message}`);
                }
            }
            node.warn(`debug msg.payload: ${JSON.stringify(msg.payload)}`)
            // Process RPC commands from input
            if ((msg.payload && typeof msg.payload === 'object' && msg.payload.method === 'set_state') ||
                (typeof msg.method === 'string' && msg.method === 'set_state')) {
                node.warn("Processing RPC input")
                console.log("Processing RPC input")
                try {
                    console.log("Processing RPC input")
                    let rpcBody: RpcMessage;
                    if (typeof msg.payload === 'object' && msg.payload.method === 'set_state') {
                        // Format: { payload: { method: "set_state", params: { key: value } } }
                        rpcBody = msg.payload;
                        node.warn(`Detected RPC in payload: ${JSON.stringify(rpcBody)}`);
                    } else if (typeof msg.method === 'string' && msg.method === 'set_state' && msg.params) {
                        // Format: { method: "set_state", params: { key: value } }
                        rpcBody = {
                            method: msg.method,
                            params: msg.params,
                            timeout: msg.timeout
                        };
                        node.warn(`Detected RPC in direct properties: ${JSON.stringify(rpcBody)}`);
                    } else {
                        throw new Error('Invalid RPC command format');
                    }
                    node.status({ fill: "blue", shape: "dot", text: "Processing RPC input" });
                    handleRpcRequest(rpcBody);
                } catch (error) {
                    node.error(`Failed to process RPC command from input: ${(error as Error).message}`);
                    node.status({ fill: "red", shape: "ring", text: "RPC input error" });
                }
            }
        });

        // Cleanup triệt để khi node bị xóa
        node.on('close', async (done: () => void) => {
            try {
                flowContext.set(SCALE_CONFIG_KEY, []);
                flowContext.set(CONFIG_KEYS_KEY, {});
                flowContext.set(CONFIG_VALUES_KEY, {});
                flowContext.set(MANUAL_OVERRIDES_KEY, {});
                await mqttClient.disconnect();
                ClientRegistry.releaseClient("modbus", node);
                if (config.mqttBroker === "thingsboard") {
                    ClientRegistry.releaseClient("thingsboard", node);
                } else {
                    ClientRegistry.releaseClient("local", node);
                }
                //node.log("Node closed and configs cleaned");
                done();
            } catch (error) {
                node.error(`Cleanup error: ${(error as Error).message}`);
                done();
            }
        });
    }

    RED.nodes.registerType("viis-rpc-control", ViisRpcControlNode);
};