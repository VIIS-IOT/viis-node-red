# MQTT Client Improvements - Google IoT Device Standards

## 🎯 Mục tiêu cải thiện

Nâng cấp MQTT client management để đạt chuẩn Google IoT device với focus vào ThingsBoard connection, bao gồm:

1. **Connection Promise Management** - Quản lý promise kết nối hiệu quả
2. **Reconnection Logic** - Logic reconnect thông minh với exponential backoff
3. **Resource Leak Prevention** - Ngăn chặn memory leaks và resource leaks
4. **Enhanced Error Handling** - Xử lý lỗi toàn diện với circuit breaker
5. **ThingsBoard Integration** - Tối ưu cho ThingsBoard platform

## 🔧 Các cải thiện đã thực hiện

### 1. Enhanced Configuration Interface

```typescript
export interface MqttConfig {
    // Existing properties...
    
    // Enhanced configuration for Google IoT standards
    maxReconnectAttempts?: number;           // Default: 10
    reconnectBackoffMultiplier?: number;     // Default: 1.5
    maxReconnectDelay?: number;              // Default: 60000ms
    healthCheckInterval?: number;            // Default: 30000ms
    messageQueueSize?: number;               // Default: 100
    enableCircuitBreaker?: boolean;          // Default: true
}
```

### 2. Connection State Management

```typescript
export interface ConnectionState {
    isConnected: boolean;
    isConnecting: boolean;
    lastConnectedAt?: number;
    lastDisconnectedAt?: number;
    reconnectAttempts: number;
    totalReconnects: number;
    circuitBreakerOpen: boolean;
}
```

### 3. Message Queuing System

```typescript
export interface QueuedMessage {
    topic: string;
    message: string | Buffer;
    options?: IClientPublishOptions;
    timestamp: number;
    retryCount: number;
}
```

## 🚀 Key Features

### 1. **Smart Connection Promise Management**

- **Fresh Promise per Connection**: Mỗi lần kết nối tạo promise mới
- **Timeout Handling**: Tự động timeout nếu kết nối quá lâu
- **Proper Cleanup**: Cleanup event listeners sau mỗi attempt

```typescript
private createConnectionPromise(): void {
    this.connectionPromise = new Promise<void>((resolve, reject) => {
        // Fresh promise with timeout and proper cleanup
        const timeoutHandler = setTimeout(() => {
            this.handleConnectionError(new Error("Connection timeout"));
            reject(new Error("Connection timeout"));
        }, this.config.connectTimeout);

        this.client.once("connect", () => {
            clearTimeout(timeoutHandler);
            this.onConnected();
            resolve();
        });
    });
}
```

### 2. **Exponential Backoff Reconnection**

- **Smart Delays**: Exponential backoff với configurable multiplier
- **Max Delay Cap**: Giới hạn delay tối đa để tránh chờ quá lâu
- **Circuit Breaker**: Tạm dừng reconnect sau nhiều lần thất bại

```typescript
private scheduleReconnection(): void {
    const baseDelay = this.config.reconnectPeriod || 5000;
    const multiplier = this.config.reconnectBackoffMultiplier || 1.5;
    const maxDelay = this.config.maxReconnectDelay || 60000;
    
    const delay = Math.min(
        baseDelay * Math.pow(multiplier, this.connectionState.reconnectAttempts),
        maxDelay
    );
    
    this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.initializeClient();
    }, delay);
}
```

### 3. **Circuit Breaker Pattern**

- **Failure Threshold**: Tự động mở circuit breaker sau N lần thất bại
- **Recovery Timer**: Tự động đóng circuit breaker sau timeout
- **Prevent Resource Waste**: Ngăn chặn việc cố gắng kết nối vô ích

```typescript
private openCircuitBreaker(): void {
    this.connectionState.circuitBreakerOpen = true;
    this.node.warn("Circuit breaker opened - stopping reconnection attempts");
    
    // Close circuit breaker after 5 minutes
    this.circuitBreakerTimer = setTimeout(() => {
        this.connectionState.circuitBreakerOpen = false;
        this.connectionState.reconnectAttempts = 0;
        this.node.log("Circuit breaker closed - reconnection attempts resumed");
    }, 300000);
}
```

### 4. **Message Queuing for Offline Scenarios**

- **Offline Queuing**: Queue messages khi offline
- **Retry Logic**: Retry failed messages với limit
- **Queue Size Management**: Giới hạn queue size để tránh memory issues

```typescript
private async publishMessage(topic: string, message: string | Buffer, options?: IClientPublishOptions): Promise<void> {
    if (!this.connectionState.isConnected) {
        // Queue message if offline
        const queuedMessage: QueuedMessage = {
            topic, message, options,
            timestamp: Date.now(),
            retryCount: 0
        };
        this.queueMessage(queuedMessage);
        return;
    }
    
    return this.publish(topic, message, options);
}
```

