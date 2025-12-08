# Đánh Giá Mức Độ Robust - VIIS Marine Telemetry Node

**Ngày đánh giá:** 8/12/2025  
**Phiên bản:** Node-RED Custom Node - DH6400 Serial Polling  
**Lỗi phát sinh:** Resource temporarily unavailable Cannot lock port

---

## 📊 TÓM TẮT ĐÁNH GIÁ

| Tiêu chí | Điểm (1-10) | Trạng thái |
|----------|-------------|------------|
| **Error Handling** | 6/10 | ⚠️ Cần cải thiện |
| **Auto-reconnection** | 7/10 | ✅ Khá tốt |
| **Port Locking** | 3/10 | ❌ Có vấn đề nghiêm trọng |
| **Deploy Safety** | 5/10 | ⚠️ Cần cải thiện |
| **Promise Rejection** | 4/10 | ❌ Thiếu xử lý |
| **Resource Cleanup** | 7/10 | ✅ Khá tốt |

**Tổng điểm:** 5.3/10 - **TRUNG BÌNH, CẦN CẢI THIỆN**

---

## 🔴 VẤN ĐỀ NGHIÊM TRỌNG HIỆN TẠI

### 1. **Port Locking Error (CRITICAL)**

#### Lỗi xuất hiện:
```
[DH6400-Client] Failed to open /dev/ttyACM0: Error Resource temporarily unavailable Cannot lock port
[UNHANDLED-REJECTION] Error Resource temporarily unavailable Cannot lock port
```

#### Nguyên nhân gốc rễ:

**A. Không có mutex/lock mechanism:**
```typescript:92:130
// viis-marine-telemetry.ts - Line 92-130
private async initializePort(): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            this.port = new SerialPort({
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
            // ...
        }
    });
}
```

**Vấn đề:** Không có cơ chế kiểm tra xem port đã được mở bởi process khác hay chưa.

**B. Deploy gây duplicate instances:**

Khi deploy Node-RED, có thể xảy ra:
1. Node cũ chưa cleanup xong
2. Node mới đã bắt đầu khởi tạo
3. Cả 2 cùng cố gắng mở `/dev/ttyACM0`
4. ⚠️ **Port lock conflict**

**C. Reconnection không có backoff strategy:**

```typescript:291:319
// dh6400-serial-client.ts - Line 291-319
private scheduleReconnect(): void {
    if (this.isClosing) {
        this.log('Skipping reconnect - client is closing');
        return;
    }

    if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(async () => {
        if (this.isClosing) {
            this.log('Skipping reconnect - client is closing');
            return;
        }
        
        this.log(`Attempting reconnect...`);
        try {
            await this.initializePort();
            this.log('Reconnect successful');
        } catch (error) {
            this.log(`Reconnect failed: ${(error as Error).message}`, 'warn');
            // Will schedule another reconnect via handleClose or error handler
        }
    }, 5000); // Fixed 5s delay
}
```

**Vấn đề:** Luôn retry sau 5s, không tăng dần (exponential backoff), gây aggressive reconnection.

---

### 2. **Unhandled Promise Rejection (HIGH)**

#### Lỗi:
```
[UNHANDLED-REJECTION] Error Resource temporarily unavailable Cannot lock port
```

#### Nguyên nhân:

**A. Global handlers không đủ:**

```typescript:15:21
// viis-marine-telemetry.ts - Line 15-21
process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (reason, promise) => {
  console.error('🚨 Unhandled Exception at:', promise, 'reason:', reason);
});
```

**Vấn đề:** Chỉ log, không xử lý recovery. Node-RED có thể crash hoặc ở trạng thái không ổn định.

**B. Async initialization không catch hết:**

```typescript:59:158
// viis-marine-telemetry.ts - Line 59-158
(async () => {
    try {
        node.log('[Marine] Initializing DH6400 serial polling node...');
        
        // ... initialization code ...
        
        // Initialize DH6400 Polling Service
        const dh6400Config = createDH6400Config(globalHelper, config);
        if (dh6400Config.enabled) {
            dh6400PollingService = new DH6400PollingService(node, nodeContext, dh6400Config);
            node.log(`[Marine] DH6400 serial polling enabled for ${dh6400Config.enabledChannels.length} channels`);
        }
        
        // Start DH6400 polling if enabled
        if (dh6400PollingService) {
            await dh6400PollingService.startPolling(); // ⚠️ If this throws, not caught properly
            node.log('[Marine] DH6400 polling started');
            node.status({ fill: "green", shape: "dot", text: "DH6400 polling active" });
        }
        
    } catch (error) {
        node.error(`[Marine] Node initialization failed: ${(error as Error).message}`);
        node.status({ fill: "red", shape: "ring", text: "Initialization failed" });
    }
})().catch((error) => {
    node.error(`[Marine] Async initialization failed: ${(error as Error).message}`);
    node.status({ fill: "red", shape: "ring", text: "Async init failed" });
});
```

