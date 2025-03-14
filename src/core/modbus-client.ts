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
    private wasConnected: boolean = false; // Track connection state

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
        //this.node.log(`Modbus: Attempting to connect type ${this.config.type}...`); // Log connection attempt
        try {
            if (this.config.type === "TCP") {
                await this.connectTCP();
            } else if (this.config.type === "RTU") {
                await this.connectRTU();
            }
            this.client.setTimeout(this.config.timeout!);
            if (this.config.unitId) this.client.setID(this.config.unitId);
            this.wasConnected = this.isConnected; // Cập nhật trạng thái kết nối trước đó
            this.isConnected = true;
            if (!this.wasConnected) { // Chỉ log khi trạng thái thay đổi
                //this.node.log(`Modbus: isConnected status changed to true (Connected)`);
                this.node.status({ fill: "green", shape: "dot", text: "Connected" });
                this.emit("modbus-status", { status: "connected" });
            }
            if (this.config.type === "TCP") {
                //this.node.log(`Modbus TCP: Connected successfully to ${this.config.host}:${this.config.tcpPort}`); // Log TCP connect success
            } else if (this.config.type === "RTU") {
                //this.node.log(`Modbus RTU: Connected successfully to ${this.config.serialPort}`); // Log RTU connect success
            }

        } catch (error) {
            //this.node.log(`Modbus: Connection failed for type ${this.config.type}: ${(error as Error).message}`); // Log connection error
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

    // Lên lịch reconnect (chỉ cho TCP)
    private scheduleReconnect(): void {
        if (this.reconnectTimer || this.config.type !== "TCP") return;
        //this.node.log(`Modbus TCP: Reconnection scheduled in ${this.config.reconnectInterval}ms`); // Log reconnect schedule
        this.reconnectTimer = setTimeout(async () => {
            //this.node.log("Modbus TCP: Attempting reconnection..."); // Log reconnect attempt
            try {
                await this.initializeClient();
                clearTimeout(this.reconnectTimer!);
                this.reconnectTimer = undefined;
                //this.node.log(`Modbus TCP: Reconnected successfully after reconnection attempt.`); // Log reconnect success
            } catch (error) {
                //this.node.log(`Modbus TCP: Reconnection attempt failed: ${(error as Error).message}`); // Log reconnect error
                this.handleError(error as Error);
                this.scheduleReconnect();
            }
        }, this.config.reconnectInterval);
    }

    private async ensureConnected(): Promise<void> {
        if (!this.isConnected || !this.client.isOpen) {
            //this.node.log("Modbus: Connection lost, attempting to reinitialize...");
            await this.initializeClient();
        }
    }
    public async readCoils(address: number, length: number): Promise<ModbusData> {
        await this.ensureConnected();
        //this.node.log(`Modbus: Reading Coils at address ${address}, length ${length}...`);
        try {
            const { data } = await this.client.readCoils(address, length);
            //this.node.log(`Modbus: Successfully read Coils at address ${address}, length ${length}`);
            return { address, data };
        } catch (error) {
            //this.node.log(`Modbus: Error reading Coils at address ${address}, length ${length}: ${(error as Error).message}`);
            this.handleError(error as Error);
            throw error;
        }
    }

    public async readInputRegisters(address: number, length: number): Promise<ModbusData> {
        await this.ensureConnected();
        //this.node.log(`Modbus: Reading Input Registers at address ${address}, length ${length}...`);
        try {
            const { data } = await this.client.readInputRegisters(address, length);
            //this.node.log(`Modbus: Successfully read Input Registers at address ${address}, length ${length}`);
            return { address, data };
        } catch (error) {
            //this.node.log(`Modbus: Error reading Input Registers at address ${address}, length ${length}: ${(error as Error).message}`);
            this.handleError(error as Error);
            throw error;
        }
    }

    public async readHoldingRegisters(address: number, length: number): Promise<ModbusData> {
        await this.ensureConnected();
        //this.node.log(`Modbus: Reading Holding Registers at address ${address}, length ${length}...`);
        try {
            const { data } = await this.client.readHoldingRegisters(address, length);
            //this.node.log(`Modbus: Successfully read Holding Registers at address ${address}, length ${length}`);
            return { address, data };
        } catch (error) {
            //this.node.log(`Modbus: Error reading Holding Registers at address ${address}, length ${length}: ${(error as Error).message}`);
            this.handleError(error as Error);
            throw error;
        }
    }

    // Ghi Holding Register
    public async writeRegister(address: number, value: number): Promise<void> {
        if (!this.isConnected) throw new Error("Modbus client not connected");
        //this.node.log(`Modbus: Writing Holding Register at address ${address}, value ${value}...`); // Log write request
        try {
            await this.client.writeRegister(address, value);
            //this.node.log(`Modbus: Successfully wrote Holding Register at address ${address}, value ${value}`); // Log write success
        } catch (error) {
            //this.node.log(`Modbus: Error writing Holding Register at address ${address}, value ${value}: ${(error as Error).message}`); // Log write error
            this.handleError(error as Error);
            throw error;
        }
    }

    public async writeCoil(address: number, value: boolean): Promise<void> {
        await this.ensureConnected();
        //this.node.log(`Modbus: Writing Coil at address ${address}, value ${value}...`);
        try {
            await this.client.writeCoil(address, value);
            //this.node.log(`Modbus: Successfully wrote Coil at address ${address}, value ${value}`);
        } catch (error) {
            //this.node.log(`Modbus: Error writing Coil at address ${address}, value ${value}: ${(error as Error).message}`);
            this.handleError(error as Error);
            throw error;
        }
    }

    // Ngắt kết nối
    public disconnect(): void {
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
    public isConnectedCheck(): boolean {
        return this.isConnected;
    }
}