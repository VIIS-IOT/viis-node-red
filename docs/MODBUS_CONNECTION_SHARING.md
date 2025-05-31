# Modbus Connection Sharing trong VIIS Node-RED

## Tổng quan

Hệ thống VIIS Node-RED đã được thiết kế để tự động chia sẻ modbus connection giữa nhiều node VIIS Modbus Getter. Điều này đảm bảo rằng chỉ có **1 connection duy nhất** tới modbus server, tránh vượt quá giới hạn connection của server.

## Cách thức hoạt động

### 1. ClientRegistry - Quản lý Connection Sharing

`ClientRegistry` là singleton class chịu trách nhiệm quản lý tất cả các shared connection:

```typescript
class ClientRegistry {
    private static modbusInstance: ModbusClientCore | null = null;
    private static modbusConfig: ModbusConfig | null = null;
    private static referenceCount = { modbus: 0 };
    private static clientUsers = { modbus: new Set<string>() };
}
```

### 2. Quy trình khởi tạo Node

Khi một VIIS Modbus Getter node được khởi tạo:

1. **Node đầu tiên**:
   - Tạo modbus connection mới
   - Lưu config làm "shared config"
   - Reference count = 1

2. **Các node tiếp theo**:
   - Sử dụng lại connection đã có
   - Kiểm tra config compatibility
   - Reference count tăng lên

3. **Khi node bị xóa**:
   - Reference count giảm
   - Chỉ disconnect khi count = 0

### 3. Config Validation

Hệ thống sẽ validate config của các node:

- **Config khớp**: Sử dụng shared connection bình thường
- **Config khác**: Hiển thị warning nhưng vẫn sử dụng shared connection với config của node đầu tiên

```
[MODBUS-CONFIG-MISMATCH] Node abc123 config differs from shared config:
  Existing: TCP 192.168.1.100:502 unit=1
  Requested: TCP 192.168.1.101:502 unit=1
  Using existing shared connection with config from first node.
```

## Logging và Monitoring

### Connection Status Logs

```
[MODBUS-INIT] Node abc123 got Modbus client, ref count: 2
[MODBUS-INIT] Active users: node1, node2
[MODBUS-INIT] Shared connection config: TCP 192.168.1.100:502
```

### Release Logs

```
[MODBUS-RELEASE] Node abc123 released Modbus client, ref count: 1
Disconnected and cleared ModbusClientCore instance and config
```

## Lợi ích

### 1. Tiết kiệm Resource
- Chỉ 1 TCP connection tới modbus server
- Giảm tải cho modbus server
- Tránh connection limit issues

### 2. Tự động quản lý
- Không cần config thủ công
- Tự động cleanup khi không sử dụng
- Thread-safe với mutex protection

### 3. Debugging dễ dàng
- Detailed logging cho connection sharing
- Hiển thị reference count và active users
- Warning khi có config mismatch

## Best Practices

### 1. Sử dụng cùng config
Đảm bảo tất cả VIIS Modbus Getter node sử dụng cùng modbus config:
- Host/IP address
- Port
- Unit ID
- Connection type (TCP/RTU)

### 2. Monitor logs
Kiểm tra Node-RED debug logs để:
- Xác nhận connection sharing hoạt động
- Phát hiện config mismatch
- Theo dõi reference count

### 3. Testing
Khi test với nhiều node:
1. Deploy node đầu tiên
2. Kiểm tra connection established
3. Deploy thêm node khác
4. Xác nhận reference count tăng
5. Xóa node và kiểm tra cleanup

## Troubleshooting

### Connection không được share
- Kiểm tra logs cho config mismatch
- Đảm bảo tất cả node sử dụng cùng environment variables
- Restart Node-RED nếu cần

### Memory leaks
- Kiểm tra reference count giảm khi xóa node
- Xác nhận connection được disconnect khi count = 0
- Monitor active connections logs

### Performance issues
- Kiểm tra số lượng concurrent requests
- Monitor modbus server response time
- Xem xét implement request queuing nếu cần

## Kết luận

Hệ thống connection sharing đã được implement và hoạt động tự động. Bạn chỉ cần:

1. **Deploy nhiều VIIS Modbus Getter node** với cùng config
2. **Kiểm tra logs** để xác nhận connection sharing
3. **Monitor reference count** để đảm bảo cleanup đúng cách

Hệ thống sẽ tự động đảm bảo chỉ có 1 connection tới modbus server, giải quyết vấn đề giới hạn connection.
