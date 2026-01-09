# Kiến trúc Hệ thống Quản lý Error/Warning trên Gateway

## 1. Tổng quan (Overview)

### 1.1. Mục tiêu
Xây dựng hệ thống quản lý error và warning toàn diện trên gateway Node-RED, cho phép:
- Thu thập error/warning từ Modbus devices
- Thu thập error/warning từ business logic trong Node-RED flows
- Lưu trữ vào database local (MySQL)
- Quản lý lifecycle của notification (created → read → resolved)
- Cung cấp API để query và quản lý notifications

### 1.2. Nguồn Error/Warning

#### A. Từ Modbus Device
- **Holding Registers**: Chứa error codes từ device
- **Input Registers**: Chứa sensor error values
- **Coils**: Chứa trạng thái error flags (on/off)
- **Mapping Table**: Bảng tra để parse error code thành human-readable message

#### B. Từ Node-RED Flow Logic
- Business rules violations (ví dụ: nhiệt độ vượt ngưỡng)
- Device protection logic (ví dụ: thiết bị chạy quá lâu)
- Communication errors (ví dụ: mất kết nối Modbus)
- Data validation errors

## 2. Kiến trúc Hiện tại (Current State)

### 2.1. Components Đã có sẵn

#### Database Layer ✅
- **Entity**: `TabiotNotification` - Đã định nghĩa đầy đủ
- **Fields quan trọng**:
  - `name`: Primary key (varchar 140)
  - `err_code`: Mã lỗi từ device hoặc logic
  - `severity`: low | medium | high | critical
  - `type`: alert | warning | info | error
  - `message`: Mô tả lỗi chi tiết
  - `entity`: Thiết bị/component gây lỗi
  - `is_read`: Trạng thái đã đọc
  - `is_sent`: Trạng thái đã gửi MQTT

#### Service Layer ✅
- **NotificationService** (`/src/modules/viis-rest-api/services/notification.service.ts`)
  - ✅ `createNotification()`: Tạo notification mới
  - ✅ `publishNotificationToMqtt()`: Publish lên MQTT (optional)
  - ✅ `getAllNotifications()`: Query với filtering và pagination
  - ✅ `updateNotification()`: Cập nhật trạng thái
  - ✅ `deleteNotification()`: Xóa notification

#### API Layer ✅
- REST endpoints đã có sẵn qua viis-rest-api module
- DTOs đã định nghĩa: `CreateIotNotificationDto`, `UpdateIotNotificationDto`
- Validation middleware đã có

#### Modbus Infrastructure ✅
- **ClientRegistry**: Quản lý multi-board connections
- **ModbusClientCore**: Read/Write Modbus registers
- Hot-reload config support
- Multi-board support với `getModbusClientV2()`

### 2.2. Components Còn thiếu

❌ **Error Mapping Service**: Parse error codes thành messages
❌ **Modbus Error Monitoring Node**: Node-RED node để poll Modbus errors
❌ **Error Code Configuration**: Cấu trúc lưu trữ mapping table
❌ **Deduplication Logic**: Tránh tạo duplicate notifications
❌ **Auto-resolve Logic**: Tự động resolve khi lỗi hết

## 3. Kiến trúc Đề xuất (Proposed Architecture)

### 3.1. Layered Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Node-RED Flow Layer                       │
│  ┌───────────────┐  ┌────────────────┐  ┌─────────────────┐ │
│  │ Modbus Error  │  │ Business Logic │  │ Device          │ │
│  │ Monitor Node  │  │ Check Nodes    │  │ Protection Node │ │
│  └───────┬───────┘  └────────┬───────┘  └────────┬────────┘ │
└──────────┼──────────────────┼───────────────────┼──────────┘
           │                  │                   │
           └──────────────────┼───────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Core Services Layer                         │
