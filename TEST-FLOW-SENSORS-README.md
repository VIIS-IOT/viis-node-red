# Test Flow Sensors Script

Script JavaScript để test đọc dữ liệu từ 6 flow sensors DH6400 thông qua Modbus RTU.

## Mô tả

Script này là bản JavaScript tương đương với `read_flow_sensors.py` ở root folder. Được tạo để test trước khi implement vào custom nodes.

## Cấu hình Flow Sensor

- **Model**: DH6400
- **Slave IDs**: 01-06 (6 sensors)
- **Baudrate**: 9600
- **Parity**: None
- **Data bits**: 8
- **Stop bits**: 1
- **Function Code**: 03 (Read Holding Registers)
- **Starting Address**: 0x0000
- **Quantity**: 10 registers

## Cài đặt

Trước khi chạy script, cần cài đặt dependency `serialport`:

```bash
cd /home/fuel-iot/viis-local-docker/services/nodered/custom-nodes/viis-node-red
npm install serialport
```

## Sử dụng

### 1. Test với sample data (không cần serial port)

```bash
node test-flow-sensors.js test
```

Lệnh này sẽ test parsing function với sample data:
- Response: `010314000000010284064000000001028A064000000000271F`

### 2. Đọc thực tế từ serial port

```bash
# Cần quyền sudo để access serial port
sudo node test-flow-sensors.js /dev/ttyACM0
```

Thay `/dev/ttyACM0` bằng serial port phù hợp trên hệ thống của bạn.

**Lưu ý về quyền truy cập serial port:**

Nếu gặp lỗi permission denied, thêm user vào group `dialout`:

```bash
sudo usermod -a -G dialout $USER
```

Sau đó logout và login lại.

## Output mẫu

### Test mode:

```
══════════════════════════════════════════════════════════════════
🧪 TESTING PARSE FUNCTION WITH SAMPLE DATA
══════════════════════════════════════════════════════════════════
Sample response: 010314000000010284064000000001028A064000000000271F

✅ Parsed Data:
  ├─ Slave ID                : 1
  ├─ Function Code           : 03
  ├─ Length                  : 20
  ├─ Instantaneous Flow      : 1.6600 m³/h
  │   (Integer: 1 ÷ 1000, Decimal: 6600 ÷ 10000)
  └─ Total Accumulated       : 1.00006600 m³
      (Integer: 1, Decimal: 6600 ÷ 100000000)
══════════════════════════════════════════════════════════════════
```

### Read from serial port:

```
══════════════════════════════════════════════════════════════════
🌊 READING ALL FLOW SENSORS (DH6400)
══════════════════════════════════════════════════════════════════
Port      : /dev/ttyACM0
Baudrate  : 9600
Parity    : None
Data bits : 8
Stop bits : 1
Sensors   : 01 - 06
══════════════════════════════════════════════════════════════════

──────────────────────────────────────────────────────────────────
📡 Reading Flow Sensor 01
──────────────────────────────────────────────────────────────────
Request : 01030000000AC5CD
Response: 010314000000010284064000000001028A064000000000271F

✅ Flow Sensor 01 Data:
  ├─ Instantaneous Flow  : 1.6600 m³/h
  │   (Integer part: 1 ÷ 1000 = 1.000)
  │   (Decimal part: 6600 ÷ 10000 = 0.6600)
  └─ Total Accumulated   : 1.00006600 m³
      (Integer part: 1, Decimal part: 6600 ÷ 100000000 = 0.00006600)

... (tương tự cho sensors 02-06)

══════════════════════════════════════════════════════════════════
📊 SUMMARY - All Flow Sensors
══════════════════════════════════════════════════════════════════
Sensor     Instant Flow (m³/h)       Total Accumulated (m³)
──────────────────────────────────────────────────────────────────
FS01                       1.6600                 1.00006600
FS02                       2.3400                 2.00007800
FS03                       0.0000                 0.00000000
FS04                       3.1200                 3.00009100
FS05                       1.5000                 1.50005000
FS06                       0.7500                 0.75003750
══════════════════════════════════════════════════════════════════
```

## Functions exported

Script export các functions sau để sử dụng trong custom nodes:

```javascript
const {
    calculateCRC,          // Tính Modbus CRC16
    parseFlowResponse,     // Parse response từ sensor
    readFlowSensor,        // Đọc 1 sensor
    readAllSensors,        // Đọc tất cả 6 sensors
    testParseWithSample    // Test với sample data
} = require('./test-flow-sensors.js');
```

## Cấu trúc dữ liệu response

Response từ DH6400 flow sensor (25 bytes):

| Byte    | Mô tả                                      | Cách tính                    |
|---------|--------------------------------------------|------------------------------|
| 1       | Slave ID (01-06)                          | -                            |
| 2       | Function Code (0x03)                      | -                            |
| 3       | Data length (0x14 = 20 bytes)             | -                            |
| 4-7     | Phần nguyên lưu lượng tức thời            | ÷ 1000 → m³/h                |
| 8-11    | Phần thập phân lưu lượng tức thời         | ÷ 10000 → m³/h               |
| 12-15   | Phần nguyên tổng lưu lượng tích lũy       | m³                           |
| 16-19   | Phần thập phân tổng lưu lượng tích lũy    | ÷ 100000000 → m³             |
| 20-23   | Reserved (không sử dụng)                  | -                            |
| 24-25   | CRC16 (little endian)                     | -                            |

## Next Steps

Sau khi test thành công, các functions này có thể được integrate vào custom Node-RED nodes:

1. `calculateCRC()` - để tạo Modbus requests
2. `parseFlowResponse()` - để parse responses
3. `readFlowSensor()` - logic đọc 1 sensor
4. `readAllSensors()` - logic đọc nhiều sensors

## Troubleshooting

### Lỗi: Cannot find module 'serialport'

```bash
npm install serialport
```

### Lỗi: Permission denied accessing serial port

```bash
sudo usermod -a -G dialout $USER
# Sau đó logout và login lại
```

### Lỗi: No response from sensor

1. Kiểm tra kết nối USB/Serial
2. Kiểm tra port đúng chưa: `ls /dev/tty*`
3. Kiểm tra baudrate và cấu hình serial
4. Kiểm tra Slave ID có đúng không (01-06)

### Lỗi: CRC mismatch

1. Kiểm tra cấu hình serial (baudrate, parity, data bits, stop bits)
2. Có thể do nhiễu trên đường truyền
3. Thử lại request

## So sánh với Python script

| Feature                  | Python                    | JavaScript (này)          |
|-------------------------|---------------------------|---------------------------|
| CRC calculation         | ✅ Giống nhau             | ✅ Giống nhau             |
| Parse logic             | ✅ Giống nhau             | ✅ Giống nhau             |
| Serial communication    | `pyserial`                | `serialport` (Node.js)    |
| Async handling          | Synchronous               | Promise-based (async)     |
| Export for reuse        | ❌                        | ✅ module.exports         |

## License

VIIS - Viet Nam IoT Solution
