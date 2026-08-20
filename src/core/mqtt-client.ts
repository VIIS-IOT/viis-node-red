import { Node } from "node-red";
import mqtt, { MqttClient, IClientOptions, IClientPublishOptions } from "mqtt";
import { EventEmitter } from "events";
import { ConnectionMonitor } from "./connection-monitor";
import {
    buildDeviceAttributesTopic,
    buildDeviceTelemetryTopic,
} from "./demeter-mqtt-topics";

export interface MqttConfig {
    broker?: string;
    /** Virtual device UUID — required for Demeter topic ACL / LWT. */
    deviceId?: string;
    clientId?: string;
    username?: string;
    password?: string;
    reconnectPeriod?: number;
    connectTimeout?: number;
    keepalive?: number;
    qos: 0 | 1 | 2;
    // Enhanced configuration for Google IoT standards
    maxReconnectAttempts?: number;
    reconnectBackoffMultiplier?: number;
    maxReconnectDelay?: number;
    healthCheckInterval?: number;
    messageQueueSize?: number;
    enableCircuitBreaker?: boolean;
}

export interface MqttMessage {
    topic: string;
    message: string | Buffer;
    qos: 0 | 1 | 2;
    retain: boolean;
    timestamp?: number;
}

export interface ConnectionState {
    isConnected: boolean;
    isConnecting: boolean;
    lastConnectedAt?: number;
    lastDisconnectedAt?: number;
    reconnectAttempts: number;
    totalReconnects: number;
    circuitBreakerOpen: boolean;
}

export interface QueuedMessage {
    topic: string;
    message: string | Buffer;
    options?: IClientPublishOptions;
    timestamp: number;
    retryCount: number;
}

// Enhanced MQTT Client with Google IoT standards compliance
export class MqttClientCore extends EventEmitter {
    private client: MqttClient | null = null;
    private config: MqttConfig;
    private node: Node;
    private connectionPromise: Promise<void> | null = null;
    private subscribedTopics: Set<string> = new Set();

    // Enhanced state management
    private readonly RECONNECT_INTERVAL_MIN = 500; // 500ms - more aggressive
    private readonly RECONNECT_INTERVAL_MAX = 10000; // 10 seconds - faster recovery
    private readonly RECONNECT_INTERVAL_MULTIPLIER = 1.3; // slower backoff
    private readonly CIRCUIT_BREAKER_TIMEOUT = 20000; // 20 seconds - quicker recovery
    private readonly CIRCUIT_BREAKER_MAX_ATTEMPTS = 10; // more attempts before circuit break
    private readonly HEALTH_CHECK_INTERVAL = 300000; // 5 minutes - health check interval

    private connectionState: ConnectionState;
    private messageQueue: QueuedMessage[] = [];
    private healthCheckTimer: NodeJS.Timeout | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private circuitBreakerTimer: NodeJS.Timeout | null = null;
    private monitoredClientId: string = '';

    // Event listeners for cleanup
    private eventListeners: Map<string, (...args: any[]) => void> = new Map();

    constructor(config: MqttConfig, node: Node) {
        super();
        this.config = {
            reconnectPeriod: 0, // Disable auto reconnect (0 = disabled), we'll handle it manually
            connectTimeout: 10000, // 10 second timeout for faster failure detection
            keepalive: 30, // 30 second keepalive for quicker disconnection detection
            maxReconnectAttempts: this.CIRCUIT_BREAKER_MAX_ATTEMPTS,
            reconnectBackoffMultiplier: this.RECONNECT_INTERVAL_MULTIPLIER,
            maxReconnectDelay: this.RECONNECT_INTERVAL_MAX,
            healthCheckInterval: this.HEALTH_CHECK_INTERVAL,
            messageQueueSize: 100,
            enableCircuitBreaker: true,
            ...config,
        };
        this.node = node;

        // Initialize connection state
        this.connectionState = {
            isConnected: false,
            isConnecting: false,
            reconnectAttempts: 0,
            totalReconnects: 0,
            circuitBreakerOpen: false
        };

        this.initializeClient();
        this.startHealthCheck();

        // Register with connection monitor for automatic recovery
        const monitor = ConnectionMonitor.getInstance();
        this.monitoredClientId = this.config.clientId || `nodered_${Math.random().toString(16).substring(2, 8)}`;
        monitor.registerClient(this.monitoredClientId, this, node);
    }

