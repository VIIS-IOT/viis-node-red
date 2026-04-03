# ⚡ Error Notification - Quick Reference

## 🚀 Setup (1 phút)

```bash
# 1. Thêm column vào database
docker exec viis-local-mysql mysql -u root -p'admin@123' viis_local \
  -e "ALTER TABLE tabiot_notification ADD COLUMN metadata TEXT NULL;"

# 2. Deploy env-loader node trong Node-RED
# 3. Tạo file /services/env/error-codes/your-device.json
```

---

## 💻 Basic Usage

### Import Service

```typescript
import { ErrorNotificationService } from '../services/error-notification.service';

// Trong node của bạn
const errorService = new ErrorNotificationService(node.context());
```

---

## 📝 Cách 1: Từ Modbus Error

```typescript
// Khi đọc error register
if (modbusValue !== 0) {
  await errorService.createFromModbus(
    {
      register_type: 'holding', // hoặc 'input', 'coil'
      address: 1000,
      value: modbusValue
    },
    'Climate_Controller', // Device type
    'device_001'          // Entity ID
  );
}

// Khi error clear
if (modbusValue === 0) {
  await errorService.autoResolveIfClear(
    { register_type: 'holding', address: 1000, value: 0 },
    'Climate_Controller',
    'device_001'
  );
}
```

---

## 🔧 Cách 2: Từ Business Logic

```typescript
await errorService.createFromBusinessLogic({
  err_code: 'TEMP_HIGH',
  message: 'Nhiệt độ 38°C vượt ngưỡng 35°C',
  severity: 'high',              // low | medium | high | critical
  type: 'warning',               // info | warning | error | alert
  entity: 'greenhouse_1',        // Unique ID
  metadata: {                    // Optional custom data
    temperature: 38,
    threshold: 35
  }
});
```

---

## 📄 Error Code Mapping File

**File**: `/services/env/error-codes/your-device.json`

```json
{
  "device_type": "Climate_Controller",
  "mappings": [
    {
      "register_type": "holding",
      "address": 1000,
      "error_codes": [
        {
          "code": 1,
          "err_code": "ERR_TEMP_HIGH",
          "message": "Nhiệt độ vượt ngưỡng",
          "severity": "high",
          "auto_resolve": true
        }
      ]
    }
  ]
}
```

---

## 🎯 Severity Levels

| Level | Auto-resolve? | Use For |
|-------|---------------|---------|
| `low` | ✅ | Thông tin |
| `medium` | ✅ | Cần theo dõi |
| `high` | ✅ | Cần xử lý sớm |
| `critical` | ❌ | Phải xử lý thủ công |

---

## 🔍 Query Notifications

```typescript
import { TabiotNotification } from '../orm/entities/notification/TabiotNotification';
import { createDataSource } from '../orm/dataSource';

const dataSource = await createDataSource(node.context());
const repo = dataSource.getRepository(TabiotNotification);

// Tất cả unresolved
const unresolved = await repo.find({ where: { is_read: 0 } });

// Của một device
const deviceErrors = await repo.find({ 
  where: { entity: 'device_001', is_read: 0 } 
});

// Critical errors
const critical = await repo.find({ 
  where: { severity: 'critical', is_read: 0 } 
});
```

---

## ✅ Features

| Feature | Status |
|---------|--------|
| **Deduplication** | ✅ Tự động (sequential) |
| **Occurrence Counting** | ✅ Trong metadata |
| **Auto-resolve** | ✅ Khi error clear |
| **Hot-reload Config** | ✅ Không cần restart |
| **Custom Metadata** | ✅ JSON flexible |
| **Multi-device** | ✅ Unlimited entities |

---

## 🧪 Testing

```bash
# Unit tests (mocked)
npm test

# Integration tests (real database)
npm run test:integration

# All tests
npm run test:all
```

---

## 🚨 Troubleshooting

**Không tạo notification?**
- ✅ env-loader deployed?
- ✅ JSON file exists?
- ✅ Device type matches?
- ✅ metadata column exists?

**Có duplicates?**
- ⚠️ Concurrent requests → race condition (expected)
- ✅ Sequential requests → no duplicates

**Auto-resolve không work?**
- ✅ Check `auto_resolve: true` in mapping
- ✅ Value must be 0 (or false for coil)
- ✅ Entity ID must match

---

## 📚 Full Docs

- **Usage Guide**: `docs/ERROR_NOTIFICATION_USAGE_GUIDE.md`
- **Architecture**: `docs/ERROR_WARNING_MANAGEMENT_ARCHITECTURE.md`
- **Implementation**: `docs/ERROR_MANAGEMENT_IMPLEMENTATION_COMPLETE.md`

---

## 🎯 Example: Complete Flow

```typescript
module.exports = function(RED: any) {
  function MyNode(config: any) {
    RED.nodes.createNode(this, config);
    const node = this;
    const errorService = new ErrorNotificationService(node.context());

    node.on('input', async function(msg: any) {
      try {
        // Read Modbus error register
        const errorCode = msg.payload.holding_1000;
        
        if (errorCode !== 0) {
          // Create notification
          const notification = await errorService.createFromModbus(
            { register_type: 'holding', address: 1000, value: errorCode },
            'Climate_Controller',
            msg.deviceId
          );
          
          if (notification) {
            node.warn(`❌ ${notification.err_code}: ${notification.message}`);
          }
        } else {
          // Auto-resolve when clear
          await errorService.autoResolveIfClear(
            { register_type: 'holding', address: 1000, value: 0 },
            'Climate_Controller',
            msg.deviceId
          );
          node.log('✅ Error cleared');
        }
        
        node.send(msg);
      } catch (error) {
        node.error(`Error: ${error}`);
      }
    });
  }
  
  RED.nodes.registerType("my-node", MyNode);
}
```

---

**Made with ❤️ by VIIS Team** | Updated: 2025-10-17