│  ┌───────────────────────────────────────────────────────┐   │
│  │         ErrorNotificationService                       │   │
│  │  • createFromModbus()                                  │   │
│  │  • createFromBusinessLogic()                           │   │
│  │  • checkDuplicateAndCreate()                           │   │
│  │  • autoResolve()                                       │   │
│  └───────────────┬───────────────────────────────────────┘   │
│                  │                                            │
│  ┌───────────────▼───────────────────────────────────────┐   │
│  │         ErrorMappingService                            │   │
│  │  • parseModbusError()                                  │   │
│  │  • getErrorMessage()                                   │   │
│  │  • getSeverity()                                       │   │
│  └───────────────┬───────────────────────────────────────┘   │
└──────────────────┼───────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                  Data Access Layer                            │
│  ┌────────────────────┐  ┌──────────────────────────────┐   │
│  │ TabiotNotification │  │ ErrorCodeMapping (JSON/DB)   │   │
│  │ Repository         │  │                              │   │
│  └────────────────────┘  └──────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    MySQL Database                             │
│         (viis_local.tabiot_notification table)                │
└─────────────────────────────────────────────────────────────┘
```

### 3.2. Error Code Mapping Structure

#### Format JSON cho Error Mapping
```typescript
interface ErrorCodeMapping {
  device_type: string;      // Loại thiết bị (e.g., "PLC_S7_1200")
  board_id?: string;        // Board ID nếu multi-board
  mappings: {
    register_type: 'holding' | 'input' | 'coil';
    address: number;        // Địa chỉ Modbus
    error_codes: {
      code: number | boolean;  // Giá trị error code hoặc coil state
      err_code: string;        // Mã lỗi chuẩn hóa (e.g., "ERR_TEMP_001")
      message: string;         // Thông báo lỗi
      severity: 'low' | 'medium' | 'high' | 'critical';
      auto_resolve?: boolean;  // Tự động resolve khi code = 0
      description?: string;    // Mô tả chi tiết
    }[];
  }[];
}
```

#### Ví dụ Configuration
```json
{
  "device_type": "Climate_Controller",
  "board_id": "board1",
  "mappings": [
    {
      "register_type": "holding",
      "address": 1000,
      "error_codes": [
        {
          "code": 1,
          "err_code": "ERR_TEMP_HIGH",
          "message": "Nhiệt độ vượt ngưỡng an toàn",
          "severity": "high",
          "auto_resolve": true
        },
        {
          "code": 2,
          "err_code": "ERR_SENSOR_FAULT",
          "message": "Cảm biến nhiệt độ bị lỗi",
          "severity": "critical",
          "auto_resolve": false
        }
      ]
    },
    {
      "register_type": "coil",
      "address": 500,
      "error_codes": [
        {
          "code": true,
          "err_code": "ERR_FAN_OVERRUN",
          "message": "Quạt chạy quá giới hạn thời gian",
          "severity": "medium",
          "auto_resolve": true
        }
      ]
    }
  ]
}
```

**Lưu trữ**: `/services/env/error-codes/` directory với multiple JSON files
- `/services/env/error-codes/default.json` - Default mappings
- `/services/env/error-codes/climate-controller.json` - Device-specific
- `/services/env/error-codes/irrigation-system.json` - Device-specific
- Tự động loaded bởi **env-loader** (extended)

## 4. Implementation Plan

### 4.1. Phase 1: Core Services

#### A. ErrorMappingService
```typescript
// /src/services/error-mapping.service.ts

interface ModbusErrorSource {
  register_type: 'holding' | 'input' | 'coil';
  address: number;
  value: number | boolean;
  board_id?: string;
}

interface ParsedError {
  err_code: string;
  message: string;
  severity: string;
  auto_resolve: boolean;
  description?: string;
}

class ErrorMappingService {
  private mappings: Map<string, ErrorCodeMapping>;

  constructor(nodeContext: NodeContext) {
    // Load từ error-codes.json hoặc env variable
    this.loadMappings();
  }

  parseModbusError(source: ModbusErrorSource, deviceType: string): ParsedError | null {
    // Tìm mapping phù hợp
    // Parse error code thành message
  }

  reloadMappings() {
    // Hot-reload mapping khi config thay đổi
  }
}
```

#### B. ErrorNotificationService (extends NotificationService)
```typescript
// /src/services/error-notification.service.ts

class ErrorNotificationService {
  private notificationService: NotificationService;
  private errorMappingService: ErrorMappingService;
  private activeErrors: Map<string, string>; // err_code -> notification_name