    // Enhanced MQTT client initialization with proper error handling
    private initializeClient(): void {
        if (this.connectionState.circuitBreakerOpen) {
            this.node.warn("Circuit breaker is open, skipping connection attempt");
            return;
        }

        this.connectionState.isConnecting = true;
        this.clearTimers();

        const options: IClientOptions = {
            clientId: this.config.clientId || `nodered_${Math.random().toString(16).substring(2, 8)}`,
            username: this.config.username,
            password: this.config.password,
            reconnectPeriod: 0, // Disable auto-reconnect, we handle it manually
            connectTimeout: this.config.connectTimeout,
            keepalive: this.config.keepalive,
            clean: true,
        };
        if (this.config.deviceId) {
            options.will = {
                topic: buildDeviceAttributesTopic(this.config.deviceId),
                payload: JSON.stringify({ status: "offline" }),
                qos: 1,
                retain: false,
            };
        }

        try {
            this.client = mqtt.connect(this.config.broker!, options);
            this.setupEventHandlers();
            this.createConnectionPromise();
        } catch (error) {
            this.handleConnectionError(error as Error);
        }
    }

    // Create a fresh connection promise for each connection attempt
    private createConnectionPromise(): void {
        this.connectionPromise = new Promise<void>((resolve, reject) => {
            if (!this.client) {
                reject(new Error("MQTT client not initialized"));
                return;
            }

            const connectHandler = () => {
                this.onConnected();
                resolve();
            };

            const errorHandler = (error: Error) => {
                this.handleConnectionError(error);
                reject(error);
            };

            const timeoutHandler = setTimeout(() => {
                this.handleConnectionError(new Error("Connection timeout"));
                reject(new Error("Connection timeout"));
            }, this.config.connectTimeout);

            // Store event handlers for cleanup
            this.eventListeners.set('connect', connectHandler);
            this.eventListeners.set('error', errorHandler);
            this.eventListeners.set('timeout', () => clearTimeout(timeoutHandler));

            this.client.once("connect", () => {
                clearTimeout(timeoutHandler);
                connectHandler();
            });

            this.client.once("error", (error) => {
                clearTimeout(timeoutHandler);
                errorHandler(error);
            });
        });
    }

    // Setup all event handlers with proper cleanup tracking
    private setupEventHandlers(): void {
        if (!this.client) return;

        const closeHandler = () => this.onDisconnected();
        const messageHandler = (topic: string, message: Buffer, packet: any) => {
            const mqttMessage: MqttMessage = {
                topic,
                message: message.toString(),
                qos: packet.qos,
                retain: packet.retain,
                timestamp: Date.now()
            };
            this.emit("mqtt-message", { message: mqttMessage });
        };

        const offlineHandler = () => {
            this.node.warn("MQTT client went offline");
            this.onDisconnected();
        };

        // Store handlers for cleanup
        this.eventListeners.set('close', closeHandler);
        this.eventListeners.set('message', messageHandler);
        this.eventListeners.set('offline', offlineHandler);

        this.client.on("close", closeHandler);
        this.client.on("message", messageHandler);
        this.client.on("offline", offlineHandler);
    }

    // Connection state handlers
    private onConnected(): void {
        this.connectionState.isConnected = true;
        this.connectionState.isConnecting = false;
        this.connectionState.lastConnectedAt = Date.now();
        this.connectionState.reconnectAttempts = 0;
        this.connectionState.totalReconnects++;

        this.node.status({ fill: "green", shape: "dot", text: "Connected" });
        this.emit("mqtt-status", { status: "connected", state: this.connectionState });

        // Resubscribe to topics
        this.resubscribeTopics();

        // Process queued messages
        this.processMessageQueue();

        // Send device online status to ThingsBoard
        this.publishDeviceStatus("online");
    }

    private onDisconnected(): void {
        this.connectionState.isConnected = false;
        this.connectionState.isConnecting = false;
        this.connectionState.lastDisconnectedAt = Date.now();

        this.node.status({ fill: "red", shape: "ring", text: "Disconnected" });
        this.emit("mqtt-status", { status: "disconnected", state: this.connectionState });

        // Schedule reconnection if not manually disconnected
        this.scheduleReconnection();
    }

