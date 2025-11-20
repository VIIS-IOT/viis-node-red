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
        this.responseBuffer = Buffer.alloc(0);
        this.expectedResponseLength = 25; // Can vary based on byte_count
        this.currentSlaveId = 0;
        this.requestQueue = [];
        this.isProcessingRequest = false;
        this.log(`DH6400 Modbus RTU client initialized on ${serialPort} @ ${baudRate} baud`);
    }
    /**
     * Initialize serial port
     */
    async initializePort() {
        return new Promise((resolve, reject) => {
            try {
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
                        this.log(`Failed to open ${this.serialPort}: ${error.message}`, 'error');
                        this.scheduleReconnect();
                        reject(error);
                    }
                });
            }
            catch (error) {
                this.log(`Port initialization failed: ${error.message}`, 'error');
                this.scheduleReconnect();
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
    }
    /**
     * Handle port close
     */
    handleClose() {
        this.isConnected = false;
        this.log(`Port closed`);
        this.emit('disconnected');
        this.scheduleReconnect();
    }
    /**
     * Schedule reconnection
     */
    scheduleReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        this.reconnectTimer = setTimeout(() => {
            this.log(`Attempting reconnect...`);
            this.initializePort();
        }, 5000); // 5s delay
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
        this.isProcessingRequest = true;
        const request = this.requestQueue.shift();
        try {
            this.currentSlaveId = request.slaveId;
            this.responseBuffer = Buffer.alloc(0);
            const packet = this.createModbusRequest(request.slaveId);
            // Clear buffers
            this.port.flush();
            // Send request
            this.port.write(packet);
            this.log(`Query sent to slave ${request.slaveId}: ${packet.toString('hex').toUpperCase()}`, 'debug');
            // Wait for response with timeout
            const timeout = setTimeout(() => {
                this.log(`Timeout waiting for slave ${request.slaveId} response`, 'warn');
                request.callback(null);
                this.processRequestQueue(); // Continue to next
            }, 2000);
            // Store callback to call when response arrives
            this.once(`response-${request.slaveId}`, (data) => {
                clearTimeout(timeout);
                request.callback(data);
                // Small delay before next request
                setTimeout(() => {
                    this.processRequestQueue();
                }, 100);
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
        await this.initializePort();
    }
    /**
     * Disconnect from serial port
     */
    async disconnect() {
        if (this.port) {
            await this.port.close();
        }
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