  async createFromModbus(
    source: ModbusErrorSource,
    deviceType: string,
    entity: string
  ): Promise<TabiotNotification | null> {
    // 1. Parse error qua ErrorMappingService
    const parsedError = this.errorMappingService.parseModbusError(source, deviceType);
    if (!parsedError) return null;

    // 2. Check duplicate (nếu err_code đã có trong activeErrors)
    if (this.isDuplicate(parsedError.err_code, entity)) {
      return null; // Skip nếu đã tạo
    }

    // 3. Create notification
    const notification = await this.notificationService.createNotification({
      entity,
      type: 'error',
      severity: parsedError.severity,
      message: parsedError.message,
      err_code: parsedError.err_code,
      entity_label: `${deviceType} - ${entity}`,
      isRead: 0,
      isSent: 0
    });

    // 4. Track active error
    this.activeErrors.set(`${parsedError.err_code}_${entity}`, notification.name);

    return notification;
  }

  async autoResolveIfClear(
    source: ModbusErrorSource,
    deviceType: string,
    entity: string
  ): Promise<void> {
    // Kiểm tra nếu error code = 0 hoặc coil = false
    // Tự động mark notification as resolved (is_read = 1)
  }

  async createFromBusinessLogic(
    err_code: string,
    message: string,
    severity: string,
    entity: string,
    type: string
  ): Promise<TabiotNotification> {
    // Tương tự createFromModbus nhưng không cần parse
  }
}
```

### 4.2. Phase 2: Node-RED Custom Nodes

#### A. viis-modbus-error-monitor Node

**Chức năng**:
- Poll Modbus registers/coils định kỳ
- Parse errors qua ErrorMappingService
- Tự động tạo notifications
- Tự động resolve khi error clear

**Configuration UI**:
```html
<script type="text/html" data-template-name="viis-modbus-error-monitor">
  <div class="form-row">
    <label for="node-input-deviceType">Device Type</label>
    <input type="text" id="node-input-deviceType">
  </div>
  <div class="form-row">
    <label for="node-input-pollInterval">Poll Interval (ms)</label>
    <input type="number" id="node-input-pollInterval" value="5000">
  </div>
  <div class="form-row">
    <label for="node-input-boardId">Board ID (multi-board)</label>
    <input type="text" id="node-input-boardId">
  </div>
  <div class="form-row">
    <label for="node-input-errorMappingFile">Error Mapping File</label>
    <input type="text" id="node-input-errorMappingFile" placeholder="error-codes.json">
  </div>
</script>
```

**Implementation**:
```typescript
// /src/modules/viis-modbus-error-monitor/viis-modbus-error-monitor.ts

module.exports = function (RED: NodeAPI) {
  function ViisModbusErrorMonitorNode(this: Node, config: any) {
    RED.nodes.createNode(this, config);
    const node = this;

    const errorNotificationService = new ErrorNotificationService(node.context());
    const modbusClient = ClientRegistry.getModbusClientV2(config.boardId, node);

    let pollInterval: NodeJS.Timeout;

    const pollErrors = async () => {
      // Load error mapping config
      const mapping = loadErrorMapping(config.errorMappingFile);

      // Poll từng register trong mapping
      for (const map of mapping.mappings) {
        let value;

        if (map.register_type === 'holding') {
          const result = await modbusClient.readHoldingRegisters(map.address, 1);
          value = result.data[0];
        } else if (map.register_type === 'coil') {
          const result = await modbusClient.readCoils(map.address, 1);
          value = result.data[0];
        }

        // Check nếu có error
        if (value !== 0 && value !== false) {
          await errorNotificationService.createFromModbus(
            {
              register_type: map.register_type,
              address: map.address,
              value,
              board_id: config.boardId
            },
            config.deviceType,
            node.id
          );
        } else {
          // Auto-resolve nếu error clear
          await errorNotificationService.autoResolveIfClear(
            { register_type: map.register_type, address: map.address, value },
            config.deviceType,
            node.id
          );
        }
      }
    };

    // Start polling
    pollInterval = setInterval(pollErrors, config.pollInterval || 5000);

    node.on('close', () => {
      clearInterval(pollInterval);
      ClientRegistry.releaseModbusClientV2(config.boardId, node);
    });
  }

  RED.nodes.registerType("viis-modbus-error-monitor", ViisModbusErrorMonitorNode);
};
```

#### B. viis-error-trigger Node

**Chức năng**:
- Function node để business logic có thể trigger errors
- Nhận msg input với error info
- Tạo notification qua ErrorNotificationService

**Usage trong Flow**:
```javascript
// Function node trước viis-error-trigger
msg.payload = {
  err_code: "BIZ_TEMP_EXCEED",
  message: "Nhiệt độ vượt ngưỡng cài đặt 35°C",
  severity: "high",
  type: "warning",
  entity: "greenhouse_1",
  metadata: {
    current_temp: 38.5,
    threshold: 35
  }
};
return msg;
```

**Implementation**:
```typescript
// /src/modules/viis-error-trigger/viis-error-trigger.ts