    // Enhanced error handling with circuit breaker pattern
    private handleConnectionError(error: Error): void {
        this.connectionState.isConnecting = false;
        this.connectionState.reconnectAttempts++;

        // Reset stale connection promise to prevent hanging waitForConnection calls
        this.connectionPromise = null;

        this.node.error(`MQTT Connection Error: ${error.message}`);
        this.node.status({
            fill: "yellow",
            shape: "ring",
            text: `Error: ${error.message} (Attempt ${this.connectionState.reconnectAttempts})`
        });

        // Circuit breaker logic with more aggressive recovery
        if (this.config.enableCircuitBreaker &&
            this.connectionState.reconnectAttempts >= (this.config.maxReconnectAttempts || 10)) {
            this.openCircuitBreaker();
        } else {
            this.scheduleReconnection();
        }

        this.emit("mqtt-error", { error, state: this.connectionState });
    }

    // Circuit breaker implementation with progressive recovery
    private openCircuitBreaker(): void {
        this.connectionState.circuitBreakerOpen = true;
        this.node.warn("Circuit breaker opened - stopping reconnection attempts");
        this.node.status({ fill: "red", shape: "ring", text: "Circuit breaker open - will retry in 30s" });

        // Shorter initial timeout with progressive backoff
        const initialTimeout = this.CIRCUIT_BREAKER_TIMEOUT; // 20 seconds instead of 5 minutes
        this.circuitBreakerTimer = setTimeout(() => {
            this.connectionState.circuitBreakerOpen = false;
            this.connectionState.reconnectAttempts = 0;
            this.node.log("Circuit breaker closed - reconnection attempts resumed");
            this.node.status({ fill: "yellow", shape: "ring", text: "Retrying connection..." });

            // Immediately attempt reconnection
            this.initializeClient();
        }, initialTimeout);
    }

    // Add method to manually reset circuit breaker for external recovery triggers
    public resetCircuitBreaker(): void {
        if (this.connectionState.circuitBreakerOpen) {
            this.node.warn("Manually resetting circuit breaker");
            this.connectionState.circuitBreakerOpen = false;
            this.connectionState.reconnectAttempts = 0;

            if (this.circuitBreakerTimer) {
                clearTimeout(this.circuitBreakerTimer);
                this.circuitBreakerTimer = null;
            }

            // Attempt immediate reconnection
            this.initializeClient();
        }
    }

