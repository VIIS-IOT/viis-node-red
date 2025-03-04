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
Object.defineProperty(exports, "__esModule", { value: true });
const modbus_client_1 = require("./core/modbus-client"); // Chỉ cần import ModbusClientCore
module.exports = function (RED) {
    function ViisModbusTestNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        // Cấu hình Modbus từ process.env
        const modbusConfig = {
            type: process.env.MODBUS_TYPE || "TCP",
            host: process.env.MODBUS_HOST || "localhost",
            tcpPort: parseInt(process.env.MODBUS_TCP_PORT || "502", 10),
            serialPort: process.env.MODBUS_SERIAL_PORT || "/dev/ttyUSB0",
            baudRate: parseInt(process.env.MODBUS_BAUD_RATE || "9600", 10),
            parity: process.env.MODBUS_PARITY || "none",
            unitId: parseInt(process.env.MODBUS_UNIT_ID || "1", 10),
            timeout: parseInt(process.env.MODBUS_TIMEOUT || "5000", 10),
            reconnectInterval: parseInt(process.env.MODBUS_RECONNECT_INTERVAL || "5000", 10),
        };
        let modbusClient;
        // Khởi tạo Modbus client
        try {
            modbusClient = new modbus_client_1.ModbusClientCore(modbusConfig, node);
            node.log(`Modbus client initialized with config: ${JSON.stringify(modbusConfig)}`);
        }
        catch (error) {
            const err = error;
            node.error(`Failed to initialize Modbus client: ${err.message}`);
            node.status({ fill: "red", shape: "ring", text: `Error: ${err.message}` });
            return;
        }
        const startAddress = parseInt(config.startAddress, 10);
        const length = parseInt(config.length, 10);
        const pollInterval = parseInt(config.pollInterval, 10);
        let pollingInterval = null;
        // Lắng nghe trạng thái từ Modbus client
        modbusClient.on("modbus-status", (data) => {
            if (data.status === "connected") {
                node.status({ fill: "green", shape: "dot", text: "Connected" });
                startPolling();
            }
            else if (data.status === "disconnected") {
                node.status({ fill: "red", shape: "ring", text: "Disconnected" });
                stopPolling();
            }
            else if (data.status === "error") {
                node.status({ fill: "yellow", shape: "ring", text: `Error: ${data.error}` });
                stopPolling();
            }
        });
        // Bắt đầu polling
        function startPolling() {
            if (pollingInterval)
                return;
            pollingInterval = setInterval(() => __awaiter(this, void 0, void 0, function* () {
                try {
                    const result = yield modbusClient.readHoldingRegisters(startAddress, length);
                    node.send([{ payload: result.data }, null]);
                }
                catch (error) {
                    const err = error;
                    node.send([null, { payload: `Polling error: ${err.message}` }]);
                    node.error(`Polling error: ${err.message}`);
                }
            }), pollInterval);
        }
        // Dừng polling
        function stopPolling() {
            if (pollingInterval) {
                clearInterval(pollingInterval);
                pollingInterval = null;
            }
        }
        // Xử lý input để ghi dữ liệu
        node.on("input", (msg) => __awaiter(this, void 0, void 0, function* () {
            try {
                if (msg.payload && typeof msg.payload === "object" && "address" in msg.payload && "value" in msg.payload) {
                    const address = parseInt(msg.payload.address, 10);
                    const value = parseInt(msg.payload.value, 10);
                    if (isNaN(address) || isNaN(value)) {
                        throw new Error("Invalid address or value in msg.payload");
                    }
                    yield modbusClient.writeRegister(address, value);
                    node.send([{ payload: { address, value } }, null]);
                }
                else {
                    throw new Error("msg.payload must be an object with address and value");
                }
            }
            catch (error) {
                const err = error;
                node.send([null, { payload: `Write error: ${err.message}` }]);
                node.error(`Write error: ${err.message}`);
            }
        }));
        // Dừng polling và đóng client khi node bị xóa
        node.on("close", () => {
            stopPolling();
            modbusClient.disconnect();
        });
    }
    RED.nodes.registerType("viis-modbus-test-node", ViisModbusTestNode);
};
