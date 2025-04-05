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
        this.wasConnected = false; // Track connection state
        this.config = Object.assign({ tcpPort: 502, baudRate: 9600, parity: "none", unitId: 1, timeout: 5000, reconnectInterval: 5000 }, config);
        this.node = node;
        this.client = new modbus_serial_1.default();
        this.initializeClient();
        this.startConnectionCheck(); // Bắt đầu kiểm tra kết nối
    }
    // Khởi tạo client
    initializeClient() {
        return __awaiter(this, void 0, void 0, function* () {
            //this.node.log(`Modbus: Attempting to connect type ${this.config.type}...`); // Log connection attempt
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
                this.wasConnected = this.isConnected; // Cập nhật trạng thái kết nối trước đó
                this.isConnected = true;
                if (!this.wasConnected) { // Chỉ log khi trạng thái thay đổi
                    //this.node.log(`Modbus: isConnected status changed to true (Connected)`);
                    this.node.status({ fill: "green", shape: "dot", text: "Connected" });
                    this.emit("modbus-status", { status: "connected" });
                }
                if (this.config.type === "TCP") {
                    //this.node.log(`Modbus TCP: Connected successfully to ${this.config.host}:${this.config.tcpPort}`); // Log TCP connect success
                }
                else if (this.config.type === "RTU") {
                    //this.node.log(`Modbus RTU: Connected successfully to ${this.config.serialPort}`); // Log RTU connect success
                }
            }
            catch (error) {
                //this.node.log(`Modbus: Connection failed for type ${this.config.type}: ${(error as Error).message}`); // Log connection error
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
        //this.node.log(`Modbus Error Handler: ${error.message} - ${error}`); // Log full error and message (chuyển error object thành string)
        this.node.error(`Modbus Error: ${error.message}`);
        this.node.status({ fill: "yellow", shape: "ring", text: `Error: ${error.message}` });
        this.emit("modbus-status", { status: "error", error: error.message });
        if (error.message.includes("Timed out") || error.message.includes("Port Not Open")) {
            this.wasConnected = this.isConnected; // Cập nhật trạng thái kết nối trước đó
            this.isConnected = false;
            if (this.wasConnected) { // Chỉ log khi trạng thái thay đổi
                //this.node.log(`Modbus Error Handler: Marking as disconnected due to "${error.message}"`);
                //this.node.log(`Modbus: isConnected status changed to false (Disconnected)`);
                this.node.status({ fill: "red", shape: "ring", text: "Disconnected" });
                this.emit("modbus-status", { status: "disconnected" });
            }
        }
    }
    scheduleReconnect() {
        if (this.reconnectTimer)
            return;
        this.node.log(`Scheduling reconnect in ${this.config.reconnectInterval}ms for ${this.config.type}`);
        this.reconnectTimer = setTimeout(() => __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.initializeClient();
                this.node.log(`Reconnected successfully for ${this.config.type}`);
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = undefined;
            }
            catch (error) {
                this.handleError(error);
                this.scheduleReconnect();
            }
        }), this.config.reconnectInterval);
    }
    startConnectionCheck() {
        setInterval(() => __awaiter(this, void 0, void 0, function* () {
            if (!this.isConnected || !this.client.isOpen)
                return;
            try {
                yield this.client.readCoils(0, 1); // Thử đọc 1 coil để kiểm tra
                if (!this.isConnected) {
                    this.isConnected = true;
                    this.node.status({ fill: "green", shape: "dot", text: "Connected" });
                    this.emit("modbus-status", { status: "connected" });
                }
            }
            catch (error) {
                this.handleError(error);
                this.scheduleReconnect();
            }
        }), 30000); // Kiểm tra mỗi 30 giây
    }
    ensureConnected() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.isConnected || !this.client.isOpen) {
                this.node.log("Connection lost or not initialized, attempting to reconnect...");
                yield this.initializeClient();
            }
            // Kiểm tra thử một thao tác đơn giản
            try {
                yield this.client.readCoils(0, 1); // Thử đọc để xác nhận kết nối
            }
            catch (error) {
                this.node.log("Connection check failed, forcing reinitialization...");
                this.isConnected = false;
                yield this.initializeClient();
            }
        });
    }
    readCoils(address, length) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.ensureConnected();
            //this.node.log(`Modbus: Reading Coils at address ${address}, length ${length}...`);
            try {
                const { data } = yield this.client.readCoils(address, length);
                //this.node.log(`Modbus: Successfully read Coils at address ${address}, length ${length}`);
                return { address, data };
            }
            catch (error) {
                //this.node.log(`Modbus: Error reading Coils at address ${address}, length ${length}: ${(error as Error).message}`);
                this.handleError(error);
                throw error;
            }
        });
    }
    readInputRegisters(address, length) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.ensureConnected();
            //this.node.log(`Modbus: Reading Input Registers at address ${address}, length ${length}...`);
            try {
                const { data } = yield this.client.readInputRegisters(address, length);
                //this.node.log(`Modbus: Successfully read Input Registers at address ${address}, length ${length}`);
                return { address, data };
            }
            catch (error) {
                //this.node.log(`Modbus: Error reading Input Registers at address ${address}, length ${length}: ${(error as Error).message}`);
                this.handleError(error);
                throw error;
            }
        });
    }
    readHoldingRegisters(address, length) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.ensureConnected();
            //this.node.log(`Modbus: Reading Holding Registers at address ${address}, length ${length}...`);
            try {
                const { data } = yield this.client.readHoldingRegisters(address, length);
                //this.node.log(`Modbus: Successfully read Holding Registers at address ${address}, length ${length}`);
                return { address, data };
            }
            catch (error) {
                //this.node.log(`Modbus: Error reading Holding Registers at address ${address}, length ${length}: ${(error as Error).message}`);
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
            //this.node.log(`Modbus: Writing Holding Register at address ${address}, value ${value}...`); // Log write request
            try {
                yield this.client.writeRegister(address, value);
                //this.node.log(`Modbus: Successfully wrote Holding Register at address ${address}, value ${value}`); // Log write success
            }
            catch (error) {
                //this.node.log(`Modbus: Error writing Holding Register at address ${address}, value ${value}: ${(error as Error).message}`); // Log write error
                this.handleError(error);
                throw error;
            }
        });
    }
    writeCoil(address, value) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.ensureConnected();
            //this.node.log(`Modbus: Writing Coil at address ${address}, value ${value}...`);
            try {
                yield this.client.writeCoil(address, value);
                //this.node.log(`Modbus: Successfully wrote Coil at address ${address}, value ${value}`);
            }
            catch (error) {
                //this.node.log(`Modbus: Error writing Coil at address ${address}, value ${value}: ${(error as Error).message}`);
                this.handleError(error);
                throw error;
            }
        });
    }
    // Ngắt kết nối
    disconnect() {
        //this.node.log("Modbus: Disconnecting client..."); // Log disconnect start
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        this.client.close(() => {
            this.wasConnected = this.isConnected; // Cập nhật trạng thái kết nối trước đó
            this.isConnected = false;
            if (this.wasConnected) { // Chỉ log khi trạng thái thay đổi
                //this.node.log(`Modbus: isConnected status changed to false (Disconnected)`);
                this.node.status({ fill: "grey", shape: "ring", text: "Disconnected" });
                this.emit("modbus-status", { status: "disconnected" });
            }
            //this.node.log("Modbus: Client disconnected."); // Log disconnect complete
        });
    }
    // Kiểm tra trạng thái kết nối
    isConnectedCheck() {
        return this.isConnected;
    }
}
exports.ModbusClientCore = ModbusClientCore;
