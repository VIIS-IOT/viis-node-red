import { Node } from "node-red";
import mqtt, { MqttClient, IClientOptions, IClientPublishOptions } from "mqtt";
import { EventEmitter } from "events";

export interface MqttConfig {
    broker?: string;
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
    private connectionState: ConnectionState;
    private messageQueue: QueuedMessage[] = [];
    private healthCheckTimer: NodeJS.Timeout | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private circuitBreakerTimer: NodeJS.Timeout | null = null;

    // Event listeners for cleanup
    private eventListeners: Map<string, (...args: any[]) => void> = new Map();

    constructor(config: MqttConfig, node: Node) {
        super();
        this.config = {
            reconnectPeriod: 5000,
            connectTimeout: 30000,
            keepalive: 60,
            maxReconnectAttempts: 10,
            reconnectBackoffMultiplier: 1.5,
            maxReconnectDelay: 60000,
            healthCheckInterval: 30000,
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
            clean: true, // Clean session for ThingsBoard compatibility
            will: {
                topic: `v1/devices/me/attributes`,
                payload: JSON.stringify({ status: "offline" }),
                qos: 1,
                retain: false
            }
        };

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

        this.node.error(`MQTT Connection Error: ${error.message}`);
        this.node.status({
            fill: "yellow",
            shape: "ring",
            text: `Error: ${error.message} (Attempt ${this.connectionState.reconnectAttempts})`
        });

        // Circuit breaker logic
        if (this.config.enableCircuitBreaker &&
            this.connectionState.reconnectAttempts >= (this.config.maxReconnectAttempts || 10)) {
            this.openCircuitBreaker();
        } else {
            this.scheduleReconnection();
        }

        this.emit("mqtt-error", { error, state: this.connectionState });
    }

    // Circuit breaker implementation
    private openCircuitBreaker(): void {
        this.connectionState.circuitBreakerOpen = true;
        this.node.warn("Circuit breaker opened - stopping reconnection attempts");

        // Close circuit breaker after a timeout
        this.circuitBreakerTimer = setTimeout(() => {
            this.connectionState.circuitBreakerOpen = false;
            this.connectionState.reconnectAttempts = 0;
            this.node.log("Circuit breaker closed - reconnection attempts resumed");
        }, 300000); // 5 minutes
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

        try {
            await this.publishMessage(
                "v1/devices/me/attributes",
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

        this.publishMessage(
            "v1/devices/me/telemetry",
            JSON.stringify(healthData),
            { qos: 0, retain: false }
        ).catch((error: Error) => {
            this.node.warn(`Health check failed: ${error.message}`);
            this.handleConnectionError(new Error(`Health check failed: ${error.message}`));
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

    // Chờ kết nối trước khi sử dụng
    public async waitForConnection(timeoutMs: number = 30000): Promise<void> {
        if (this.client?.connected) return; // Đã kết nối thì return ngay
        if (!this.connectionPromise) throw new Error("Client not initialized");

        // Promise.race với kiểu rõ ràng là Promise<void>
        await Promise.race([
            this.connectionPromise,
            new Promise<void>((_, reject) => setTimeout(() => reject(new Error("Connection timeout")), timeoutMs)),
        ]);
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

    // Publish message, chỉ khi đã kết nối
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
                    this.node.log(`Published to topic: ${topic}`);
                    resolve();
                }
            });
        });
    }



    // Resubscribe tất cả các topic khi reconnect
    private resubscribeTopics(): void {
        if (!this.client) return;
        this.subscribedTopics.forEach((topic) => {
            this.client.subscribe(topic, { qos: this.config.qos }, (err) => {
                if (err) {
                    this.node.error(`Failed to resubscribe to ${topic}: ${err.message}`);
                } else {
                    this.node.log(`Resubscribed to topic: ${topic}`);
                }
            });
        });
    }

    // Enhanced disconnect with proper resource cleanup
    public async disconnect(): Promise<void> {
        this.node.log("Initiating MQTT client disconnect...");

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

        // Reset state
        this.connectionState.isConnected = false;
        this.connectionState.isConnecting = false;
        this.messageQueue = [];
        this.subscribedTopics.clear();
    }

    // Force disconnect for emergency situations
    public forceDisconnect(): void {
        this.node.warn("Force disconnecting MQTT client");

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

    // Kiểm tra trạng thái kết nối
    public isConnected(): boolean {
        return this.client?.connected ?? false;
    }
}

// // Ví dụ tích hợp vào custom node
// export function registerMqttConfigNode(RED: NodeAPI) {
//     function MqttConfigNode(this: Node, config: MqttConfig) {
//         RED.nodes.createNode(this, config);
//         const mqttClient = new MqttClientCore(config, this);

//         // Đăng ký sự kiện để custom node khác sử dụng
//         this.on("close", () => {
//             mqttClient.disconnect();
//         });

//         // Lưu mqttClient vào node để các node khác truy cập
//         (this as any).mqttClient = mqttClient;
//     }

//     RED.nodes.registerType("mqtt-config", MqttConfigNode);
// }