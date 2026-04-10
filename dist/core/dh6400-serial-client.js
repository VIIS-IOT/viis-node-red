"use strict";
/**
 * DH6400 Flow Sensor Serial Client
 * Modbus RTU protocol with 6 slave IDs on shared serial port
 *
 * Protocol: Modbus RTU Function Code 03
 * Request: <slave_id> 03 00 00 00 0A <CRC>
 * Response: 25 bytes (3 header + 20 data + 2 CRC)
 * - Bytes 0-2: Header (slave ID, function, byte count)
 * - Bytes 11-14: Total accumulated integer part (Big Endian 32-bit)
 * - Bytes 15-18: Total accumulated decimal part (Big Endian 32-bit, ÷ 100000000)
 * - Bytes 19-22: Instantaneous flow raw value (Big Endian 32-bit, ÷ 1000 → m³/h)
 * - Bytes 23-24: CRC16
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DH6400MultiChannelManager = exports.DH6400SerialClient = void 0;
const serialport_1 = require("serialport");
const events_1 = require("events");
/**
 * Modbus RTU CRC16 calculation
 */
function calculateModbusCRC(data) {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let j = 0; j < 8; j++) {
            if (crc & 0x0001) {
                crc = (crc >> 1) ^ 0xA001;
            }
            else {
                crc >>= 1;
            }
        }
    }
    // Return as little-endian bytes
    const crcBuffer = Buffer.alloc(2);
    crcBuffer.writeUInt16LE(crc, 0);
    return crcBuffer;
}
/**
 * DH6400 Serial Client (Shared Port for 6 Channels)
 * Uses Modbus RTU protocol with slave IDs 01-06
 */
