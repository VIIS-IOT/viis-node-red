import { NodeAPI, Node } from "node-red";
import ModbusRTU from "modbus-serial";
import { EventEmitter } from "events";

// Định nghĩa interface cho cấu hình Modbus
export interface ModbusConfig {
    type: "TCP" | "RTU"; // Loại kết nối
    host?: string; // Chỉ dùng cho TCP
    tcpPort?: number; // Port cho TCP (mặc định 502)
    serialPort?: string; // Port cho RTU (ví dụ: /dev/ttyUSB0)
    baudRate?: number; // Chỉ dùng cho RTU
    parity?: "none" | "even" | "odd"; // Chỉ dùng cho RTU
    unitId?: number; // Modbus Unit ID (mặc định 1)
    timeout?: number; // Timeout cho mỗi request (ms)
    reconnectInterval?: number; // Thời gian chờ trước khi reconnect (ms, chỉ TCP)
}

// Định nghĩa interface cho dữ liệu đọc được
export interface ModbusData {
    address: number;
    data: number[] | boolean[];
}

// Core Modbus Client
export class ModbusClientCore extends EventEmitter {
    private client: ModbusRTU;
    private config: ModbusConfig;
    private node: Node;
    private isConnected: boolean = false;
    private reconnectTimer?: NodeJS.Timeout;

    constructor(config: ModbusConfig, node: Node) {
        super();
        this.config = {
            tcpPort: 502, // Mặc định cho TCP
            baudRate: 9600, // Mặc định cho RTU
            parity: "none", // Mặc định cho RTU
            unitId: 1,
            timeout: 5000,
            reconnectInterval: 5000,
            ...config, // Ghi đè bởi config từ người dùng, type không cần mặc định vì bắt buộc
        };
        this.node = node;
        this.client = new ModbusRTU();
        this.initializeClient();
    }

    // Khởi tạo client
    private async initializeClient(): Promise<void> {
        try {
            if (this.config.type === "TCP") {
                await this.connectTCP();
            } else if (this.config.type === "RTU") {
                await this.connectRTU();
            }
            this.client.setTimeout(this.config.timeout!);
            if (this.config.unitId) this.client.setID(this.config.unitId);
            this.isConnected = true;
            this.node.status({ fill: "green", shape: "dot", text: "Connected" });
            this.emit("modbus-status", { status: "connected" });
        } catch (error) {
            this.handleError(error as Error);
            if (this.config.type === "TCP") this.scheduleReconnect();
        }
    }

    // Kết nối TCP
    private async connectTCP(): Promise<void> {
        if (!this.config.host || !this.config.tcpPort) {
            throw new Error("Host and tcpPort are required for Modbus TCP");
        }
        await this.client.connectTCP(this.config.host, { port: this.config.tcpPort });
    }

    // Kết nối RTU
    private async connectRTU(): Promise<void> {
        if (!this.config.serialPort) {
            throw new Error("Serial port is required for Modbus RTU");
        }
        await this.client.connectRTUBuffered(this.config.serialPort, {
            baudRate: this.config.baudRate,
            parity: this.config.parity,
        });
    }

    // Xử lý lỗi
    private handleError(error: Error): void {
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
    private scheduleReconnect(): void {
        if (this.reconnectTimer || this.config.type !== "TCP") return;
        this.reconnectTimer = setTimeout(async () => {
            this.node.log("Attempting to reconnect...");
            try {
                await this.initializeClient();
                clearTimeout(this.reconnectTimer!);
                this.reconnectTimer = undefined;
            } catch (error) {
                this.handleError(error as Error);
                this.scheduleReconnect();
            }
        }, this.config.reconnectInterval);
    }

    // Đọc Holding Registers
    public async readHoldingRegisters(address: number, length: number): Promise<ModbusData> {
        if (!this.isConnected) throw new Error("Modbus client not connected");
        try {
            const { data } = await this.client.readHoldingRegisters(address, length);
            return { address, data };
        } catch (error) {
            this.handleError(error as Error);
            throw error;
        }
    }

    // Đọc Input Registers
    public async readInputRegisters(address: number, length: number): Promise<ModbusData> {
        if (!this.isConnected) throw new Error("Modbus client not connected");
        try {
            const { data } = await this.client.readInputRegisters(address, length);
            return { address, data };
        } catch (error) {
            this.handleError(error as Error);
            throw error;
        }
    }

    // Đọc Coils
    public async readCoils(address: number, length: number): Promise<ModbusData> {
        if (!this.isConnected) throw new Error("Modbus client not connected");
        try {
            const { data } = await this.client.readCoils(address, length);
            return { address, data };
        } catch (error) {
            this.handleError(error as Error);
            throw error;
        }
    }

    // Ghi Holding Register
    public async writeRegister(address: number, value: number): Promise<void> {
        if (!this.isConnected) throw new Error("Modbus client not connected");
        try {
            await this.client.writeRegister(address, value);
        } catch (error) {
            this.handleError(error as Error);
            throw error;
        }
    }

    // Ngắt kết nối
    public disconnect(): void {
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
    public isConnectedCheck(): boolean {
        return this.isConnected;
    }
}