**Vấn đề:** Nested promises trong `startPolling()` có thể không được catch.

**C. Polling Service không wrap errors:**

```typescript:161:201
// DH6400PollingService.ts - Line 161-201
async startPolling(): Promise<void> {
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
        await this.manager.connect(); // ⚠️ Can throw "Cannot lock port"
        this.node.log(`[DH6400Polling] ✅ Connected successfully`);
        // Reset failure counter on successful connection
        this.consecutiveFailures = 0;
    } catch (error) {
        this.node.error(`[DH6400Polling] ❌ Connection failed: ${(error as Error).message}`);
        this.emitPollingError(
            'DH6400_CONNECTION_FAILED',
            `Không thể kết nối với cổng serial ${this.config.serialPort}: ${(error as Error).message}`,
            'critical',
            'error',
            { serialPort: this.config.serialPort, errorDetails: (error as Error).message }
        );
        return; // ⚠️ Returns but promise may still propagate
    }

    this.pollingTimer = setInterval(async () => {
        if (!this.isPaused) {
            await this.poll(); // ⚠️ poll() errors not caught here
        }
    }, this.config.pollingInterval);

    this.node.log(`[DH6400Polling] Started with interval ${this.config.pollingInterval}ms`);

    // Trigger immediate first poll
    this.poll(); // ⚠️ Not awaited, floating promise
}
```

**Vấn đề:** 
- `poll()` cuối cùng không được await → floating promise
- Errors trong `setInterval` callback không được catch

---

### 3. **Deploy Safety Issues (MEDIUM)**

#### Vấn đề A: Race Condition khi Deploy

**Cleanup không đủ nhanh:**

```typescript:377:411
// viis-marine-telemetry.ts - Line 377-411
node.on('close', async (done: () => void) => {
    try {
        // Cleanup DH6400 polling service
        if (dh6400PollingService) {
            await dh6400PollingService.cleanup();
            node.log('[Marine] DH6400 polling service cleaned up');
        }

        // Disconnect ThingsBoard MQTT
        if (thingsboardMqttClient) {
            thingsboardMqttClient.disconnect();
            node.log('[Marine] ThingsBoard MQTT disconnected');
        }

        // Cleanup DataSource (singleton shared across nodes)
        if (dataSource && dataSource.isInitialized) {
            try {
                await dataSource.destroy();
                node.log('[Marine] Database connection closed');
            } catch (dbError) {
                // Ignore if already closed by another node
                if (!(dbError as Error).message.includes('not yet established')) {
                    node.warn(`[Marine] Database cleanup warning: ${(dbError as Error).message}`);
                }
            }
        }

        node.log('[Marine] Node closed and cleaned up');
        done();
    } catch (error) {
        node.error(`[Marine] Cleanup error: ${(error as Error).message}`);
        done(); // ⚠️ Calls done() even if cleanup failed
    }
});
```

**Timeline Deploy:**
```
T+0ms:   User clicks Deploy
T+100ms: Node-RED calls old node's close()
T+200ms: Old node starts cleanup (async)
T+300ms: ⚠️ NEW NODE STARTS INITIALIZING (old not done yet!)
T+400ms: New node tries to open /dev/ttyACM0
T+500ms: ❌ ERROR: Port locked by old node's cleanup process
T+800ms: Old node finally closes port
```

**Vấn đề:** Không có synchronization mechanism giữa old node cleanup và new node init.

#### Vấn đề B: Không có deploy cooldown

Node-RED không có built-in delay giữa node destruction và construction.

---

## ✅ ĐIỂM MẠNH HIỆN TẠI

### 1. **Reconnection Logic (GOOD)**

