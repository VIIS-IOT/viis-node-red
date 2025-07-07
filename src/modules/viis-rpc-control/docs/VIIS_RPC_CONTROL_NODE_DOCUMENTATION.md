# VIIS RPC Control Node - Tài liệu Kỹ thuật

## Tổng quan

Node **viis-rpc-control** là một custom node trong Node-RED được thiết kế để xử lý các lệnh RPC (Remote Procedure Call) và điều khiển thiết bị thông qua giao thức Modbus. Node này có khả năng lưu và publish telemetry data thông qua MQTT.

## Chức năng chính

### 1. Xử lý RPC Commands
- Nhận lệnh RPC từ MQTT broker (ThingsBoard hoặc Local EMQX)
- Hỗ trợ method `set_state` với các parameters
- Xử lý batch RPC requests
- Validation và conversion dữ liệu đầu vào

### 2. Điều khiển Modbus
- Hỗ trợ cả Modbus TCP và RTU
- Tương thích với nhiều loại board: STM32, ATMEGA, GENERIC
- Xử lý Holding Registers và Coils
- Retry logic với connection error handling
- Board-specific timeout configurations

### 3. Telemetry Data Management

#### **CÓ LOGIC LƯU TELEMETRY DATA**

Node này **có đầy đủ logic để lưu và publish telemetry data** thông qua các cơ chế sau:

#### a) Publish Result Data
```typescript
// Sau khi write thành công vào Modbus, node sẽ read back và publish
const readValue = await this.readFromModbusWithRetry(key, mapping);
this.mqttService.publishResult(key, readValue);
```

#### b) Publish Config Updates
```typescript
// Khi update configuration parameters
await this.mqttService.publishConfigUpdate(key, value);
```

#### c) Publish Multiple Values
```typescript
// Publish nhiều giá trị cùng lúc
await this.mqttService.publishMultipleValues(values, note);
```

#### d) Publish Error Status
```typescript
// Publish error messages khi có lỗi xảy ra
await this.mqttService.publishError(errorMessage);
```

### 4. MQTT Integration
- Kết nối với ThingsBoard hoặc Local EMQX broker
- Subscribe topic: `v1/devices/me/rpc/request/+` (ThingsBoard) hoặc `v1/devices/me/rpc/request/{deviceId}` (Local)
- Publish topic: `v1/devices/me/telemetry` (ThingsBoard) hoặc `v1/devices/me/telemetry/{deviceId}` (Local)
- Debouncing mechanism để tránh publish quá nhanh
- QoS level 1 cho reliability

## Input Parameters

### 1. RPC Message Structure
```json
{
  "method": "set_state",
  "params": {
    "parameter_key": "value",
    "another_key": "another_value"
  },
  "timeout": 5000
}
```

### 2. Configuration Keys
- Định nghĩa các parameter keys và data types (number, boolean, string)
- Được lưu trong global context: `configKeys`

### 3. Scale Configurations
```json
[
  {
    "key": "temperature",
    "operation": "multiply",
    "factor": 10,
    "direction": "write"
  }
]
```

### 4. Environment Variables
- `DEVICE_ID`: ID của thiết bị
- `MODBUS_*`: Các cấu hình Modbus (host, port, timeout, board type)
- `THINGSBOARD_*` / `EMQX_*`: Cấu hình MQTT broker

## Xử lý Logic

### 1. Parameter Processing Order
Node xử lý parameters theo thứ tự ưu tiên:
1. **Holding Registers** (setpoints, thời gian) - được thiết lập trước
2. **Coils** (enable/disable flags) - được kích hoạt sau
3. **Config-only parameters** - chỉ update configuration

### 2. Luoi Mapping Handler
- Xử lý đặc biệt cho `luoi_1`, `luoi_2`, `luoi_3`
- Mapping các lệnh luoi thành Modbus coil operations
- Có logic riêng để write trực tiếp vào Modbus

### 3. Value Validation & Conversion
- Type checking (number, boolean, string)
- Value scaling (multiply/divide operations)
- Range validation
- Error handling với detailed error messages

