"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MqttClientCore = void 0;
const mqtt_1 = __importDefault(require("mqtt"));
const events_1 = require("events");
const connection_monitor_1 = require("./connection-monitor");
const demeter_mqtt_topics_1 = require("./demeter-mqtt-topics");
// Enhanced MQTT Client with Google IoT standards compliance
class MqttClientCore extends events_1.EventEmitter {
    constructor(config, node) {
        super();
        this.client = null;
        this.connectionPromise = null;
        this.subscribedTopics = new Set();
        // Enhanced state management
        this.RECONNECT_INTERVAL_MIN = 500; // 500ms - more aggressive
        this.RECONNECT_INTERVAL_MAX = 10000; // 10 seconds - faster recovery
        this.RECONNECT_INTERVAL_MULTIPLIER = 1.3; // slower backoff
        this.CIRCUIT_BREAKER_TIMEOUT = 20000; // 20 seconds - quicker recovery
        this.CIRCUIT_BREAKER_MAX_ATTEMPTS = 10; // more attempts before circuit break
        this.HEALTH_CHECK_INTERVAL = 300000; // 5 minutes - health check interval
        this.messageQueue = [];
        this.healthCheckTimer = null;
        this.reconnectTimer = null;
        this.circuitBreakerTimer = null;
        this.monitoredClientId = '';
        // Event listeners for cleanup
        this.eventListeners = new Map();
        this.config = Object.assign({ reconnectPeriod: 0, connectTimeout: 10000, keepalive: 30, maxReconnectAttempts: this.CIRCUIT_BREAKER_MAX_ATTEMPTS, reconnectBackoffMultiplier: this.RECONNECT_INTERVAL_MULTIPLIER, maxReconnectDelay: this.RECONNECT_INTERVAL_MAX, healthCheckInterval: this.HEALTH_CHECK_INTERVAL, messageQueueSize: 100, enableCircuitBreaker: true }, config);
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
        this.monitoredClientId = this.config.clientId || `nodered_${Math.random().toString(16).substring(2, 8)}`;
        monitor.registerClient(this.monitoredClientId, this, node);
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
            clean: true,
        };
        if (this.config.deviceId) {
            options.will = {
                topic: (0, demeter_mqtt_topics_1.buildDeviceAttributesTopic)(this.config.deviceId),
                payload: JSON.stringify({ status: "offline" }),
                qos: 1,
                retain: false,
            };
        }
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
        if (!this.config.deviceId)
            return;
        try {
            await this.publishMessage((0, demeter_mqtt_topics_1.buildDeviceAttributesTopic)(this.config.deviceId), JSON.stringify(statusMessage), { qos: 1, retain: false });
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
        if (!this.config.deviceId)
            return;
        this.publishMessage((0, demeter_mqtt_topics_1.buildDeviceTelemetryTopic)(this.config.deviceId), JSON.stringify(healthData), { qos: 0, retain: false }).catch((error) => {
            // Don't trigger reconnection on health check failure
            // Health check failures can be false positives and cause unnecessary reconnects
            this.node.warn(`Health check failed: ${error.message}`);
            // Removed: this.handleConnectionError(new Error(`Health check failed: ${error.message}`));
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
    // Publish message only when connected
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
                    }
                    catch (_a) {
                        // Not JSON, use as is
                    }
                    resolve();
                }
            });
        });
    }
    // Resubscribe all topics on reconnect
    resubscribeTopics() {
        if (!this.client)
            return;
        // Only log resubscribe if there are topics to resubscribe
        const topicsCount = this.subscribedTopics.size;
        if (topicsCount === 0)
            return;
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
    async disconnect() {
        this.node.log("Initiating MQTT client disconnect...");
        // Unregister from connection monitor
        connection_monitor_1.ConnectionMonitor.getInstance().unregisterClient(this.monitoredClientId);
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
    }
    // Force disconnect for emergency situations
    forceDisconnect() {
        this.node.warn("Force disconnecting MQTT client");
        // Unregister from connection monitor
        connection_monitor_1.ConnectionMonitor.getInstance().unregisterClient(this.monitoredClientId);
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
    isConnected() {
        var _a, _b;
        return (_b = (_a = this.client) === null || _a === void 0 ? void 0 : _a.connected) !== null && _b !== void 0 ? _b : false;
    }
}
exports.MqttClientCore = MqttClientCore;
