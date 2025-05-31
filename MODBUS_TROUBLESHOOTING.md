# Modbus Connection Troubleshooting Guide

## Lỗi "Port Not Open" - Nguyên nhân và Giải pháp

### Nguyên nhân chính:

1. **Thiết bị Modbus không kết nối**: Thiết bị Modbus (PLC, sensor, etc.) không được kết nối hoặc không hoạt động
2. **Cấu hình sai**: IP address, port, hoặc serial port không đúng
3. **Network issues**: Mạng bị gián đoạn hoặc firewall chặn kết nối
4. **Modbus server không chạy**: Thiết bị đích không có Modbus server đang chạy

### Các bước kiểm tra và khắc phục:

#### 1. Kiểm tra cấu hình Modbus

Kiểm tra file `.env` hoặc environment variables:

```bash
# TCP Modbus
MODBUS_TYPE=TCP
MODBUS_HOST=192.168.1.100  # IP của thiết bị Modbus
MODBUS_TCP_PORT=502        # Port Modbus (mặc định 502)
MODBUS_UNIT_ID=1           # Unit ID của thiết bị
MODBUS_TIMEOUT=5000        # Timeout (ms)

# RTU Modbus (qua serial)
MODBUS_TYPE=RTU
MODBUS_SERIAL_PORT=/dev/ttyUSB0
MODBUS_BAUD_RATE=9600
MODBUS_PARITY=none
```

#### 2. Test kết nối mạng (cho TCP Modbus)

```bash
# Ping thiết bị
ping 192.168.1.100

# Test port Modbus
telnet 192.168.1.100 502
# hoặc
nc -zv 192.168.1.100 502
```

#### 3. Kiểm tra thiết bị Modbus

- Đảm bảo thiết bị đang bật và hoạt động
- Kiểm tra LED status trên thiết bị
- Xác nhận Modbus server đang chạy trên thiết bị

#### 4. Kiểm tra log Node-RED

Trong Node-RED debug panel, tìm các log:

```
Modbus Configuration: {
  "type": "TCP",
  "host": "192.168.1.100",
  "tcpPort": 502,
  ...
}
```

#### 5. Test với Modbus client khác

Sử dụng công cụ như:
- **ModbusPoll** (Windows)
- **QModMaster** (Linux/Windows)
- **mbpoll** (command line)

```bash
# Test với mbpoll
mbpoll -m tcp -a 1 -r 1 -c 1 192.168.1.100
```

### Cải tiến đã thực hiện:

1. **Validation cấu hình**: Kiểm tra cấu hình trước khi kết nối
2. **Better error handling**: Xử lý lỗi chi tiết hơn với thông báo rõ ràng
3. **Connection checking**: Kiểm tra kết nối trước khi thực hiện RPC
4. **Auto-reconnection**: Tự động thử kết nối lại khi mất kết nối
5. **Detailed logging**: Log chi tiết để debug

### Monitoring và Debug:

#### Bật debug logging:
Trong Node-RED, set log level thành debug để xem chi tiết:

```javascript
// Trong node configuration
logger.setLevel("debug");
```

#### Kiểm tra connection status:
Node sẽ hiển thị status:
- 🟢 **Connected**: Kết nối thành công
- 🔴 **Modbus disconnected**: Mất kết nối Modbus
- 🟡 **Connecting**: Đang kết nối

### Các lỗi thường gặp khác:

1. **"Timed out"**: Thiết bị không phản hồi trong thời gian timeout
2. **"ECONNREFUSED"**: Thiết bị từ chối kết nối (port sai hoặc service không chạy)
3. **"EHOSTUNREACH"**: Không thể reach được thiết bị (network issue)

### Khuyến nghị:

1. **Sử dụng static IP** cho thiết bị Modbus
2. **Đặt timeout hợp lý** (5-10 giây)
3. **Monitor connection status** thường xuyên
4. **Backup configuration** và test trước khi deploy
5. **Sử dụng UPS** cho thiết bị quan trọng

### Support:

Nếu vẫn gặp vấn đề, cung cấp thông tin:
- Modbus configuration (ẩn sensitive info)
- Full error log
- Loại thiết bị Modbus đang sử dụng
- Network topology
