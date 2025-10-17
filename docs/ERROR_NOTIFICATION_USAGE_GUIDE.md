# 🎯 Hướng dẫn Sử dụng Local Error Notification

**Version**: 1.0  
**Updated**: 2025-10-17  
**Status**: ✅ Production Ready (Verified with real database)

---

## 📋 Mục lục

1. [Setup ban đầu](#setup-ban-đầu)
2. [Cách 1: Tạo notification từ Modbus error](#cách-1-tạo-notification-từ-modbus-error)
3. [Cách 2: Tạo notification từ Business Logic](#cách-2-tạo-notification-từ-business-logic)
4. [Auto-resolve errors](#auto-resolve-errors)
5. [Cấu hình Error Code Mappings](#cấu-hình-error-code-mappings)
6. [Best Practices](#best-practices)

---

## Setup ban đầu

### 1. Verify Database Column

Đảm bảo column `metadata` đã được thêm vào database:

```sql
-- Kiểm tra column metadata
DESC tabiot_notification;

-- Nếu chưa có, thêm column
ALTER TABLE tabiot_notification 
  ADD COLUMN metadata TEXT NULL 
  COMMENT 'JSON metadata for error tracking (occurrence_count, etc.)';
```

### 2. Deploy env-loader Node

**QUAN TRỌNG**: env-loader node phải được deploy trong Node-RED flow để load error code mappings.

1. Mở Node-RED UI
2. Kéo node `env-loader` vào flow
3. Deploy flow
4. Verify trong Debug panel: "✅ Loaded error code mappings for X devices"

### 3. Tạo Error Code Mapping Files

Tạo file JSON trong `/services/env/error-codes/`:

**Example**: `/services/env/error-codes/climate-controller.json`
```json
{
  "device_type": "Climate_Controller",
  "description": "Error codes for climate control system",
  "mappings": [
    {
      "register_type": "holding",
      "address": 1000,
      "description": "Temperature error register",
      "error_codes": [
        {
          "code": 1,
          "err_code": "ERR_TEMP_HIGH",
          "message": "Nhiệt độ vượt ngưỡng an toàn",
          "severity": "high",
          "auto_resolve": true,
          "description": "Temperature exceeds safe threshold"
        },
        {
          "code": 2,
          "err_code": "ERR_TEMP_SENSOR_FAULT",
          "message": "Cảm biến nhiệt độ bị lỗi",
          "severity": "critical",
          "auto_resolve": false
        }
      ]
    }
  ]
}
```

---

## Cách 1: Tạo notification từ Modbus error

### Use Case
Bạn đọc giá trị Modbus và phát hiện error code trong register.

### Code Example

```typescript
import { ErrorNotificationService } from '../services/error-notification.service';

// Trong custom node của bạn
module.exports = function(RED: any) {
  function YourCustomNode(config: any) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Initialize service
    const errorService = new ErrorNotificationService(node.context());

    node.on('input', async function(msg: any) {
      try {
        // Đọc giá trị từ Modbus (ví dụ)
        const errorRegisterValue = msg.payload.register_1000; // value = 1

        // Nếu có error (value != 0)
        if (errorRegisterValue !== 0) {
          // Tạo notification từ Modbus error
          const notification = await errorService.createFromModbus(
            {
              register_type: 'holding',
              address: 1000,
              value: errorRegisterValue
            },
            'Climate_Controller', // Device type (phải match với JSON file)
            msg.deviceId || 'device_001' // Entity ID
          );

          if (notification) {
            node.warn(`❌ Error detected: ${notification.err_code} - ${notification.message}`);
            msg.payload.notification = notification;
          } else {
            node.warn(`⚠️  Unmapped error: register 1000 = ${errorRegisterValue}`);
          }
        } else {
          // Error cleared - auto-resolve
          await errorService.autoResolveIfClear(
            {
              register_type: 'holding',
              address: 1000,
              value: 0
            },
            'Climate_Controller',
            msg.deviceId || 'device_001'
          );
        }

        node.send(msg);
      } catch (error) {
        node.error(`Error in notification service: ${error}`);
      }
    });
  }

  RED.nodes.registerType("your-custom-node", YourCustomNode);
}
```

### Kết quả

✅ **Lần 1**: Tạo notification mới với:
- `err_code`: "ERR_TEMP_HIGH"
- `message`: "Nhiệt độ vượt ngưỡng an toàn"
- `severity`: "high"
- `is_read`: 0
- `metadata`: `{"occurrence_count": 1, "first_occurred": "...", ...}`

✅ **Lần 2-N** (nếu error vẫn còn): Update notification:
- Không tạo duplicate
- `occurrence_count` tăng lên: 2, 3, 4...
- `last_occurred` được update

✅ **Khi error clear** (value = 0):
- `is_read` = 1 (auto-resolved)
- `metadata` có thêm: `{"resolved_at": "...", "resolved_by": "auto"}`

---

## Cách 2: Tạo notification từ Business Logic

### Use Case
Bạn phát hiện error trong logic của mình (không phải từ Modbus).

### Code Example

```typescript
import { ErrorNotificationService } from '../services/error-notification.service';

// Trong custom node của bạn
module.exports = function(RED: any) {
  function YourCustomNode(config: any) {
    RED.nodes.createNode(this, config);
    const node = this;

    const errorService = new ErrorNotificationService(node.context());

    node.on('input', async function(msg: any) {
      try {
        // Ví dụ: Kiểm tra nhiệt độ
        const currentTemp = msg.payload.temperature;
        const threshold = config.tempThreshold || 35;

        if (currentTemp > threshold) {
          // Tạo notification từ business logic
          const notification = await errorService.createFromBusinessLogic({
            err_code: 'TEMP_THRESHOLD_EXCEEDED',
            message: `Nhiệt độ ${currentTemp}°C vượt ngưỡng ${threshold}°C`,
            severity: 'high',
            type: 'warning',
            entity: msg.deviceId || 'greenhouse_1',
            metadata: {
              current_temp: currentTemp,
              threshold: threshold,
              sensor_id: msg.payload.sensor_id,
              location: msg.payload.location
            }
          });

          node.warn(`⚠️  Temperature alert: ${notification.err_code}`);
          msg.payload.notification = notification;
        }

        node.send(msg);
      } catch (error) {
        node.error(`Error creating notification: ${error}`);
      }
    });
  }

  RED.nodes.registerType("temp-monitor-node", YourCustomNode);
}
```

### Kết quả

✅ Notification được tạo với:
- Custom `err_code`, `message`, `severity`
- Custom `metadata` với thông tin bạn muốn
- Deduplication tự động (same err_code + entity)
- Occurrence tracking

---

## Auto-resolve errors

### Tự động

```typescript
// Khi đọc Modbus và value = 0 (hoặc false cho coil)
await errorService.autoResolveIfClear(
  {
    register_type: 'holding',
    address: 1000,
    value: 0 // Error cleared
  },
  'Climate_Controller',
  'device_001'
);

// Hoặc cho coil
await errorService.autoResolveIfClear(
  {
    register_type: 'coil',
    address: 500,
    value: false // Coil off = error cleared
  },
  'Climate_Controller',
  'device_001'
);
```

### Thủ công

```typescript
// Resolve notification bằng tay
await errorService.resolveNotification(
  'ERR_TEMP_HIGH',
  'device_001',
  'manual', // resolved_by
  'Đã thay sensor mới' // optional note
);
```

**Lưu ý**: Chỉ errors có `auto_resolve: true` trong mapping mới được auto-resolve. Errors critical (`auto_resolve: false`) cần resolve thủ công.

---

## Cấu hình Error Code Mappings

### Cấu trúc File JSON

```json
{
  "device_type": "YOUR_DEVICE_TYPE",
  "description": "Description of device",
  "board_id": "board1",
  "mappings": [
    {
      "register_type": "holding|input|coil",
      "address": 1000,
      "description": "Register description",
      "error_codes": [
        {
          "code": 1,
          "err_code": "ERR_CODE_NAME",
          "message": "User-friendly message in Vietnamese",
          "severity": "low|medium|high|critical",
          "auto_resolve": true,
          "description": "Technical description in English"
        }
      ]
    }
  ]
}
```

### Ví dụ đầy đủ

```json
{
  "device_type": "Irrigation_System",
  "description": "Error codes for irrigation/fertigation system",
  "mappings": [
    {
      "register_type": "holding",
      "address": 2000,
      "description": "Pump status register",
      "error_codes": [
        {
          "code": 1,
          "err_code": "ERR_PUMP_OVERLOAD",
          "message": "Máy bơm quá tải",
          "severity": "high",
          "auto_resolve": false,
          "description": "Pump motor overload detected"
        },
        {
          "code": 2,
          "err_code": "ERR_PUMP_LOW_PRESSURE",
          "message": "Áp suất máy bơm thấp",
          "severity": "medium",
          "auto_resolve": true,
          "description": "Pump pressure below threshold"
        },
        {
          "code": 3,
          "err_code": "ERR_PUMP_NO_WATER",
          "message": "Máy bơm không có nước",
          "severity": "high",
          "auto_resolve": true,
          "description": "No water flow detected"
        }
      ]
    },
    {
      "register_type": "coil",
      "address": 600,
      "description": "Valve stuck flag",
      "error_codes": [
        {
          "code": true,
          "err_code": "ERR_VALVE_STUCK",
          "message": "Van tưới bị kẹt",
          "severity": "high",
          "auto_resolve": false,
          "description": "Valve failed to open/close"
        }
      ]
    }
  ]
}
```

### Hot-reload

Sau khi tạo/sửa file JSON:
- **Không cần** restart Docker container
- **Không cần** npm run build
- Đợi tối đa **10 giây** để env-loader tự động reload
- Verify trong Node-RED Debug panel

---

## Best Practices

### 1. Error Code Naming

```typescript
// ✅ GOOD: Clear, descriptive
'ERR_TEMP_HIGH'
'ERR_PUMP_OVERLOAD'
'ERR_SENSOR_DISCONNECTED'

// ❌ BAD: Unclear
'ERROR_1'
'ERR'
'FAULT'
```

### 2. Entity Naming

```typescript
// ✅ GOOD: Unique, meaningful
entity: `greenhouse_${msg.deviceId}`
entity: `pump_station_${config.stationId}`
entity: `sensor_${msg.payload.sensor_id}`

// ❌ BAD: Generic, not unique
entity: 'device'
entity: 'sensor'
```

### 3. Severity Levels

| Severity | Meaning | Auto-resolve? | Example |
|----------|---------|---------------|---------|
| **low** | Thông tin, không cần xử lý gấp | ✅ Yes | Cảnh báo nhiệt độ cao nhẹ |
| **medium** | Cần theo dõi | ✅ Yes | Độ ẩm thấp |
| **high** | Cần xử lý sớm | ✅ Yes | Nhiệt độ vượt ngưỡng |
| **critical** | Cần xử lý ngay, thủ công | ❌ No | Sensor hỏng, máy bơm quá tải |

### 4. Metadata Best Practices

```typescript
// ✅ GOOD: Structured, useful info
metadata: {
  sensor_id: 'TEMP_001',
  location: 'Zone A',
  current_value: 38.5,
  threshold: 35,
  unit: '°C',
  timestamp: new Date().toISOString()
}

// ❌ BAD: Too much or useless data
metadata: {
  entire_payload: msg.payload, // Too large
  random_field: 'xyz' // Not useful
}
```

### 5. Error Handling

```typescript
try {
  const notification = await errorService.createFromModbus(...);
  
  if (notification) {
    // Success
    node.send([msg, null]);
  } else {
    // No mapping found - log but continue
    node.warn(`Unmapped error: register ${address} = ${value}`);
    node.send([msg, null]);
  }
} catch (error) {
  // Critical error - send to error output
  node.error(`Failed to create notification: ${error}`);
  msg.error = error;
  node.send([null, msg]);
}
```

### 6. Testing

```typescript
// Test với giá trị thực tế
const testNotification = await errorService.createFromBusinessLogic({
  err_code: 'TEST_ERROR',
  message: 'Test notification',
  severity: 'low',
  type: 'info',
  entity: 'test_device',
  metadata: { test: true }
});

console.log('Created test notification:', testNotification.name);

// Cleanup sau khi test
// await notificationRepo.delete({ entity: 'test_device' });
```

---

## 📊 Monitoring & Statistics

### Get Statistics

```typescript
const stats = errorService.getStats();

console.log('Service statistics:', stats);
// {
//   mappingService: {
//     loaded: true,
//     deviceTypeCount: 3,
//     deviceTypes: ['Climate_Controller', 'Irrigation_System', 'default']
//   },
//   repositoryInitialized: true
// }
```

### Query Notifications

```typescript
// Tìm tất cả notifications chưa đọc
const unresolved = await notificationRepo.find({
  where: { is_read: 0 },
  order: { created_at: 'DESC' }
});

// Tìm notifications của device cụ thể
const deviceNotifications = await notificationRepo.find({
  where: { 
    entity: 'greenhouse_1',
    is_read: 0
  }
});

// Đếm notifications theo severity
const criticalCount = await notificationRepo.count({
  where: {
    severity: 'critical',
    is_read: 0
  }
});
```

---

## 🔧 Troubleshooting

### Vấn đề: Notifications không được tạo

**Kiểm tra**:
1. ✅ env-loader node đã deploy chưa?
2. ✅ Error code mapping file tồn tại trong `/services/env/error-codes/`?
3. ✅ Device type match với file JSON?
4. ✅ Register address + value có trong mapping?
5. ✅ Database connection OK?

**Debug**:
```typescript
// Check if mapping exists
const mapping = errorService.getMappingForDeviceType('Climate_Controller');
console.log('Mapping:', mapping);

// Check if error code exists
const parsedError = errorMappingService.parseModbusError(
  { register_type: 'holding', address: 1000, value: 1 },
  'Climate_Controller'
);
console.log('Parsed error:', parsedError);
```

### Vấn đề: Duplicate notifications

**Nguyên nhân**: Concurrent requests (race condition)

**Giải pháp**:
- Sử dụng sequential error reporting
- Thêm debouncing/throttling
- Accept một số duplicates (sẽ merge sau)

### Vấn đề: Auto-resolve không hoạt động

**Kiểm tra**:
1. ✅ Error có `auto_resolve: true` trong mapping?
2. ✅ Đã gọi `autoResolveIfClear()` với value = 0?
3. ✅ Entity ID khớp với notification?

---

## 📚 Examples

### Example 1: Temperature Monitoring

```typescript
node.on('input', async function(msg: any) {
  const temp = msg.payload.temperature;
  
  if (temp > 40) {
    await errorService.createFromBusinessLogic({
      err_code: 'TEMP_CRITICAL',
      message: `Nhiệt độ ${temp}°C - MỨC NGUY HIỂM!`,
      severity: 'critical',
      type: 'alert',
      entity: msg.deviceId,
      metadata: { temp, threshold: 40 }
    });
  } else if (temp > 35) {
    await errorService.createFromBusinessLogic({
      err_code: 'TEMP_HIGH',
      message: `Nhiệt độ ${temp}°C - Cao hơn bình thường`,
      severity: 'high',
      type: 'warning',
      entity: msg.deviceId,
      metadata: { temp, threshold: 35 }
    });
  } else {
    // Temperature normal - resolve any existing errors
    await errorService.resolveNotification('TEMP_CRITICAL', msg.deviceId, 'auto');
    await errorService.resolveNotification('TEMP_HIGH', msg.deviceId, 'auto');
  }
});
```

### Example 2: Pump Status Monitoring

```typescript
node.on('input', async function(msg: any) {
  const pumpStatus = msg.payload.holding_2000; // Error register
  
  if (pumpStatus !== 0) {
    // Create notification from Modbus error
    await errorService.createFromModbus(
      { register_type: 'holding', address: 2000, value: pumpStatus },
      'Irrigation_System',
      `pump_${msg.payload.pump_id}`
    );
  } else {
    // Pump OK - auto-resolve
    await errorService.autoResolveIfClear(
      { register_type: 'holding', address: 2000, value: 0 },
      'Irrigation_System',
      `pump_${msg.payload.pump_id}`
    );
  }
});
```

---

## 🚀 Quick Start Checklist

- [ ] Database có column `metadata`
- [ ] env-loader node đã deploy
- [ ] Tạo error code mapping JSON files
- [ ] Test với 1 device trước
- [ ] Verify notifications trong database
- [ ] Setup monitoring/dashboard
- [ ] Deploy to production

---

## 📞 Support

**Documentation**: `/docs/ERROR_MANAGEMENT_*.md`  
**Tests**: `npm run test` (unit) hoặc `npm run test:integration` (real DB)  
**Source**: `src/services/error-notification.service.ts`

---

**Happy coding!** 🎉