    // Smart reconnection with exponential backoff
    private scheduleReconnection(): void {
        if (this.connectionState.circuitBreakerOpen || this.reconnectTimer) {
            return;
        }

        const baseDelay = this.config.reconnectPeriod || 5000;
        const multiplier = this.config.reconnectBackoffMultiplier || 1.5;
        const maxDelay = this.config.maxReconnectDelay || 60000;

        const delay = Math.min(
            baseDelay * Math.pow(multiplier, this.connectionState.reconnectAttempts),
            maxDelay
        );

        this.node.log(`Scheduling reconnection in ${delay}ms (attempt ${this.connectionState.reconnectAttempts + 1})`);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.initializeClient();
        }, delay);
    }

    // Timer management
    private clearTimers(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.circuitBreakerTimer) {
            clearTimeout(this.circuitBreakerTimer);
            this.circuitBreakerTimer = null;
        }
    }

    // Health check implementation
    private startHealthCheck(): void {
        if (!this.config.healthCheckInterval) return;

        this.healthCheckTimer = setInterval(() => {
            if (this.connectionState.isConnected && this.client) {
                // Send a lightweight telemetry message as health check for ThingsBoard
                this.publishHealthCheck();
            }
        }, this.config.healthCheckInterval);
    }

    // Message queue management for offline scenarios
    private processMessageQueue(): void {
        if (!this.connectionState.isConnected || this.messageQueue.length === 0) {
            return;
        }

        const messagesToProcess = [...this.messageQueue];
        this.messageQueue = [];

        messagesToProcess.forEach(queuedMessage => {
            this.publishMessage(
                queuedMessage.topic,
                queuedMessage.message,
                queuedMessage.options
            ).catch((error: Error) => {
                // Re-queue failed messages with retry limit
                if (queuedMessage.retryCount < 3) {
                    queuedMessage.retryCount++;
                    this.queueMessage(queuedMessage);
                } else {
                    this.node.warn(`Dropping message after 3 retries: ${queuedMessage.topic} - ${error.message}`);
                }
            });
        });
    }

    private queueMessage(message: QueuedMessage): void {
        if (this.messageQueue.length >= (this.config.messageQueueSize || 100)) {
            // Remove oldest message to make room
            this.messageQueue.shift();
            this.node.warn("Message queue full, dropping oldest message");
        }
        this.messageQueue.push(message);
    }

    // ThingsBoard specific methods
    private async publishDeviceStatus(status: "online" | "offline"): Promise<void> {
        if (!this.connectionState.isConnected) return;

        const statusMessage = {
            status,
            timestamp: Date.now(),
            clientId: this.config.clientId
        };

        if (!this.config.deviceId) return;
        try {
            await this.publishMessage(
                buildDeviceAttributesTopic(this.config.deviceId),
                JSON.stringify(statusMessage),
                { qos: 1, retain: false }
            );
        } catch (error) {
            this.node.warn(`Failed to publish device status: ${(error as Error).message}`);
            throw error;
        }
    }

    private publishHealthCheck(): void {
        if (!this.connectionState.isConnected) return;

        const healthData = {
            heartbeat: Date.now(),
            uptime: process.uptime(),
            memory: process.memoryUsage().heapUsed
        };

        if (!this.config.deviceId) return;
        this.publishMessage(
            buildDeviceTelemetryTopic(this.config.deviceId),
            JSON.stringify(healthData),
            { qos: 0, retain: false }
        ).catch((error: Error) => {
            // Don't trigger reconnection on health check failure
            // Health check failures can be false positives and cause unnecessary reconnects
            this.node.warn(`Health check failed: ${error.message}`);
            // Removed: this.handleConnectionError(new Error(`Health check failed: ${error.message}`));
        });
    }

    // Alias for publish method to maintain consistency
    private async publishMessage(topic: string, message: string | Buffer, options?: IClientPublishOptions): Promise<void> {
        if (!this.connectionState.isConnected) {
            // Queue message if offline
            const queuedMessage: QueuedMessage = {
                topic,
                message,
                options,
                timestamp: Date.now(),
                retryCount: 0
            };
            this.queueMessage(queuedMessage);
            return;
        }

        return this.publish(topic, message, options);
    }

    // Get connection state for monitoring
    public getConnectionState(): ConnectionState {
        return { ...this.connectionState };
    }

    // Get queue status for monitoring
    public getQueueStatus(): { size: number; maxSize: number } {
        return {
            size: this.messageQueue.length,
            maxSize: this.config.messageQueueSize || 100
        };
    }

    // Enhanced connection waiting with automatic recovery
    public async waitForConnection(timeoutMs: number = 30000): Promise<void> {
        if (this.client?.connected) return; // Already connected

        // If circuit breaker is open, try to reset it for recovery
        if (this.connectionState.circuitBreakerOpen) {
            this.node.warn("Circuit breaker is open, attempting reset for recovery");
            this.resetCircuitBreaker();
        }

        // If no connection promise exists, try to reinitialize
        if (!this.connectionPromise) {
            this.node.warn("No connection promise exists, reinitializing client");
            this.initializeClient();
        }

        if (!this.connectionPromise) {
            throw new Error("Failed to initialize MQTT client connection");
        }

        // Promise.race with timeout
        try {
            await Promise.race([
                this.connectionPromise,
                new Promise<void>((_, reject) =>
                    setTimeout(() => reject(new Error("Connection timeout")), timeoutMs)
                ),
            ]);
        } catch (error) {
            // On timeout or error, reset connection promise and try once more
            this.connectionPromise = null;
            this.node.warn(`Connection wait failed: ${(error as Error).message}, attempting recovery`);

            // Reset circuit breaker if it's blocking recovery
            if (this.connectionState.circuitBreakerOpen) {
                this.resetCircuitBreaker();
            }

            throw error;
        }
    }

    // Subscribe topic
    public async subscribe(topic: string, qos: 0 | 1 | 2 = this.config.qos): Promise<void> {
        if (!this.client) throw new Error("MQTT client not initialized");
        if (!this.client.connected) {
            await this.waitForConnection();
        }
        return new Promise((resolve, reject) => {
            this.client!.subscribe(topic, { qos }, (err) => {
                if (err) {
                    this.node.error(`Failed to subscribe to ${topic}: ${err.message}`);
                    reject(err);
                } else {
                    this.subscribedTopics.add(topic);
                    this.node.log(`Subscribed to topic: ${topic}`);
                    resolve();
                }
            });
        });
    }

    // Unsubscribe topic
    public async unsubscribe(topic: string): Promise<void> {
        if (!this.client) throw new Error("MQTT client not initialized");
        if (!this.client.connected) {
            await this.waitForConnection();
        }
        return new Promise((resolve, reject) => {
            this.client!.unsubscribe(topic, (err) => {
                if (err) {
                    this.node.error(`Failed to unsubscribe from ${topic}: ${err.message}`);
                    reject(err);
                } else {
                    this.subscribedTopics.delete(topic);
                    this.node.log(`Unsubscribed from topic: ${topic}`);
                    resolve();
                }
            });
        });
    }

    // Publish message only when connected
    public async publish(topic: string, message: string | Buffer, options?: IClientPublishOptions): Promise<void> {
        if (!this.client) throw new Error("MQTT client not initialized");
        if (!this.client.connected) {
            this.node.warn(`MQTT client not connected to ${this.config.broker}, waiting for connection...`);
            await this.waitForConnection();
        }
        return new Promise((resolve, reject) => {
            this.client!.publish(topic, message, { qos: this.config.qos, ...options }, (err) => {
                if (err) {
                    this.node.error(`Failed to publish to ${topic}: ${err.message}`);
                    reject(err);
                } else {
                    // Format message for logging
                    const messageStr = Buffer.isBuffer(message) ? message.toString('utf8') : message;
                    const truncatedMsg = messageStr.length > 200 ? messageStr.substring(0, 200) + '...' : messageStr;

                    // Try to parse as JSON for better readability
                    let displayMsg = truncatedMsg;
                    try {
                        const parsed = JSON.parse(messageStr);
                        displayMsg = JSON.stringify(parsed);
                        if (displayMsg.length > 200) {
                            displayMsg = displayMsg.substring(0, 200) + '...';
                        }
                    } catch {
                        // Not JSON, use as is
                    }

                    resolve();
                }
            });
        });
    }



    // Resubscribe all topics on reconnect
    private resubscribeTopics(): void {
        if (!this.client) return;

        // Only log resubscribe if there are topics to resubscribe
        const topicsCount = this.subscribedTopics.size;
        if (topicsCount === 0) return;

        // Use a single log message for all resubscriptions to reduce spam
        const topics = Array.from(this.subscribedTopics);
        this.node.log(`Resubscribing to ${topicsCount} topic(s): ${topics.join(', ')}`);

        this.subscribedTopics.forEach((topic) => {
            this.client.subscribe(topic, { qos: this.config.qos }, (err) => {
                if (err) {
                    this.node.error(`Failed to resubscribe to ${topic}: ${err.message}`);
                }
                // Remove individual success log to reduce spam
            });
        });
    }

    // Enhanced disconnect with proper resource cleanup
    public async disconnect(): Promise<void> {
        this.node.log("Initiating MQTT client disconnect...");

        // Unregister from connection monitor
        ConnectionMonitor.getInstance().unregisterClient(this.monitoredClientId);

        // Clear all timers
        this.clearTimers();
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }

        // Send offline status before disconnecting
        if (this.connectionState.isConnected) {
            try {
                await this.publishDeviceStatus("offline");
            } catch (error) {
                this.node.warn(`Failed to send offline status: ${(error as Error).message}`);
            }
        }

        // Remove all event listeners
        if (this.client) {
            this.eventListeners.forEach((handler, event) => {
                this.client?.removeListener(event as any, handler);
            });
            this.eventListeners.clear();

            // Graceful disconnect
            return new Promise<void>((resolve) => {
                if (this.client) {
                    this.client.end(false, {}, () => {
                        this.node.log("MQTT client disconnected successfully");
                        this.client = null;
                        this.connectionPromise = null;
                        resolve();
                    });
                } else {
                    resolve();
                }
            });
        }

    }

    // Force disconnect for emergency situations
    public forceDisconnect(): void {
        this.node.warn("Force disconnecting MQTT client");

        // Unregister from connection monitor
        ConnectionMonitor.getInstance().unregisterClient(this.monitoredClientId);

        this.clearTimers();
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }

        if (this.client) {
            this.client.end(true); // Force close
            this.client = null;
        }

        this.connectionPromise = null;
        this.connectionState.isConnected = false;
        this.connectionState.isConnecting = false;
        this.messageQueue = [];
        this.subscribedTopics.clear();
        this.eventListeners.clear();
    }

    // Check connection status
    public isConnected(): boolean {
        return this.client?.connected ?? false;
    }
}

