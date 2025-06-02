# Single Modbus Connection Guarantee trong VIIS Node-RED

## Tổng quan

Hệ thống VIIS Node-RED được thiết kế để **ĐẢM BẢO CHỈ SỬ DỤNG DUY NHẤT 1 MODBUS CONNECTION** cho tất cả các node. Điều này rất quan trọng để:

1. **Tránh vượt quá giới hạn connection** của modbus server
2. **Đảm bảo hiệu suất tối ưu** và tránh xung đột
3. **Quản lý tài nguyên hiệu quả** và tránh memory leak
4. **Đảm bảo tính nhất quán** trong giao tiếp modbus

## Cơ chế đảm bảo Single Connection

### 1. ClientRegistry - Singleton Pattern

`ClientRegistry` là singleton class chịu trách nhiệm quản lý **DUY NHẤT 1 MODBUS CONNECTION**:

```typescript
class ClientRegistry {
    private static modbusInstance: ModbusClientCore | null = null;
    private static modbusConfig: ModbusConfig | null = null;
    private static referenceCount = { modbus: 0 };
    private static activeConnections = { modbus: 0 };
    private static clientUsers = { modbus: new Set<string>() };
}
```

### 2. Config Validation - Enforced Consistency

Khi một node yêu cầu modbus client với config khác, hệ thống sẽ:

- **CẢNH BÁO** về sự khác biệt config
- **BẮT BUỘC** sử dụng config của connection đầu tiên
- **KHÔNG TẠO** connection mới

```typescript
private static validateModbusConfig(config: ModbusConfig, node: Node): boolean {
    // Kiểm tra và cảnh báo nếu config khác nhau
    // LUÔN sử dụng config của connection đầu tiên
}
```

### 3. Reference Counting - Automatic Cleanup

Hệ thống theo dõi số lượng node đang sử dụng connection:

- **Tăng reference count** khi node yêu cầu client
- **Giảm reference count** khi node release client
- **Tự động disconnect** khi không còn node nào sử dụng

## Các Node sử dụng Modbus

Tất cả các node sau đây đều sử dụng **CÙNG 1 MODBUS CONNECTION**:

### ✅ Nodes đã được verify:

1. **viis-modbus-getter** - Đọc dữ liệu modbus theo yêu cầu
2. **viis-modbus-poller** - Polling dữ liệu modbus định kỳ
3. **viis-rpc-control** - Điều khiển thiết bị qua RPC
4. **viis-auto-microclimate-control** - Điều khiển tự động vi khí hậu
5. **viis-schedule-executor** - Thực thi lịch trình
6. **viis-device-protection** - Bảo vệ thiết bị
7. **viis-telemetry** - Thu thập và gửi telemetry

### Cách sử dụng trong mỗi node:

```typescript
// Tất cả nodes đều sử dụng pattern này
const modbusClient = ClientRegistry.getModbusClient(modbusConfig, node);

// Khi node đóng
node.on('close', (done) => {
    ClientRegistry.releaseClient("modbus", node);
    done();
});
```

## Monitoring và Validation

### 1. Logging chi tiết

Hệ thống log chi tiết về trạng thái connection:

```
[MODBUS-SINGLE-CONNECTION] Node abc123 creating THE ONLY modbus connection for all VIIS nodes
[MODBUS-SINGLE-CONNECTION] Created THE ONLY ModbusClientCore instance - all nodes will share this connection
[MODBUS-SINGLE-CONNECTION] Node def456 got shared Modbus client, ref count: 2
[MODBUS-SINGLE-CONNECTION] Active users sharing THE SAME connection: abc123, def456
```

### 2. Validation tự động

```typescript
// Kiểm tra vi phạm multiple connections
static validateSingleModbusConnection(node: Node): boolean {
    const isValid = this.activeConnections.modbus <= 1;
    if (!isValid) {
        node.error(`[CRITICAL-VIOLATION] MULTIPLE MODBUS CONNECTIONS DETECTED!`);
    }
    return isValid;
}
```

### 3. Status monitoring

```typescript
// Lấy thông tin trạng thái connection
static getModbusConnectionStatus(): {
    hasConnection: boolean;
    activeConnections: number;
    referenceCount: number;
    users: string[];
    config: ModbusConfig | null;
}
```

## Cảnh báo quan trọng

### ❌ KHÔNG BAO GIỜ làm những việc sau:

1. **Tạo ModbusClientCore trực tiếp** - Luôn dùng ClientRegistry
2. **Import modbus-serial trực tiếp** trong nodes - Dùng ClientRegistry
3. **Tạo multiple connections** - Hệ thống sẽ cảnh báo và ngăn chặn

### ✅ LUÔN làm những việc sau:

1. **Sử dụng ClientRegistry.getModbusClient()** để lấy client
2. **Gọi ClientRegistry.releaseClient()** khi node đóng
3. **Kiểm tra logs** để đảm bảo chỉ có 1 connection

## Troubleshooting

### Nếu thấy cảnh báo "MULTIPLE MODBUS CONNECTIONS":

1. **Kiểm tra logs** để xác định nodes nào tạo multiple connections
2. **Restart Node-RED** để reset về trạng thái clean
3. **Kiểm tra code** để đảm bảo tất cả nodes đều dùng ClientRegistry

### Nếu connection không hoạt động:

1. **Kiểm tra config** trong environment variables
2. **Xem logs** để tìm lỗi connection
3. **Verify** rằng modbus server đang chạy và accessible

## Kết luận

Hệ thống VIIS Node-RED đã được thiết kế và implement để **ĐẢM BẢO TUYỆT ĐỐI** chỉ sử dụng 1 modbus connection duy nhất. Tất cả các node modbus đều:

- ✅ Sử dụng ClientRegistry
- ✅ Chia sẻ cùng 1 connection
- ✅ Có monitoring và validation
- ✅ Tự động cleanup khi không cần thiết

**Hệ thống này đảm bảo hiệu suất tối ưu và tránh mọi vấn đề liên quan đến multiple modbus connections.**