```typescript:209:217
// DH6400PollingService.ts - Line 209-217
// Check connection status and reconnect if needed
if (!this.manager.isConnected()) {
    this.node.warn('[DH6400Polling] ⚠️  Not connected, attempting to reconnect...');
    await this.tryReconnect();
    if (!this.manager.isConnected()) {
        this.node.warn('[DH6400Polling] ⚠️  Still not connected, skipping poll cycle');
        return;
    }
}
```

**Điểm mạnh:**
- Tự động kiểm tra connection trước mỗi poll
- Có mechanism tryReconnect()
- Graceful degradation (skip poll nếu không connect được)

### 2. **Max Reconnect Attempts (GOOD)**

```typescript:278:322
// DH6400PollingService.ts - Line 278-322
private async tryReconnect(): Promise<void> {
    if (this.isReconnecting) {
        this.node.log('[DH6400Polling] Reconnection already in progress...');
        return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.node.error(`[DH6400Polling] Max reconnect attempts (${this.maxReconnectAttempts}) reached`);
        this.emitPollingError(...);
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
```

**Điểm mạnh:**
- Có giới hạn max attempts (10 lần)
- Có flag `isReconnecting` tránh concurrent reconnects
- Reset counter sau thành công

### 3. **Cleanup Logic (GOOD)**

```typescript:654:657
// dh6400-serial-client.ts - Line 654-657
public async cleanup(): Promise<void> {
    await this.client.disconnect();
    this.log('DH6400 manager cleaned up');
}
```

**Disconnect chi tiết:**

```typescript:478:550
// dh6400-serial-client.ts - Line 478-550
public async disconnect(): Promise<void> {
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
        } catch (e) {
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
                await new Promise<void>((resolve) => {
                    this.port!.close((err) => {
                        if (err) {
                            this.log(`Error closing port: ${err.message}`, 'warn');
                        }
                        resolve();
                    });
                });
            }
            
            this.log('Serial port closed successfully');
        } catch (error) {
            this.log(`Error during disconnect: ${(error as Error).message}`, 'warn');
        } finally {
            this.port = null;
        }
    }
    
    this.isConnected = false;
    this.responseBuffer = Buffer.alloc(0);
    this.log('Disconnect complete');
}
```

**Điểm mạnh:**
- Rất chi tiết và thorough
- Clear tất cả timers, listeners, queues
- Có flag `isClosing` tránh reconnect
- Có `connectionPromise` guard tránh concurrent connects

### 4. **Error Throttling (GOOD)**

```typescript:410:443
// DH6400PollingService.ts - Line 410-443
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
```

**Điểm mạnh:**
- Tránh spam error notifications
- Throttle 5 phút
- Structured error format

---

## 🔧 KHUYẾN NGHỊ CẢI THIỆN

### Priority 1: Fix Port Locking (CRITICAL)

#### Solution A: Add Deploy Delay Mechanism

```typescript
// Add to viis-marine-telemetry.ts
const DEPLOY_GRACE_PERIOD = 2000; // 2 seconds

(async () => {
    try {
        node.log('[Marine] Waiting for deploy grace period...');
        await new Promise(resolve => setTimeout(resolve, DEPLOY_GRACE_PERIOD));
        
        node.log('[Marine] Initializing DH6400 serial polling node...');
        // ... rest of initialization
    }
})();
```

#### Solution B: Add Global Port Lock Registry

```typescript
// Create new file: src/core/port-lock-registry.ts
class PortLockRegistry {
    private locks = new Map<string, { nodeId: string; timestamp: number }>();
    private readonly lockTimeout = 10000; // 10 seconds

    async acquireLock(portPath: string, nodeId: string): Promise<boolean> {
        const existing = this.locks.get(portPath);
        
        if (existing) {
            const age = Date.now() - existing.timestamp;
            if (age < this.lockTimeout && existing.nodeId !== nodeId) {
                console.log(`Port ${portPath} locked by ${existing.nodeId}`);
                return false;
            }
        }

        this.locks.set(portPath, { nodeId, timestamp: Date.now() });
        return true;
    }

    releaseLock(portPath: string, nodeId: string): void {
        const existing = this.locks.get(portPath);
        if (existing && existing.nodeId === nodeId) {
            this.locks.delete(portPath);
        }
    }

    async waitForLock(portPath: string, nodeId: string, maxWaitMs = 15000): Promise<boolean> {
        const startTime = Date.now();
        
        while (Date.now() - startTime < maxWaitMs) {
            if (await this.acquireLock(portPath, nodeId)) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        return false;
    }
}

export const globalPortLockRegistry = new PortLockRegistry();
```

