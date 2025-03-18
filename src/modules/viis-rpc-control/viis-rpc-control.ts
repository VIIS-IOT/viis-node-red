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
    operation: 'multiply' | 'divide';
    factor: number;
    direction: 'read' | 'write';
}

interface ConfigKey {
    [key: string]: 'number' | 'boolean' | 'string'; // Danh sách key và kiểu mong muốn
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
    function ViisRpcControlNode(this: Node, config: ViisRpcControlNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Environment variables
        const deviceId = process.env.DEVICE_ID || "unknown";
        const modbusCoils = JSON.parse(process.env.MODBUS_COILS || "{}");
        const modbusInputRegisters = JSON.parse(process.env.MODBUS_INPUT_REGISTERS || "{}");
        const modbusHoldingRegisters = JSON.parse(process.env.MODBUS_HOLDING_REGISTERS || "{}");

        // Parse configurations
        let configKeys: ConfigKey = {};
        let scaleConfigs: ScaleConfig[] = [];
        try {
            configKeys = JSON.parse(config.configKeys || '{}');
            //node.warn(`configKeys is ${JSON.stringify(configKeys)}`);
            scaleConfigs = JSON.parse(config.scaleConfigs || '[]');
            //node.warn(`scale config is ${JSON.stringify(scaleConfigs)}`);

            // Validate configKeys
            Object.entries(configKeys).forEach(([key, type]) => {
                if (!['number', 'boolean', 'string'].includes(type)) {
                    throw new Error(`Invalid type "${type}" for key "${key}"`);
                }
            });

            // Validate scaleConfigs
            scaleConfigs.forEach(conf => {
                if (!conf.key || !conf.operation || typeof conf.factor !== 'number' || !['read', 'write'].includes(conf.direction)) {
                    throw new Error(`Invalid scale config: ${JSON.stringify(conf)}`);
                }
            });

            // Store configKeys globally (danh sách key cần detect)
            node.context().global.set("configKeys", configKeys);
            // Khởi tạo configKeyValues nếu chưa tồn tại
            if (!node.context().global.get("configKeyValues")) {
                node.context().global.set("configKeyValues", {});
            }
            // Store scaleConfigs globally
            node.context().global.set("scaleConfigs", scaleConfigs);
        } catch (error) {
            const err = error as Error;
            node.error(`Configuration parsing error: ${err.message}`);
            node.status({ fill: "red", shape: "ring", text: "Invalid configuration" });
            return;
        }

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

        const modbusClient = ClientRegistry.getModbusClient(modbusConfig, node);
        const mqttClient = new MqttClientCore(mqttConfig, node);

        if (!modbusClient || !mqttClient) {
            node.error("Failed to initialize clients");
            node.status({ fill: "red", shape: "ring", text: "Client initialization failed" });
            return;
        }

        // Utility functions
        function scaleValue(key: string, value: number, direction: 'read' | 'write'): number {
            //node.warn(`all scaleConfigs ${JSON.stringify(scaleConfigs)}`);
            const config = scaleConfigs.find(c => c.key === key && c.direction === direction);
            //node.warn(`Scaling key: ${key}, value: ${value}, direction: ${direction}`);
            //node.warn(`Config: ${JSON.stringify(config)}`);
            if (!config) return value;

            const shouldMultiply = config.operation === 'multiply';
            //node.warn(`shouldMultiply: ${shouldMultiply}`);
            return shouldMultiply ? value * config.factor : value / config.factor;
        }

        function validateAndConvertValue(key: string, value: any): any {
            const expectedType = configKeys[key];
            if (!expectedType) return value; // Nếu không phải config key, trả về nguyên giá trị
            try {
                switch (expectedType) {
                    case 'number':
                        const num = Number(value);
                        if (isNaN(num)) throw new Error(`Invalid number value for ${key}`);
                        return num;
                    case 'boolean':
                        if (typeof value === 'string') return value.toLowerCase() === 'true';
                        return Boolean(value);
                    case 'string':
                        return String(value);
                    default:
                        return value;
                }
            } catch (error) {
                const err = error as Error;
                throw new Error(`Value conversion failed for ${key}: ${err.message}`);
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
                if (typeof value === 'number') {
                    writeValue = scaleValue(key, value, 'write'); // Sử dụng key thay vì address
                }
                if (mapping.fc === 6) {
                    await modbusClient.writeRegister(mapping.address, writeValue as number);
                } else if (mapping.fc === 5) {
                    await modbusClient.writeCoil(mapping.address, value as boolean);
                }
                //node.log(`Wrote to Modbus: address=${mapping.address}, value=${writeValue}, fc=${mapping.fc}`);
            } catch (error) {
                const err = error as Error;
                throw new Error(`Modbus write failed: ${err.message}`);
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
                if (typeof readValue === 'number') {
                    readValue = scaleValue(key, readValue, 'read'); // Sử dụng key thay vì address
                }
                return readValue;
            } catch (error) {
                const err = error as Error;
                throw new Error(`Modbus read failed: ${err.message}`);
            }
        }

        function publishResult(key: string, value: number | boolean): void {
            const mqttPayload = {
                ts: Date.now(),
                [key]: value,
            };

            mqttClient.publish(publishTopic, JSON.stringify(mqttPayload));
            node.send({ payload: mqttPayload });
            node.status({ fill: "green", shape: "dot", text: "Success" });
        }

        function handleConfigRequest(params: Record<string, any>): void {
            const currentConfigKeyValues: ConfigKeyValues = node.context().global.get("configKeyValues") as ConfigKeyValues || {};
            const updatedConfigKeyValues = { ...currentConfigKeyValues };

            // Lưu tất cả các config key vào configKeyValues
            Object.entries(params).forEach(([key, rawValue]) => {
                if (key in configKeys) {
                    const value = validateAndConvertValue(key, rawValue);
                    updatedConfigKeyValues[key] = value;
                }
            });

            // Cập nhật global variable configKeyValues
            node.context().global.set("configKeyValues", updatedConfigKeyValues);

            const mqttPayload = {
                ts: Date.now(),
                ...params,
            };
            mqttClient.publish(publishTopic, JSON.stringify(mqttPayload));
            node.send({ payload: mqttPayload });
            node.status({ fill: "green", shape: "dot", text: "Config processed" });
        }

        async function handleRpcRequest(rpcBody: RpcMessage): Promise<void> {
            try {
                if (rpcBody.method === 'set_state' && rpcBody.params) {
                    // Duyệt từng key trong params
                    for (const [key, rawValue] of Object.entries(rpcBody.params)) {
                        // Kiểm tra xem key có mapping trong Modbus không
                        const mapping = findModbusMapping(key);
                        if (mapping) {
                            // Nếu có mapping, thực hiện ghi/đọc Modbus
                            const value = validateAndConvertValue(key, rawValue);
                            await writeToModbus(key, mapping, value);
                            const readValue = await readFromModbus(key, mapping);
                            publishResult(key, readValue);
                        } else {
                            // Nếu không có mapping, coi đây là config key
                            // Có thể thực hiện validate chuyển đổi nếu muốn
                            const value = validateAndConvertValue(key, rawValue);
                            const currentConfig = node.context().global.get("configKeyValues") || {};
                            currentConfig[key] = value;
                            node.context().global.set("configKeyValues", currentConfig);

                            // Gửi thông báo qua MQTT và output của node
                            const mqttPayload = {
                                ts: Date.now(),
                                [key]: value,
                                note: "Config key updated (no Modbus mapping)"
                            };
                            mqttClient.publish(publishTopic, JSON.stringify(mqttPayload));
                            node.send({ payload: mqttPayload });
                            node.status({ fill: "green", shape: "dot", text: "Config updated" });
                        }
                    }
                }
            } catch (error) {
                const err = error as Error;
                node.error(`RPC handling error: ${err.message}`);
                node.status({ fill: "red", shape: "ring", text: "RPC error" });
            }
        }


        // Set up MQTT subscription
        mqttClient.subscribe(subscribeTopic);
        mqttClient.on("mqtt-message", ({ message }: { message: MqttMessage }) => {
            if (!message.topic.startsWith(subscribeTopic.replace("+", ""))) return;

            try {
                const payload = JSON.parse(message.message.toString());
                //node.log(`Received RPC payload: ${JSON.stringify(payload)}`);
                handleRpcRequest(payload);
            } catch (error) {
                const err = error as Error;
                node.error(`MQTT message processing error: ${err.message}`);
                node.status({ fill: "red", shape: "ring", text: "Parse error" });
            }
        });

        // Cleanup
        node.on('close', (done: any) => {
            Promise.all([
                mqttClient.disconnect(),
                ClientRegistry.releaseClient("modbus", node)
            ])
                .then(() => {
                    //node.log("Node closed and clients released");
                    done();
                })
                .catch((error: Error) => {
                    node.error(`Cleanup error: ${error.message}`);
                    done();
                });
        });
    }

    RED.nodes.registerType("viis-rpc-control", ViisRpcControlNode);
};