module.exports = function (RED: NodeAPI) {
  function ViisErrorTriggerNode(this: Node, config: any) {
    RED.nodes.createNode(this, config);
    const node = this;

    const errorNotificationService = new ErrorNotificationService(node.context());

    node.on('input', async (msg: any) => {
      const payload = msg.payload;

      try {
        const notification = await errorNotificationService.createFromBusinessLogic(
          payload.err_code,
          payload.message,
          payload.severity,
          payload.entity,
          payload.type || 'warning'
        );

        msg.notification = notification;
        node.send(msg);
      } catch (error) {
        node.error(`Failed to create notification: ${error}`);
      }
    });
  }

  RED.nodes.registerType("viis-error-trigger", ViisErrorTriggerNode);
};
```

### 4.3. Phase 3: Integration với Existing Flows

#### A. Tích hợp với viis-device-protection
```typescript
// Trong viis-device-protection.ts
// Thay vì chỉ log error, tạo notification

const errorNotificationService = new ErrorNotificationService(node.context());

async function checkProtection() {
  // ... existing logic ...

  // Khi phát hiện violation
  if (timeSinceStarted > maxTime) {
    await errorNotificationService.createFromBusinessLogic(
      `PROTECTION_${coilKey}_TIMEOUT`,
      `${coilKey} đã chạy quá ${maxTime}ms`,
      'high',
      node.id,
      'alert'
    );

    // Turn off device
    await writeCoil(coilAddress, false);
  }
}
```

#### B. Tích hợp với viis-auto-microclimate-control
```typescript
// Thêm error checking trong control logic

if (sensorValue === null || sensorValue === undefined) {
  await errorNotificationService.createFromBusinessLogic(
    'SENSOR_READ_FAIL',
    `Không đọc được cảm biến ${sensorName}`,
    'critical',
    'microclimate_control',
    'error'
  );
}
```

### 4.4. Phase 4: Enhanced Features (Optional)

#### A. Notification Aggregation
- Gom nhóm nhiều notifications giống nhau trong time window
- Tránh spam khi error xảy ra liên tục

#### B. Error Statistics
- Dashboard thống kê errors theo severity, type, entity
- Track error trends over time

#### C. Escalation Rules
- Auto-escalate nếu error không được resolve trong X phút
- Tự động tăng severity level

#### D. Recovery Actions
- Trigger automatic recovery flows khi detect errors
- Ví dụ: Restart device, switch to backup, etc.

## 5. Configuration Files Structure

```
/services/env/
  ├── common.env              # Existing
  ├── device1.env             # Existing
  ├── error-codes/
  │   ├── default.json        # Default error mapping
  │   ├── climate-controller.json
  │   ├── irrigation-system.json
  │   └── ...
  └── error-notification.env  # Config cho error notification system
