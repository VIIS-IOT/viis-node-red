import { NodeAPI, NodeDef, Node } from "node-red";
import { ModbusClientCore } from "./core/modbus-client"; // Chỉ cần import ModbusClientCore

// Định nghĩa interface cho cấu hình của node
interface ViisModbusTestNodeDef extends NodeDef {
    startAddress: string;
    length: string;
    pollInterval: string;
}

module.exports = function (RED: NodeAPI) {
    function ViisModbusTestNode(this: Node, config: ViisModbusTestNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Cấu hình Modbus từ process.env
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

        let modbusClient: ModbusClientCore;

        // Khởi tạo Modbus client
        try {
            modbusClient = new ModbusClientCore(modbusConfig, node);
            node.log(`Modbus client initialized with config: ${JSON.stringify(modbusConfig)}`);
        } catch (error) {
            const err = error as Error;
            node.error(`Failed to initialize Modbus client: ${err.message}`);
            node.status({ fill: "red", shape: "ring", text: `Error: ${err.message}` });
            return;
        }

        const startAddress = parseInt(config.startAddress, 10);
        const length = parseInt(config.length, 10);
        const pollInterval = parseInt(config.pollInterval, 10);

        let pollingInterval: NodeJS.Timeout | null = null;

        // Lắng nghe trạng thái từ Modbus client
        modbusClient.on("modbus-status", (data: { status: string; error?: string }) => {
            if (data.status === "connected") {
                node.status({ fill: "green", shape: "dot", text: "Connected" });
                startPolling();
            } else if (data.status === "disconnected") {
                node.status({ fill: "red", shape: "ring", text: "Disconnected" });
                stopPolling();
            } else if (data.status === "error") {
                node.status({ fill: "yellow", shape: "ring", text: `Error: ${data.error}` });
                stopPolling();
            }
        });

        // Bắt đầu polling
        function startPolling() {
            if (pollingInterval) return;
            pollingInterval = setInterval(async () => {
                try {
                    const result = await modbusClient.readHoldingRegisters(startAddress, length);
                    node.send([{ payload: result.data }, null]);
                } catch (error) {
                    const err = error as Error;
                    node.send([null, { payload: `Polling error: ${err.message}` }]);
                    node.error(`Polling error: ${err.message}`);
                }
            }, pollInterval);
        }

        // Dừng polling
        function stopPolling() {
            if (pollingInterval) {
                clearInterval(pollingInterval);
                pollingInterval = null;
            }
        }

        // Xử lý input để ghi dữ liệu
        node.on("input", async (msg: any) => {
            try {
                if (msg.payload && typeof msg.payload === "object" && "address" in msg.payload && "value" in msg.payload) {
                    const address = parseInt(msg.payload.address, 10);
                    const value = parseInt(msg.payload.value, 10);
                    if (isNaN(address) || isNaN(value)) {
                        throw new Error("Invalid address or value in msg.payload");
                    }
                    await modbusClient.writeRegister(address, value);
                    node.send([{ payload: { address, value } }, null]);
                } else {
                    throw new Error("msg.payload must be an object with address and value");
                }
            } catch (error) {
                const err = error as Error;
                node.send([null, { payload: `Write error: ${err.message}` }]);
                node.error(`Write error: ${err.message}`);
            }
        });

        // Dừng polling và đóng client khi node bị xóa
        node.on("close", () => {
            stopPolling();
            modbusClient.disconnect();
        });
    }

    RED.nodes.registerType("viis-modbus-test-node", ViisModbusTestNode);
};