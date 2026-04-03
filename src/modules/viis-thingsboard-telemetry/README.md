# VIIS ThingsBoard Telemetry Node

Custom Node-RED node để gửi telemetry data lên ThingsBoard qua HTTP API với batch support và automatic retry mechanism.

## ✅ Tính năng chính

- **Batch Upload**: Tự động gom nhiều telemetry records gửi một lần
- **Auto Retry**: Failed requests được lưu database và retry tự động
- **Zero Data Loss**: Đảm bảo không mất data với database persistence
- **Hot Reload**: Tự động detect thay đổi config trong env files
- **Statistics**: Tracking số lượng sent/failed/retried records

---

## 📦 Database Migration

### SQL Script để tạo table:

```sql
CREATE TABLE tabiot_thingsboard_telemetry_queue (
    id INT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(255) NOT NULL,
    device_token VARCHAR(255) NOT NULL,
    payload JSON NOT NULL COMMENT 'Batch telemetry data in ThingsBoard format',
    timestamp BIGINT NOT NULL COMMENT 'Unix timestamp in milliseconds',
    retry_count INT DEFAULT 0,
    max_retries INT DEFAULT 3,
    status ENUM('pending', 'retrying', 'failed', 'success') DEFAULT 'pending',
    last_error TEXT NULL,
    last_retry_at BIGINT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_device_id (device_id),
    INDEX idx_status (status),
    INDEX idx_retry (status, retry_count, last_retry_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

## ⚙️ Configuration

### Environment Variables (common.env):

```env
# ThingsBoard Configuration
VIIS_BACKEND=https://iot.viis.tech
DEVICE_ACCESS_TOKEN=your_device_token_here
DEVICE_ID=device_001

# Optional: Batch Settings (có thể config trong node UI)
TB_BATCH_SIZE=10
TB_FLUSH_INTERVAL=5000
TB_MAX_RETRIES=3
TB_RETRY_INTERVAL=30000
```

### Node Configuration UI:

- **Batch Size**: Số lượng records gom lại trước khi gửi (default: 10)
- **Flush Interval**: Thời gian auto-flush (ms) (default: 5000)
- **Max Retries**: Số lần retry tối đa (default: 3)
- **Retry Interval**: Khoảng thời gian giữa các lần retry (default: 30000)
- **Enable Retry**: Bật/tắt auto-retry (default: true)
- **Enable Logging**: Bật/tắt debug logging (default: false)

---

## 📥 Input Message Formats

Node hỗ trợ 3 format input:

### Format 1: Simple key-value object
```javascript
msg.payload = {
    temperature: 42,
    humidity: 73
};
// Node tự động thêm timestamp
```

### Format 2: ThingsBoard format với timestamp
```javascript
msg.payload = {
    ts: 1451649600512,
    values: {
        temperature: 42,
        humidity: 73
    }
};
```

### Format 3: Batch array
```javascript
msg.payload = [
    { ts: 1451649600512, values: { temperature: 42 } },
    { ts: 1451649600513, values: { temperature: 43 } }
];
```

---

## 📤 Output Message

Node output statistics sau khi xử lý:

```javascript
msg.payload = {
    success: true,
    stats: {
        totalSent: 100,      // Tổng số đã gửi
        totalFailed: 2,      // Tổng số failed
        totalRetried: 1,     // Tổng số đã retry
        totalSuccess: 98,    // Tổng số thành công
        bufferSize: 0,       // Số lượng trong buffer hiện tại
        config: {
            batchSize: 10,
            flushInterval: 5000,
            maxRetries: 3,
            retryInterval: 30000,
            enableRetry: true,
            enableLogging: false
        }
    }
};
```

---

## 🔄 Migration từ MQTT sang HTTP

### Flow cũ (MQTT):
```
[inject] → [function: Map Data] → [mqtt out: Thingsboard]
```

### Flow mới (HTTP):
```
[inject] → [function: Map Data] → [viis-thingsboard-telemetry]
```

### Changes:
1. **Xóa MQTT broker config node**
2. **Thêm node mới** từ palette: `VIIS` → `TB Telemetry`
3. **Configure node**: Set batch size, retry settings
4. **Kết nối** output từ function node vào viis-thingsboard-telemetry

### Function node không cần thay đổi code:
```javascript
// Code hiện tại vẫn hoạt động
const mqttPayload = { ...currentState };
msg.payload = mqttPayload;
return msg;
```

---

## 🚀 Cách sử dụng trong Flow

### Example Flow:

```json
[
    {
        "id": "inject_node",
        "type": "inject",
        "repeat": "1",
        "payload": "",
        "wires": [["map_data"]]
    },
    {
        "id": "map_data",
        "type": "function",
        "name": "Map Holding Data",
        "func": "msg.payload = { temperature: 42, humidity: 73 }; return msg;",
        "wires": [["tb_telemetry"]]
    },
    {
        "id": "tb_telemetry",
        "type": "viis-thingsboard-telemetry",
        "name": "Send to ThingsBoard",
        "batchSize": 10,
        "flushInterval": 5000,
        "maxRetries": 3,
        "retryInterval": 30000,
        "enableRetry": true,
        "enableLogging": false,
        "wires": [["debug_node"]]
    },
    {
        "id": "debug_node",
        "type": "debug",
        "name": "Stats"
    }
]
```

---

## 🔍 Monitoring & Debugging

### Enable Logging:
Trong node config, bật **Enable Logging** để xem chi tiết:
- Buffer size
- Batch flush events
- HTTP request/response
- Retry attempts
- Error details

### Check Database Queue:
```sql
-- Xem failed records
SELECT * FROM tabiot_thingsboard_telemetry_queue 
WHERE status IN ('pending', 'failed') 
ORDER BY created_at DESC;

