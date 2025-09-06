# Undefined Parameter Filtering - Cải tiến RPC Handler

## Tổng quan

Cải tiến này giải quyết vấn đề khi RPC request chứa các tham số có giá trị `"undefined"` (string) hoặc `undefined` (actual undefined). Các tham số này sẽ được tự động loại bỏ trước khi xử lý, đảm bảo chỉ các tham số hợp lệ được gửi tới Modbus và MQTT.

## Vấn đề trước đây

```json
{
    "method": "set_state",
    "params": {
        "COIL_AUTO_TRON": true,
        "HOLDING_SETML_BOM_1": 400,
        "HOLDING_SETML_BOM_12": "undefined",
        "HOLDING_SETML_BOM_13": "undefined",
        "HOLDING_SETML_BOM_14": "undefined",
        "schedule_id": "21c6d14bfbc35218"
    }
}
```

**Vấn đề:**
- Các tham số có giá trị `"undefined"` vẫn được xử lý
- Gây lỗi khi validate và convert value
- Có thể ghi giá trị không mong muốn vào Modbus
- Làm ảnh hưởng đến các tham số hợp lệ khác

## Giải pháp đã triển khai

### 1. Thêm method `filterUndefinedParams`

```typescript
private filterUndefinedParams(params: Record<string, any>): Record<string, any> {
    const filteredParams: Record<string, any> = {};
    const filteredKeys: string[] = [];
    
    for (const [key, value] of Object.entries(params)) {
        // Filter out "undefined" string values and actual undefined values
        if (value === "undefined" || value === undefined) {
            filteredKeys.push(key);
            continue;
        }
        filteredParams[key] = value;
    }
    
    if (filteredKeys.length > 0) {
        this.logger.warn(`Filtered out parameters with undefined values: ${filteredKeys.join(", ")}`);
    }
    
    return filteredParams;
}
```

### 2. Cập nhật `handleSetStateRequest`

```typescript
private async handleSetStateRequest(params: Record<string, any>): Promise<void> {
    try {
        // Filter out parameters with "undefined" values
        const filteredParams = this.filterUndefinedParams(params);
        
        if (Object.keys(filteredParams).length === 0) {
            this.logger.warn("All parameters were filtered out due to undefined values");
            this.node.status({ fill: "yellow", shape: "ring", text: "No valid parameters" });
            return;
        }

        // Continue with filtered parameters...
        const hasLuoiMapping = await this.luoiHandler.processRpcBody(filteredParams);
        // ...
    } catch (error) {
        // Error handling
    }
}
```

## Các trường hợp xử lý

### Case 1: Mixed valid và undefined parameters

**Input:**
```json
{
    "COIL_AUTO_TRON": true,
    "HOLDING_SETML_BOM_1": 400,
    "HOLDING_SETML_BOM_12": "undefined",
    "HOLDING_SETML_BOM_13": "undefined",
    "schedule_id": "21c6d14bfbc35218"
}
```

**Output:**
```json
{
    "COIL_AUTO_TRON": true,
    "HOLDING_SETML_BOM_1": 400,
    "schedule_id": "21c6d14bfbc35218"
}
```

**Log:** `Filtered out parameters with undefined values: HOLDING_SETML_BOM_12, HOLDING_SETML_BOM_13`

### Case 2: Tất cả parameters đều undefined

**Input:**
```json
{
    "HOLDING_SETML_BOM_12": "undefined",
    "HOLDING_SETML_BOM_13": "undefined",
    "HOLDING_SETML_BOM_14": undefined
}
```

**Output:** `{}` (empty object)

**Behavior:** 
- Node status: `{ fill: "yellow", shape: "ring", text: "No valid parameters" }`
- Log: `All parameters were filtered out due to undefined values`
- Function returns early, không xử lý gì thêm

### Case 3: Không có undefined parameters

**Input:**
```json
{
    "COIL_AUTO_TRON": true,
    "HOLDING_SETML_BOM_1": 400,
    "schedule_id": "21c6d14bfbc35218"
}
```

**Output:** Giữ nguyên input (không filter gì)

**Behavior:** Xử lý bình thường như trước đây

## Tương thích ngược

### ✅ Hoàn toàn tương thích
- Không thay đổi API public
- Không ảnh hưởng đến RPC requests hợp lệ
- Chỉ cải thiện xử lý edge cases
- Existing functionality được bảo toàn 100%

### ✅ Cải tiến an toàn
- Không breaking changes
- Graceful handling của invalid parameters
- Better error messages và logging
- Improved system reliability

## Files được cập nhật

1. **`handlers/rpcHandler.ts`**
   - Thêm method `filterUndefinedParams()`
   - Cập nhật `handleSetStateRequest()`

2. **`viis-rpc-control-from-input.ts`**
   - Thêm function `filterUndefinedParams()`
   - Cập nhật `handleRpcRequest()`

## Testing

### Chạy test script
```bash
node test-undefined-filter.js
```

### Expected results
```
=== TEST CASE 1: Mixed valid and undefined parameters ===
Filtered out parameters with undefined values: HOLDING_SETML_BOM_12, HOLDING_SETML_BOM_13, HOLDING_SETML_BOM_14, HOLDING_SETML_BOM_15, HOLDING_SETML_BOM_16
Test 1 - Original: 22 params, Filtered: 17 params

=== TEST CASE 2: All parameters undefined ===
Filtered out parameters with undefined values: HOLDING_SETML_BOM_12, HOLDING_SETML_BOM_13, HOLDING_SETML_BOM_14, HOLDING_SETML_BOM_15
Test 2 - Original: 4 params, Filtered: 0 params

=== TEST CASE 3: No undefined parameters ===
Test 3 - Original: 4 params, Filtered: 4 params
```

## Monitoring & Debugging

### Log messages để theo dõi

**Info level:**
```
[WARN] Filtered out parameters with undefined values: HOLDING_SETML_BOM_12, HOLDING_SETML_BOM_13
[WARN] All parameters were filtered out due to undefined values
```

**Node status indicators:**
- `{ fill: "yellow", shape: "ring", text: "No valid parameters" }` - Khi tất cả params bị filter
- `{ fill: "green", shape: "dot", text: "Luoi commands processed" }` - Xử lý thành công

## Lợi ích

### 🛡️ Improved Reliability
- Tránh lỗi validation với undefined values
- Ngăn chặn ghi giá trị không mong muốn vào Modbus
- Bảo vệ hệ thống khỏi invalid data

### 📊 Better Observability
- Clear logging về việc filter parameters
- Node status indicators rõ ràng
- Easier debugging và monitoring

### 🔄 Maintained Functionality
- Các tham số hợp lệ vẫn được xử lý bình thường
- Thứ tự xử lý (holding registers → coils → config) được giữ nguyên
- Delay 1 giây giữa holding và coils vẫn hoạt động

## Kết luận

Cải tiến này đảm bảo RPC Handler xử lý robust và an toàn hơn với các RPC requests chứa undefined parameters, đồng thời duy trì hoàn toàn tương thích ngược và không ảnh hưởng đến performance của hệ thống.