class DH6400SerialClient extends events_1.EventEmitter {
    constructor(serialPort, baudRate = 9600, logger) {
        super();
        this.serialPort = serialPort;
        this.baudRate = baudRate;
        this.logger = logger;
        this.port = null;
        this.isConnected = false;
        this.reconnectTimer = null;
        this.isClosing = false;
        this.responseBuffer = Buffer.alloc(0);
        this.expectedResponseLength = 25; // Can vary based on byte_count
        this.currentSlaveId = 0;
        this.requestQueue = [];
        this.isProcessingRequest = false;
        this.connectionPromise = null; // Prevent concurrent connection attempts
        this.pendingTimeouts = new Set(); // Track pending timeouts for cleanup
        this.maxOpenRetries = 5; // Max retries for port open (lock issues)
        this.openRetryDelay = 2000; // 2 seconds between retries
        // USB Serial Port Recovery (URB -32 / EPIPE errors)
        this.consecutiveErrors = 0;
        this.MAX_CONSECUTIVE_ERRORS = 5;
        this.isRecovering = false;
        this.USB_SERIAL_ERRORS = [
            "EPIPE",
            "urb stopped: -32",
            "Resource temporarily unavailable",
            "Cannot lock port",
            "Input/output error",
            "EBUSY",
            "ENODEV"
        ];
        /**
         * Schedule reconnection with exponential backoff
         */
        this.reconnectAttemptCount = 0;
        this.maxReconnectDelay = 60000; // Max 60 seconds
        this.log(`DH6400 Modbus RTU client initialized on ${serialPort} @ ${baudRate} baud`);
    }
    /**
     * Initialize serial port with retry logic for port lock issues
     */
    async initializePort() {
        // Retry loop for handling port lock issues during deploy
        for (let attempt = 1; attempt <= this.maxOpenRetries; attempt++) {
            // Check if we're closing - abort if so
            if (this.isClosing) {
                this.log('Aborting port initialization - client is closing');
                throw new Error('Client is closing');
            }
            try {
                await this.tryOpenPort();
                return; // Success, exit retry loop
            }
            catch (error) {
                const errorMsg = error.message;
                const isLockError = errorMsg.includes('Cannot lock port') ||
                    errorMsg.includes('Resource temporarily unavailable') ||
                    errorMsg.includes('EBUSY');
                if (isLockError && attempt < this.maxOpenRetries) {
                    this.log(`Port locked, retry ${attempt}/${this.maxOpenRetries} in ${this.openRetryDelay}ms...`, 'warn');
                    await new Promise(resolve => setTimeout(resolve, this.openRetryDelay));
                    continue;
                }
                this.log(`Failed to open ${this.serialPort} after ${attempt} attempts: ${errorMsg}`, 'error');
                throw error;
            }
        }
    }
    /**
     * Try to open the serial port once
     */
    tryOpenPort() {
        return new Promise((resolve, reject) => {
            try {
                // Clean up any existing port reference first
                if (this.port) {
                    try {
                        this.port.removeAllListeners();
                        if (this.port.isOpen) {
                            this.port.close();
                        }
                    }
                    catch (e) {
                        // Ignore cleanup errors
                    }
                    this.port = null;
                }
                this.port = new serialport_1.SerialPort({
                    path: this.serialPort,
                    baudRate: this.baudRate,
                    dataBits: 8,
                    stopBits: 1,
                    parity: 'none',
                    autoOpen: false,
                });
                // Setup event handlers
                this.port.on('open', () => {
                    this.handleOpen();
                    resolve(); // Resolve when port opens successfully
                });
                this.port.on('data', (data) => this.onData(data));
                this.port.on('error', (error) => this.handleError(error));
                this.port.on('close', () => this.handleClose());
                // Open port
                this.port.open((error) => {
                    if (error) {
                        reject(error);
                    }
                });
            }
            catch (error) {
                reject(error);
            }
        });
    }
    /**
     * Handle port open
     */
    handleOpen() {
        this.isConnected = true;
        this.log(`Connected to ${this.serialPort}`);
        this.emit('connected');
    }
    /**
     * Handle incoming serial data
     */
    onData(data) {
        this.responseBuffer = Buffer.concat([this.responseBuffer, data]);
        // Check if we have at least the header (3 bytes)
        if (this.responseBuffer.length >= 3) {
            const byteCount = this.responseBuffer[2];
            const expectedLength = 3 + byteCount + 2; // header + data + CRC
            // Check if we have complete response
            if (this.responseBuffer.length >= expectedLength) {
                const response = this.responseBuffer.slice(0, expectedLength);
                this.responseBuffer = this.responseBuffer.slice(expectedLength);
                const flowData = this.parseResponse(response, this.currentSlaveId);
                // Emit response event for current request
                this.emit(`response-${this.currentSlaveId}`, flowData);
                // Also emit general data event
                if (flowData) {
                    this.emit('data', flowData);
                }
            }
        }
    }
    /**
     * Verify Modbus CRC
     */
    verifyModbusCRC(response) {
        if (response.length < 2)
            return false;
        const receivedCrc = response.slice(-2);
        const dataForCrc = response.slice(0, -2);
        const calculatedCrc = calculateModbusCRC(dataForCrc);
        return receivedCrc.equals(calculatedCrc);
    }
    /**
     * Parse DH6400 Modbus response
     * Response structure:
     * - Byte 0: Slave ID
     * - Byte 1: Function Code (0x03)
     * - Byte 2: Byte count (should be 0x14 = 20 bytes)
     * - Bytes 3-10: Skip (instant rate integer + decimal parts)
     * - Bytes 11-14: Total accumulated integer
     * - Bytes 15-18: Total accumulated decimal (÷ 100000000)
     * - Bytes 19-22: Instantaneous flow raw (÷ 1000 → m³/h)
     * - Bytes 23-24: CRC16
     */
    parseResponse(response, slaveId) {
        // Verify minimum length
        if (response.length < 5) {
            this.log(`Invalid response length: ${response.length} (too short)`, 'error');
            return null;
        }
        try {
            const receivedSlaveId = response[0];
            const functionCode = response[1];
            const byteCount = response[2];
            // Verify slave ID
            if (receivedSlaveId !== slaveId) {
                this.log(`Slave ID mismatch: expected ${slaveId}, got ${receivedSlaveId}`, 'warn');
                return null;
            }
            // Calculate expected length: 3 (header) + byteCount + 2 (CRC)
            const expectedLength = 3 + byteCount + 2;
            // Trim response if longer than expected
            const actualResponse = response.length > expectedLength
                ? response.slice(0, expectedLength)
                : response;
            // Verify CRC
            if (!this.verifyModbusCRC(actualResponse)) {
                this.log(`CRC verification failed for slave ${slaveId}`, 'warn');
                // Continue parsing anyway (some devices have CRC issues)
            }
            // Verify we have enough data bytes
            if (actualResponse.length < 23) {
                this.log(`Insufficient data bytes: ${actualResponse.length} (expected >= 23)`, 'error');
                return null;
            }
            // Byte 11-14 (index 11-14): Total accumulated integer
            const totalInt = actualResponse.readUInt32BE(11);
            // Byte 15-18 (index 15-18): Total accumulated decimal (8 decimal places)
            const totalDec = actualResponse.readUInt32BE(15);
            // Total accumulated in m³
            const totalAccumulatedM3 = totalInt + totalDec / 100000000;
            // Byte 19-22 (index 19-22): Instantaneous flow raw
            const instantFlowRaw = actualResponse.readUInt32BE(19);
            // Convert to m³/h - FIXED: divisor is 1000, not 100
            const instantFlowM3h = instantFlowRaw / 1000;
            const flowData = {
                channel: slaveId,
                slaveId: slaveId,
                sensorKey: `fs${String(slaveId).padStart(2, '0')}`,
                instantFlowM3h: instantFlowM3h,
                totalAccumulatedM3: totalAccumulatedM3,
                timestamp: Date.now(),
                rawData: actualResponse
            };
            this.log(`✅ Slave ${slaveId}: instant=${instantFlowM3h.toFixed(4)} m³/h, total=${totalAccumulatedM3.toFixed(8)} m³`);
            return flowData;
        }
        catch (error) {
            this.log(`Parse error for slave ${slaveId}: ${error.message}`, 'error');
            return null;
        }
    }
    /**
     * Handle port error
     */
    handleError(error) {
        this.log(`Serial error: ${error.message}`, 'error');
        this.emit('error', error);
        // Check if this is a USB serial error
        if (this.isUsbSerialError(error.message)) {
            this.consecutiveErrors++;
            this.log(`[USB-ERROR] Consecutive USB errors: ${this.consecutiveErrors}/${this.MAX_CONSECUTIVE_ERRORS} - "${error.message}"`, 'warn');
            // Trigger auto-recovery if threshold reached
            if (this.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS && !this.isRecovering) {
                this.log(`[USB-RECOVERY] Threshold reached! Attempting automatic port recovery...`, 'warn');
                this.attemptPortRecovery().catch(recoveryError => {
                    this.log(`[USB-RECOVERY] Recovery failed: ${recoveryError.message}`, 'error');
                });
            }
        }
        else {
            // Reset counter on non-USB errors
            this.consecutiveErrors = 0;
        }
    }
    /**
     * Check if error is related to USB serial port failure
     */
    isUsbSerialError(message) {
        return this.USB_SERIAL_ERRORS.some(err => message.includes(err));
    }
    /**
     * Force-close and recreate the serial port connection
     */
    async attemptPortRecovery() {
        var _a;
        if (this.isRecovering) {
            this.log('[USB-RECOVERY] Recovery already in progress, skipping', 'warn');
            return;
        }
        this.isRecovering = true;
        const startTime = Date.now();
        try {
            this.log('[USB-RECOVERY] Starting port recovery sequence...', 'warn');
            // Step 1: Force close existing connection
            this.log('[USB-RECOVERY] Step 1/4: Force-closing serial port...', 'warn');
            await this.forceClosePort();
            // Step 2: Wait for USB stack to settle
            this.log('[USB-RECOVERY] Step 2/4: Waiting 3s for USB stack to settle...', 'warn');
            await this.sleep(3000);
            // Step 3: Attempt fresh connection
            this.log('[USB-RECOVERY] Step 3/4: Creating new serial port instance...', 'warn');
            await this.initializePort();
            // Step 4: Verify connection
            this.log('[USB-RECOVERY] Step 4/4: Verifying connection...', 'warn');
            await this.sleep(1000);
            if (this.isConnected && ((_a = this.port) === null || _a === void 0 ? void 0 : _a.isOpen)) {
                const recoveryTime = Date.now() - startTime;
                this.log(`[USB-RECOVERY] ✅ SUCCESS! Port recovered in ${recoveryTime}ms`, 'info');
                // Reset error counters
                this.consecutiveErrors = 0;
                this.reconnectAttemptCount = 0;
                this.emit('recovered', { recoveryTimeMs: recoveryTime });
            }
            else {
                throw new Error('Connection not established after recovery');
            }
        }
        catch (error) {
            const recoveryTime = Date.now() - startTime;
            this.log(`[USB-RECOVERY] ❌ FAILED after ${recoveryTime}ms: ${error.message}`, 'error');
            // Schedule another recovery attempt after delay
            this.log('[USB-RECOVERY] Will retry in 10 seconds...', 'warn');
            setTimeout(() => {
                this.isRecovering = false;
                this.attemptPortRecovery().catch(err => {
                    this.log(`[USB-RECOVERY] Retry also failed: ${err.message}`, 'error');
                });
            }, 10000);
            throw error;
        }
        finally {
            this.isRecovering = false;
        }
    }
    /**
     * Force close the serial port with aggressive cleanup
     */
    async forceClosePort() {
        try {
            // Mark as disconnected
            this.isConnected = false;
            // Close port if exists
            if (this.port) {
                try {
                    if (this.port.isOpen) {
                        this.port.close();
                    }
                }
                catch (closeError) {
                    this.log(`[USB-RECOVERY] Close error (ignored): ${closeError.message}`, 'warn');
                }
            }
            // Wait to ensure OS releases the file descriptor
            await this.sleep(500);
            // Remove all event listeners
            if (this.port) {
                this.port.removeAllListeners();
                this.port = null;
            }
            this.log('[USB-RECOVERY] Port force-closed and listeners cleared', 'info');
        }
        catch (error) {
            this.log(`[USB-RECOVERY] Force close error (continuing): ${error.message}`, 'warn');
        }
    }
    /**
     * Sleep utility function
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    /**
     * Handle port close
     */
    handleClose() {
        this.isConnected = false;
        this.log(`Port closed`);
        this.emit('disconnected');
        // Only schedule reconnect if not intentionally closing
        if (!this.isClosing) {
            this.scheduleReconnect();
        }
    }
    scheduleReconnect() {
        // Don't schedule reconnect if closing
        if (this.isClosing) {
            this.log('Skipping reconnect - client is closing');
            return;
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        // Exponential backoff: 5s, 10s, 20s, 40s, max 60s
        this.reconnectAttemptCount++;
        const delay = Math.min(5000 * Math.pow(2, this.reconnectAttemptCount - 1), this.maxReconnectDelay);
        this.log(`Scheduling reconnect attempt ${this.reconnectAttemptCount} in ${delay / 1000}s...`);
        this.reconnectTimer = setTimeout(async () => {
            // Double-check closing flag before reconnecting
            if (this.isClosing) {
                this.log('Skipping reconnect - client is closing');
                return;
            }
            this.log(`Attempting reconnect (attempt ${this.reconnectAttemptCount})...`);
            try {
                await this.initializePort();
                this.log('Reconnect successful');
                this.reconnectAttemptCount = 0; // Reset on success
            }
            catch (error) {
                this.log(`Reconnect failed: ${error.message}`, 'warn');
                // Schedule another reconnect with increased delay
                this.scheduleReconnect();
            }
        }, delay);
    }
    /**
     * Create Modbus RTU request for DH6400
     * Request: <slave_id> 03 00 00 00 0A <CRC>
     */
    createModbusRequest(slaveId) {
        const data = Buffer.from([
            slaveId, // Slave ID (01-06)
            0x03, // Function Code 03: Read Holding Registers
            0x00, 0x00, // Starting address: 0
            0x00, 0x0A // Quantity: 10 registers (20 bytes)
        ]);
        const crc = calculateModbusCRC(data);
        return Buffer.concat([data, crc]);
    }
    /**
     * Query flow sensor data for specific slave ID
     */
    queryFlowData(slaveId) {
        return new Promise((resolve) => {
            if (!this.isConnected || !this.port) {
                this.log(`Cannot query slave ${slaveId}: port not connected`, 'warn');
                resolve(null);
                return;
            }
            // Add to queue
            this.requestQueue.push({ slaveId, callback: resolve });
            // Process queue if not already processing
            if (!this.isProcessingRequest) {
                this.processRequestQueue();
            }
        });
    }
    /**
     * Process request queue sequentially
     */
    async processRequestQueue() {
        if (this.requestQueue.length === 0) {
            this.isProcessingRequest = false;
            return;
        }
        // Don't process if closing or not connected
        if (this.isClosing || !this.isConnected || !this.port) {
            // Resolve all pending requests with null
            while (this.requestQueue.length > 0) {
                const req = this.requestQueue.shift();
                if (req)
                    req.callback(null);
            }
            this.isProcessingRequest = false;
            return;
        }
        this.isProcessingRequest = true;
        const request = this.requestQueue.shift();
        try {
            this.currentSlaveId = request.slaveId;
            this.responseBuffer = Buffer.alloc(0);
            const packet = this.createModbusRequest(request.slaveId);
            // Clear buffers - with error handling
            try {
                if (this.port && this.port.isOpen) {
                    this.port.flush();
                }
            }
            catch (flushError) {
                this.log(`Flush error (ignored): ${flushError.message}`, 'warn');
            }
            // Check port is still valid before writing
            if (!this.port || !this.port.isOpen) {
                this.log(`Port closed before sending query to slave ${request.slaveId}`, 'warn');
                request.callback(null);
                this.processRequestQueue();
                return;
            }
            // Send request with error handling
            this.port.write(packet, (writeError) => {
                if (writeError) {
                    this.log(`Write error to slave ${request.slaveId}: ${writeError.message}`, 'error');
                    request.callback(null);
                    this.processRequestQueue();
                    return;
                }
            });
            this.log(`Query sent to slave ${request.slaveId}: ${packet.toString('hex').toUpperCase()}`, 'debug');
            // Wait for response with timeout
            const timeout = setTimeout(() => {
                this.pendingTimeouts.delete(timeout);
                // Remove the listener to prevent memory leak
                this.removeAllListeners(`response-${request.slaveId}`);
                this.log(`Timeout waiting for slave ${request.slaveId} response`, 'warn');
                request.callback(null);
                this.processRequestQueue(); // Continue to next
            }, 2000);
            this.pendingTimeouts.add(timeout);
            // Store callback to call when response arrives
            this.once(`response-${request.slaveId}`, (data) => {
                this.pendingTimeouts.delete(timeout);
                clearTimeout(timeout);
                // Reset error counter on successful response
                if (data) {
                    this.consecutiveErrors = 0;
                }
                request.callback(data);
                // Small delay before next request
                const delayTimeout = setTimeout(() => {
                    this.pendingTimeouts.delete(delayTimeout);
                    this.processRequestQueue();
                }, 100);
                this.pendingTimeouts.add(delayTimeout);
            });
        }
        catch (error) {
            this.log(`Failed to send query to slave ${request.slaveId}: ${error.message}`, 'error');
            request.callback(null);
            this.processRequestQueue(); // Continue to next
        }
    }
    /**
     * Connect to serial port
     */
    async connect() {
        var _a;
        // Reset closing flag in case this is a reconnection
        this.isClosing = false;
        // If already connected, return
        if (this.isConnected && ((_a = this.port) === null || _a === void 0 ? void 0 : _a.isOpen)) {
            this.log('Already connected');
            return;
        }
        // If connection is in progress, wait for it
        if (this.connectionPromise) {
            this.log('Connection already in progress, waiting...');
            return this.connectionPromise;
        }
        // Start new connection
        this.connectionPromise = this.initializePort()
            .finally(() => {
            this.connectionPromise = null;
        });
        return this.connectionPromise;
    }
    /**
     * Disconnect from serial port
     */
    async disconnect() {
        this.log('Disconnecting from serial port...');
        // Set closing flag to prevent reconnection
        this.isClosing = true;
        // Clear reconnect timer if any
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
            this.log('Cleared reconnect timer');
        }
        // Clear all pending timeouts
        for (const timeout of this.pendingTimeouts) {
            clearTimeout(timeout);
        }
        this.pendingTimeouts.clear();
        // Clear all pending response listeners
        for (let i = 1; i <= 6; i++) {
            this.removeAllListeners(`response-${i}`);
        }
        // Clear request queue
        while (this.requestQueue.length > 0) {
            const request = this.requestQueue.shift();
            if (request) {
                request.callback(null);
            }
        }
        this.isProcessingRequest = false;
        // Wait for any pending connection to complete
        if (this.connectionPromise) {
            try {
                await this.connectionPromise;
            }
            catch (e) {
                // Ignore - we're closing anyway
            }
            this.connectionPromise = null;
        }
        // Close port if exists
        if (this.port) {
            try {
                // Remove all listeners first to prevent callbacks during close
                this.port.removeAllListeners();
                if (this.port.isOpen) {
                    await new Promise((resolve) => {
                        this.port.close((err) => {
                            if (err) {
                                this.log(`Error closing port: ${err.message}`, 'warn');
                                // Don't reject, just log - port might already be closed
                            }
                            resolve();
                        });
                    });
                }
                this.log('Serial port closed successfully');
            }
            catch (error) {
                this.log(`Error during disconnect: ${error.message}`, 'warn');
            }
            finally {
                this.port = null;
            }
        }
        this.isConnected = false;
        this.responseBuffer = Buffer.alloc(0);
        this.reconnectAttemptCount = 0; // Reset reconnect counter
        this.log('Disconnect complete');
    }
    log(message, level = 'info') {
        if (this.logger) {
            // Only log debug if logger has debug method
            if (level === 'debug' && this.logger.debug) {
                this.logger.debug(`[DH6400-Client] ${message}`);
            }
            else if (level !== 'debug') {
                this.logger[level](`[DH6400-Client] ${message}`);
            }
        }
    }
}
exports.DH6400SerialClient = DH6400SerialClient;
/**
 * DH6400 Multi-Channel Manager (Single Serial Port)
 * Manages polling of 6 DH6400 flow sensors via Modbus RTU on shared serial port
 */
