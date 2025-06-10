"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MqttClientCore = void 0;
const mqtt_1 = __importDefault(require("mqtt"));
const events_1 = require("events");
const connection_monitor_1 = require("./connection-monitor");
// Enhanced MQTT Client with Google IoT standards compliance
class MqttClientCore extends events_1.EventEmitter {
    constructor(config, node) {
        super();
        this.client = null;
        this.connectionPromise = null;
        this.subscribedTopics = new Set();
        this.messageQueue = [];
        this.healthCheckTimer = null;
        this.reconnectTimer = null;
        this.circuitBreakerTimer = null;
        // Event listeners for cleanup
        this.eventListeners = new Map();
        this.config = Object.assign({ reconnectPeriod: 5000, connectTimeout: 30000, keepalive: 60, maxReconnectAttempts: 10, reconnectBackoffMultiplier: 1.5, maxReconnectDelay: 60000, healthCheckInterval: 30000, messageQueueSize: 100, enableCircuitBreaker: true }, config);
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
        const monitor = connection_monitor_1.ConnectionMonitor.getInstance();
        const clientId = this.config.clientId || `nodered_${Math.random().toString(16).substring(2, 8)}`;
        monitor.registerClient(clientId, this, node);
    }
    // Enhanced MQTT client initialization with proper error handling
    initializeClient() {
        if (this.connectionState.circuitBreakerOpen) {
            this.node.warn("Circuit breaker is open, skipping connection attempt");
            return;
        }
        this.connectionState.isConnecting = true;
        this.clearTimers();
        const options = {
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
            this.client = mqtt_1.default.connect(this.config.broker, options);
            this.setupEventHandlers();
            this.createConnectionPromise();
        }
        catch (error) {
            this.handleConnectionError(error);
        }
    }
    // Create a fresh connection promise for each connection attempt
    createConnectionPromise() {
        this.connectionPromise = new Promise((resolve, reject) => {
            if (!this.client) {
                reject(new Error("MQTT client not initialized"));
                return;
            }
            const connectHandler = () => {
                this.onConnected();
                resolve();
            };
            const errorHandler = (error) => {
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
    setupEventHandlers() {
        if (!this.client)
            return;
        const closeHandler = () => this.onDisconnected();
        const messageHandler = (topic, message, packet) => {
            const mqttMessage = {
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
    onConnected() {
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
    onDisconnected() {
        this.connectionState.isConnected = false;
        this.connectionState.isConnecting = false;
        this.connectionState.lastDisconnectedAt = Date.now();
        this.node.status({ fill: "red", shape: "ring", text: "Disconnected" });
        this.emit("mqtt-status", { status: "disconnected", state: this.connectionState });
        // Schedule reconnection if not manually disconnected
        this.scheduleReconnection();
    }
    // Enhanced error handling with circuit breaker pattern
    handleConnectionError(error) {
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
        }
        else {
            this.scheduleReconnection();
        }
        this.emit("mqtt-error", { error, state: this.connectionState });
    }
    // Circuit breaker implementation with progressive recovery
    openCircuitBreaker() {
        this.connectionState.circuitBreakerOpen = true;
        this.node.warn("Circuit breaker opened - stopping reconnection attempts");
        this.node.status({ fill: "red", shape: "ring", text: "Circuit breaker open - will retry in 30s" });
        // Shorter initial timeout with progressive backoff
        const initialTimeout = 30000; // 30 seconds instead of 5 minutes
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
    resetCircuitBreaker() {
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
    scheduleReconnection() {
        if (this.connectionState.circuitBreakerOpen || this.reconnectTimer) {
            return;
        }
        const baseDelay = this.config.reconnectPeriod || 5000;
        const multiplier = this.config.reconnectBackoffMultiplier || 1.5;
        const maxDelay = this.config.maxReconnectDelay || 60000;
        const delay = Math.min(baseDelay * Math.pow(multiplier, this.connectionState.reconnectAttempts), maxDelay);
        this.node.log(`Scheduling reconnection in ${delay}ms (attempt ${this.connectionState.reconnectAttempts + 1})`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.initializeClient();
        }, delay);
    }
    // Timer management
    clearTimers() {
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
    startHealthCheck() {
        if (!this.config.healthCheckInterval)
            return;
        this.healthCheckTimer = setInterval(() => {
            if (this.connectionState.isConnected && this.client) {
                // Send a lightweight telemetry message as health check for ThingsBoard
                this.publishHealthCheck();
            }
        }, this.config.healthCheckInterval);
    }
    // Message queue management for offline scenarios
    processMessageQueue() {
        if (!this.connectionState.isConnected || this.messageQueue.length === 0) {
            return;
        }
        const messagesToProcess = [...this.messageQueue];
        this.messageQueue = [];
        messagesToProcess.forEach(queuedMessage => {
            this.publishMessage(queuedMessage.topic, queuedMessage.message, queuedMessage.options).catch((error) => {
                // Re-queue failed messages with retry limit
                if (queuedMessage.retryCount < 3) {
                    queuedMessage.retryCount++;
                    this.queueMessage(queuedMessage);
                }
                else {
                    this.node.warn(`Dropping message after 3 retries: ${queuedMessage.topic} - ${error.message}`);
                }
            });
        });
    }
    queueMessage(message) {
        if (this.messageQueue.length >= (this.config.messageQueueSize || 100)) {
            // Remove oldest message to make room
            this.messageQueue.shift();
            this.node.warn("Message queue full, dropping oldest message");
        }
        this.messageQueue.push(message);
    }
    // ThingsBoard specific methods
    async publishDeviceStatus(status) {
        if (!this.connectionState.isConnected)
            return;
        const statusMessage = {
            status,
            timestamp: Date.now(),
            clientId: this.config.clientId
        };
        try {
            await this.publishMessage("v1/devices/me/attributes", JSON.stringify(statusMessage), { qos: 1, retain: false });
        }
        catch (error) {
            this.node.warn(`Failed to publish device status: ${error.message}`);
            throw error;
        }
    }
    publishHealthCheck() {
        if (!this.connectionState.isConnected)
            return;
        const healthData = {
            heartbeat: Date.now(),
            uptime: process.uptime(),
            memory: process.memoryUsage().heapUsed
        };
        this.publishMessage("v1/devices/me/telemetry", JSON.stringify(healthData), { qos: 0, retain: false }).catch((error) => {
            this.node.warn(`Health check failed: ${error.message}`);
            this.handleConnectionError(new Error(`Health check failed: ${error.message}`));
        });
    }
    // Alias for publish method to maintain consistency
    async publishMessage(topic, message, options) {
        if (!this.connectionState.isConnected) {
            // Queue message if offline
            const queuedMessage = {
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
    getConnectionState() {
        return Object.assign({}, this.connectionState);
    }
    // Get queue status for monitoring
    getQueueStatus() {
        return {
            size: this.messageQueue.length,
            maxSize: this.config.messageQueueSize || 100
        };
    }
    // Enhanced connection waiting with automatic recovery
    async waitForConnection(timeoutMs = 30000) {
        var _a;
        if ((_a = this.client) === null || _a === void 0 ? void 0 : _a.connected)
            return; // Already connected
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
                new Promise((_, reject) => setTimeout(() => reject(new Error("Connection timeout")), timeoutMs)),
            ]);
        }
        catch (error) {
            // On timeout or error, reset connection promise and try once more
            this.connectionPromise = null;
            this.node.warn(`Connection wait failed: ${error.message}, attempting recovery`);
            // Reset circuit breaker if it's blocking recovery
            if (this.connectionState.circuitBreakerOpen) {
                this.resetCircuitBreaker();
            }
            throw error;
        }
    }
    // Subscribe topic
    async subscribe(topic, qos = this.config.qos) {
        if (!this.client)
            throw new Error("MQTT client not initialized");
        if (!this.client.connected) {
            await this.waitForConnection();
        }
        return new Promise((resolve, reject) => {
            this.client.subscribe(topic, { qos }, (err) => {
                if (err) {
                    this.node.error(`Failed to subscribe to ${topic}: ${err.message}`);
                    reject(err);
                }
                else {
                    this.subscribedTopics.add(topic);
                    this.node.log(`Subscribed to topic: ${topic}`);
                    resolve();
                }
            });
        });
    }
    // Unsubscribe topic
    async unsubscribe(topic) {
        if (!this.client)
            throw new Error("MQTT client not initialized");
        if (!this.client.connected) {
            await this.waitForConnection();
        }
        return new Promise((resolve, reject) => {
            this.client.unsubscribe(topic, (err) => {
                if (err) {
                    this.node.error(`Failed to unsubscribe from ${topic}: ${err.message}`);
                    reject(err);
                }
                else {
                    this.subscribedTopics.delete(topic);
                    this.node.log(`Unsubscribed from topic: ${topic}`);
                    resolve();
                }
            });
        });
    }
    // Publish message, chỉ khi đã kết nối
    async publish(topic, message, options) {
        if (!this.client)
            throw new Error("MQTT client not initialized");
        if (!this.client.connected) {
            this.node.warn(`MQTT client not connected to ${this.config.broker}, waiting for connection...`);
            await this.waitForConnection();
        }
        return new Promise((resolve, reject) => {
            this.client.publish(topic, message, Object.assign({ qos: this.config.qos }, options), (err) => {
                if (err) {
                    this.node.error(`Failed to publish to ${topic}: ${err.message}`);
                    reject(err);
                }
                else {
                    this.node.log(`Published to topic: ${topic}`);
                    resolve();
                }
            });
        });
    }
    // Resubscribe tất cả các topic khi reconnect
    resubscribeTopics() {
        if (!this.client)
            return;
        this.subscribedTopics.forEach((topic) => {
            this.client.subscribe(topic, { qos: this.config.qos }, (err) => {
                if (err) {
                    this.node.error(`Failed to resubscribe to ${topic}: ${err.message}`);
                }
                else {
                    this.node.log(`Resubscribed to topic: ${topic}`);
                }
            });
        });
    }
    // Enhanced disconnect with proper resource cleanup
    async disconnect() {
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
            }
            catch (error) {
                this.node.warn(`Failed to send offline status: ${error.message}`);
            }
        }
        // Remove all event listeners
        if (this.client) {
            this.eventListeners.forEach((handler, event) => {
                var _a;
                (_a = this.client) === null || _a === void 0 ? void 0 : _a.removeListener(event, handler);
            });
            this.eventListeners.clear();
            // Graceful disconnect
            return new Promise((resolve) => {
                if (this.client) {
                    this.client.end(false, {}, () => {
                        this.node.log("MQTT client disconnected successfully");
                        this.client = null;
                        this.connectionPromise = null;
                        resolve();
                    });
                }
                else {
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
    forceDisconnect() {
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
    isConnected() {
        var _a, _b;
        return (_b = (_a = this.client) === null || _a === void 0 ? void 0 : _a.connected) !== null && _b !== void 0 ? _b : false;
    }
}
exports.MqttClientCore = MqttClientCore;
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
