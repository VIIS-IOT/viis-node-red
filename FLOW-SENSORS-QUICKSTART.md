# Flow Sensors Test Script - Quick Start

## Tổng quan

3 files đã được tạo để test đọc flow sensors DH6400 trước khi implement vào custom nodes:

1. **test-flow-sensors.js** - Script chính để đọc flow sensors
2. **test-flow-sensors.test.js** - Unit tests cho các functions
3. **TEST-FLOW-SENSORS-README.md** - Documentation chi tiết

## Cài đặt nhanh

```bash
cd /home/fuel-iot/viis-local-docker/services/nodered/custom-nodes/viis-node-red

# Cài đặt dependencies (serialport đã được thêm vào package.json)
npm install
```

## Sử dụng

### 1. Test parsing với sample data (không cần hardware)

```bash
node test-flow-sensors.js test
```

**Kết quả mong đợi:**
```
══════════════════════════════════════════════════════════════════
🧪 TESTING PARSE FUNCTION WITH SAMPLE DATA
══════════════════════════════════════════════════════════════════
Sample response: 010314000000010284064000000001028A064000000000271F

✅ Parsed Data:
  ├─ Slave ID                : 1
  ├─ Function Code           : 03
  ├─ Length                  : 20
  ├─ Instantaneous Flow      : 4220.6794 m³/h
  │   (Integer: 1 ÷ 1000, Decimal: 42206784 ÷ 10000)
  └─ Total Accumulated       : 1.42600000 m³
      (Integer: 1, Decimal: 42600000 ÷ 100000000)
══════════════════════════════════════════════════════════════════
```

### 2. Chạy unit tests

```bash
npm test test-flow-sensors.test.js
```

### 3. Đọc từ serial port thực tế (cần hardware)

```bash
# Tìm serial port
ls /dev/tty*

# Đọc từ port (cần sudo)
sudo node test-flow-sensors.js /dev/ttyACM0
```

## So sánh với Python version

```bash
# Python version (từ root folder)
python3 /home/fuel-iot/viis-local-docker/read_flow_sensors.py test

# JavaScript version
node test-flow-sensors.js test
```

Cả 2 versions sẽ cho kết quả giống hệt nhau! ✅

## Functions có sẵn để dùng trong custom nodes

Script export các functions sau:

```javascript
const {
    calculateCRC,          // Tính Modbus CRC16
    parseFlowResponse,     // Parse response từ sensor
    readFlowSensor,        // Đọc 1 sensor (Promise-based)
    readAllSensors,        // Đọc tất cả 6 sensors (Promise-based)
    testParseWithSample    // Test function
} = require('./test-flow-sensors.js');

// Example usage:
async function example() {
    // Test parsing
    const sampleData = Buffer.from('010314000000010284064000000001028A064000000000271F', 'hex');
    const result = parseFlowResponse(sampleData);
    console.log(result);

    // Calculate CRC for request
    const requestData = Buffer.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x0A]);
    const crc = calculateCRC(requestData);
    console.log(crc.toString('hex')); // C5CD
}
```

## Next Steps - Integration vào Custom Nodes

Khi sẵn sàng implement vào custom nodes, bạn có thể:

1. **Tạo custom node mới** hoặc thêm vào node hiện có
2. **Import functions** từ test script này
3. **Tích hợp serial communication** với Node-RED flow
4. **Handle errors** và retry logic
5. **Add configuration UI** trong Node-RED

### Ví dụ skeleton cho custom node:

```javascript
module.exports = function(RED) {
    const { parseFlowResponse, calculateCRC } = require('./test-flow-sensors.js');
    const { SerialPort } = require('serialport');

    function FlowSensorNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.on('input', async function(msg) {
            try {
                // Use the tested functions here
                const result = parseFlowResponse(msg.payload);
                msg.payload = result;
                node.send(msg);
            } catch (err) {
                node.error(err);
            }
        });
    }

    RED.nodes.registerType("flow-sensor", FlowSensorNode);
}
```

## Troubleshooting

### SerialPort installation issues

Nếu gặp lỗi khi cài serialport (do native dependencies):

```bash
# Cài build tools
sudo apt-get install build-essential

# Rebuild serialport
npm rebuild serialport
```

### Permission denied on serial port

```bash
# Add user to dialout group
sudo usermod -a -G dialout $USER

# Logout và login lại
```

### Module not found

```bash
# Đảm bảo chạy npm install
cd /home/fuel-iot/viis-local-docker/services/nodered/custom-nodes/viis-node-red
npm install
```

## Test Coverage

Unit tests bao gồm:

- ✅ CRC calculation với nhiều slave IDs
- ✅ Parse response với sample data
- ✅ Parse zero flow values
- ✅ Parse high flow values
- ✅ Decimal precision testing
- ✅ CRC validation
- ✅ Edge cases (buffer sizes, max values)
- ✅ Complete request-response cycle

Run tests:
```bash
npm test test-flow-sensors.test.js
```

## Files Created

```
/home/fuel-iot/viis-local-docker/services/nodered/custom-nodes/viis-node-red/
├── test-flow-sensors.js              # Main test script (executable)
├── test-flow-sensors.test.js         # Unit tests
├── TEST-FLOW-SENSORS-README.md       # Detailed documentation
└── FLOW-SENSORS-QUICKSTART.md        # This file
```

## Resources

- **Python original**: `/home/fuel-iot/viis-local-docker/read_flow_sensors.py`
- **Modbus spec**: Function Code 03 (Read Holding Registers)
- **DH6400 sensor**: 9600 baud, 8N1, slave IDs 01-06

---

**Prepared for**: Custom Node development
**Status**: ✅ Tested and verified matching Python implementation
**Ready for**: Integration into Node-RED custom nodes
