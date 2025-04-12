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
        this.startConnectionCheck(); // Bắt đầu kiểm tra kết nối
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

    // Kết nối TCP với các tùy chọn nâng cao
    private async connectTCP(): Promise<void> {
        if (!this.config.host || !this.config.tcpPort) {
            throw new Error("Host and tcpPort are required for Modbus TCP");
        }

        // Tùy chọn nâng cao cho kết nối TCP
        const tcpOptions = {
            port: this.config.tcpPort,
            // Thêm các tùy chọn socket để cải thiện độ ổn định
            socketOptions: {
                // Gửi gói tin keep-alive để giữ kết nối
                keepAlive: true,
                // Gửi gói tin keep-alive sau 10 giây không hoạt động
                keepAliveInitialDelay: 10000,
                // Đặt timeout cho socket (ms)
                timeout: this.config.timeout || 5000,
                // Không trì hoãn gửi dữ liệu (Nagle's algorithm)
                noDelay: true
            }
        };

        this.node.log(`Connecting to Modbus TCP at ${this.config.host}:${this.config.tcpPort} with enhanced options`);

        try {
            // Thử kết nối với tùy chọn nâng cao
            await this.client.connectTCP(this.config.host, tcpOptions);
            this.node.log(`Successfully connected to Modbus TCP at ${this.config.host}:${this.config.tcpPort}`);
        } catch (error) {
            const err = error as Error;
            this.node.error(`Failed to connect to Modbus TCP at ${this.config.host}:${this.config.tcpPort}: ${err.message}`);
            throw error;
        }
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

    // Xử lý lỗi với cơ chế phục hồi nâng cao
    private handleError(error: Error): void {
        // Log lỗi chi tiết
        this.node.error(`Modbus Error: ${error.message}`);
        this.node.status({ fill: "yellow", shape: "ring", text: `Error: ${error.message}` });
        this.emit("modbus-status", { status: "error", error: error.message });

        // Danh sách các lỗi liên quan đến kết nối
        const connectionErrors = [
            "Timed out",
            "Port Not Open",
            "ECONNREFUSED",
            "ETIMEDOUT",
            "ECONNRESET",
            "EPIPE",
            "EHOSTUNREACH",
            "ENETUNREACH",
            "socket hang up",
            "socket closed",
            "cannot connect"
        ];

        // Kiểm tra xem lỗi có phải là lỗi kết nối không
        const isConnectionError = connectionErrors.some(errText =>
            error.message.includes(errText)
        );

        if (isConnectionError) {
            this.wasConnected = this.isConnected; // Cập nhật trạng thái kết nối trước đó
            this.isConnected = false;

            if (this.wasConnected) { // Chỉ log khi trạng thái thay đổi
                this.node.log(`Modbus connection lost due to: "${error.message}"`);
                this.node.status({ fill: "red", shape: "ring", text: "Disconnected" });
                this.emit("modbus-status", { status: "disconnected", error: error.message });

                // Đóng kết nối hiện tại nếu còn mở
                try {
                    if (this.client.isOpen) {
                        this.client.close();
                    }
                } catch (closeErr) {
                    // Bỏ qua lỗi khi đóng kết nối
                }

                // Lên lịch kết nối lại ngay lập tức cho lỗi kết nối
                if (this.config.type === "TCP") {
                    // Tạo client mới để tránh vấn đề với client cũ
                    this.client = new ModbusRTU();
                    // Lên lịch kết nối lại
                    this.scheduleReconnect();
                }
            }
        }
    }

    private scheduleReconnect(): void {
        // Nếu đã có timer đang chạy, không tạo thêm
        if (this.reconnectTimer) {
            this.node.log(`Reconnect already scheduled, skipping new schedule`);
            return;
        }

        // Sử dụng thời gian reconnect ngắn hơn cho lần thử đầu tiên
        const quickReconnectTime = Math.min(1000, this.config.reconnectInterval || 5000);

        this.node.log(`Scheduling quick reconnect in ${quickReconnectTime}ms for ${this.config.type}`);

        // Thử kết nối lại nhanh
        this.reconnectTimer = setTimeout(async () => {
            try {
                // Tạo client mới để tránh vấn đề với client cũ
                this.client = new ModbusRTU();

                // Thử kết nối lại
                await this.initializeClient();
                this.node.log(`Reconnected successfully for ${this.config.type}`);

                // Xóa timer
                clearTimeout(this.reconnectTimer!);
                this.reconnectTimer = undefined;

                // Kiểm tra kết nối
                try {
                    await this.client.readCoils(0, 1);
                    this.node.log(`Connection verified successfully`);
                } catch (verifyError) {
                    this.node.error(`Connection verification failed: ${(verifyError as Error).message}`);
                    throw verifyError;
                }
            } catch (error) {
                const err = error as Error;
                this.node.error(`Quick reconnect failed: ${err.message}`);

                // Xóa timer hiện tại
                clearTimeout(this.reconnectTimer!);
                this.reconnectTimer = undefined;

                // Lên lịch thử lại với thời gian dài hơn
                this.node.log(`Scheduling standard reconnect in ${this.config.reconnectInterval}ms for ${this.config.type}`);
                this.reconnectTimer = setTimeout(async () => {
                    try {
                        // Tạo client mới lần nữa
                        this.client = new ModbusRTU();

                        // Thử kết nối lại
                        await this.initializeClient();
                        this.node.log(`Reconnected successfully on standard attempt for ${this.config.type}`);

                        // Xóa timer
                        clearTimeout(this.reconnectTimer!);
                        this.reconnectTimer = undefined;
                    } catch (retryError) {
                        this.node.error(`Standard reconnect failed: ${(retryError as Error).message}`);

                        // Xóa timer
                        clearTimeout(this.reconnectTimer!);
                        this.reconnectTimer = undefined;

                        // Lên lịch thử lại
                        this.scheduleReconnect();
                    }
                }, this.config.reconnectInterval);
            }
        }, quickReconnectTime);
    }


    private startConnectionCheck(): void {
        // Kiểm tra kết nối thường xuyên hơn (mỗi 10 giây)
        setInterval(async () => {
            try {
                // Kiểm tra cả trạng thái isConnected và client.isOpen
                if (!this.isConnected || !this.client.isOpen) {
                    this.node.log("Connection check: Connection appears to be closed, attempting to reconnect...");
                    // Đánh dấu là đã ngắt kết nối
                    this.isConnected = false;
                    // Thử kết nối lại
                    await this.initializeClient();
                    return;
                }

                // Thử đọc 1 coil để kiểm tra kết nối thực tế
                await this.client.readCoils(0, 1);

                // Nếu đọc thành công nhưng trạng thái là disconnected, cập nhật lại
                if (!this.isConnected) {
                    this.isConnected = true;
                    this.node.status({ fill: "green", shape: "dot", text: "Connected" });
                    this.emit("modbus-status", { status: "connected" });
                    this.node.log("Connection check: Connection restored");
                }
            } catch (error) {
                const err = error as Error;
                this.node.log(`Connection check failed: ${err.message}`);

                // Nếu lỗi liên quan đến kết nối, đánh dấu là đã ngắt kết nối
                if (err.message.includes("Timed out") ||
                    err.message.includes("Port Not Open") ||
                    err.message.includes("ECONNREFUSED") ||
                    err.message.includes("ETIMEDOUT") ||
                    err.message.includes("ECONNRESET")) {

                    this.isConnected = false;
                    this.node.status({ fill: "red", shape: "ring", text: `Disconnected: ${err.message}` });
                    this.emit("modbus-status", { status: "disconnected", error: err.message });

                    // Đóng kết nối hiện tại nếu còn mở
                    try {
                        this.client.close();
                    } catch (closeErr) {
                        // Bỏ qua lỗi khi đóng kết nối
                    }

                    // Lên lịch kết nối lại
                    this.scheduleReconnect();
                } else {
                    // Xử lý các lỗi khác
                    this.handleError(err);
                }
            }
        }, 10000); // Kiểm tra mỗi 10 giây
    }

    private async ensureConnected(): Promise<void> {
        // Kiểm tra kết nối hiện tại
        if (!this.isConnected || !this.client.isOpen) {
            this.node.log("Connection lost or not initialized, attempting to reconnect...");

            // Đóng kết nối hiện tại nếu còn mở
            try {
                if (this.client.isOpen) {
                    this.client.close();
                }
            } catch (closeErr) {
                // Bỏ qua lỗi khi đóng kết nối
            }

            // Tạo client mới để tránh vấn đề với client cũ
            this.client = new ModbusRTU();

            // Thử kết nối lại
            let retryCount = 0;
            const maxRetries = 3;

            while (retryCount < maxRetries) {
                try {
                    await this.initializeClient();
                    break; // Thoát khỏi vòng lặp nếu kết nối thành công
                } catch (error) {
                    retryCount++;
                    const err = error as Error;
                    this.node.log(`Reconnection attempt ${retryCount}/${maxRetries} failed: ${err.message}`);

                    if (retryCount >= maxRetries) {
                        throw new Error(`Failed to reconnect after ${maxRetries} attempts: ${err.message}`);
                    }

                    // Đợi một khoảng thời gian trước khi thử lại
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }

        // Kiểm tra thử một thao tác đơn giản để xác nhận kết nối
        try {
            await this.client.readCoils(0, 1);
        } catch (error) {
            const err = error as Error;
            this.node.log(`Connection verification failed: ${err.message}, forcing reinitialization...`);

            // Đóng kết nối hiện tại
            try {
                this.client.close();
            } catch (closeErr) {
                // Bỏ qua lỗi khi đóng kết nối
            }

            // Tạo client mới
            this.client = new ModbusRTU();
            this.isConnected = false;

            // Thử kết nối lại một lần nữa
            await this.initializeClient();

            // Kiểm tra lại kết nối
            try {
                await this.client.readCoils(0, 1);
            } catch (verifyError) {
                // Nếu vẫn thất bại, ném lỗi để hàm gọi xử lý
                throw new Error(`Failed to establish a stable connection: ${(verifyError as Error).message}`);
            }
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