```

**error-notification.env**:
```env
# Error Notification Configuration
ERROR_POLL_INTERVAL=5000           # Poll interval for Modbus error monitoring
ERROR_AUTO_RESOLVE=true            # Enable auto-resolve when error clears
ERROR_DEDUPLICATION_WINDOW=300000  # 5 minutes - prevent duplicate within window
ERROR_MQTT_PUBLISH=true            # Publish to MQTT when error created
ERROR_LOG_LEVEL=info               # Log level: debug | info | warn | error
```

## 6. Database Schema (Existing - No changes needed)

```sql
CREATE TABLE `tabiot_notification` (
  `name` varchar(140) NOT NULL,
  `customer_user` varchar(140) DEFAULT NULL,
  `message` text,
  `created_at` timestamp NULL DEFAULT NULL,
  `entity` varchar(140) DEFAULT NULL,
  `type` varchar(140) DEFAULT NULL,
  `is_read` smallint DEFAULT '0',
  `is_sent` smallint DEFAULT '0',
  `customer_id` varchar(140) DEFAULT NULL,
  `err_code` varchar(140) DEFAULT NULL,
  `entity_label` varchar(140) DEFAULT NULL,
  `severity` varchar(140) DEFAULT NULL,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

✅ Schema hiện tại đã đầy đủ, không cần migration

## 7. API Endpoints (Already Available)

```
GET    /api/iot-notification          # List all notifications
GET    /api/iot-notification/:name    # Get specific notification
POST   /api/iot-notification          # Create notification
PUT    /api/iot-notification/:name    # Update notification
DELETE /api/iot-notification/:name    # Delete notification
```

**Query Parameters hỗ trợ**:
- `severity`: Filter by severity
- `type`: Filter by type
- `is_read`: Filter read/unread
- `err_code`: Filter by error code
- `entity`: Filter by entity
- `search`: Full-text search
- `page`, `size`: Pagination

## 8. Usage Examples

### Example 1: Monitor Modbus Error Register

**Node-RED Flow**:
```
[viis-modbus-error-monitor] → [debug]
```

**Config**:
- Device Type: `Climate_Controller`
- Poll Interval: `5000` ms
- Board ID: `board1`
- Error Mapping: `error-codes/climate-controller.json`

### Example 2: Business Logic Trigger

**Node-RED Flow**:
```
[viis-modbus-flex] → [function: check threshold] → [viis-error-trigger] → [debug]
```

**Function node code**:
```javascript
const temp = msg.payload.temperature;
const threshold = 35;

if (temp > threshold) {
  msg.payload = {
    err_code: "TEMP_EXCEED_THRESHOLD",
    message: `Nhiệt độ ${temp}°C vượt ngưỡng ${threshold}°C`,
    severity: "high",
    type: "warning",
    entity: "greenhouse_1",
    metadata: { temp, threshold }
  };
  return msg;
}
return null; // No error
```

### Example 3: Query Errors via API

```bash
# Get all unread high severity errors
curl "http://localhost:3001/api/iot-notification?is_read=0&severity=high"

# Get errors for specific entity
curl "http://localhost:3001/api/iot-notification?entity=greenhouse_1"

# Mark error as read
curl -X PUT "http://localhost:3001/api/iot-notification/notification_error_..."
  -H "Content-Type: application/json"
  -d '{"is_read": 1}'
```

## 9. Benefits của Architecture này

### ✅ Tận dụng Infrastructure Hiện tại
- Sử dụng `NotificationService` đã có
- Tích hợp với `ClientRegistry` và multi-board support
- Dùng REST API framework đã xây dựng
- Hot-reload config tương tự existing nodes

### ✅ Separation of Concerns
- **ErrorMappingService**: Parse error codes
- **ErrorNotificationService**: Business logic
- **Node-RED Nodes**: User interface
- **NotificationService**: Data persistence

### ✅ Extensibility
- Dễ thêm error mapping mới (chỉ cần edit JSON)
- Có thể extend ErrorNotificationService cho advanced features
- Custom nodes có thể tái sử dụng services

### ✅ Maintainability
- Centralized error mapping configuration
- Clear responsibility boundaries
- Type-safe với TypeScript
- Existing patterns được tuân thủ

### ✅ Production-Ready
- Deduplication tránh spam
- Auto-resolve giảm manual work
- MQTT integration for real-time alerts
- Comprehensive logging

## 10. Migration Path

### Step 1: Core Services
1. Implement `ErrorMappingService`
2. Implement `ErrorNotificationService`
3. Create sample error-codes JSON files
4. Unit tests cho services

### Step 2: Node-RED Nodes
1. Implement `viis-modbus-error-monitor`
2. Implement `viis-error-trigger`
3. Test với sample flows

### Step 3: Integration
1. Update `viis-device-protection` để tạo notifications
2. Update `viis-auto-microclimate-control` error handling
3. Thêm error monitoring vào existing flows

### Step 4: Documentation & Training
1. Viết docs cho users
2. Create example flows
3. Training cho team

---

## 📝 Next Steps

Bạn muốn tôi bắt đầu implement từ component nào?

1. **ErrorMappingService** + Error codes configuration structure
2. **ErrorNotificationService** với deduplication logic
3. **viis-modbus-error-monitor** Node-RED node
4. **viis-error-trigger** Node-RED node
5. Integration examples với existing nodes

Hoặc bạn có điều chỉnh/bổ sung nào cho architecture này không?