-- Statistics
SELECT 
    status, 
    COUNT(*) as count,
    AVG(retry_count) as avg_retries
FROM tabiot_thingsboard_telemetry_queue 
GROUP BY status;

-- Recent errors
SELECT 
    device_id,
    last_error,
    retry_count,
    created_at
FROM tabiot_thingsboard_telemetry_queue 
WHERE status = 'failed'
ORDER BY created_at DESC
LIMIT 10;
```

---

## 🐛 Troubleshooting

### Node status: "Missing access token"
**Solution**: Kiểm tra `DEVICE_ACCESS_TOKEN` trong env file

### Failed uploads không retry
**Solution**: 
1. Check **Enable Retry** = true trong node config
2. Kiểm tra database connection
3. Review logs với **Enable Logging** = true

### Batch không flush
**Solution**:
1. Check buffer chưa đầy (< batch size)
2. Đợi flush interval timeout
3. Manually trigger bằng cách gửi thêm messages

### Database connection error
**Solution**:
1. Kiểm tra DATABASE_* env variables
2. Check MySQL service running
3. Verify database permissions

---

## 📊 Performance Tuning

### High throughput (nhiều data):
```javascript
{
    batchSize: 50,        // Tăng batch size
    flushInterval: 2000,  // Giảm flush interval
    maxRetries: 2,        // Giảm retries
    retryInterval: 60000  // Tăng retry interval
}
```

### Low latency (real-time):
```javascript
{
    batchSize: 1,         // Gửi ngay
    flushInterval: 100,   // Flush nhanh
    maxRetries: 5,        // Tăng retries
    retryInterval: 10000  // Retry nhanh
}
```

### Reliable (zero data loss):
```javascript
{
    batchSize: 10,
    flushInterval: 5000,
    maxRetries: 10,       // Retry nhiều lần
    retryInterval: 30000,
    enableRetry: true     // Bắt buộc
}
```

---

## 🔗 API Reference

ThingsBoard HTTP API Documentation: https://thingsboard.io/docs/reference/http-api/

---

## 📝 Notes

- Node tự động detect config changes mỗi 30 giây (hot-reload)
- Failed data được persist vào database ngay lập tức
- Retry mechanism sử dụng exponential backoff
- Node tự động flush buffer khi close/redeploy

---

## 🆘 Support

Nếu gặp vấn đề, kiểm tra:
1. Node-RED debug panel
2. Node status indicator (màu đỏ/xanh/vàng)
3. Database queue table
4. Enable logging trong node config
