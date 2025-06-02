# STM32 Modbus Connection Guide

## Tổng quan

Hướng dẫn này giải thích cách tối ưu hóa kết nối Modbus với STM32 và xử lý các vấn đề thường gặp như `ECONNREFUSED`.

## Vấn đề thường gặp với STM32

### 1. ECONNREFUSED Error
```
Failed to connect to Modbus TCP at 192.168.1.51:502: connect ECONNREFUSED 192.168.1.51:502
```

**Nguyên nhân:**
- STM32 đang bận xử lý task khác
- Network stack của STM32 chưa sẵn sàng
- STM32 đã đạt giới hạn concurrent connections
- Firmware STM32 có bug hoặc chưa ổn định

### 2. Connection Timeout
```
[STM32-TIMEOUT] Read coils timeout after 3s
```

**Nguyên nhân:**
- STM32 đang xử lý interrupt hoặc task ưu tiên cao
- Network latency cao
- STM32 firmware không phản hồi đúng protocol

## Cải tiến đã thực hiện

### 1. Connection Optimization

#### A. Timeout ngắn hơn
```typescript
// Timeout 2s thay vì 5s cho connection
connectTimeout: 2000

// Timeout 3s cho read/write operations
setTimeout(() => reject(new Error('timeout after 3s')), 3000);
```

#### B. Không dùng Keep-Alive
```typescript
// KHÔNG dùng keep-alive với STM32
keepAlive: false
```

#### C. Force IPv4
```typescript
family: 4 // Force IPv4 để tránh IPv6 issues
```

### 2. Reconnection Strategy

#### A. Exponential Backoff
```
Attempt 1: 2s delay
Attempt 2: 5s delay  
Attempt 3: 10s delay
Attempt 4: 20s delay
Attempt 5: 30s delay
```

#### B. Reduced Retry Count
```typescript
const maxRetries = 2; // Giảm từ 3 xuống 2 cho STM32
```

#### C. Longer Recovery Time
```typescript
await new Promise(resolve => setTimeout(resolve, 2000)); // 2s recovery
```

### 3. Connection Monitoring

#### A. Ít kiểm tra hơn
```typescript
setInterval(checkConnection, 15000); // 15s thay vì 10s
```

#### B. Không verify bằng readCoils
```typescript
// KHÔNG đọc data để verify - STM32 cần thời gian ổn định
if (this.client.isOpen && this.isConnected) {
    return; // Connection OK
}
```

## Cấu hình tối ưu cho STM32

### Environment Variables
```bash
# Timeout ngắn hơn cho STM32
MODBUS_TIMEOUT=3000

# Reconnect interval hợp lý
MODBUS_RECONNECT_INTERVAL=5000

# STM32 IP và port
MODBUS_HOST=192.168.1.51
MODBUS_TCP_PORT=502
MODBUS_TYPE=TCP
MODBUS_UNIT_ID=1
```

### STM32 Firmware Recommendations

#### 1. Network Stack
- Sử dụng LwIP với cấu hình tối ưu
- Tăng TCP buffer size nếu có thể
- Implement proper connection handling

#### 2. Modbus Implementation
- Sử dụng interrupt-driven processing
- Implement timeout cho Modbus responses
- Proper error handling và recovery

#### 3. Task Priority
- Đặt Modbus task ở priority cao
- Tránh blocking operations trong Modbus handler
- Sử dụng RTOS queue cho Modbus requests

## Troubleshooting

### 1. Kiểm tra Network
```bash
# Ping STM32
ping 192.168.1.51

# Kiểm tra port 502
telnet 192.168.1.51 502

# Scan network
nmap -p 502 192.168.1.51
```

### 2. Kiểm tra STM32 Status
- LED indicators
- Serial debug output
- Memory usage
- Task status

### 3. Modbus Testing Tools
```bash
# Sử dụng modpoll để test
modpoll -m tcp -a 1 -r 1 -c 10 192.168.1.51

# Hoặc mbpoll
mbpoll -m tcp -a 1 -r 1 -c 10 192.168.1.51
```

## Logs mẫu khi hoạt động tốt

### Connection Success
```
[STM32-OPTIMIZED] Connecting to Modbus TCP at 192.168.1.51:502
[STM32-SUCCESS] Connected to STM32 Modbus at 192.168.1.51:502
[MODBUS-SINGLE-CONNECTION] Created THE ONLY ModbusClientCore instance
```

### Read/Write Success
```
[STM32-WRITE] Successfully wrote register 100 = 1234
[STM32-READ] Reading coils successful
```

### Reconnection Success
```
[STM32-RECONNECT] Quick reconnect successful
[STM32-RECONNECT] Connection established, allowing STM32 to stabilize
```

## Best Practices

### 1. STM32 Development
- Implement watchdog timer
- Use proper error handling
- Test với multiple concurrent connections
- Optimize network stack parameters

### 2. Node-RED Usage
- Không spam requests quá nhanh
- Sử dụng reasonable polling intervals
- Monitor connection status
- Implement proper error handling

### 3. Network Setup
- Sử dụng stable network connection
- Tránh network congestion
- Consider using dedicated network segment
- Monitor network latency

## Monitoring và Debugging

### 1. Connection Status
```javascript
// Kiểm tra connection status
const status = ClientRegistry.getModbusConnectionStatus();
console.log('Connection status:', status);
```

### 2. Error Patterns
- Theo dõi error frequency
- Identify peak error times
- Correlate với STM32 activities
- Monitor network conditions

### 3. Performance Metrics
- Connection establishment time
- Read/write response time
- Error rate
- Reconnection frequency

## Kết luận

Với các cải tiến này, hệ thống sẽ:
- ✅ Kết nối ổn định hơn với STM32
- ✅ Xử lý ECONNREFUSED tốt hơn
- ✅ Recovery nhanh hơn khi có lỗi
- ✅ Ít làm phiền STM32 hơn
- ✅ Logging chi tiết để debug

**Lưu ý:** STM32 là embedded device với tài nguyên hạn chế, cần patience và proper handling để đảm bảo kết nối ổn định.
