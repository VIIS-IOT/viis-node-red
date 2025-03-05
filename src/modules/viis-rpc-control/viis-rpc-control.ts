import { NodeAPI, NodeDef, Node } from "node-red";
import ClientRegistry from "../../core/client-registry";
import { ModbusData } from "../../core/modbus-client";
import { MqttConfig, MqttClientCore, MqttMessage } from "../../core/mqtt-client";

// Định nghĩa interface cho cấu hình của node
interface ViisRpcControlNodeDef extends NodeDef {
    mqttBroker: string; // "thingsboard" hoặc "local"
}

// Định nghĩa interface cho dữ liệu RPC
interface RpcData {
    [key: string]: number | boolean;
}

module.exports = function (RED: NodeAPI) {
    function ViisRpcControlNode(this: Node, config: ViisRpcControlNodeDef & { configKeys: string }) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Lấy thông tin device và mapping từ môi trường
        const deviceId = process.env.DEVICE_ID || "unknown";
        const modbusCoils = JSON.parse(process.env.MODBUS_COILS || "{}") as { [key: string]: number };
        const modbusInputRegisters = JSON.parse(process.env.MODBUS_INPUT_REGISTERS || "{}") as { [key: string]: number };
        const modbusHoldingRegisters = JSON.parse(process.env.MODBUS_HOLDING_REGISTERS || "{}") as { [key: string]: number };

        // Parse configKeys từ config
        let configKeys: { [key: string]: string } = {};
        try {
            configKeys = JSON.parse(config.configKeys || "{}");
        } catch (error) {
            node.error(`Failed to parse configKeys: ${(error as Error).message}`);
            node.status({ fill: "red", shape: "ring", text: "Invalid configKeys fuck" });
        }

        // Lưu configKeys vào global variable
        node.context().global.set("configKeys", configKeys);
        // Cấu hình Modbus từ biến môi trường
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

        // Cấu hình MQTT cho ThingsBoard
        const thingsboardConfig: MqttConfig = {
            broker: `mqtt://${process.env.THINGSBOARD_HOST || "mqtt.viis.tech"}:${process.env.THINGSBOARD_PORT || "1883"}`,
            clientId: `node-red-thingsboard-rpc-${Math.random().toString(16).substr(2, 8)}`,
            username: process.env.DEVICE_ACCESS_TOKEN || "",
            password: process.env.THINGSBOARD_PASSWORD || "",
            qos: 1,
        };

        // Cấu hình MQTT cho EMQX Local
        const localConfig: MqttConfig = {
            broker: `mqtt://${process.env.EMQX_HOST || "emqx"}:${process.env.EMQX_PORT || "1883"}`,
            clientId: `node-red-local-rpc-${Math.random().toString(16).substr(2, 8)}`,
            username: process.env.EMQX_USERNAME || "",
            password: process.env.EMQX_PASSWORD || "",
            qos: 1,
        };

        // Chọn cấu hình MQTT dựa trên mqttBroker
        const mqttConfig = config.mqttBroker === "thingsboard" ? thingsboardConfig : localConfig;
        const subscribeTopic = config.mqttBroker === "thingsboard" ? "v1/devices/me/rpc/request/+" : `v1/devices/me/rpc/request/${deviceId}`;
        const publishTopic = config.mqttBroker === "thingsboard" ? "v1/devices/me/telemetry" : `v1/devices/me/telemetry/${deviceId}`;

        // Lấy client từ registry hoặc khởi tạo trực tiếp
        const modbusClient = ClientRegistry.getModbusClient(modbusConfig, node);
        const mqttClient = new MqttClientCore(mqttConfig, node); // Sử dụng MqttClientCore của bạn

        if (!modbusClient || !mqttClient) {
            node.error("Failed to retrieve or initialize clients");
            node.status({ fill: "red", shape: "ring", text: "Client initialization failed" });
            return;
        }

        // Cấu hình scaling cho giá trị ghi
        const scaleConfigsWrite: { key: string; factor: number }[] = [
            { key: "set_ph", factor: 10 },
            { key: "set_ec", factor: 1000 },
        ];

        // Cấu hình scaling cho giá trị đọc
        const scaleConfigsRead: { key: string; factor: number }[] = [
            { key: "current_ec", factor: 1000 },
            { key: "set_ec", factor: 1000 },
            { key: "current_ph", factor: 10 },
            { key: "set_ph", factor: 10 },
        ];

        // Hàm áp dụng scaling khi ghi
        function applyWriteScaling(key: string, value: number): number {
            const scaleConfig = scaleConfigsWrite.find(config => config.key === key);
            return scaleConfig ? value * scaleConfig.factor : value;
        }

        // Hàm áp dụng scaling khi đọc
        function applyReadScaling(key: string, value: number): number {
            const scaleConfig = scaleConfigsRead.find(config => config.key === key);
            return scaleConfig ? value / scaleConfig.factor : value;
        }

        // Subscribe vào topic RPC
        mqttClient.subscribe(subscribeTopic);

        // Xử lý dữ liệu RPC từ MQTT
        mqttClient.on("mqtt-message", ({ message }: { message: MqttMessage }) => {
            if (!message.topic.startsWith(subscribeTopic.replace("+", ""))) return; // Chỉ xử lý topic phù hợp
            try {
                const payload = JSON.parse(message.message.toString());
                const rpcBody = payload.params || payload;
                node.log(`Received RPC payload: ${JSON.stringify(rpcBody)}`);
                // Kiểm tra xem payload có phải là config hay không
                if (payload.method === "set_state" && payload.params) {
                    const params = payload.params;
                    const isConfig = Object.keys(params).some(key => configKeys[key]);
                    if (isConfig) {
                        handleConfigRequest(params);
                        return;
                    }
                }
                handleRpcRequest(rpcBody);
            } catch (error) {
                node.error(`Failed to parse MQTT message: ${(error as Error).message}`);
                node.status({ fill: "red", shape: "ring", text: "Parse error" });
            }
        });

        // Xử lý yêu cầu config (không ghi Modbus)
        function handleConfigRequest(params: RpcData) {
            const mqttPayload = {
                ts: Date.now(),
                ...params,
            };
            mqttClient.publish(publishTopic, JSON.stringify(mqttPayload));
            node.send({ payload: mqttPayload });
            node.status({ fill: "yellow", shape: "dot", text: "Config processed" });
            node.log(`Processed config payload: ${JSON.stringify(mqttPayload)}`);
        }

        // Xử lý yêu cầu RPC
        async function handleRpcRequest(rpcBody: RpcData) {
            let address: number | undefined, value: number | boolean | undefined, fc: number | undefined;
            //node.warn(`modbusCoils at start: ${JSON.stringify(modbusCoils)}`);
            //node.warn(`rpc body: ${JSON.stringify(rpcBody)}`);

            for (const key in rpcBody) {
                if (rpcBody.hasOwnProperty(key)) {
                    let rawValue = rpcBody[key];
                    //node.warn(`Processing key: ${key}, rawValue: ${rawValue}, type: ${typeof rawValue}`);
                    //node.warn(`modbusCoils[${key}] = ${modbusCoils[key]}, typeof: ${typeof modbusCoils[key]}`);
                    //node.warn(`modbusCoils content during check: ${JSON.stringify(modbusCoils)}`);

                    if (modbusHoldingRegisters[key]) {
                        address = modbusHoldingRegisters[key];
                        value = rawValue as number;
                        fc = 6;
                        //node.warn(`Mapped to Holding Register: address=${address}, value=${value}, fc=${fc}`);
                        break;
                    } else if (modbusCoils[key] !== undefined) { // Explicit check for existence
                        address = modbusCoils[key];
                        value = rawValue ? 1 : 0;
                        fc = 5;
                        //node.warn(`Mapped to Coil: address=${address}, value=${value}, fc=${fc}`);
                        break;
                    } else if (modbusInputRegisters[key]) {
                        address = modbusInputRegisters[key];
                        value = rawValue as number;
                        fc = 4;
                        //node.warn(`Mapped to Input Register: address=${address}, value=${value}, fc=${fc}`);
                        break;
                    } else {
                        node.warn(`No mapping found for key: ${key}`);
                    }
                }
            }

            if (address === undefined || value === undefined || fc === undefined) {
                node.warn(`No valid mapping: address=${address}, value=${value}, fc=${fc}`);
                return;
            }

            try {
                // Ghi dữ liệu vào Modbus (nếu fc là 5 hoặc 6)
                if (fc === 5 || fc === 6) {
                    if (fc === 6) {
                        await modbusClient.writeRegister(address, value as number);
                    } else if (fc === 5) {
                        await modbusClient.writeCoil(address, value as number === 1);
                    }
                    node.log(`Wrote to Modbus: address=${address}, value=${value}, fc=${fc}`);
                }

                // Đọc lại giá trị để kiểm tra
                let readFc = fc === 6 ? 3 : fc === 5 ? 1 : 4; // Mapping fc ghi sang fc đọc
                let result: ModbusData;

                if (readFc === 1) {
                    result = await modbusClient.readCoils(address, 1);
                } else if (readFc === 3) {
                    result = await modbusClient.readHoldingRegisters(address, 1);
                } else {
                    result = await modbusClient.readInputRegisters(address, 1);
                }

                const readValue = result.data[0];
                node.log(`Read back from Modbus: address=${address}, value=${readValue}, fc=${readFc}`);

                // Mapping lại thành object MQTT
                const key = Object.keys(rpcBody)[0];
                const scaledValue = typeof readValue === "number" ? applyReadScaling(key, readValue) : readValue;
                const mqttPayload = {
                    ts: Date.now(),
                    [key]: scaledValue,
                };

                // Gửi dữ liệu qua MQTT
                mqttClient.publish(publishTopic, JSON.stringify(mqttPayload));
                node.send({ payload: mqttPayload });
                node.status({ fill: "green", shape: "dot", text: "RPC processed" });
            } catch (error) {
                node.error(`Modbus operation failed: ${(error as Error).message}`);
                node.status({ fill: "red", shape: "ring", text: "Modbus error" });
            }
        }

        // Dọn dẹp khi node đóng
        node.on("close", () => {
            mqttClient.disconnect();
            ClientRegistry.releaseClient("modbus", node);
            node.log("Node closed and client references released");
        });
    }

    RED.nodes.registerType("viis-rpc-control", ViisRpcControlNode);
};