**Usage:**

```typescript
// In viis-marine-telemetry.ts
import { globalPortLockRegistry } from '../../core/port-lock-registry';

(async () => {
    try {
        const nodeId = node.id;
        const serialPort = globalHelper.getEnvVar('DH6400_SERIAL_PORT', '/dev/ttyACM0');
        
        node.log(`[Marine] Waiting for port lock on ${serialPort}...`);
        const lockAcquired = await globalPortLockRegistry.waitForLock(serialPort, nodeId, 15000);
        
        if (!lockAcquired) {
            node.error('[Marine] Failed to acquire port lock - another instance may be using it');
            node.status({ fill: "red", shape: "ring", text: "Port lock timeout" });
            return;
        }
        
        node.log('[Marine] Port lock acquired, initializing...');
        
        // ... rest of initialization
        
    } catch (error) {
        node.error(`[Marine] Initialization failed: ${error.message}`);
    }
})();

// In cleanup:
node.on('close', async (done) => {
    try {
        const serialPort = globalHelper.getEnvVar('DH6400_SERIAL_PORT', '/dev/ttyACM0');
        globalPortLockRegistry.releaseLock(serialPort, node.id);
        
        // ... rest of cleanup
    }
});
```

#### Solution C: Exponential Backoff for Reconnection

```typescript
// Update DH6400SerialClient
private reconnectAttempt: number = 0;
private readonly maxReconnectAttempts = 10;
private readonly baseReconnectDelay = 1000; // Start with 1s
private readonly maxReconnectDelay = 60000; // Max 60s

private scheduleReconnect(): void {
    if (this.isClosing) {
        this.log('Skipping reconnect - client is closing');
        return;
    }

    if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 60s, 60s...
    const delay = Math.min(
        this.baseReconnectDelay * Math.pow(2, this.reconnectAttempt),
        this.maxReconnectDelay
    );
    
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(async () => {
        if (this.isClosing) {
            this.log('Skipping reconnect - client is closing');
            return;
        }
        
        this.log(`Reconnect attempt ${this.reconnectAttempt} (delay: ${delay}ms)...`);
        try {
            await this.initializePort();
            this.log('Reconnect successful');
            this.reconnectAttempt = 0; // Reset on success
        } catch (error) {
            this.log(`Reconnect failed: ${(error as Error).message}`, 'warn');
            
            if (this.reconnectAttempt >= this.maxReconnectAttempts) {
                this.log('Max reconnect attempts reached, giving up', 'error');
                this.reconnectAttempt = 0; // Reset for future
                // Don't schedule another reconnect
            } else {
                // Will schedule another reconnect
            }
        }
    }, delay);
}
```

### Priority 2: Fix Unhandled Promise Rejections (HIGH)

#### Solution A: Wrap Polling with Error Handler

```typescript
// Update DH6400PollingService.ts
async startPolling(): Promise<void> {
    if (!this.config.enabled || !this.manager) {
        this.node.warn('[DH6400Polling] Cannot start - disabled or not initialized');
        return;
    }

    if (this.pollingTimer) {
        this.node.warn('[DH6400Polling] Polling already started');
        return;
    }

    try {
        this.node.log(`[DH6400Polling] Connecting to ${this.config.serialPort}...`);
        await this.manager.connect();
        this.node.log(`[DH6400Polling] ✅ Connected successfully`);
        this.consecutiveFailures = 0;
    } catch (error) {
        this.node.error(`[DH6400Polling] ❌ Connection failed: ${(error as Error).message}`);
        this.emitPollingError(
            'DH6400_CONNECTION_FAILED',
            `Không thể kết nối với cổng serial ${this.config.serialPort}: ${(error as Error).message}`,
            'critical',
            'error',
            { serialPort: this.config.serialPort, errorDetails: (error as Error).message }
        );
        // Schedule retry instead of just returning
        this.scheduleRetryConnection();
        return;
    }

    this.pollingTimer = setInterval(async () => {
        if (!this.isPaused) {
            try {
                await this.poll(); // ✅ Now wrapped in try-catch
            } catch (pollError) {
                this.node.error(`[DH6400Polling] Polling error: ${(pollError as Error).message}`);
            }
        }
    }, this.config.pollingInterval);

    this.node.log(`[DH6400Polling] Started with interval ${this.config.pollingInterval}ms`);

    // Trigger immediate first poll - wrapped
    this.poll().catch(error => {
        this.node.error(`[DH6400Polling] Initial poll error: ${error.message}`);
    });
}

private scheduleRetryConnection(): void {
    setTimeout(async () => {
        this.node.log('[DH6400Polling] Retrying connection...');
        try {
            await this.startPolling();
        } catch (error) {
            this.node.error(`[DH6400Polling] Retry failed: ${(error as Error).message}`);
        }
    }, 10000); // Retry after 10 seconds
}
```

