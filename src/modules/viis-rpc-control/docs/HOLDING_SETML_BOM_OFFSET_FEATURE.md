# HOLDING_SETML_BOM Offset Feature Documentation

## Tổng quan

Tính năng **HOLDING_SETML_BOM Offset** là một special case logic được thiết kế để tự động cộng thêm một giá trị offset vào các lệnh RPC control khi ghi giá trị cho các key có prefix `HOLDING_SETML_BOM_`.

## Đặc điểm chính

### 1. Decoupled Design
- Tính năng được thiết kế độc lập, không ảnh hưởng đến logic chung của RPC control
- Có thể dễ dàng bật/tắt thông qua cấu hình
- Không làm thay đổi cấu trúc code hiện tại

### 2. Automatic Offset Application
- Tự động áp dụng offset khi ghi giá trị vào Modbus holding registers
- Chỉ áp dụng cho các key được định nghĩa trong danh sách offset
- Chỉ áp dụng cho giá trị số (number), không áp dụng cho boolean

## Cấu hình

### Bật/Tắt tính năng

Trong file `constants.ts`:

```typescript
export const HOLDING_SETML_BOM_OFFSETS = {
    // Bật/tắt tính năng
    ENABLED: true, // Đặt false để tắt
    
    // Các giá trị offset
    OFFSETS: {
        "HOLDING_SETML_BOM_1": 34,
        "HOLDING_SETML_BOM_2": 55,
        // ... các key khác
    }
};
```

### Danh sách Offset hiện tại

| Key | Offset Value |
|-----|-------------|
| HOLDING_SETML_BOM_1 | 34 |
| HOLDING_SETML_BOM_2 | 55 |
| HOLDING_SETML_BOM_3 | 35 |
| HOLDING_SETML_BOM_4 | 48 |
| HOLDING_SETML_BOM_5 | 31 |
| HOLDING_SETML_BOM_6 | 39 |
| HOLDING_SETML_BOM_7 | 38 |
| HOLDING_SETML_BOM_8 | 39 |
| HOLDING_SETML_BOM_9 | 33 |
| HOLDING_SETML_BOM_10 | 37 |
| HOLDING_SETML_BOM_11 | 33 |
| HOLDING_SETML_BOM_12 | 37 |
| HOLDING_SETML_BOM_13 | 34 |
| HOLDING_SETML_BOM_14 | 56 |

## Cách hoạt động

### 1. Flow xử lý

1. **RPC Request nhận được**: `{"HOLDING_SETML_BOM_1": 100}`
2. **Kiểm tra offset**: Tìm offset cho key `HOLDING_SETML_BOM_1` = 34
3. **Áp dụng offset**: 100 + 34 = 134
4. **Áp dụng scaling** (nếu có): Scaling được áp dụng sau offset
5. **Ghi vào Modbus**: Giá trị cuối cùng được ghi vào Modbus
6. **Logging**: Log chi tiết quá trình áp dụng offset

### 2. Thứ tự xử lý

```
Original Value → Offset Application → Scaling → Modbus Write
```

### 3. Ví dụ cụ thể

```typescript
// RPC Request
{
    "method": "set_state",
    "params": {
        "HOLDING_SETML_BOM_1": 100,
        "HOLDING_SETML_BOM_2": 200
    }
}

// Xử lý:
// HOLDING_SETML_BOM_1: 100 + 34 = 134
// HOLDING_SETML_BOM_2: 200 + 55 = 255

// Kết quả ghi vào Modbus: 134 và 255
```

## API Methods

### ModbusService Methods

```typescript
// Kiểm tra tính năng có được bật không
isHoldingSetmlBomOffsetEnabled(): boolean

// Lấy offset value cho một key cụ thể
getHoldingSetmlBomOffset(key: string): number | null

// Lấy toàn bộ cấu hình offset
getHoldingSetmlBomOffsetConfig(): typeof HOLDING_SETML_BOM_OFFSETS
```

### Sử dụng API

```typescript
// Kiểm tra tính năng
if (modbusService.isHoldingSetmlBomOffsetEnabled()) {
    console.log("Offset feature is enabled");
}

// Lấy offset cho key cụ thể
const offset = modbusService.getHoldingSetmlBomOffset("HOLDING_SETML_BOM_1");
if (offset !== null) {
    console.log(`Offset for HOLDING_SETML_BOM_1: ${offset}`);
}

// Lấy toàn bộ cấu hình
const config = modbusService.getHoldingSetmlBomOffsetConfig();
console.log("Offset configuration:", config);
```

## Logging

### Log Messages

Khi offset được áp dụng, sẽ có log message:

```
[OFFSET] Applied offset to HOLDING_SETML_BOM_1: 100 + 34 = 134
```

### Debug Information

Các log này giúp:
- Theo dõi quá trình áp dụng offset
- Debug khi có vấn đề với giá trị
- Xác nhận offset đã được áp dụng đúng

## Lưu ý quan trọng

### 1. Chỉ áp dụng cho Holding Registers
- Tính năng chỉ hoạt động với holding registers (FC 6)
- Không áp dụng cho coils hoặc input registers

### 2. Chỉ áp dụng cho giá trị số
- Offset chỉ được cộng vào giá trị number
- Boolean values không bị ảnh hưởng

### 3. Thứ tự xử lý
- Offset được áp dụng TRƯỚC scaling
- Điều này đảm bảo scaling hoạt động trên giá trị đã được offset

### 4. Backward Compatibility
- Tính năng không ảnh hưởng đến các key khác
- Có thể tắt hoàn toàn mà không ảnh hưởng hệ thống

## Troubleshooting

### 1. Offset không được áp dụng

**Kiểm tra:**
- `HOLDING_SETML_BOM_OFFSETS.ENABLED` có được set `true`?
- Key có tồn tại trong `HOLDING_SETML_BOM_OFFSETS.OFFSETS`?
- Giá trị có phải là number không?

### 2. Giá trị không đúng sau khi ghi

**Kiểm tra:**
- Log message `[OFFSET]` để xem offset có được áp dụng
- Kiểm tra scaling configuration
- Xác nhận thứ tự: offset → scaling → modbus write

### 3. Tắt tính năng tạm thời

```typescript
// Trong constants.ts
export const HOLDING_SETML_BOM_OFFSETS = {
    ENABLED: false, // Tắt tính năng
    OFFSETS: {
        // ... giữ nguyên cấu hình
    }
};
```

## Mở rộng tương lai

### 1. Dynamic Configuration
- Có thể mở rộng để load offset từ environment variables
- Hỗ trợ cập nhật offset runtime

### 2. More Key Patterns
- Có thể mở rộng cho các pattern key khác
- Hỗ trợ regex matching cho key names

### 3. Conditional Offsets
- Áp dụng offset dựa trên điều kiện
- Offset khác nhau cho các device types