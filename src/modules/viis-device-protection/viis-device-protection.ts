import { NodeAPI, NodeDef, Node } from "node-red";
import ClientRegistry from "../../core/client-registry";

interface ViisDeviceProtectionNodeDef extends NodeDef { }

module.exports = function (RED: NodeAPI) {
    function ViisDeviceProtectionNode(this: Node, config: ViisDeviceProtectionNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Environment variables for Modbus mappings
        const modbusCoils = JSON.parse(process.env.MODBUS_COILS || "{}");
        const modbusHoldingRegisters = JSON.parse(process.env.MODBUS_HOLDING_REGISTERS || "{}");
        const modbusInputRegisters = JSON.parse(process.env.MODBUS_INPUT_REGISTERS || "{}");

        // Modbus client configuration
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

        const modbusClient = ClientRegistry.getModbusClient(modbusConfig, node);
        if (!modbusClient) {
            node.error("Failed to initialize Modbus client");
            node.status({ fill: "red", shape: "ring", text: "Modbus client failed" });
            return;
        }

        // Trạng thái theo dõi thời gian bật của các coil
        const coilTimers: { [key: string]: { startTime: number; maxTime: number } } = {};

        // Hàm đọc trạng thái coil từ Modbus
        async function readCoil(address: number): Promise<boolean> {
            try {
                const result = await modbusClient.readCoils(address, 1);
                return Boolean(result.data[0]);
            } catch (error) {
                const err = error as Error;
                node.error(`Modbus read coil error at address ${address}: ${err.message}`);
                return false;
            }
        }

        // Hàm ghi trạng thái coil vào Modbus
        async function writeCoil(address: number, value: boolean): Promise<void> {
            try {
                await modbusClient.writeCoil(address, value);
                node.log(`Wrote to coil at address ${address}: ${value}`);
            } catch (error) {
                const err = error as Error;
                node.error(`Modbus write coil error at address ${address}: ${err.message}`);
            }
        }

        // Hàm kiểm tra và áp dụng logic bảo vệ
        async function checkProtection() {
            const configKeyValues = node.context().global.get("configKeyValues") || {};
            if (!configKeyValues || Object.keys(configKeyValues).length === 0) {
                // node.warn("No configKeyValues found in global context");
                node.status({ fill: "yellow", shape: "ring", text: "No configKeyValues" });
                return;
            }

            // Lấy dữ liệu telemetry từ biến global coilRegisterData
            const coilData = node.context().global.get("coilRegisterData") || {};

            for (const [key, value] of Object.entries(configKeyValues)) {
                // Chỉ xử lý các key liên quan đến giới hạn thời gian (có hậu tố _MAX_TIME)
                if (!key.endsWith("_MAX_TIME")) continue;

                const coilKey = key.replace("_MAX_TIME", ""); // Ví dụ: COIL_OUTPUT_WATER_IN_MAX_TIME -> COIL_OUTPUT_WATER_IN
                const maxTime = Number(value); // Thời gian tối đa (giây)
                if (isNaN(maxTime) || maxTime <= 0) {
                    node.warn(`Invalid max time for ${key}: ${value}`);
                    continue;
                }

                // Lấy trạng thái của coil từ dữ liệu telemetry
                const isCoilOn = coilData[coilKey];

                if (isCoilOn) {
                    if (!coilTimers[coilKey]) {
                        // Bắt đầu đếm thời gian nếu coil vừa bật
                        coilTimers[coilKey] = {
                            startTime: Date.now(),
                            maxTime: maxTime * 1000, // Chuyển sang milliseconds
                        };
                        node.log(`Started timer for ${coilKey} with max time ${maxTime}s`);
                    } else {
                        // Kiểm tra thời gian đã vượt quá chưa
                        const elapsedTime = Date.now() - coilTimers[coilKey].startTime;
                        if (elapsedTime > coilTimers[coilKey].maxTime) {
                            node.warn(`Coil ${coilKey} exceeded max time (${maxTime}s). Turning off.`);
                            // Giữ lại thao tác tắt coil qua Modbus nếu cần (ví dụ khi cần gửi lệnh về PLC)
                            await writeCoil(modbusCoils[coilKey], false);
                            delete coilTimers[coilKey];
                            node.send({ payload: { [coilKey]: false, reason: "Exceeded max time" } });
                        }
                    }
                } else {
                    // Nếu coil đã tắt, xóa timer (nếu có)
                    if (coilTimers[coilKey]) {
                        delete coilTimers[coilKey];
                        node.log(`Timer for ${coilKey} cleared`);
                    }
                }
            }

            node.status({ fill: "green", shape: "dot", text: "Running" });
        }


        // Chạy kiểm tra định kỳ mỗi 1 giây
        const interval = setInterval(checkProtection, 1000);

        // Cleanup khi node bị xóa hoặc đóng
        node.on("close", (done: any) => {
            clearInterval(interval);
            ClientRegistry.releaseClient("modbus", node);
            node.log("Protection node closed and Modbus client released");
            done();
        });
    }

    RED.nodes.registerType("viis-device-protection", ViisDeviceProtectionNode);
};