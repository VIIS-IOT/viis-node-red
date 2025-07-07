# RPC Handler Sorting Improvement

## Tổng quan
Cải tiến RPC Handler để xử lý payload với nhiều keys theo thứ tự ưu tiên: **Holding Registers trước, sau đó Coils, cuối cùng là Config-only parameters**.

## Vấn đề trước đây
- RPC Handler xử lý các parameters theo thứ tự ngẫu nhiên trong `Object.entries(params)`
- Không có sắp xếp thứ tự ưu tiên giữa các loại Modbus commands
- Có thể gây ra vấn đề khi cần thực hiện holding registers trước coils

## Giải pháp đã triển khai

### 1. Cải tiến `handleStandardParams` method
```typescript
private async handleStandardParams(params: Record<string, any>): Promise<void> {
    // Phân loại parameters thành 3 nhóm
    const holdingParams: Array<[string, any]> = [];
    const coilParams: Array<[string, any]> = [];
    const configParams: Array<[string, any]> = [];
    
    // Xử lý theo thứ tự: Holding -> Coils -> Config
    for (const [key, rawValue] of holdingParams) {
        await this.processParameter(key, rawValue);
    }
    
    for (const [key, rawValue] of coilParams) {
        await this.processParameter(key, rawValue);
    }
    
    for (const [key, rawValue] of configParams) {
        await this.processParameter(key, rawValue);
    }
}
```

### 2. Thêm methods mới vào ModbusService
```typescript
/**
 * Get modbus holding registers mapping
 */
getModbusHoldingRegisters(): Record<string, number> {
    return this.environmentConfig.modbusHoldingRegisters || {};
}

/**
 * Get modbus coils mapping
 */
getModbusCoils(): Record<string, number> {
    return this.environmentConfig.modbusCoils || {};
}
```

### 3. Cập nhật IModbusService interface
```typescript
export interface IModbusService {
    // ... existing methods
    getModbusHoldingRegisters(): Record<string, number>;
    getModbusCoils(): Record<string, number>;
}
```

## Luồng xử lý mới

### Ví dụ payload:
```json
{
    "method": "set_state",
    "params": {
        "COIL_AUTO_TRON": 1,
        "HOLDING_THOI_GIAN_TRON_TOI_DA": 200,
        "schedule_id": "683d312bdfc82ffc"
    },
    "timeout": 5000
}
```

### Thứ tự xử lý:
1. **Holding Registers** (ưu tiên cao nhất)
   - `HOLDING_THOI_GIAN_TRON_TOI_DA`: 200

2. **Coils** (ưu tiên trung bình)
   - `COIL_AUTO_TRON`: 1

3. **Config-only parameters** (ưu tiên thấp nhất)
   - `schedule_id`: "683d312bdfc82ffc"

## Lợi ích

### 1. Thứ tự xử lý có logic
- Holding registers (thường là setpoints, thời gian) được thiết lập trước
- Coils (thường là enable/disable) được kích hoạt sau
- Config parameters được cập nhật cuối cùng

### 2. Tránh xung đột
- Đảm bảo các giá trị cấu hình được thiết lập trước khi kích hoạt
- Giảm thiểu khả năng xung đột giữa các lệnh Modbus

### 3. Logging rõ ràng
```
Processing parameters - Holding: 1, Coils: 1, Config: 1
```

### 4. Xử lý đặc biệt cho schedule_id
- `schedule_id` luôn được xử lý như config parameter
- Không bị nhầm lẫn với Modbus parameters

## Tương thích ngược
- Hoàn toàn tương thích với code hiện tại
- Không thay đổi API public
- Chỉ cải thiện thứ tự xử lý nội bộ

## Testing

### Test case 1: Mixed parameters
```json
{
    "COIL_BOM_TRON": 1,
    "HOLDING_THOI_GIAN_TRON": 300,
    "COIL_AUTO_TRON": 1,
    "schedule_id": "test123"
}
```

**Expected order:**
1. `HOLDING_THOI_GIAN_TRON`: 300
2. `COIL_BOM_TRON`: 1
3. `COIL_AUTO_TRON`: 1
4. `schedule_id`: "test123"

### Test case 2: Only coils
```json
{
    "COIL_AUTO_TRON": 1,
    "COIL_BOM_TRON": 0
}
```

**Expected order:**
1. `COIL_AUTO_TRON`: 1
2. `COIL_BOM_TRON`: 0

## Monitoring

### Log messages để theo dõi:
```
[INFO] Processing parameters - Holding: 2, Coils: 3, Config: 1
[INFO] Processing Modbus parameter: key=HOLDING_TEMP_SETPOINT, rawValue=25
[INFO] Processing Modbus parameter: key=COIL_AUTO_MODE, rawValue=1
[INFO] Config-only parameter validated: schedule_id=abc123
```

## Kết luận
Cải tiến này đảm bảo RPC Handler xử lý các parameters theo thứ tự logic và an toàn, giảm thiểu xung đột và cải thiện độ tin cậy của hệ thống.