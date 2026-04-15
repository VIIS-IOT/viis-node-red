"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModbusClientCore = exports.ConnectionState = void 0;
const modbus_serial_1 = __importDefault(require("modbus-serial"));
const events_1 = require("events");
// Connection state machine for managing connection lifecycle
var ConnectionState;
(function (ConnectionState) {
    ConnectionState["DISCONNECTED"] = "disconnected";
    ConnectionState["CONNECTING"] = "connecting";
    ConnectionState["CONNECTED"] = "connected";
    ConnectionState["RECONNECTING"] = "reconnecting";
    ConnectionState["ERROR"] = "error";
    ConnectionState["CIRCUIT_BREAKER_OPEN"] = "circuit_breaker_open";
})(ConnectionState || (exports.ConnectionState = ConnectionState = {}));
// Core Modbus Client
class ModbusClientCore extends events_1.EventEmitter {
    constructor(config, node) {
        super();
        this.isConnected = false;
        this.wasConnected = false; // Track connection state
        // Request queue for serializing Modbus operations
        this.requestQueue = Promise.resolve();
        this.queueLength = 0;
        this.isShuttingDown = false; // Flag to prevent new operations during shutdown
        // Circuit breaker pattern for recovery management
        this.failedConnectionCount = 0;
        this.circuitBreakerOpen = false;
        this.disconnectStartTime = null;
        // FSM state management
        this.connectionState = ConnectionState.DISCONNECTED;
        this.stateHistory = [];
        this.lastStateChangeAt = 0;
        this.MIN_RECONNECT_INTERVAL = 5000; // Minimum 5s between reconnects
        this.SERVER_CLEANUP_TIME = 120000; // 120s for TCP TIME_WAIT cleanup
        // USB Serial Port Recovery (URB -32 / EPIPE errors)
        this.consecutiveErrors = 0;
        this.MAX_CONSECUTIVE_ERRORS = 5; // Trigger recovery after 5 consecutive errors
        this.isRecovering = false; // Prevent concurrent recovery attempts
        this.recoveryLockPromise = null; // Atomic lock for recovery
        this.USB_SERIAL_ERRORS = [
            "EPIPE", // USB broken pipe (URB -32)
            "urb stopped: -32", // Linux kernel USB error
            "Resource temporarily unavailable", // Port locked after USB error
            "Cannot lock port", // Port lock after USB failure
            "Input/output error", // Generic USB I/O error
            "EBUSY", // USB device busy
            "ENODEV" // USB device disconnected
        ];
        this.node = node; // Set node first before calling other methods
        this.config = Object.assign({ tcpPort: 502, baudRate: 9600, parity: "none", unitId: 1, timeout: 8000, reconnectInterval: 30000, 
            // Board-specific defaults
            boardType: "STM32", writeTimeout: 8000, readTimeout: 8000, connectionTimeout: 8000, maxRetries: 3 }, config);
        // Apply board-specific optimizations (after node is set)
        this.applyBoardSpecificConfig();
        this.client = new modbus_serial_1.default();
        this.initializeClient();
        this.startConnectionCheck(); // Bắt đầu kiểm tra kết nối
    }
    /**
     * Enqueue a Modbus request to serialize operations
     * This prevents overwhelming STM32 when multiple nodes poll simultaneously
     * Now with timeout protection to prevent queue deadlock
     */
    async enqueueRequest(operation) {
        // Add to queue
        this.queueLength++;
        const queueTimeout = 30000; // 30 seconds max wait time in queue
        const queueStartTime = Date.now();
        // Chain the operation to the queue with timeout protection
        const result = this.requestQueue.then(async () => {
            try {
                // Check if request has been waiting too long
                const waitTime = Date.now() - queueStartTime;
                if (waitTime > queueTimeout) {
                    throw new Error(`[QUEUE-TIMEOUT] Request timed out after waiting ${waitTime}ms in queue`);
                }
                // Add inter-request delay to prevent overwhelming device
                if (this.queueLength > 1) {
                    const interRequestDelay = this.config.boardType === 'ATMEGA' ? 100 : 50;
                    await new Promise(resolve => setTimeout(resolve, interRequestDelay));
                }
                return await operation();
            }
            finally {
                this.queueLength--;
            }
        });
        // Update queue reference
        this.requestQueue = result.catch(() => { }); // Catch to prevent queue blocking on errors
        return result;
    }
    /**
     * Apply board-specific configuration optimizations
     */
    applyBoardSpecificConfig() {
        const boardType = this.config.boardType || "STM32";
        switch (boardType) {
            case "ATMEGA":
                // ATmega boards typically need longer timeouts
                this.config.writeTimeout = this.config.writeTimeout || 8000;
                this.config.readTimeout = this.config.readTimeout || 8000;
                this.config.connectionTimeout = this.config.connectionTimeout || 5000;
                this.config.maxRetries = this.config.maxRetries || 3;
                if (this.node && this.node.log) {
                    //this.node.log(`[${boardType}] Applied ATmega-specific configuration: writeTimeout=${this.config.writeTimeout}ms, readTimeout=${this.config.readTimeout}ms`);
                }
                break;
            case "STM32":
                // STM32 boards - optimized timeouts for fast polling (reduced from 8000ms to 3000ms)
                this.config.writeTimeout = this.config.writeTimeout || 5000;
                this.config.readTimeout = this.config.readTimeout || 3000; // Reduced for fast polling
                this.config.connectionTimeout = this.config.connectionTimeout || 3000;
                this.config.maxRetries = this.config.maxRetries || 2; // Reduced retries
                if (this.node && this.node.log) {
                    //this.node.log(`[${boardType}] Applied STM32-specific configuration: writeTimeout=${this.config.writeTimeout}ms, readTimeout=${this.config.readTimeout}ms`);
                }
                break;
            default:
                // Generic configuration
                this.config.writeTimeout = this.config.writeTimeout || 5000;
                this.config.readTimeout = this.config.readTimeout || 5000;
                this.config.connectionTimeout = this.config.connectionTimeout || 3000;
                this.config.maxRetries = this.config.maxRetries || 3;
                if (this.node && this.node.log) {
                    //this.node.log(`[${boardType}] Applied generic configuration: writeTimeout=${this.config.writeTimeout}ms, readTimeout=${this.config.readTimeout}ms`);
                }
                break;
        }
    }
    /**
     * FSM state transition method with logging and event emission
     */
    transitionTo(newState) {
        const oldState = this.connectionState;
        this.connectionState = newState;
        this.lastStateChangeAt = Date.now();
        this.stateHistory.push({ state: newState, timestamp: this.lastStateChangeAt });
        // Keep only last 50 state changes
        if (this.stateHistory.length > 50) {
            this.stateHistory = this.stateHistory.slice(-50);
        }
        if (oldState !== newState) {
            this.node.log(`[FSM] ${oldState} → ${newState}`);
            this.emit('state-change', { from: oldState, to: newState, timestamp: this.lastStateChangeAt });
        }
    }
    /**
     * Get current connection state (for debugging/monitoring)
     */
    getConnectionState() {
        return this.connectionState;
    }
    /**
     * Get recent state history (for debugging)
     */
    getStateHistory() {
        return [...this.stateHistory];
    }
    // Khởi tạo client
    async initializeClient() {
        ////this.node.log(`Modbus: Attempting to connect type ${this.config.type}...`); // Log connection attempt
        // FSM: Transition to CONNECTING
        this.transitionTo(ConnectionState.CONNECTING);
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
            const wasConnected = this.isConnected;
            this.isConnected = true;
            // FSM: Transition to CONNECTED
            this.transitionTo(ConnectionState.CONNECTED);
            // Reset counters on successful connection
            if (!wasConnected) {
                this.failedConnectionCount = 0;
                this.disconnectStartTime = null;
                this.node.status({ fill: "green", shape: "dot", text: "Connected" });
                this.emit("modbus-status", { status: "connected" });
            }
            if (this.config.type === "TCP") {
                ////this.node.log(`Modbus TCP: Connected successfully to ${this.config.host}:${this.config.tcpPort}`); // Log TCP connect success
            }
            else if (this.config.type === "RTU") {
                ////this.node.log(`Modbus RTU: Connected successfully to ${this.config.serialPort}`); // Log RTU connect success
            }
        }
        catch (error) {
            ////this.node.log(`Modbus: Connection failed for type ${this.config.type}: ${(error as Error).message}`); // Log connection error
            // FSM: Transition to ERROR (handleError does this)
            this.handleError(error);
            if (this.config.type === "TCP") {
                // Sử dụng circuit breaker thay vì scheduleReconnect trực tiếp
                this.scheduleReconnectWithCircuitBreaker();
            }
        }
    }
    // Kết nối TCP với các tùy chọn tối ưu cho board cụ thể
    async connectTCP() {
        if (!this.config.host || !this.config.tcpPort) {
            throw new Error("Host and tcpPort are required for Modbus TCP");
        }
        const boardType = this.config.boardType || "STM32";
        // Tùy chọn socket được tối ưu cho từng loại board
        const socketOptions = this.getBoardSpecificSocketOptions(boardType);
        const tcpOptions = {
            port: this.config.tcpPort,
            socketOptions: Object.assign(Object.assign({}, socketOptions), { timeout: this.config.connectionTimeout || socketOptions.timeout, connectTimeout: this.config.connectionTimeout || socketOptions.connectTimeout })
        };
        //this.node.log(`[${boardType}-OPTIMIZED] Connecting to Modbus TCP at ${this.config.host}:${this.config.tcpPort} with timeout ${this.config.connectionTimeout}ms`);
        try {
            // Thử kết nối với timeout được cấu hình cho board cụ thể
            const connectPromise = this.client.connectTCP(this.config.host, tcpOptions);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`[${boardType}-TIMEOUT] Connection timeout after ${this.config.connectionTimeout}ms`)), this.config.connectionTimeout || 3000);
            });
            await Promise.race([connectPromise, timeoutPromise]);
            //this.node.log(`[${boardType}-SUCCESS] Connected to ${boardType} Modbus at ${this.config.host}:${this.config.tcpPort}`);
        }
        catch (error) {
            const err = error;
            this.node.error(`[${boardType}-FAILED] Failed to connect to ${boardType} at ${this.config.host}:${this.config.tcpPort}: ${err.message}`);
            throw error;
        }
    }
    /**
     * Get board-specific socket options
     * TCP keepalive enabled to detect half-open connections before device hits max connection limit
     */
    getBoardSpecificSocketOptions(boardType) {
        switch (boardType) {
            case "ATMEGA":
                return {
                    keepAlive: true, // Enable to detect half-open connections
                    keepAliveDelay: 60000, // 60s before sending keepalive probes
                    timeout: 8000,
                    noDelay: false, // Use Nagle's algorithm (reduce packet count)
                    family: 4,
                    connectTimeout: 5000
                };
            case "STM32":
                return {
                    keepAlive: true, // Enable for all boards
                    keepAliveDelay: 30000, // 30s for faster detection
                    timeout: 3000,
                    noDelay: true,
                    family: 4,
                    connectTimeout: 2000
                };
            default:
                return {
                    keepAlive: true,
                    keepAliveDelay: 30000,
                    timeout: 3000,
                    noDelay: true,
                    family: 4,
                    connectTimeout: 3000
                };
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
        // FSM: Transition to ERROR
        this.transitionTo(ConnectionState.ERROR);
        // Log lỗi chi tiết
        this.node.error(`Modbus Error: ${error.message}`);
        this.node.status({ fill: "yellow", shape: "ring", text: `Error: ${error.message}` });
        this.emit("modbus-status", { status: "error", error: error.message });
        // Check if this is a USB serial error that might need port recovery
        const isUsbError = this.isUsbSerialError(error.message);
        if (isUsbError) {
            this.consecutiveErrors++;
            this.node.warn(`[USB-ERROR] Consecutive USB errors: ${this.consecutiveErrors}/${this.MAX_CONSECUTIVE_ERRORS} - "${error.message}"`);
            // Trigger auto-recovery if threshold reached
            // Use atomic lock to prevent race conditions
            if (this.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS && !this.recoveryLockPromise) {
                this.node.warn(`[USB-RECOVERY] Threshold reached! Attempting automatic port recovery...`);
                this.recoveryLockPromise = this.attemptPortRecovery()
                    .catch(recoveryError => {
                    this.node.error(`[USB-RECOVERY] Recovery failed: ${recoveryError.message}`);
                })
                    .finally(() => {
                    this.recoveryLockPromise = null; // Release lock
                });
            }
        }
        else {
            // Reset counter on non-USB errors (might be normal timeouts)
            this.consecutiveErrors = 0;
        }
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
            // FSM: Transition to DISCONNECTED
            this.transitionTo(ConnectionState.DISCONNECTED);
            if (this.wasConnected) { // Chỉ log khi trạng thái thay đổi
                //this.node.log(`Modbus connection lost due to: "${error.message}"`);
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
                    // Ensure old connection is fully cleaned up before creating new one
                    // Use IIFE to handle async operation in sync context
                    (async () => {
                        await this.ensureCleanConnection();
                        // Lên lịch kết nối lại
                        this.scheduleReconnect();
                    })();
                }
            }
        }
    }
    /**
     * Check if error is related to USB serial port failure (URB -32 / EPIPE)
     */
    isUsbSerialError(message) {
        return this.USB_SERIAL_ERRORS.some(err => message.includes(err));
    }
    /**
     * Force-close and recreate the serial port connection
     * This simulates the effect of `docker restart nodered1` without restarting the container
     */
    async attemptPortRecovery() {
        if (this.recoveryLockPromise) {
            this.node.warn("[USB-RECOVERY] Recovery already in progress (locked), skipping");
            return;
        }
        this.isRecovering = true;
        const startTime = Date.now();
        try {
            this.node.warn("[USB-RECOVERY] Starting port recovery sequence...");
            this.node.status({ fill: "yellow", shape: "dot", text: "Recovering..." });
            // Step 1: Force close existing connection
            this.node.warn("[USB-RECOVERY] Step 1/5: Force-closing serial port...");
            await this.forceClosePort();
            // Step 2: Try USB driver unbind/rebind (kernel-level reset)
            this.node.warn("[USB-RECOVERY] Step 2/5: Attempting USB driver reset...");
            const usbResetSuccess = await this.tryUsbDriverReset();
            if (usbResetSuccess) {
                this.node.warn("[USB-RECOVERY] USB driver reset successful");
            }
            else {
                this.node.warn("[USB-RECOVERY] USB driver reset not available, continuing with standard recovery...");
            }
            // Step 3: Wait for USB stack to settle (critical for FTDI chips)
            this.node.warn("[USB-RECOVERY] Step 3/5: Waiting 3s for USB stack to settle...");
            await this.sleep(3000);
            // Step 4: Create completely new Modbus client (ensureCleanConnection handles this)
            this.node.warn("[USB-RECOVERY] Step 4/5: Creating new Modbus client instance...");
            await this.ensureCleanConnection();
            // Step 5: Attempt fresh connection
            this.node.warn("[USB-RECOVERY] Step 5/5: Attempting fresh connection...");
            await this.initializeClient();
            // Verify connection is actually working
            await this.sleep(1000); // Give connection time to stabilize
            if (this.isConnected && this.client.isOpen) {
                const recoveryTime = Date.now() - startTime;
                this.node.warn(`[USB-RECOVERY] ✅ SUCCESS! Port recovered in ${recoveryTime}ms`);
                this.node.status({ fill: "green", shape: "dot", text: "Recovered" });
                // Reset error counters
                this.consecutiveErrors = 0;
                this.failedConnectionCount = 0;
                // Emit recovery event
                this.emit("modbus-status", {
                    status: "recovered",
                    recoveryTimeMs: recoveryTime
                });
            }
            else {
                throw new Error("Connection not established after recovery");
            }
        }
        catch (error) {
            const recoveryTime = Date.now() - startTime;
            this.node.error(`[USB-RECOVERY] ❌ FAILED after ${recoveryTime}ms: ${error.message}`);
            this.node.status({ fill: "red", shape: "ring", text: "Recovery failed" });
            // Emit recovery failure event
            this.emit("modbus-status", {
                status: "recovery-failed",
                error: error.message,
                recoveryTimeMs: recoveryTime
            });
            // Schedule another recovery attempt after delay
            this.node.warn("[USB-RECOVERY] Will retry in 10 seconds...");
            setTimeout(() => {
                this.isRecovering = false;
                this.recoveryLockPromise = null; // Release lock
                this.attemptPortRecovery().catch(err => {
                    this.node.error(`[USB-RECOVERY] Retry also failed: ${err.message}`);
                });
            }, 10000);
            throw error;
        }
        finally {
            this.isRecovering = false;
        }
    }
    /**
     * Attempt to reset USB device by unbinding and rebinding the driver
     * Uses the same logic as the working bash script (scripts/usb-serial-recovery.sh)
     * Returns true if successful, false if not available
     */
    async tryUsbDriverReset() {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        const fs = require('fs');
        try {
            // Only works for RTU connections with serial port
            if (!this.config.serialPort) {
                this.node.warn("[USB-RECOVERY] Not an RTU connection, skipping USB reset");
                return false;
            }
            // Extract device name (e.g., ttyUSB0 from /dev/ttyUSB0)
            const deviceName = this.config.serialPort.split('/').pop();
            if (!deviceName) {
                this.node.warn("[USB-RECOVERY] Could not extract device name");
                return false;
            }
            this.node.warn(`[USB-RECOVERY] Detecting USB bus ID for ${deviceName}...`);
            let busId = '';
            // Method 1: Try multiple sysfs path patterns (same as bash script)
            const sysfsPaths = [
                `/sys/class/tty/${deviceName}/device/../../../uevent`,
                `/sys/class/tty/${deviceName}/device/../uevent`,
                `/sys/class/tty/${deviceName}/device/uevent`,
                `/sys/bus/usb-serial/devices/${deviceName}/../uevent`
            ];
            for (const sysfsPath of sysfsPaths) {
                try {
                    if (fs.existsSync(sysfsPath)) {
                        this.node.warn(`[USB-RECOVERY] Found sysfs path: ${sysfsPath}`);
                        const uevent = fs.readFileSync(sysfsPath, 'utf8');
                        const devPathMatch = uevent.match(/DEVPATH=(.+)/);
                        if (devPathMatch) {
                            const devPath = devPathMatch[1];
                            // Handle both "1-1.1:1.0" and "1-1.1" formats
                            const pathParts = devPath.split('/');
                            busId = pathParts[pathParts.length - 1];
                            // Clean up interface suffix if present (e.g., "1-1.1:1.0" -> "1-1.1")
                            if (busId.includes(':')) {
                                busId = busId.split(':')[0];
                            }
                            if (busId && /^\d+-\d+(\.\d+)*$/.test(busId)) {
                                this.node.warn(`[USB-RECOVERY] Detected USB bus ID: ${busId}`);
                                break;
                            }
                            else {
                                busId = ''; // Reset if invalid
                            }
                        }
                    }
                }
                catch (err) {
                    // Continue to next path
                }
            }
            // Method 2: If sysfs failed, scan sysfs directly for FTDI devices
            if (!busId) {
                this.node.warn("[USB-RECOVERY] Trying sysfs driver scan...");
                try {
                    const ftdiDir = '/sys/bus/usb/drivers/ftdi_sio';
                    if (fs.existsSync(ftdiDir)) {
                        const entries = fs.readdirSync(ftdiDir);
                        for (const entry of entries) {
                            // Match patterns like "1-1.1" or "1-1.1:1.0"
                            if (/^\d+-\d+(\.\d+)*(:\d+\.\d+)?$/.test(entry)) {
                                busId = entry.split(':')[0];
                                this.node.warn(`[USB-RECOVERY] Found FTDI device via sysfs scan: ${busId}`);
                                break;
                            }
                        }
                    }
                }
                catch (err) {
                    this.node.warn("[USB-RECOVERY] Sysfs scan failed: " + err.message);
                }
            }
            if (!busId) {
                this.node.warn("[USB-RECOVERY] Could not detect USB bus ID - USB driver reset skipped");
                this.node.warn("[USB-RECOVERY] Hint: Run 'sudo ./scripts/usb-serial-recovery.sh /dev/ttyUSB0' on host");
                return false;
            }
            this.node.warn(`[USB-RECOVERY] Resetting USB device: ${busId}`);
            // Try multiple unbind paths
            const unbindPaths = [
                '/sys/bus/usb/drivers/ftdi_sio/unbind',
                '/sys/bus/usb/drivers/usb/unbind',
                '/sys/bus/usb-serial/drivers/generic/unbind'
            ];
            let unbindSuccess = false;
            for (const unbindPath of unbindPaths) {
                try {
                    if (fs.existsSync(unbindPath)) {
                        this.node.warn(`[USB-RECOVERY] Unbinding via: ${unbindPath}`);
                        fs.writeFileSync(unbindPath, busId);
                        unbindSuccess = true;
                        this.node.warn("[USB-RECOVERY] ✅ Driver unbound successfully");
                        break;
                    }
                }
                catch (err) {
                    this.node.warn(`[USB-RECOVERY] Unbind failed via ${unbindPath}: ${err.message}`);
                }
            }
            // Wait for USB stack to settle
            await this.sleep(2000);
            // Try multiple bind paths
            const bindPaths = [
                '/sys/bus/usb/drivers/ftdi_sio/bind',
                '/sys/bus/usb/drivers/usb/bind',
                '/sys/bus/usb-serial/drivers/generic/bind'
            ];
            let bindSuccess = false;
            for (const bindPath of bindPaths) {
                try {
                    if (fs.existsSync(bindPath)) {
                        this.node.warn(`[USB-RECOVERY] Binding via: ${bindPath}`);
                        fs.writeFileSync(bindPath, busId);
                        bindSuccess = true;
                        this.node.warn("[USB-RECOVERY] ✅ Driver rebound successfully");
                        break;
                    }
                }
                catch (err) {
                    this.node.warn(`[USB-RECOVERY] Bind failed via ${bindPath}: ${err.message}`);
                }
            }
            // Wait for device to reappear
            await this.sleep(1000);
            if (unbindSuccess && bindSuccess) {
                this.node.warn("[USB-RECOVERY] ✅ USB driver unbind/bind completed");
                return true;
            }
            else {
                this.node.warn("[USB-RECOVERY] ⚠️ USB driver reset partially successful");
                return unbindSuccess || bindSuccess;
            }
        }
        catch (error) {
            this.node.warn(`[USB-RECOVERY] USB driver reset failed (non-critical): ${error.message}`);
            return false;
        }
    }
    /**
     * Force close the serial port with aggressive cleanup
     * Ensures all resources are released (similar to container restart effect)
     */
    async forceClosePort() {
        try {
            // Mark as disconnected
            this.isConnected = false;
            // CRITICAL: Remove ALL event listeners FIRST to prevent stale callbacks
            // This must happen BEFORE close() to avoid race conditions
            this.removeAllListeners();
            // Close client if open - with timeout protection
            if (this.client && this.client.isOpen) {
                try {
                    // Use timeout to prevent hanging on close
                    const closePromise = new Promise((resolve, reject) => {
                        try {
                            this.client.close();
                            resolve();
                        }
                        catch (err) {
                            reject(err);
                        }
                    });
                    await Promise.race([
                        closePromise,
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Close timeout')), 2000))
                    ]);
                }
                catch (closeError) {
                    this.node.warn(`[USB-RECOVERY] Close error (continuing): ${closeError.message}`);
                }
            }
            // CRITICAL: Wait for OS to release file descriptor
            // FTDI chips need at least 500ms for kernel cleanup
            await this.sleep(1000);
            // Additional: Try to release any lingering file locks
            // This helps with "Resource temporarily unavailable" errors
            try {
                // Force garbage collection hint (if available)
                if (global.gc) {
                    global.gc();
                }
            }
            catch (gcError) {
                // Ignore GC errors - not critical
            }
            this.node.warn("[USB-RECOVERY] Port force-closed and all listeners cleared");
        }
        catch (error) {
            this.node.warn(`[USB-RECOVERY] Force close error (continuing): ${error.message}`);
        }
    }
    /**
     * Sleep utility function
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    /**
     * Ensure old connection is fully closed before creating a new one
     * Prevents connection leaks and ensures OS releases file descriptors
     */
    async ensureCleanConnection() {
        if (this.client && this.client.isOpen) {
            this.node.log('[CLEANUP] Closing existing connection before creating new one');
            try {
                // Remove all listeners first to prevent stale callbacks
                this.removeAllListeners();
                // Close with timeout protection
                await Promise.race([
                    new Promise((resolve, reject) => {
                        try {
                            this.client.close(() => resolve());
                        }
                        catch (err) {
                            reject(err);
                        }
                    }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Close timeout')), 2000))
                ]);
                // Wait for OS to release file descriptor
                await new Promise(resolve => setTimeout(resolve, 1000));
                this.node.log('[CLEANUP] Connection closed successfully');
            }
            catch (closeError) {
                this.node.warn(`[CLEANUP] Close error (continuing): ${closeError.message}`);
            }
        }
        // Create fresh client instance
        this.client = new modbus_serial_1.default();
        this.isConnected = false;
    }
    scheduleReconnect() {
        // Don't schedule reconnect if shutting down
        if (this.isShuttingDown) {
            return;
        }
        // Nếu đã có timer đang chạy, không tạo thêm
        if (this.reconnectTimer) {
            //this.node.log(`[STM32-RECONNECT] Already scheduled, skipping`);
            return;
        }
        // FSM: Check minimum interval since last state change
        const timeSinceLastChange = Date.now() - this.lastStateChangeAt;
        if (timeSinceLastChange < this.MIN_RECONNECT_INTERVAL) {
            const waitTime = this.MIN_RECONNECT_INTERVAL - timeSinceLastChange;
            this.node.log(`[FSM] Waiting ${waitTime}ms before next reconnect attempt (enforcing minimum interval)`);
            // Schedule after the minimum interval
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = undefined;
                this.transitionTo(ConnectionState.RECONNECTING);
                this.scheduleReconnect();
            }, waitTime);
            return;
        }
        // FSM: Transition to RECONNECTING state
        this.transitionTo(ConnectionState.RECONNECTING);
        // STM32 cần thời gian recovery ngắn hơn nhưng ổn định
        const quickReconnectTime = 5000; // 5 giây cho STM32 (tăng từ 2s)
        const standardReconnectTime = Math.max(this.config.reconnectInterval || 30000, 30000); // 30s
        //this.node.log(`[STM32-RECONNECT] Scheduling quick reconnect in ${quickReconnectTime}ms`);
        // Thử kết nối lại nhanh
        this.reconnectTimer = setTimeout(async () => {
            try {
                // Ensure old connection is fully cleaned up before creating new one
                await this.ensureCleanConnection();
                // Thử kết nối lại
                await this.initializeClient();
                //this.node.log(`[STM32-RECONNECT] Quick reconnect successful`);
                // Xóa timer
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = undefined;
                // KHÔNG verify với readCoils ngay - STM32 cần thời gian ổn định
                //this.node.log(`[STM32-RECONNECT] Connection established, allowing STM32 to stabilize`);
            }
            catch (error) {
                const err = error;
                this.node.warn(`[STM32-RECONNECT] Quick attempt failed: ${err.message}`);
                // Xóa timer hiện tại
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = undefined;
                // Lên lịch thử lại với thời gian dài hơn cho STM32
                //this.node.log(`[STM32-RECONNECT] Scheduling standard reconnect in ${standardReconnectTime}ms`);
                this.reconnectTimer = setTimeout(async () => {
                    try {
                        // Ensure clean connection before retry
                        await this.ensureCleanConnection();
                        // Thử kết nối lại
                        await this.initializeClient();
                        //this.node.log(`[STM32-RECONNECT] Standard reconnect successful`);
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
    // Thêm exponential backoff cho STM32 với Circuit Breaker
    scheduleReconnectWithBackoff(attempt = 1) {
        const maxAttempts = 10; // Tăng lên 10 để trigger circuit breaker
        const baseDelay = 10000; // 10 giây (tăng từ 5s)
        const maxDelay = 60000; // Tối đa 60 giây (tăng từ 30s)
        if (attempt > maxAttempts) {
            // 🆕 Circuit Breaker Triggered
            this.circuitBreakerOpen = true;
            this.disconnectStartTime = Date.now();
            // FSM: Transition to CIRCUIT_BREAKER_OPEN
            this.transitionTo(ConnectionState.CIRCUIT_BREAKER_OPEN);
            this.node.error(`[CIRCUIT-BREAKER] Triggered! ${maxAttempts} failed attempts, waiting 5 minutes`);
            // Emit event cho alert handling
            this.emit("modbus-status", {
                status: "circuit-breaker-open",
                error: `${maxAttempts} failed connection attempts`,
                recoveryAt: Date.now() + 300000,
                failedCount: maxAttempts
            });
            this.circuitBreakerTimer = setTimeout(() => {
                this.circuitBreakerOpen = false;
                this.failedConnectionCount = 0;
                this.disconnectStartTime = null;
                this.node.warn("[CIRCUIT-BREAKER] Reset, attempting recovery");
                this.scheduleReconnect();
            }, 300000); // 5 minutes
            return;
        }
        // Exponential backoff: 10s, 20s, 40s, 60s, 60s...
        const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
        //this.node.log(`[STM32-RECONNECT] Scheduling backoff reconnect attempt ${attempt}/${maxAttempts} in ${delay}ms`);
        this.reconnectTimer = setTimeout(async () => {
            try {
                await this.ensureCleanConnection();
                await this.initializeClient();
                //this.node.log(`[STM32-RECONNECT] Backoff reconnect successful on attempt ${attempt}`);
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
        // Clear existing timer if any
        if (this.connectionCheckTimer) {
            clearInterval(this.connectionCheckTimer);
            this.connectionCheckTimer = undefined;
        }
        // 🆕 Tăng interval từ 5s lên 15s để giảm frequency check
        this.connectionCheckTimer = setInterval(async () => {
            try {
                // Kiểm tra cả trạng thái isConnected và client.isOpen
                if (!this.isConnected || !this.client.isOpen) {
                    if (!this.isConnected) {
                        this.disconnectStartTime = Date.now();
                    }
                    //this.node.log("[STM32-CHECK] Connection appears to be closed, attempting to reconnect...");
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
                    this.disconnectStartTime = Date.now();
                    //this.node.log("[STM32-CHECK] Connection state inconsistent, attempting reconnect...");
                    await this.initializeClient();
                }
            }
            catch (error) {
                const err = error;
                this.disconnectStartTime = Date.now();
                //this.node.log(`[STM32-CHECK] Connection check failed: ${err.message}`);
                // Nếu lỗi liên quan đến kết nối, đánh dấu là đã ngắt kết nối
                if (err.message.includes("Timed out") ||
                    err.message.includes("Port Not Open") ||
                    err.message.includes("ECONNREFUSED") ||
                    err.message.includes("ETIMEDOUT") ||
                    err.message.includes("ECONNRESET") ||
                    err.message.includes("socket hang up") ||
                    err.message.includes("EPIPE")) {
                    this.isConnected = false;
                    this.node.status({ fill: "red", shape: "ring", text: `Disconnected` });
                    this.emit("modbus-status", { status: "disconnected", error: err.message });
                    // Đóng kết nối hiện tại nếu còn mở
                    try {
                        this.client.close();
                    }
                    catch (closeErr) {
                        // Bỏ qua lỗi khi đóng kết nối
                    }
                    // 🆕 Sử dụng circuit breaker thay vì scheduleReconnect trực tiếp
                    this.scheduleReconnectWithCircuitBreaker();
                }
                else {
                    // Xử lý các lỗi khác
                    this.handleError(err);
                }
            }
        }, 15000); // 5000 → 15000ms
    }
    async ensureConnected() {
        // Kiểm tra kết nối hiện tại
        if (!this.isConnected || !this.client.isOpen) {
            //this.node.log(" Connection lost or not initialized, attempting to reconnect...");
            // Ensure old connection is fully cleaned up
            await this.ensureCleanConnection();
            // Thử kết nối lại với retry logic tối ưu cho STM32
            let retryCount = 0;
            const maxRetries = 2; // Giảm số retry cho STM32
            const retryDelay = 3000; // Tăng delay giữa các retry
            while (retryCount < maxRetries) {
                try {
                    await this.initializeClient();
                    break; // Thoát khỏi vòng lặp nếu kết nối thành công
                }
                catch (error) {
                    retryCount++;
                    const err = error;
                    //this.node.log(` Reconnection attempt ${retryCount}/${maxRetries} failed: ${err.message}`);
                    if (retryCount >= maxRetries) {
                        throw new Error(` Failed to reconnect after ${maxRetries} attempts: ${err.message}`);
                    }
                    // Đợi lâu hơn cho STM32 recovery
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
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
            throw new Error(" Connection could not be established");
        }
    }
    /**
     * 🆕 MỚI: Schedule reconnect với Circuit Breaker pattern
     * Tăng failed count và trigger circuit breaker sau 10 lần failed
     */
    scheduleReconnectWithCircuitBreaker() {
        if (this.circuitBreakerOpen) {
            this.node.warn("[CIRCUIT-BREAKER] Open, skipping reconnect");
            return;
        }
        this.failedConnectionCount++;
        if (this.failedConnectionCount >= 10) {
            // Circuit breaker triggered
            this.circuitBreakerOpen = true;
            this.disconnectStartTime = Date.now();
            // FSM: Transition to CIRCUIT_BREAKER_OPEN
            this.transitionTo(ConnectionState.CIRCUIT_BREAKER_OPEN);
            this.node.error(`[CIRCUIT-BREAKER] Triggered! ${this.failedConnectionCount} failed attempts, waiting 5 minutes`);
            // Emit event cho alert handling
            this.emit("modbus-status", {
                status: "circuit-breaker-open",
                error: `${this.failedConnectionCount} failed connection attempts`,
                recoveryAt: Date.now() + 300000,
                failedCount: this.failedConnectionCount
            });
            this.circuitBreakerTimer = setTimeout(() => {
                this.circuitBreakerOpen = false;
                this.failedConnectionCount = 0;
                this.disconnectStartTime = null;
                this.node.warn("[CIRCUIT-BREAKER] Reset, attempting recovery");
                this.scheduleReconnect();
            }, 300000); // 5 minutes
            return;
        }
        // Continue với normal reconnect
        this.scheduleReconnect();
    }
    async readCoils(address, length) {
        // Use request queue to serialize operations
        return this.enqueueRequest(async () => {
            await this.ensureConnected();
            const boardType = this.config.boardType || "STM32";
            const readTimeout = this.config.readTimeout || 5000;
            try {
                //this.node.debug(`[${boardType}-READ] Reading coils at address ${address}, length ${length} with timeout ${readTimeout}ms`);
                // Add timeout wrapper with configurable timeout
                const readPromise = this.client.readCoils(address, length);
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(`[${boardType}-TIMEOUT] Read coils timeout after ${readTimeout}ms`)), readTimeout);
                });
                const { data } = await Promise.race([readPromise, timeoutPromise]);
                // Reset consecutive error counter on successful read
                this.consecutiveErrors = 0;
                //this.node.debug(`[${boardType}-READ] Successfully read coils at ${address}: ${data.length} values`);
                return { address, data };
            }
            catch (error) {
                const err = error;
                this.node.warn(`[${boardType}-READ] Error reading coils at ${address}: ${err.message}`);
                this.handleError(err);
                throw error;
            }
        });
    }
    async readInputRegisters(address, length) {
        // Use request queue to serialize operations
        return this.enqueueRequest(async () => {
            await this.ensureConnected();
            const boardType = this.config.boardType || "STM32";
            const readTimeout = this.config.readTimeout || 3000; // Use configured timeout
            try {
                // Timeout wrapper with configurable timeout
                const readPromise = this.client.readInputRegisters(address, length);
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(`[${boardType}-TIMEOUT] Read input registers timeout after ${readTimeout}ms`)), readTimeout);
                });
                const { data } = await Promise.race([readPromise, timeoutPromise]);
                // Reset consecutive error counter on successful read
                this.consecutiveErrors = 0;
                return { address, data };
            }
            catch (error) {
                const err = error;
                this.node.warn(`[${boardType}-READ] Error reading input registers at ${address}: ${err.message}`);
                this.handleError(err);
                throw error;
            }
        });
    }
    async readHoldingRegisters(address, length) {
        // Use request queue to serialize operations
        return this.enqueueRequest(async () => {
            await this.ensureConnected();
            const boardType = this.config.boardType || "STM32";
            const readTimeout = this.config.readTimeout || 3000; // Use configured timeout
            try {
                // Timeout wrapper with configurable timeout
                const readPromise = this.client.readHoldingRegisters(address, length);
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(`[${boardType}-TIMEOUT] Read holding registers timeout after ${readTimeout}ms`)), readTimeout);
                });
                const { data } = await Promise.race([readPromise, timeoutPromise]);
                // Reset consecutive error counter on successful read
                this.consecutiveErrors = 0;
                return { address, data };
            }
            catch (error) {
                const err = error;
                this.node.warn(`[${boardType}-READ] Error reading holding registers at ${address}: ${err.message}`);
                this.handleError(err);
                throw error;
            }
        });
    }
    // Ghi Holding Register
    async writeRegister(address, value) {
        // Use request queue to serialize operations
        return this.enqueueRequest(async () => {
            await this.ensureConnected();
            const boardType = this.config.boardType || "STM32";
            const writeTimeout = this.config.writeTimeout || 5000;
            let retryCount = 0;
            const maxRetries = this.config.maxRetries || 3;
            while (retryCount <= maxRetries) {
                try {
                    //this.node.log(`[${boardType}-WRITE] Attempting to write register ${address} = ${value} (attempt ${retryCount + 1}/${maxRetries + 1}, timeout: ${writeTimeout}ms)`);
                    // Add timeout wrapper for write operations with configurable timeout
                    const writePromise = this.client.writeRegister(address, value);
                    const timeoutPromise = new Promise((_, reject) => {
                        setTimeout(() => reject(new Error(`[${boardType}-TIMEOUT] Write register timeout after ${writeTimeout}ms`)), writeTimeout);
                    });
                    await Promise.race([writePromise, timeoutPromise]);
                    //this.node.log(`[${boardType}-WRITE] Successfully wrote register ${address} = ${value} on attempt ${retryCount + 1}`);
                    return; // Success, exit retry loop
                }
                catch (error) {
                    const err = error;
                    retryCount++;
                    // Check if this is a timeout error and we have retries left
                    if (err.message.includes('timeout') && retryCount <= maxRetries) {
                        this.node.warn(`[${boardType}-WRITE] Write register ${address} timeout on attempt ${retryCount}/${maxRetries + 1}, retrying in ${retryCount * 1000}ms...`);
                        await new Promise(resolve => setTimeout(resolve, retryCount * 1000)); // Exponential backoff
                        continue;
                    }
                    // Final error handling
                    this.node.error(`[${boardType}-WRITE] Failed to write register ${address} after ${retryCount} attempts: ${err.message}`);
                    this.handleError(err);
                    throw new Error(`[${boardType}-WRITE-FAILED] Write register ${address} failed after ${retryCount} attempts: ${err.message}`);
                }
            }
        });
    }
    async writeCoil(address, value) {
        // Use request queue to serialize operations
        return this.enqueueRequest(async () => {
            await this.ensureConnected();
            const boardType = this.config.boardType || "STM32";
            const writeTimeout = this.config.writeTimeout || 5000;
            let retryCount = 0;
            const maxRetries = this.config.maxRetries || 3;
            while (retryCount <= maxRetries) {
                try {
                    //this.node.log(`[${boardType}-WRITE] Attempting to write coil ${address} = ${value} (attempt ${retryCount + 1}/${maxRetries + 1}, timeout: ${writeTimeout}ms)`);
                    // Add timeout wrapper for write operations with configurable timeout
                    const writePromise = this.client.writeCoil(address, value);
                    const timeoutPromise = new Promise((_, reject) => {
                        setTimeout(() => reject(new Error(`[${boardType}-TIMEOUT] Write coil timeout after ${writeTimeout}ms`)), writeTimeout);
                    });
                    await Promise.race([writePromise, timeoutPromise]);
                    //this.node.log(`[${boardType}-WRITE] Successfully wrote coil ${address} = ${value} on attempt ${retryCount + 1}`);
                    return; // Success, exit retry loop
                }
                catch (error) {
                    const err = error;
                    retryCount++;
                    // Check if this is a timeout error and we have retries left
                    if (err.message.includes('timeout') && retryCount <= maxRetries) {
                        this.node.warn(`[${boardType}-WRITE] Write coil ${address} timeout on attempt ${retryCount}/${maxRetries + 1}, retrying in ${retryCount * 1000}ms...`);
                        await new Promise(resolve => setTimeout(resolve, retryCount * 1000)); // Exponential backoff
                        continue;
                    }
                    // Final error handling
                    this.node.error(`[${boardType}-WRITE] Failed to write coil ${address} after ${retryCount} attempts: ${err.message}`);
                    this.handleError(err);
                    throw new Error(`[${boardType}-WRITE-FAILED] Write coil ${address} failed after ${retryCount} attempts: ${err.message}`);
                }
            }
        });
    }
    // Ngắt kết nối
    disconnect() {
        ////this.node.log("Modbus: Disconnecting client..."); // Log disconnect start
        this.cleanup();
    }
    /**
     * Comprehensive cleanup method - ensures all resources are released
     * Call this when node is being removed or destroyed
     */
    cleanup() {
        // Set shutdown flag to prevent new operations
        this.isShuttingDown = true;
        // Clear ALL timers to prevent memory leaks
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
            this.node.log("[MODBUS-CLEANUP] Reconnect timer cleared");
        }
        if (this.connectionCheckTimer) {
            clearInterval(this.connectionCheckTimer);
            this.connectionCheckTimer = undefined;
            this.node.log("[MODBUS-CLEANUP] Connection check timer cleared");
        }
        // 🆕 Clear circuit breaker timer
        if (this.circuitBreakerTimer) {
            clearTimeout(this.circuitBreakerTimer);
            this.circuitBreakerTimer = undefined;
            this.node.log("[MODBUS-CLEANUP] Circuit breaker timer cleared");
        }
        // Close the client connection
        try {
            if (this.client && this.client.isOpen) {
                this.client.close(() => {
                    this.wasConnected = this.isConnected;
                    this.isConnected = false;
                    if (this.wasConnected) {
                        this.node.status({ fill: "grey", shape: "ring", text: "Disconnected" });
                        this.emit("modbus-status", { status: "disconnected" });
                    }
                    this.node.log("[MODBUS-CLEANUP] Client connection closed");
                });
            }
        }
        catch (error) {
            // Silently handle close errors during cleanup
            this.node.warn(`[MODBUS-CLEANUP] Error during close: ${error.message}`);
        }
        // Remove all event listeners to prevent memory leaks
        this.removeAllListeners();
        // 🆕 Reset circuit breaker state
        this.failedConnectionCount = 0;
        this.circuitBreakerOpen = false;
        this.disconnectStartTime = null;
        this.node.log("[MODBUS-CLEANUP] Cleanup complete");
    }
    // Kiểm tra trạng thái kết nối
    isConnectedCheck() {
        return this.isConnected;
    }
    // Public method to manually trigger reconnection
    async reconnect() {
        this.node.warn("[MODBUS-RECONNECT] Manual reconnection requested");
        // Clear any existing reconnect timer
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        // Ensure clean connection before reconnecting
        await this.ensureCleanConnection();
        // Attempt to reconnect
        await this.initializeClient();
    }
}
exports.ModbusClientCore = ModbusClientCore;
