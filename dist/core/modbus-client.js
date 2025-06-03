"use strict";
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
    async initializeClient() {
        //this.node.log(`Modbus: Attempting to connect type ${this.config.type}...`); // Log connection attempt
        try {
            if (this.config.type === "TCP") {
                await this.connectTCP();
            }
            else if (this.config.type === "RTU") {
                await this.connectRTU();
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
    }
    // Kết nối TCP với các tùy chọn tối ưu cho STM32
    async connectTCP() {
        if (!this.config.host || !this.config.tcpPort) {
            throw new Error("Host and tcpPort are required for Modbus TCP");
        }
        // Tùy chọn tối ưu cho STM32 và embedded devices
        const tcpOptions = {
            port: this.config.tcpPort,
            // Tùy chọn socket được tối ưu cho embedded devices
            socketOptions: {
                // KHÔNG dùng keep-alive với STM32 vì có thể gây vấn đề
                keepAlive: false,
                // Timeout ngắn hơn cho embedded devices
                timeout: Math.min(this.config.timeout || 3000, 3000),
                // Không trì hoãn gửi dữ liệu (quan trọng cho real-time)
                noDelay: true,
                // Thêm các tùy chọn cho embedded devices
                family: 4, // Force IPv4
                // Retry connection nhanh hơn
                connectTimeout: 2000
            }
        };
        this.node.log(`[STM32-OPTIMIZED] Connecting to Modbus TCP at ${this.config.host}:${this.config.tcpPort}`);
        try {
            // Thử kết nối với timeout ngắn cho STM32
            const connectPromise = this.client.connectTCP(this.config.host, tcpOptions);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Connection timeout after 2s')), 2000);
            });
            await Promise.race([connectPromise, timeoutPromise]);
            this.node.log(`[STM32-SUCCESS] Connected to STM32 Modbus at ${this.config.host}:${this.config.tcpPort}`);
        }
        catch (error) {
            const err = error;
            this.node.error(`[STM32-FAILED] Failed to connect to STM32 at ${this.config.host}:${this.config.tcpPort}: ${err.message}`);
            throw error;
        }
    }
    // Kết nối RTU
    async connectRTU() {
        if (!this.config.serialPort) {
            throw new Error("Serial port is required for Modbus RTU");
        }
        await this.client.connectRTUBuffered(this.config.serialPort, {
            baudRate: this.config.baudRate,
            parity: this.config.parity,
        });
    }
    // Xử lý lỗi với cơ chế phục hồi nâng cao
    handleError(error) {
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
        const isConnectionError = connectionErrors.some(errText => error.message.includes(errText));
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
                }
                catch (closeErr) {
                    // Bỏ qua lỗi khi đóng kết nối
                }
                // Lên lịch kết nối lại ngay lập tức cho lỗi kết nối
                if (this.config.type === "TCP") {
                    // Tạo client mới để tránh vấn đề với client cũ
                    this.client = new modbus_serial_1.default();
                    // Lên lịch kết nối lại
                    this.scheduleReconnect();
                }
            }
        }
    }
    scheduleReconnect() {
        // Nếu đã có timer đang chạy, không tạo thêm
        if (this.reconnectTimer) {
            this.node.log(`[STM32-RECONNECT] Already scheduled, skipping`);
            return;
        }
        // STM32 cần thời gian recovery ngắn hơn nhưng ổn định
        const quickReconnectTime = 2000; // 2 giây cho STM32
        const standardReconnectTime = Math.max(this.config.reconnectInterval || 5000, 5000); // Tối thiểu 5s
        this.node.log(`[STM32-RECONNECT] Scheduling quick reconnect in ${quickReconnectTime}ms`);
        // Thử kết nối lại nhanh
        this.reconnectTimer = setTimeout(async () => {
            try {
                // Tạo client mới để tránh vấn đề với client cũ
                this.client = new modbus_serial_1.default();
                // Thử kết nối lại
                await this.initializeClient();
                this.node.log(`[STM32-RECONNECT] Quick reconnect successful`);
                // Xóa timer
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = undefined;
                // KHÔNG verify với readCoils ngay - STM32 cần thời gian ổn định
                this.node.log(`[STM32-RECONNECT] Connection established, allowing STM32 to stabilize`);
            }
            catch (error) {
                const err = error;
                this.node.warn(`[STM32-RECONNECT] Quick attempt failed: ${err.message}`);
                // Xóa timer hiện tại
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = undefined;
                // Lên lịch thử lại với thời gian dài hơn cho STM32
                this.node.log(`[STM32-RECONNECT] Scheduling standard reconnect in ${standardReconnectTime}ms`);
                this.reconnectTimer = setTimeout(async () => {
                    try {
                        // Tạo client mới lần nữa
                        this.client = new modbus_serial_1.default();
                        // Thử kết nối lại
                        await this.initializeClient();
                        this.node.log(`[STM32-RECONNECT] Standard reconnect successful`);
                        // Xóa timer
                        clearTimeout(this.reconnectTimer);
                        this.reconnectTimer = undefined;
                    }
                    catch (retryError) {
                        this.node.warn(`[STM32-RECONNECT] Standard attempt failed: ${retryError.message}`);
                        // Xóa timer
                        clearTimeout(this.reconnectTimer);
                        this.reconnectTimer = undefined;
                        // Lên lịch thử lại với exponential backoff cho STM32
                        this.scheduleReconnectWithBackoff();
                    }
                }, standardReconnectTime);
            }
        }, quickReconnectTime);
    }
    // Thêm exponential backoff cho STM32
    scheduleReconnectWithBackoff(attempt = 1) {
        const maxAttempts = 5;
        const baseDelay = 5000; // 5 giây
        const maxDelay = 30000; // Tối đa 30 giây
        if (attempt > maxAttempts) {
            this.node.error(`[STM32-RECONNECT] Max reconnection attempts (${maxAttempts}) reached. Stopping automatic reconnection.`);
            return;
        }
        // Exponential backoff: 5s, 10s, 20s, 30s, 30s
        const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
        this.node.log(`[STM32-RECONNECT] Scheduling backoff reconnect attempt ${attempt}/${maxAttempts} in ${delay}ms`);
        this.reconnectTimer = setTimeout(async () => {
            try {
                this.client = new modbus_serial_1.default();
                await this.initializeClient();
                this.node.log(`[STM32-RECONNECT] Backoff reconnect successful on attempt ${attempt}`);
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = undefined;
            }
            catch (error) {
                this.node.warn(`[STM32-RECONNECT] Backoff attempt ${attempt} failed: ${error.message}`);
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = undefined;
                // Thử lại với attempt tăng lên
                this.scheduleReconnectWithBackoff(attempt + 1);
            }
        }, delay);
    }
    startConnectionCheck() {
        // Kiểm tra kết nối ít thường xuyên hơn cho STM32 (mỗi 15 giây)
        setInterval(async () => {
            try {
                // Kiểm tra cả trạng thái isConnected và client.isOpen
                if (!this.isConnected || !this.client.isOpen) {
                    this.node.log("[STM32-CHECK] Connection appears to be closed, attempting to reconnect...");
                    // Đánh dấu là đã ngắt kết nối
                    this.isConnected = false;
                    // Thử kết nối lại
                    await this.initializeClient();
                    return;
                }
                // CHỈ kiểm tra connection status, KHÔNG đọc data để tránh làm phiền STM32
                // STM32 có thể bận xử lý và không phản hồi ngay
                if (this.client.isOpen && this.isConnected) {
                    // Connection vẫn OK, không cần làm gì
                    return;
                }
                // Nếu có vấn đề với connection state
                if (!this.isConnected) {
                    this.node.log("[STM32-CHECK] Connection state inconsistent, attempting reconnect...");
                    await this.initializeClient();
                }
            }
            catch (error) {
                const err = error;
                this.node.log(`[STM32-CHECK] Connection check failed: ${err.message}`);
                // Nếu lỗi liên quan đến kết nối, đánh dấu là đã ngắt kết nối
                if (err.message.includes("Timed out") ||
                    err.message.includes("Port Not Open") ||
                    err.message.includes("ECONNREFUSED") ||
                    err.message.includes("ETIMEDOUT") ||
                    err.message.includes("ECONNRESET") ||
                    err.message.includes("socket hang up") ||
                    err.message.includes("EPIPE")) {
                    this.isConnected = false;
                    this.node.status({ fill: "red", shape: "ring", text: `STM32 Disconnected` });
                    this.emit("modbus-status", { status: "disconnected", error: err.message });
                    // Đóng kết nối hiện tại nếu còn mở
                    try {
                        this.client.close();
                    }
                    catch (closeErr) {
                        // Bỏ qua lỗi khi đóng kết nối
                    }
                    // Lên lịch kết nối lại
                    this.scheduleReconnect();
                }
                else {
                    // Xử lý các lỗi khác
                    this.handleError(err);
                }
            }
        }, 15000); // Kiểm tra mỗi 15 giây cho STM32
    }
    async ensureConnected() {
        // Kiểm tra kết nối hiện tại
        if (!this.isConnected || !this.client.isOpen) {
            this.node.log("[STM32-ENSURE] Connection lost or not initialized, attempting to reconnect...");
            // Đóng kết nối hiện tại nếu còn mở
            try {
                if (this.client.isOpen) {
                    this.client.close();
                }
            }
            catch (closeErr) {
                // Bỏ qua lỗi khi đóng kết nối
            }
            // Tạo client mới để tránh vấn đề với client cũ
            this.client = new modbus_serial_1.default();
            // Thử kết nối lại với retry logic tối ưu cho STM32
            let retryCount = 0;
            const maxRetries = 2; // Giảm số retry cho STM32
            while (retryCount < maxRetries) {
                try {
                    await this.initializeClient();
                    break; // Thoát khỏi vòng lặp nếu kết nối thành công
                }
                catch (error) {
                    retryCount++;
                    const err = error;
                    this.node.log(`[STM32-ENSURE] Reconnection attempt ${retryCount}/${maxRetries} failed: ${err.message}`);
                    if (retryCount >= maxRetries) {
                        throw new Error(`[STM32-ENSURE] Failed to reconnect after ${maxRetries} attempts: ${err.message}`);
                    }
                    // Đợi lâu hơn cho STM32 recovery
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }
        // KHÔNG verify với readCoils cho STM32 - có thể gây thêm lỗi
        // STM32 cần thời gian để ổn định sau khi kết nối
        if (this.isConnected && this.client.isOpen) {
            // Connection đã OK, không cần verify thêm
            return;
        }
        // Chỉ verify nếu thực sự cần thiết
        if (!this.isConnected) {
            throw new Error("[STM32-ENSURE] Connection could not be established");
        }
    }
    async readCoils(address, length) {
        await this.ensureConnected();
        try {
            // Thêm timeout wrapper cho STM32
            const readPromise = this.client.readCoils(address, length);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`[STM32-TIMEOUT] Read coils timeout after 3s`)), 3000);
            });
            const { data } = await Promise.race([readPromise, timeoutPromise]);
            return { address, data };
        }
        catch (error) {
            const err = error;
            this.node.warn(`[STM32-READ] Error reading coils at ${address}: ${err.message}`);
            this.handleError(err);
            throw error;
        }
    }
    async readInputRegisters(address, length) {
        await this.ensureConnected();
        try {
            // Thêm timeout wrapper cho STM32
            const readPromise = this.client.readInputRegisters(address, length);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`[STM32-TIMEOUT] Read input registers timeout after 3s`)), 3000);
            });
            const { data } = await Promise.race([readPromise, timeoutPromise]);
            return { address, data };
        }
        catch (error) {
            const err = error;
            this.node.warn(`[STM32-READ] Error reading input registers at ${address}: ${err.message}`);
            this.handleError(err);
            throw error;
        }
    }
    async readHoldingRegisters(address, length) {
        await this.ensureConnected();
        try {
            // Thêm timeout wrapper cho STM32
            const readPromise = this.client.readHoldingRegisters(address, length);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`[STM32-TIMEOUT] Read holding registers timeout after 3s`)), 3000);
            });
            const { data } = await Promise.race([readPromise, timeoutPromise]);
            return { address, data };
        }
        catch (error) {
            const err = error;
            this.node.warn(`[STM32-READ] Error reading holding registers at ${address}: ${err.message}`);
            this.handleError(err);
            throw error;
        }
    }
    // Ghi Holding Register
    async writeRegister(address, value) {
        await this.ensureConnected();
        try {
            // Thêm timeout wrapper cho STM32 write operations
            const writePromise = this.client.writeRegister(address, value);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`[STM32-TIMEOUT] Write register timeout after 3s`)), 3000);
            });
            await Promise.race([writePromise, timeoutPromise]);
            this.node.log(`[STM32-WRITE] Successfully wrote register ${address} = ${value}`);
        }
        catch (error) {
            const err = error;
            this.node.warn(`[STM32-WRITE] Error writing register ${address}: ${err.message}`);
            this.handleError(err);
            throw error;
        }
    }
    async writeCoil(address, value) {
        await this.ensureConnected();
        try {
            // Thêm timeout wrapper cho STM32 write operations
            const writePromise = this.client.writeCoil(address, value);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`[STM32-TIMEOUT] Write coil timeout after 3s`)), 3000);
            });
            await Promise.race([writePromise, timeoutPromise]);
            this.node.log(`[STM32-WRITE] Successfully wrote coil ${address} = ${value}`);
        }
        catch (error) {
            const err = error;
            this.node.warn(`[STM32-WRITE] Error writing coil ${address}: ${err.message}`);
            this.handleError(err);
            throw error;
        }
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