#### Solution B: Add Process-level Safety Net

```typescript
// Update viis-marine-telemetry.ts
process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
  
  // Try to recover gracefully
  if (reason && typeof reason === 'object' && 'message' in reason) {
    const errorMsg = (reason as Error).message;
    
    if (errorMsg.includes('Cannot lock port') || errorMsg.includes('Resource temporarily unavailable')) {
      console.error('⚠️  Port lock error detected - node may need manual restart');
      // Attempt to clean up and retry
      if (dh6400PollingService) {
        dh6400PollingService.cleanup().then(() => {
          console.log('Cleaned up after port lock error');
        }).catch(e => {
          console.error('Cleanup failed:', e);
        });
      }
    }
  }
});
```

### Priority 3: Improve Deploy Safety (MEDIUM)

#### Solution: Add Graceful Shutdown Signal

```typescript
// Update viis-marine-telemetry.ts
let isShuttingDown = false;

node.on('close', async (done: () => void) => {
    isShuttingDown = true;
    
    try {
        node.log('[Marine] Starting graceful shutdown...');
        
        // 1. Stop accepting new work
        if (dh6400PollingService) {
            dh6400PollingService.pausePolling();
        }
        
        // 2. Wait a bit for ongoing operations
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 3. Cleanup DH6400 polling service
        if (dh6400PollingService) {
            await dh6400PollingService.cleanup();
            node.log('[Marine] DH6400 polling service cleaned up');
        }
        
        // 4. Disconnect MQTT
        if (thingsboardMqttClient) {
            thingsboardMqttClient.disconnect();
            node.log('[Marine] ThingsBoard MQTT disconnected');
        }
        
        // 5. Cleanup database (carefully)
        if (dataSource && dataSource.isInitialized) {
            try {
                await dataSource.destroy();
                node.log('[Marine] Database connection closed');
            } catch (dbError) {
                if (!(dbError as Error).message.includes('not yet established')) {
                    node.warn(`[Marine] Database cleanup warning: ${(dbError as Error).message}`);
                }
            }
        }
        
        node.log('[Marine] Graceful shutdown complete');
        done();
        
    } catch (error) {
        node.error(`[Marine] Cleanup error: ${(error as Error).message}`);
        done();
    }
});

// Guard initialization
(async () => {
    if (isShuttingDown) {
        node.log('[Marine] Skipping initialization - node is shutting down');
        return;
    }
    
    // ... rest of initialization
})();
```

---

## 📈 KẾT LUẬN VÀ ROADMAP

### Hiện trạng:
- ✅ **Có** auto-reconnection cơ bản
- ✅ **Có** cleanup logic tốt
- ❌ **THIẾU** port locking mechanism
- ❌ **THIẾU** promise rejection handling đầy đủ
- ⚠️ **YẾU** về deploy safety

### Độ ưu tiên fix:

1. **NGAY LẬP TỨC (1-2 ngày):**
   - Implement global port lock registry
   - Add exponential backoff cho reconnection
   - Wrap tất cả polling promises với try-catch

2. **SỚM (1 tuần):**
   - Add deploy grace period
   - Improve error recovery strategies
   - Add health check endpoint

3. **TRUNG HẠN (2 tuần):**
   - Add comprehensive logging
   - Add metrics và monitoring
   - Add integration tests cho reconnection scenarios

### Điểm cần kiểm tra thêm:
- [ ] Kiểm tra xem có multiple Node-RED instances không
- [ ] Kiểm tra file `/dev/ttyACM0` permissions
- [ ] Kiểm tra có process nào khác đang giữ port không (dùng `lsof /dev/ttyACM0`)
- [ ] Review Node-RED deploy logs chi tiết

---

**Người đánh giá:** AI Assistant  
**Ngày hoàn thành:** 8/12/2025  
**Version:** 1.0
