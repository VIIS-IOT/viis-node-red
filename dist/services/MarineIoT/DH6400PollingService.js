"use strict";
/**
 * DH6400 Polling Service
 * Manages periodic polling of 6 DH6400 flow sensors via serial
 * Emits telemetry data for viis-marine-telemetry node
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DH6400PollingService = void 0;
const events_1 = require("events");
const dh6400_serial_client_1 = require("../../core/dh6400-serial-client");
/**
 * DH6400 Polling Service
 * Polls 6 channels sequentially and emits telemetry data
 */
class DH6400PollingService extends events_1.EventEmitter {
    constructor(node, nodeContext, config) {
        super();
        this.manager = null;
        this.pollingTimer = null;
        this.isPaused = false;
        this.latestData = new Map();
        this.consecutiveFailures = 0;
        this.lastErrorEmitTime = 0;
        this.errorEmitThrottle = 300000; // 5 minutes throttle for duplicate errors
        this.node = node;
        this.nodeContext = nodeContext;
        this.config = config;
        if (this.config.enabled) {
            this.initializeManager();
        }
        else {
            this.node.log('[DH6400Polling] Disabled by configuration');
        }
    }
    /**
     * Initialize DH6400 Multi-Channel Manager
     */
    initializeManager() {
        try {
            if (!this.config.serialPort) {
                this.node.warn('[DH6400Polling] No serial port configured');
                return;
            }
            if (this.config.enabledChannels.length === 0) {
                this.node.warn('[DH6400Polling] No enabled channels found');
                return;
            }
            // Create logger adapter for Node-RED
            const logger = {
                info: (msg) => this.node.log(msg),
                warn: (msg) => this.node.warn(msg),
                error: (msg) => this.node.error(msg),
                debug: (msg) => this.node.log(msg)
            };
            // Create single manager for shared serial port with logger
            this.manager = new dh6400_serial_client_1.DH6400MultiChannelManager(this.config.serialPort, this.config.baudRate, this.config.enabledChannels, logger);
            // Setup event handlers
            this.manager.on('data', (data) => this.handleFlowData(data));
            this.manager.on('error', (error) => this.node.error(`[DH6400Polling] Error: ${error.message}`));
            this.manager.on('connected', () => this.node.log(`[DH6400Polling] Connected to ${this.config.serialPort}`));
            this.manager.on('disconnected', () => this.node.warn(`[DH6400Polling] Disconnected from ${this.config.serialPort}`));
            this.node.log(`[DH6400Polling] Initialized with ${this.config.enabledChannels.length} channels on ${this.config.serialPort}`);
        }
        catch (error) {
            this.node.error(`[DH6400Polling] Initialization failed: ${error.message}`);
        }
    }
    /**
     * Handle flow data from DH6400 sensor
     */
    handleFlowData(data) {
        // Update latest data cache
        this.latestData.set(data.channel, data);
        // Log received data
        this.node.log(`[DH6400Polling] ${data.sensorKey}: ` +
            `instant=${data.instantFlowM3h.toFixed(2)} m³/h, ` +
            `total=${data.totalAccumulatedM3.toFixed(4)} m³`);
    }
    /**
     * Start polling
     */
    async startPolling() {
        if (!this.config.enabled || !this.manager) {
            this.node.warn('[DH6400Polling] Cannot start - disabled or not initialized');
            return;
        }
        if (this.pollingTimer) {
            this.node.warn('[DH6400Polling] Polling already started');
            return;
        }
        try {
            // Connect to serial port first
            this.node.log(`[DH6400Polling] Connecting to ${this.config.serialPort}...`);
            await this.manager.connect();
            this.node.log(`[DH6400Polling] ✅ Connected successfully`);
            // Reset failure counter on successful connection
            this.consecutiveFailures = 0;
        }
        catch (error) {
            this.node.error(`[DH6400Polling] ❌ Connection failed: ${error.message}`);
            this.emitPollingError('DH6400_CONNECTION_FAILED', `Không thể kết nối với cổng serial ${this.config.serialPort}: ${error.message}`, 'critical', 'error', { serialPort: this.config.serialPort, errorDetails: error.message });
            return;
        }
        this.pollingTimer = setInterval(async () => {
            if (!this.isPaused) {
                await this.poll();
            }
        }, this.config.pollingInterval);
        this.node.log(`[DH6400Polling] Started with interval ${this.config.pollingInterval}ms`);
        // Trigger immediate first poll
        this.poll();
    }
    /**
     * Execute one polling cycle
     */
    async poll() {
        if (!this.manager)
            return;
        try {
            this.node.log(`[DH6400Polling] 🔄 Polling ${this.config.enabledChannels.length} channels...`);
            // Query all channels sequentially
            await this.manager.queryAllChannels();
            // After querying, emit telemetry event with latest data
            if (this.latestData.size > 0) {
                this.node.log(`[DH6400Polling] 📊 Emitting data for ${this.latestData.size} channels`);
                this.emitTelemetryEvent();
                // Reset failure counter on successful poll
                this.consecutiveFailures = 0;
            }
            else {
                this.node.warn(`[DH6400Polling] ⚠️  No data received from any channel`);
                this.consecutiveFailures++;
                // Emit error if no data after multiple attempts
                if (this.consecutiveFailures >= 3) {
                    this.emitPollingError('DH6400_NO_DATA', `Không nhận được dữ liệu từ ${this.config.enabledChannels.length} kênh DH6400 sau ${this.consecutiveFailures} lần thử`, 'high', 'warning', {
                        consecutiveFailures: this.consecutiveFailures,
                        enabledChannels: this.config.enabledChannels,
                        serialPort: this.config.serialPort
                    });
                }
            }
        }
        catch (error) {
            this.node.error(`[DH6400Polling] Poll cycle failed: ${error.message}`);
            this.consecutiveFailures++;
            // Emit error for polling failure
            this.emitPollingError('DH6400_POLL_FAILED', `Lỗi khi đọc dữ liệu DH6400: ${error.message}`, 'high', 'error', {
                consecutiveFailures: this.consecutiveFailures,
                errorDetails: error.message,
                serialPort: this.config.serialPort
            });
        }
    }
    /**
     * Emit telemetry event with formatted data
     */
    emitTelemetryEvent() {
        const telemetryData = {};
        // Format data for each channel
        this.latestData.forEach((data, channel) => {
            const sensorKey = data.sensorKey; // fs01-fs06
            const tfsSensorKey = `tfs${String(channel).padStart(2, '0')}`; // tfs01-tfs06
            // Add instantaneous flow (fs01-fs06)
            telemetryData[sensorKey] = data.instantFlowM3h;
            // Add total accumulated (tfs01-tfs06)
            telemetryData[tfsSensorKey] = data.totalAccumulatedM3;
        });
        // Emit event
        const event = {
            data: telemetryData,
            rawData: new Map(this.latestData),
            timestamp: Date.now(),
        };
        this.emit('telemetry-data', event);
    }
    /**
     * Stop polling
     */
    stopPolling() {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
            this.node.log('[DH6400Polling] Stopped');
        }
    }
    /**
     * Pause polling
     */
    pausePolling() {
        this.isPaused = true;
        this.node.log('[DH6400Polling] Paused');
    }
    /**
     * Resume polling
     */
    resumePolling() {
        this.isPaused = false;
        this.node.log('[DH6400Polling] Resumed');
    }
    /**
     * Get connection status
     */
    isConnected() {
        if (!this.manager)
            return false;
        return this.manager.isConnected();
    }
    /**
     * Cleanup
     */
    async cleanup() {
        this.stopPolling();
        if (this.manager) {
            await this.manager.cleanup();
            this.manager = null;
        }
        this.latestData.clear();
        this.node.log('[DH6400Polling] Cleaned up');
    }
    /**
     * Check if polling is active
     */
    isPollingActive() {
        return this.pollingTimer !== null && !this.isPaused;
    }
    /**
     * Emit polling error event with throttling to avoid spam
     */
    emitPollingError(err_code, message, severity, type, metadata) {
        const now = Date.now();
        // Throttle error emission to avoid spam (5 minutes)
        if (now - this.lastErrorEmitTime < this.errorEmitThrottle) {
            this.node.log(`[DH6400Polling] Error throttled: ${err_code}`);
            return;
        }
        this.lastErrorEmitTime = now;
        const errorEvent = {
            err_code,
            message,
            severity,
            type,
            entity: `dh6400-${this.config.serialPort}`,
            metadata: Object.assign(Object.assign({}, metadata), { timestamp: now, pollingInterval: this.config.pollingInterval }),
            timestamp: now
        };
        this.emit('polling-error', errorEvent);
        this.node.warn(`[DH6400Polling] Emitted error event: ${err_code}`);
    }
}
exports.DH6400PollingService = DH6400PollingService;