class DH6400MultiChannelManager extends events_1.EventEmitter {
    constructor(serialPort, baudRate = 9600, enabledChannels = [1, 2, 3, 4, 5, 6], logger) {
        super();
        this.serialPort = serialPort;
        this.baudRate = baudRate;
        this.enabledChannels = enabledChannels;
        this.logger = logger;
        this.slaveIds = [1, 2, 3, 4, 5, 6];
        // Filter to only enabled channels
        this.slaveIds = enabledChannels.filter(ch => ch >= 1 && ch <= 6);
        // Create single client for shared serial port
        this.client = new DH6400SerialClient(serialPort, baudRate, logger);
        // Forward events
        this.client.on('data', (flowData) => {
            this.emit('data', flowData);
        });
        this.client.on('error', (error) => {
            this.emit('error', error);
        });
        this.client.on('connected', () => {
            this.emit('connected');
        });
        this.client.on('disconnected', () => {
            this.emit('disconnected');
        });
        this.log(`Initialized DH6400 manager for ${this.slaveIds.length} channels on ${serialPort}`);
    }
    /**
     * Connect to serial port
     */
    async connect() {
        await this.client.connect();
        this.log(`Connected to ${this.serialPort}`);
    }
    /**
     * Query all enabled channels sequentially
     */
    async queryAllChannels() {
        const results = new Map();
        // Query channels sequentially
        for (const slaveId of this.slaveIds) {
            try {
                const flowData = await this.client.queryFlowData(slaveId);
                if (flowData) {
                    results.set(slaveId, flowData);
                }
                // Delay between requests (500ms as per Python script)
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            catch (error) {
                this.log(`Failed to query slave ${slaveId}: ${error.message}`, 'warn');
            }
        }
        return results;
    }
    /**
     * Query specific channel
     */
    async queryChannel(channel) {
        if (!this.slaveIds.includes(channel)) {
            this.log(`Channel ${channel} not enabled`, 'warn');
            return null;
        }
        return await this.client.queryFlowData(channel);
    }
    /**
     * Cleanup
     */
    async cleanup() {
        await this.client.disconnect();
        this.log('DH6400 manager cleaned up');
    }
    /**
     * Check if connected
     */
    isConnected() {
        return this.client['isConnected'];
    }
    log(message, level = 'info') {
        if (this.logger) {
            this.logger[level](`[DH6400-Manager] ${message}`);
        }
    }
}
exports.DH6400MultiChannelManager = DH6400MultiChannelManager;
