/**
 * DH6400 Polling Service
 * Manages periodic polling of 6 DH6400 flow sensors via serial
 * Emits telemetry data for viis-marine-telemetry node
 */

import { EventEmitter } from 'events';
import { Node, NodeContext } from 'node-red';
import { DH6400MultiChannelManager, DH6400FlowData } from '../../core/dh6400-serial-client';

/**
 * DH6400 Polling Configuration (Single Serial Port)
 */
export interface DH6400PollingConfig {
    enabled: boolean;
    pollingInterval: number; // milliseconds
    serialPort: string; // Single serial port for all channels (e.g. /dev/ttyACM0)
    baudRate: number; // Default: 9600
    enabledChannels: number[]; // Slave IDs to poll (1-6)
}


export interface DH6400TelemetryEvent {
    data: {
        [key: string]: number; // fs01: instantFlow, tfs01: totalAccumulated, etc.
    };
    rawData: Map<number, DH6400FlowData>; // Raw data by channel
    timestamp: number;
}

/**
 * DH6400 Polling Error Event
 */
export interface DH6400PollingErrorEvent {
    err_code: string;
    message: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    type: 'alert' | 'warning' | 'info' | 'error';
    entity: string;
    metadata: Record<string, any>;
    timestamp: number;
}

/**
 * DH6400 Debug Event - emitted when data is successfully read from a channel
 */
export interface DH6400DebugEvent {
    channel: number;
    sensorKey: string;
    instantFlowM3h: number;
    totalAccumulatedM3: number;
    timestamp: number;
    rawHex?: string;
}

/**
 * DH6400 Polling Service
 * Polls 6 channels sequentially and emits telemetry data
 */
export class DH6400PollingService extends EventEmitter {
    private node: Node;
    private nodeContext: NodeContext;
    private config: DH6400PollingConfig;
    private manager: DH6400MultiChannelManager | null = null;
    private pollingTimer: NodeJS.Timeout | null = null;
    private isPaused: boolean = false;
    private latestData: Map<number, DH6400FlowData> = new Map();
    private consecutiveFailures: number = 0;
    private lastErrorEmitTime: number = 0;
    private readonly errorEmitThrottle: number = 300000; // 5 minutes throttle for duplicate errors
    private isReconnecting: boolean = false;
    private reconnectAttempts: number = 0;
    private readonly maxReconnectAttempts: number = 10;
    private readonly reconnectDelay: number = 5000; // 5 seconds

    constructor(node: Node, nodeContext: NodeContext, config: DH6400PollingConfig) {
        super();
        this.node = node;
        this.nodeContext = nodeContext;
        this.config = config;

        if (this.config.enabled) {
            this.initializeManager();
        } else {
            this.node.log('[DH6400Polling] Disabled by configuration');
        }
    }

    /**
     * Initialize DH6400 Multi-Channel Manager
     */
    private initializeManager(): void {
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
                info: (msg: string) => this.node.log(msg),
                warn: (msg: string) => this.node.warn(msg),
                error: (msg: string) => this.node.error(msg),
                debug: (msg: string) => this.node.log(msg)
            };

            // Create single manager for shared serial port with logger
            this.manager = new DH6400MultiChannelManager(
                this.config.serialPort,
                this.config.baudRate,
                this.config.enabledChannels,
                logger
            );

            // Setup event handlers
            this.manager.on('data', (data: DH6400FlowData) => this.handleFlowData(data));
            this.manager.on('error', (error) => this.node.error(`[DH6400Polling] Error: ${error.message}`));
            this.manager.on('connected', () => this.node.log(`[DH6400Polling] Connected to ${this.config.serialPort}`));
            this.manager.on('disconnected', () => this.node.warn(`[DH6400Polling] Disconnected from ${this.config.serialPort}`));