### 5. **Resource Leak Prevention**

- **Event Listener Tracking**: Track tất cả event listeners để cleanup
- **Timer Management**: Proper cleanup của tất cả timers
- **Graceful Shutdown**: Graceful disconnect với resource cleanup

```typescript
public async disconnect(): Promise<void> {
    // Clear all timers
    this.clearTimers();
    if (this.healthCheckTimer) {
        clearInterval(this.healthCheckTimer);
        this.healthCheckTimer = null;
    }

    // Send offline status before disconnecting
    if (this.connectionState.isConnected) {
        await this.publishDeviceStatus("offline");
    }

    // Remove all event listeners
    this.eventListeners.forEach((handler, event) => {
        this.client?.removeListener(event as any, handler);
    });
    this.eventListeners.clear();

    // Graceful disconnect
    return new Promise<void>((resolve) => {
        this.client?.end(false, {}, () => {
            this.client = null;
            this.connectionPromise = null;
            resolve();
        });
    });
}
```

### 6. **ThingsBoard Specific Features**

- **Device Status Reporting**: Tự động báo cáo online/offline status
- **Health Check Telemetry**: Gửi heartbeat định kỳ
- **Clean Session**: Optimized cho ThingsBoard
- **Last Will Testament**: Tự động báo offline khi disconnect

```typescript
// ThingsBoard optimized connection options
const options: IClientOptions = {
    clientId: this.config.clientId || `nodered_${Math.random().toString(16).substring(2, 8)}`,
    username: this.config.username,
    password: this.config.password,
    reconnectPeriod: 0, // Manual reconnect handling
    clean: true, // Clean session for ThingsBoard
    will: {
        topic: `v1/devices/me/attributes`,
        payload: JSON.stringify({ status: "offline" }),
        qos: 1,
        retain: false
    }
};
```

### 7. **Health Check System**

- **Periodic Health Checks**: Gửi telemetry định kỳ để check connection
- **Connection Monitoring**: Monitor connection health
- **Automatic Recovery**: Tự động recovery khi detect connection issues

```typescript
private publishHealthCheck(): void {
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
        this.handleConnectionError(new Error(`Health check failed: ${error.message}`));
    });
}
```

## 📊 Monitoring & Debugging

### Connection State API

```typescript
// Get current connection state
const state = mqttClient.getConnectionState();
console.log(`Connected: ${state.isConnected}`);
console.log(`Reconnect attempts: ${state.reconnectAttempts}`);
console.log(`Total reconnects: ${state.totalReconnects}`);

// Get queue status
const queueStatus = mqttClient.getQueueStatus();
console.log(`Queue size: ${queueStatus.size}/${queueStatus.maxSize}`);
```

### Event Monitoring

```typescript
mqttClient.on("mqtt-status", ({ status, state }) => {
    console.log(`MQTT Status: ${status}`, state);
});

mqttClient.on("mqtt-error", ({ error, state }) => {
    console.error(`MQTT Error: ${error.message}`, state);
});
```

## 🎯 Benefits

1. **Reliability**: Circuit breaker và smart reconnection
2. **Efficiency**: Message queuing và resource management
3. **Monitoring**: Comprehensive state tracking
4. **ThingsBoard Optimized**: Specific optimizations cho ThingsBoard
5. **Google IoT Standards**: Tuân thủ best practices
6. **Fault Tolerance**: Robust error handling và recovery
7. **Clean Code**: Well-structured và maintainable

## 🔄 Migration Guide

### Before (Old Code)
```typescript
const mqttClient = new MqttClientCore(config, node);
await mqttClient.waitForConnection();
```

### After (Enhanced Code)
```typescript
const mqttClient = new MqttClientCore({
    ...config,
    maxReconnectAttempts: 10,
    reconnectBackoffMultiplier: 1.5,
    healthCheckInterval: 30000,
    enableCircuitBreaker: true
}, node);

// Monitor connection state
mqttClient.on("mqtt-status", ({ status, state }) => {
    console.log(`Connection ${status}:`, state);
});

await mqttClient.waitForConnection();
```

## ✅ Compliance với Google IoT Standards

- ✅ **Connection Management**: Robust connection handling
- ✅ **Error Recovery**: Exponential backoff và circuit breaker
- ✅ **Resource Management**: Proper cleanup và leak prevention
- ✅ **Monitoring**: Comprehensive state tracking
- ✅ **Fault Tolerance**: Graceful degradation và recovery
- ✅ **Performance**: Efficient message queuing và batching
- ✅ **Security**: Clean session và proper authentication
