# Schedule Executor - Audit Log Implementation

## Tổng quan

Hệ thống Device Audit Log đã được tích hợp vào **VIIS Schedule Executor** để ghi lại tất cả các thay đổi function key khi lịch trình thực thi. Điều này giúp truy vết lý do tại sao các thiết bị (pump, valve, etc.) được bật/tắt.

## Mục đích

- **Truy xuất lịch sử**: Khách hàng có thể biết được lịch trình nào đã thay đổi giá trị của function key
- **Giải quyết tranh chấp**: Tránh tình huống khách hàng thắc mắc "Tại sao bơm tự nhiên lại được bật?"
- **Debug & monitoring**: Dễ dàng debug các vấn đề liên quan đến schedule execution

## Luồng hoạt động

```
Schedule Start/End → Execute Modbus Commands → Publish Audit Log → ThingsBoard/EMQX → Backend Kafka Consumer → Database
```

## Telemetry Format

### Schedule Start

Khi lịch trình bắt đầu chạy:

```json
{
  "logs": {
    "from": "DEVICE_EXE_SCHEDULE",
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "message": "Lịch trình \"Tưới A1 sáng\" bắt đầu: pump_1=true, valve_A1=true, set_flow_A1=150",
    "metadata": {
      "status": "SUCCESS",
      "schedule_id": "schedule-001",
      "schedule_label": "Tưới A1 sáng",
      "action": "start",
      "changed_keys": [
        {
          "key": "pump_1",
          "value": true,
          "address": 0,
          "fc": 5
        },
        {
          "key": "valve_A1",
          "value": true,
          "address": 1,
          "fc": 5
        },
        {
          "key": "set_flow_A1",
          "value": 150,
          "address": 10,
          "fc": 6
        }
      ],
      "timestamp": 1699888888000,
      "error": null
    }
  }
}
```

### Schedule End (Success)

Khi lịch trình kết thúc thành công:

```json
{
  "logs": {
    "from": "DEVICE_EXE_SCHEDULE",
    "requestId": "550e8400-e29b-41d4-a716-446655440001",
    "message": "Lịch trình \"Tưới A1 sáng\" kết thúc: pump_1=false, valve_A1=false, set_flow_A1=0",
    "metadata": {
      "status": "SUCCESS",
      "schedule_id": "schedule-001",
      "schedule_label": "Tưới A1 sáng",
      "action": "end",
      "changed_keys": [
        {
          "key": "pump_1",
          "value": false,
          "address": 0,
          "fc": 5
        },
        {
          "key": "valve_A1",
          "value": false,
          "address": 1,
          "fc": 5
        },
        {
          "key": "set_flow_A1",
          "value": 0,
          "address": 10,
          "fc": 6
        }
      ],
      "timestamp": 1699892488000,
      "error": null
    }
  }
}
```

### Schedule End (Failure)

Khi lịch trình kết thúc nhưng không thể tắt thiết bị:

```json
{
  "logs": {
    "from": "DEVICE_EXE_SCHEDULE",
    "requestId": "550e8400-e29b-41d4-a716-446655440002",
    "message": "Lịch trình \"Tưới A1 sáng\" kết thúc thất bại: Không thể tắt thiết bị sau khi kết thúc lịch trình - Lỗi ghi Modbus",
    "metadata": {
      "status": "FAIL",
      "schedule_id": "schedule-001",
      "schedule_label": "Tưới A1 sáng",
      "action": "end",
      "changed_keys": [
        {
          "key": "pump_1",
          "value": false,
          "address": 0,
          "fc": 5
        }
      ],
      "timestamp": 1699892488000,
      "error": "Không thể tắt thiết bị sau khi kết thúc lịch trình - Lỗi ghi Modbus"
    }
  }
}
```

## Implementation Details

### 1. Method mới: `publishAuditLog()`

Location: `viis-schedule-executor-service.ts`

```typescript
async publishAuditLog(
    thingsboardClient: MqttClientCore,
    emqxClient: MqttClientCore,
    schedule: TabiotSchedule,
    action: 'start' | 'end',
    commands: { holdingCommands: ModbusCmd[], coilCommands: ModbusCmd[] },
    success: boolean = true,
    errorMessage?: string
): Promise<void>
```

**Parameters:**
- `thingsboardClient`: MQTT client để publish lên ThingsBoard
- `emqxClient`: MQTT client để publish lên EMQX local
- `schedule`: Schedule object đang được thực thi
- `action`: `'start'` hoặc `'end'` 
- `commands`: Danh sách các lệnh Modbus đã/sẽ thực thi
- `success`: `true` nếu thực thi thành công, `false` nếu thất bại
- `errorMessage`: Thông báo lỗi nếu `success = false`

### 2. Integration Points

#### Schedule Start
- Location: `viis-schedule-executor.ts` line ~532-550
- Trigger: Sau khi `executeModbusCommands()` và `verifyModbusWrite()` 
- Publishes: Danh sách function keys được SET (bật thiết bị)

#### Schedule End (Time-based)
- Location: `viis-schedule-executor.ts` line ~601-620
- Trigger: Khi schedule hết thời gian và `resetModbusCommands()` thành công
- Publishes: Danh sách function keys được RESET (tắt thiết bị)