### 4. Modbus Operations

#### Write Operation Flow:
1. Validate input value
2. Apply scaling if configured
3. Write to Modbus with retry logic
4. Read back value for confirmation
5. Publish result via MQTT
6. Update node status

#### Error Handling:
- Connection timeout detection
- Board-specific timeout configurations
- Automatic reconnection attempts
- Detailed error logging

## Actions Thực hiện

### 1. Modbus Write Actions
- **Write Single Coil** (FC 5): Cho boolean values
- **Write Single Register** (FC 6): Cho numeric values
- **Read back verification**: Đọc lại giá trị sau khi write

### 2. MQTT Publish Actions

#### a) Result Publishing
```json
{
  "ts": 1640995200000,
  "parameter_key": 25.5,
  "status": "success"
}
```

#### b) Config Update Publishing
```json
{
  "ts": 1640995200000,
  "schedule_id": "abc123",
  "note": "Configuration updated"
}
```

#### c) Error Publishing
```json
{
  "ts": 1640995200000,
  "error": "Modbus connection timeout",
  "status": "error"
}
```

### 3. Context Updates
- **Flow Context**: Lưu RPC body, scale configs
- **Global Context**: Lưu config keys, values, Modbus mappings
- **Manual Overrides**: Lưu các override values với timestamp

### 4. Node Status Updates
- **Green dot**: Thành công (Ready, Published, Config updated)
- **Blue dot**: Đang xử lý (Message received, Processing)
- **Yellow ring**: Cảnh báo (Timeout)
- **Red ring**: Lỗi (Connection failed, Write failed)

## Telemetry Data Flow

```
RPC Input → Validation → Modbus Write → Read Back → MQTT Publish → Node Output
     ↓
Config Update → Context Storage → MQTT Publish
     ↓
Error Handling → Error Logging → Error MQTT Publish
```

## Board-Specific Configurations

### STM32 Boards
- Write Timeout: 3000ms
- Read Timeout: 3000ms
- Connection Timeout: 2000ms
- Max Retries: 2

### ATMEGA Boards
- Write Timeout: 8000ms (longer for slower response)
- Read Timeout: 8000ms
- Connection Timeout: 5000ms
- Max Retries: 3

### Generic Boards
- Write Timeout: 5000ms
- Read Timeout: 5000ms
- Connection Timeout: 3000ms
- Max Retries: 3

## Debouncing Mechanism

- **Debounce Time**: 200ms
- **Purpose**: Tránh publish MQTT quá nhanh khi có nhiều updates liên tiếp
- **Implementation**: Sử dụng setTimeout để delay publish
- **Override**: Có thể force publish immediate khi cần thiết

## Error Handling & Recovery

### 1. Connection Errors
- Automatic reconnection attempts
- Exponential backoff retry strategy
- Connection status monitoring

### 2. Timeout Errors
- Board-specific timeout detection
- Detailed error messages với board type
- Retry với increased timeout

### 3. Write/Read Errors
- Validation errors với specific messages
- Modbus protocol errors
- Value conversion errors

## Monitoring & Debugging

### 1. Logging Levels
- **ERROR**: Critical errors, connection failures
- **WARN**: Warnings, timeouts, retries
- **LOG**: Normal operations, successful writes
- **DEBUG**: Detailed debugging information

### 2. Status Indicators
- Node status colors và messages
- MQTT publish confirmations
- Connection status monitoring

### 3. Performance Metrics
- Pending publish count
- Retry attempt counts
- Connection uptime

## Kết luận

Node **viis-rpc-control** là một solution hoàn chỉnh cho việc:
- Nhận và xử lý RPC commands
- Điều khiển thiết bị qua Modbus
- **Lưu và publish telemetry data** một cách đáng tin cậy
- Error handling và recovery tự động
- Tương thích với nhiều loại hardware boards

Node này đặc biệt phù hợp cho các ứng dụng IoT cần điều khiển thiết bị từ xa và thu thập dữ liệu telemetry real-time.