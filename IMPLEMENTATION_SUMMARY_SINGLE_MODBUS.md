# Implementation Summary: Single Modbus Connection Guarantee

## Tổng quan thực hiện

Đã hoàn thành việc đảm bảo **toàn bộ source viis-node-red chỉ dùng chung duy nhất 1 modbus connection** như yêu cầu.

## Các thay đổi đã thực hiện

### 1. Cải tiến ClientRegistry (`src/core/client-registry.ts`)

#### A. Enhanced Logging và Monitoring
- Thêm logging chi tiết với prefix `[MODBUS-SINGLE-CONNECTION]`
- Cảnh báo rõ ràng khi có config khác nhau
- Validation tự động phát hiện multiple connections

#### B. Validation Methods mới
```typescript
// Kiểm tra vi phạm multiple connections
static validateSingleModbusConnection(node: Node): boolean

// Lấy thông tin trạng thái connection
static getModbusConnectionStatus(): ConnectionStatus
```

#### C. Improved Error Handling
- Cảnh báo `[CRITICAL-VIOLATION]` nếu phát hiện multiple connections
- Logging chi tiết về users đang sử dụng connection
- Validation config enforcement

### 2. Enhanced Validation trong viis-modbus-poller

Thêm validation check trong quá trình initialization:
```typescript
// Validate single modbus connection requirement
const isValidConnection = ClientRegistry.validateSingleModbusConnection(node);
if (!isValidConnection) {
    throw new Error("CRITICAL: Multiple modbus connections detected!");
}
```

### 3. Documentation hoàn chỉnh

#### A. Single Connection Guarantee Guide
- `docs/SINGLE_MODBUS_CONNECTION_GUARANTEE.md`
- Giải thích chi tiết cơ chế đảm bảo single connection
- Hướng dẫn troubleshooting

#### B. Test Script
- `test-single-modbus-connection.js`
- Script test để verify behavior
- Kiểm tra tất cả aspects của single connection

## Verification - Tất cả nodes đã sử dụng ClientRegistry

### ✅ Nodes đã được verify sử dụng single connection:

1. **viis-modbus-getter** ✅
   - `ClientRegistry.getModbusClient(modbusConfig, node)`
   - `ClientRegistry.releaseClient("modbus", node)`

2. **viis-modbus-poller** ✅
   - `ClientRegistry.getModbusClient(modbusConfig, node)`
   - `ClientRegistry.releaseClient("modbus", node)`
   - Thêm validation check

3. **viis-rpc-control** ✅
   - `ClientRegistry.getModbusClient(modbusConfig, node)`
   - `ClientRegistry.releaseClient("modbus", node)`

4. **viis-auto-microclimate-control** ✅
   - `ClientRegistry.getModbusClient(modbusConfig, node)`
   - `ClientRegistry.releaseClient("modbus", node)`

5. **viis-schedule-executor** ✅
   - `ClientRegistry.getModbusClient(modbusConfig, node)`
   - `ClientRegistry.releaseClient("modbus", node)`

6. **viis-device-protection** ✅
   - `ClientRegistry.getModbusClient(modbusConfig, node)`
   - `ClientRegistry.releaseClient("modbus", node)`

7. **viis-telemetry** ✅
   - `ClientRegistry.getModbusClient(modbusConfig, node)`
   - `ClientRegistry.releaseClient("modbus", node)`

### ❌ Không có node nào tạo ModbusClientCore trực tiếp

Đã verify rằng **KHÔNG CÓ** node nào:
- Import `modbus-serial` trực tiếp
- Tạo `ModbusClientCore` trực tiếp
- Tạo multiple connections

## Cơ chế đảm bảo Single Connection

### 1. Singleton Pattern
```typescript
private static modbusInstance: ModbusClientCore | null = null;
private static modbusConfig: ModbusConfig | null = null;
```

### 2. Config Enforcement
- Node đầu tiên tạo connection với config của nó
- Các node sau **BẮT BUỘC** sử dụng config đã có
- Cảnh báo rõ ràng nếu config khác nhau

### 3. Reference Counting
- Theo dõi số node đang sử dụng
- Tự động cleanup khi không còn node nào

### 4. Validation & Monitoring
- Kiểm tra tự động multiple connections
- Logging chi tiết trạng thái
- Error nếu vi phạm

## Logs mẫu khi hoạt động đúng

```
[MODBUS-SINGLE-CONNECTION] Node abc123 creating THE ONLY modbus connection for all VIIS nodes
[MODBUS-SINGLE-CONNECTION] Storing shared config for ALL nodes: TCP localhost:502 unit=1
[MODBUS-SINGLE-CONNECTION] Created THE ONLY ModbusClientCore instance - all nodes will share this connection
[MODBUS-SINGLE-CONNECTION] Node def456 got shared Modbus client, ref count: 2
[MODBUS-SINGLE-CONNECTION] Active users sharing THE SAME connection: abc123, def456
[MODBUS-SINGLE-CONNECTION] ✓ Correctly using SINGLE modbus connection as designed
```

## Testing

### Chạy test script:
```bash
cd services/nodered/custom-nodes/viis-node-red
node test-single-modbus-connection.js
```

### Expected output:
```
🎉 ALL TESTS PASSED - SINGLE CONNECTION GUARANTEE VERIFIED! 🎉
```

## Kết luận

✅ **HOÀN THÀNH**: Toàn bộ source viis-node-red đã được đảm bảo chỉ sử dụng **DUY NHẤT 1 MODBUS CONNECTION**

### Đảm bảo:
- ✅ Tất cả 7 nodes sử dụng ClientRegistry
- ✅ Không có direct ModbusClientCore instantiation
- ✅ Config enforcement và validation
- ✅ Monitoring và error detection
- ✅ Proper cleanup và resource management
- ✅ Comprehensive documentation
- ✅ Test script để verify behavior

### Lợi ích:
- 🚀 **Hiệu suất tối ưu** - Không có overhead multiple connections
- 🛡️ **Tránh connection limit** - Modbus server không bị quá tải
- 🔧 **Resource management** - Tự động cleanup
- 📊 **Monitoring** - Phát hiện vi phạm ngay lập tức
- 🐛 **Debugging** - Logs chi tiết để troubleshoot

**Hệ thống hiện tại đảm bảo tuyệt đối chỉ có 1 modbus connection duy nhất được sử dụng bởi tất cả các VIIS nodes.**