#### Schedule End (RPC Disable)
- Location: `viis-schedule-executor.ts` line ~277-325
- Trigger: Khi user disable schedule qua RPC command
- Publishes: Danh sách function keys được RESET

## Control Types

Audit logs được ghi với `control_from = "DEVICE_EXE_SCHEDULE"`, mapping đến:

```typescript
enum ControlFrom {
  DEVICE_EXE_SCHEDULE = 'DEVICE_EXE_SCHEDULE'  // Lịch trên device thực thi
}

enum ControlType {
  SYSTEM = 'system'  // Hệ thống tự động (schedule)
}
```

## MQTT Topics

### ThingsBoard
```
Topic: v1/devices/me/telemetry
Payload: {"logs": {...}}
```

### EMQX Local
```
Topic: viis/things/v2/{DEVICE_ID}/telemetry
Payload: {"logs": {...}}
```

## Backend Processing

1. **Kafka Consumer** nhận message từ topic `device_latest_data`
2. **IoTDeviceService** detect datapoint `logs` 
3. **AuditLogService.processLogsFromDevice()** xử lý:
   - Parse logs value
   - Infer `controlType = SYSTEM` từ `from = DEVICE_EXE_SCHEDULE`
   - **UPSERT** vào database theo `requestId`

## Database Schema

```sql
CREATE TABLE device_audit_logs (
  id SERIAL PRIMARY KEY,
  request_id VARCHAR UNIQUE,
  message TEXT,
  device_id INTEGER REFERENCES tabiot_device(id),
  user_id INTEGER REFERENCES iot_customer_user(id),  -- NULL cho schedule
  logs JSONB,
  device_logs JSONB,
  control_from VARCHAR,  -- 'DEVICE_EXE_SCHEDULE'
  control_type VARCHAR,  -- 'system'
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

## Viewing Audit Logs

### API Endpoint
```bash
GET /api/v2/device-audit-logs/:deviceId
Query params:
  - start_time: ISO 8601 timestamp
  - end_time: ISO 8601 timestamp
  - control_from: DEVICE_EXE_SCHEDULE
```

### Example Response
```json
{
  "data": [
    {
      "id": 123,
      "request_id": "550e8400-e29b-41d4-a716-446655440000",
      "message": "Lịch trình \"Tưới A1 sáng\" bắt đầu: pump_1=true, valve_A1=true",
      "device": {
        "id": 1,
        "name": "device-001",
        "label": "Gateway A1"
      },
      "user": null,
      "control_from": "DEVICE_EXE_SCHEDULE",
      "control_type": "system",
      "device_logs": {
        "schedule_id": "schedule-001",
        "schedule_label": "Tưới A1 sáng",
        "action": "start",
        "changed_keys": [...]
      },
      "created_at": "2024-11-11T08:00:00Z"
    }
  ]
}
```

## Error Handling

- Audit log failures **DO NOT** break schedule execution
- Errors are logged với node.warn() nhưng schedule tiếp tục chạy
- Failed audit logs không được retry tự động

```typescript
try {
    await scheduleService.publishAuditLog(...);
} catch (auditError) {
    debugLog(`Failed to publish audit log: ${auditError.message}`);
    // Schedule execution continues
}
```

## Testing

### Manual Test

1. Tạo một schedule với action:
```json
{
  "pump_1": true,
  "valve_A1": true,
  "set_flow_A1": 150
}
```

2. Enable schedule và chờ thời gian start
3. Kiểm tra telemetry trên ThingsBoard
4. Kiểm tra database `device_audit_logs`

### Expected Logs

```
📝 AUDIT LOG PUBLISHED: schedule-001 | Action: start | Keys: 3 | Status: SUCCESS
📝 AUDIT LOG PUBLISHED: schedule-001 | Action: end | Keys: 3 | Status: SUCCESS
```

## Best Practices

1. **Always log audit**: Đảm bảo mọi schedule execution đều có audit log
2. **Meaningful messages**: Message phải rõ ràng về hành động và các key thay đổi
3. **Include metadata**: Luôn include schedule_id, schedule_label, changed_keys
4. **Handle failures**: Log cả success và failure cases
5. **Don't block execution**: Audit log failure không được làm gián đoạn schedule

## Troubleshooting

### Audit log không được ghi

**Kiểm tra:**
1. `KAFKA_ENV=PRODUCTION` trong environment
2. MQTT clients (ThingsBoard & EMQX) đã connected
3. Backend Kafka consumer đang chạy
4. ThingsBoard Rule Engine có publish vào Kafka topic `device_latest_data`

### Logs bị duplicate

**Nguyên nhân**: `requestId` collision (rất hiếm với UUID v4)

**Giải pháp**: Backend tự động UPSERT theo `requestId`, không có duplicate

### Message không đầy đủ

**Kiểm tra**: Đảm bảo `changed_keys` array không rỗng khi call `publishAuditLog()`

## Future Enhancements

- [ ] Batch publishing để giảm MQTT overhead
- [ ] Retry mechanism cho failed audit logs
- [ ] Real-time notification khi có audit log mới
- [ ] Dashboard để visualize schedule execution history

---

**Version:** 1.0  
**Last Updated:** 2024-11-11  
**Author:** VIIS IoT Backend Team
