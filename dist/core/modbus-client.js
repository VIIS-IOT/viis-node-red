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
exports.ModbusClientCore = void 0;
const modbus_serial_1 = __importDefault(require("modbus-serial"));
const events_1 = require("events");
// Core Modbus Client
class ModbusClientCore extends events_1.EventEmitter {
    constructor(config, node) {
        super();
        this.isConnected = false;
        this.config = Object.assign({ tcpPort: 502, baudRate: 9600, parity: "none", unitId: 1, timeout: 5000, reconnectInterval: 5000 }, config);
        this.node = node;
        this.client = new modbus_serial_1.default();
        this.initializeClient();
    }
    // Khởi tạo client
    initializeClient() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (this.config.type === "TCP") {
                    yield this.connectTCP();
                }
                else if (this.config.type === "RTU") {
                    yield this.connectRTU();
                }
                this.client.setTimeout(this.config.timeout);
                if (this.config.unitId)
                    this.client.setID(this.config.unitId);
                this.isConnected = true;
                this.node.status({ fill: "green", shape: "dot", text: "Connected" });
                this.emit("modbus-status", { status: "connected" });
            }
            catch (error) {
                this.handleError(error);
                if (this.config.type === "TCP")
                    this.scheduleReconnect();
            }
        });
    }
    // Kết nối TCP
    connectTCP() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.config.host || !this.config.tcpPort) {
                throw new Error("Host and tcpPort are required for Modbus TCP");
            }
            yield this.client.connectTCP(this.config.host, { port: this.config.tcpPort });
        });
    }
    // Kết nối RTU
    connectRTU() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.config.serialPort) {
                throw new Error("Serial port is required for Modbus RTU");
            }
            yield this.client.connectRTUBuffered(this.config.serialPort, {
                baudRate: this.config.baudRate,
                parity: this.config.parity,
            });
        });
    }
    // Xử lý lỗi
    handleError(error) {
        this.node.error(`Modbus Error: ${error.message}`);
        this.node.status({ fill: "yellow", shape: "ring", text: `Error: ${error.message}` });
        this.emit("modbus-status", { status: "error", error: error.message });
        if (error.message.includes("Timed out") || error.message.includes("Port Not Open")) {
            this.isConnected = false;
            this.node.status({ fill: "red", shape: "ring", text: "Disconnected" });
            this.emit("modbus-status", { status: "disconnected" });
        }
    }
    // Lên lịch reconnect (chỉ cho TCP)
    scheduleReconnect() {
        if (this.reconnectTimer || this.config.type !== "TCP")
            return;
        this.reconnectTimer = setTimeout(() => __awaiter(this, void 0, void 0, function* () {
            this.node.log("Attempting to reconnect...");
            try {
                yield this.initializeClient();
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = undefined;
            }
            catch (error) {
                this.handleError(error);
                this.scheduleReconnect();
            }
        }), this.config.reconnectInterval);
    }
    // Đọc Holding Registers
    readHoldingRegisters(address, length) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.isConnected)
                throw new Error("Modbus client not connected");
            try {
                const { data } = yield this.client.readHoldingRegisters(address, length);
                return { address, data };
            }
            catch (error) {
                this.handleError(error);
                throw error;
            }
        });
    }
    // Đọc Input Registers
    readInputRegisters(address, length) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.isConnected)
                throw new Error("Modbus client not connected");
            try {
                const { data } = yield this.client.readInputRegisters(address, length);
                return { address, data };
            }
            catch (error) {
                this.handleError(error);
                throw error;
            }
        });
    }
    // Đọc Coils
    readCoils(address, length) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.isConnected)
                throw new Error("Modbus client not connected");
            try {
                const { data } = yield this.client.readCoils(address, length);
                return { address, data };
            }
            catch (error) {
                this.handleError(error);
                throw error;
            }
        });
    }
    // Ghi Holding Register
    writeRegister(address, value) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.isConnected)
                throw new Error("Modbus client not connected");
            try {
                yield this.client.writeRegister(address, value);
            }
            catch (error) {
                this.handleError(error);
                throw error;
            }
        });
    }
    // Ngắt kết nối
    disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        this.client.close(() => {
            this.isConnected = false;
            this.node.log("Modbus client disconnected");
            this.node.status({ fill: "grey", shape: "ring", text: "Disconnected" });
            this.emit("modbus-status", { status: "disconnected" });
        });
    }
    // Kiểm tra trạng thái kết nối
    isConnectedCheck() {
        return this.isConnected;
    }
}
exports.ModbusClientCore = ModbusClientCore;