            this.node.log(`[DH6400Polling] Initialized with ${this.config.enabledChannels.length} channels on ${this.config.serialPort}`);
        } catch (error) {
            this.node.error(`[DH6400Polling] Initialization failed: ${(error as Error).message}`);
        }
    }

    /**
     * Handle flow data from DH6400 sensor
     */
    private handleFlowData(data: DH6400FlowData): void {
        // Update latest data cache
        this.latestData.set(data.channel, data);

        // Log received data
        this.node.log(
            `[DH6400Polling] ✅ ${data.sensorKey}: ` +
            `instant=${data.instantFlowM3h.toFixed(2)} m³/h, ` +
            `total=${data.totalAccumulatedM3.toFixed(4)} m³`
        );

        // Emit debug event for successful read
        const debugEvent: DH6400DebugEvent = {
            channel: data.channel,
            sensorKey: data.sensorKey,
            instantFlowM3h: data.instantFlowM3h,
            totalAccumulatedM3: data.totalAccumulatedM3,
            timestamp: data.timestamp,
            rawHex: data.rawData?.toString('hex').toUpperCase()
        };
        this.emit('debug-data', debugEvent);
    }

    /**
     * Start polling with robust error handling
     */
    async startPolling(): Promise<void> {
        if (!this.config.enabled || !this.manager) {
            this.node.warn('[DH6400Polling] Cannot start - disabled or not initialized');
            return;
        }

        if (this.pollingTimer) {
            this.node.warn('[DH6400Polling] Polling already started');
            return;
        }

        // Try to connect with graceful error handling
        const connected = await this.tryInitialConnection();
        
        // Start polling timer regardless of connection status
        // If not connected, poll() will attempt reconnection
        this.pollingTimer = setInterval(async () => {
            if (!this.isPaused) {
                try {
                    await this.poll();
                } catch (pollError) {
                    // Catch any unhandled errors in poll to prevent crashes
                    this.node.error(`[DH6400Polling] Unhandled poll error: ${(pollError as Error).message}`);
                }
            }
        }, this.config.pollingInterval);

        if (connected) {
            this.node.log(`[DH6400Polling] Started with interval ${this.config.pollingInterval}ms`);
            // Trigger immediate first poll
            this.poll().catch(e => this.node.error(`[DH6400Polling] First poll error: ${(e as Error).message}`));
        } else {
            this.node.warn(`[DH6400Polling] Started in disconnected state - will retry on next poll cycle`);
        }
    }

    /**
     * Try initial connection with graceful error handling
     * Returns true if connected, false otherwise (will retry later)
     */
    private async tryInitialConnection(): Promise<boolean> {
        if (!this.manager) return false;
        
        try {
            this.node.log(`[DH6400Polling] Connecting to ${this.config.serialPort}...`);
            await this.manager.connect();
            this.node.log(`[DH6400Polling] ✅ Connected successfully`);
            this.consecutiveFailures = 0;
            return true;
        } catch (error) {
            const errorMsg = (error as Error).message;
            const isLockError = errorMsg.includes('Cannot lock port') ||
                               errorMsg.includes('Resource temporarily unavailable') ||
                               errorMsg.includes('EBUSY');
            
            if (isLockError) {
                // Port lock error - common during deploy, will retry
                this.node.warn(`[DH6400Polling] ⚠️ Port locked (likely deploy in progress), will retry: ${errorMsg}`);
            } else {
                this.node.error(`[DH6400Polling] ❌ Connection failed: ${errorMsg}`);
                this.emitPollingError(
                    'DH6400_CONNECTION_FAILED',
                    `Không thể kết nối với cổng serial ${this.config.serialPort}: ${errorMsg}`,
                    'critical',
                    'error',
                    { serialPort: this.config.serialPort, errorDetails: errorMsg }
                );
            }
            return false;
        }
    }

    /**
     * Execute one polling cycle
     */
    private async poll(): Promise<void> {
        if (!this.manager) return;

        // Check connection status and reconnect if needed
        if (!this.manager.isConnected()) {
            this.node.warn('[DH6400Polling] ⚠️  Not connected, attempting to reconnect...');
            await this.tryReconnect();
            if (!this.manager.isConnected()) {
                this.node.warn('[DH6400Polling] ⚠️  Still not connected, skipping poll cycle');
                return;
            }
        }

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
                this.reconnectAttempts = 0; // Reset reconnect attempts on successful poll
            } else {
                this.node.warn(`[DH6400Polling] ⚠️  No data received from any channel`);
                this.consecutiveFailures++;

                // Check if device might have disconnected
                if (this.consecutiveFailures >= 3 && !this.manager.isConnected()) {
                    this.node.warn('[DH6400Polling] Connection lost, will try to reconnect on next poll');
                }

                // Emit error if no data after multiple attempts
                if (this.consecutiveFailures >= 3) {
                    this.emitPollingError(
                        'DH6400_NO_DATA',
                        `Không nhận được dữ liệu từ ${this.config.enabledChannels.length} kênh DH6400 sau ${this.consecutiveFailures} lần thử`,
                        'high',
                        'warning',
                        {
                            consecutiveFailures: this.consecutiveFailures,
                            enabledChannels: this.config.enabledChannels,
                            serialPort: this.config.serialPort
                        }
                    );
                }
            }
        } catch (error) {
            this.node.error(`[DH6400Polling] Poll cycle failed: ${(error as Error).message}`);
            this.consecutiveFailures++;

            // Emit error for polling failure
            this.emitPollingError(
                'DH6400_POLL_FAILED',
                `Lỗi khi đọc dữ liệu DH6400: ${(error as Error).message}`,
                'high',
                'error',
                {
                    consecutiveFailures: this.consecutiveFailures,
                    errorDetails: (error as Error).message,
                    serialPort: this.config.serialPort
                }
            );
        }
    }

    /**
     * Try to reconnect to the serial port
     */
    private async tryReconnect(): Promise<void> {
        if (this.isReconnecting) {
            this.node.log('[DH6400Polling] Reconnection already in progress...');
            return;
        }

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.node.error(`[DH6400Polling] Max reconnect attempts (${this.maxReconnectAttempts}) reached`);
            this.emitPollingError(
                'DH6400_MAX_RECONNECT_ATTEMPTS',
                `Đã thử kết nối lại ${this.maxReconnectAttempts} lần nhưng không thành công`,
                'critical',
                'error',
                {
                    reconnectAttempts: this.reconnectAttempts,
                    serialPort: this.config.serialPort
                }
            );
            // Reset counter to allow future attempts after error is emitted
            this.reconnectAttempts = 0;
            return;
        }

        this.isReconnecting = true;
        this.reconnectAttempts++;

        try {
            this.node.log(`[DH6400Polling] 🔄 Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);
            
            if (this.manager) {
                await this.manager.connect();
                this.node.log('[DH6400Polling] ✅ Reconnected successfully');
                this.reconnectAttempts = 0; // Reset on success
            }
        } catch (error) {
            this.node.warn(`[DH6400Polling] ❌ Reconnect failed: ${(error as Error).message}`);
            
            // Wait before next attempt
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.node.log(`[DH6400Polling] Will retry in ${this.reconnectDelay / 1000}s...`);
            }
        } finally {
            this.isReconnecting = false;
        }
    }

    /**
     * Emit telemetry event with formatted data
     */
    private emitTelemetryEvent(): void {
        const telemetryData: { [key: string]: number } = {};

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
        const event: DH6400TelemetryEvent = {
            data: telemetryData,
            rawData: new Map(this.latestData),
            timestamp: Date.now(),
        };

        this.emit('telemetry-data', event);
    }

    /**
     * Stop polling
     */
    stopPolling(): void {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
            this.node.log('[DH6400Polling] Stopped');
        }
    }

    /**
     * Pause polling
     */
    pausePolling(): void {
        this.isPaused = true;
        this.node.log('[DH6400Polling] Paused');
    }

    /**
     * Resume polling
     */
    resumePolling(): void {
        this.isPaused = false;
        this.node.log('[DH6400Polling] Resumed');
    }

    /**
     * Get connection status
     */
    isConnected(): boolean {
        if (!this.manager) return false;
        return this.manager.isConnected();
    }

    /**
     * Cleanup
     */
    async cleanup(): Promise<void> {
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
    isPollingActive(): boolean {
        return this.pollingTimer !== null && !this.isPaused;
    }

    /**
     * Emit polling error event with throttling to avoid spam
     */
    private emitPollingError(
        err_code: string,
        message: string,
        severity: 'low' | 'medium' | 'high' | 'critical',
        type: 'alert' | 'warning' | 'info' | 'error',
        metadata: Record<string, any>
    ): void {
        const now = Date.now();

        // Throttle error emission to avoid spam (5 minutes)
        if (now - this.lastErrorEmitTime < this.errorEmitThrottle) {
            this.node.log(`[DH6400Polling] Error throttled: ${err_code}`);
            return;
        }

        this.lastErrorEmitTime = now;

        const errorEvent: DH6400PollingErrorEvent = {
            err_code,
            message,
            severity,
            type,
            entity: `dh6400-${this.config.serialPort}`,
            metadata: {
                ...metadata,
                timestamp: now,
                pollingInterval: this.config.pollingInterval
            },
            timestamp: now
        };

        this.emit('polling-error', errorEvent);
        this.node.warn(`[DH6400Polling] Emitted error event: ${err_code}`);
    }
}
