#!/usr/bin/env node
/**
 * Script đọc 6 flow sensors DH6400 (Slave ID 01-06)
 * Request: 01030000000AC5CD (đọc 10 registers từ địa chỉ 0)
 * Cấu hình: 9600 baud, FC03, Parity None, 8 data bits, 1 stop bit
 *
 * Dependencies: npm install serialport
 * Usage:
 *   node test-flow-sensors.js <serial_port>     # Read all 6 sensors
 *   node test-flow-sensors.js test              # Test parse with sample data
 *
 * Example:
 *   node test-flow-sensors.js /dev/ttyACM0
 *   node test-flow-sensors.js test
 */

const { SerialPort } = require('serialport');

/**
 * Tính Modbus CRC16
 * @param {Buffer} data - Data buffer cần tính CRC
 * @returns {Buffer} - 2 bytes CRC (little endian)
 */
function calculateCRC(data) {
    let crc = 0xFFFF;

    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let j = 0; j < 8; j++) {
            if (crc & 0x0001) {
                crc = (crc >> 1) ^ 0xA001;
            } else {
                crc >>= 1;
            }
        }
    }

    // Return as little endian (low byte first, high byte second)
    const buffer = Buffer.allocUnsafe(2);
    buffer.writeUInt16LE(crc, 0);
    return buffer;
}

/**
 * Parse response từ flow sensor theo cấu trúc:
 * - Byte 1: address
 * - Byte 2: function code
 * - Byte 3: length
 * - (bỏ qua) Byte 4-7: phần nguyên rate lưu lượng tức thời, nhân 1000 -> m3/h
 * - (bỏ qua) Byte 8-11: phần thập phân rate lưu lượng tức thời, chia 10000 -> m3/h
 * - Byte 12-15: phần nguyên tổng lưu lượng tích lũy -> m3
 * - Byte 16-19: phần thập phân tổng lưu lượng tích lũy, chia 100000000 -> m3
 * - Byte 20-23: dữ liệu lưu lượng tức thời, đọc lên chuyển qua dec, chia cho 1000 là ra m3/h
 * - Byte 24-25: check code
 *
 * @param {Buffer} response - Response buffer từ sensor
 * @returns {Object|null} - Parsed data hoặc null nếu invalid
 */
function parseFlowResponse(response) {
    if (response.length < 25) {
        return null;
    }

    const slaveId = response[0];
    const functionCode = response[1];
    const length = response[2];

    // Byte 12-15 (index 11-14): phần nguyên tổng lưu lượng tích lũy
    const totalIntBytes = response.slice(11, 15);
    const totalInt = totalIntBytes.readUInt32BE(0);

    // Byte 16-19 (index 15-18): phần thập phân tổng lưu lượng tích lũy
    const totalDecBytes = response.slice(15, 19);
    const totalDec = totalDecBytes.readUInt32BE(0);

    // Tính tổng lưu lượng tích lũy (m3)
    const totalAccumulatedM3 = totalInt + totalDec / 100000000;

    // Byte 20-23 (index 19-22): dữ liệu lưu lượng tức thời
    const instantFlowBytes = response.slice(19, 23);
    const instantFlowRaw = instantFlowBytes.readUInt32BE(0);

    // Tính rate lưu lượng tức thời (m3/h) - chia 1000
    const instantaneousFlowM3h = instantFlowRaw / 1000;

    return {
        slaveId: slaveId,
        functionCode: functionCode,
        length: length,
        instantaneousFlowM3h: instantaneousFlowM3h,
        totalAccumulatedM3: totalAccumulatedM3,
        instantFlowRaw: instantFlowRaw,
        totalInt: totalInt,
        totalDec: totalDec
    };
}

/**
 * Đọc data từ 1 flow sensor
 * Request: <slave_id> 03 0000 000A <CRC>
 *
 * @param {SerialPort} port - Serial port object
 * @param {number} slaveId - Slave ID (1-6)
 * @returns {Promise<Object|null>} - Promise với parsed data hoặc null
 */
function readFlowSensor(port, slaveId) {
    return new Promise((resolve) => {
        // Tạo request packet
        const data = Buffer.from([
            slaveId,    // Slave ID (01-06)
            0x03,       // Function Code 03
            0x00, 0x00, // Starting address: 0
            0x00, 0x0A  // Quantity: 10 registers
        ]);

        const crc = calculateCRC(data);
        const packet = Buffer.concat([data, crc]);

        console.log(`\n${'─'.repeat(70)}`);
        console.log(`📡 Reading Flow Sensor ${slaveId.toString().padStart(2, '0')}`);
        console.log(`${'─'.repeat(70)}`);
        console.log(`Request : ${packet.toString('hex').toUpperCase()}`);

        let responseBuffer = Buffer.alloc(0);
        let timeout;

        // Handler cho data nhận được
        const dataHandler = (chunk) => {
            responseBuffer = Buffer.concat([responseBuffer, chunk]);

            // Đợi nhận đủ data (tối thiểu 25 bytes)
            if (responseBuffer.length >= 25) {
                clearTimeout(timeout);
                port.removeListener('data', dataHandler);
                processResponse();
            }
        };

        const processResponse = () => {
            let response = responseBuffer;

            if (response.length === 0) {
                console.log(`❌ No response from sensor ${slaveId.toString().padStart(2, '0')}`);
                resolve(null);
                return;
            }

            // Nếu nhận > 25 bytes, chỉ lấy đúng số bytes cần thiết dựa vào byte_count
            if (response.length >= 3) {
                const byteCount = response[2];
                const expectedLength = 3 + byteCount + 2; // header(3) + data(byte_count) + CRC(2)
                if (response.length > expectedLength) {
                    response = response.slice(0, expectedLength);
                }
            }

            console.log(`Response: ${response.toString('hex').toUpperCase()}`);

            // Verify CRC
            if (response.length >= 2) {
                const receivedCrc = response.slice(-2);
                const dataForCrc = response.slice(0, -2);
                const calculatedCrc = calculateCRC(dataForCrc);

                if (!receivedCrc.equals(calculatedCrc)) {
                    console.log(`⚠️  CRC mismatch! Received: ${receivedCrc.toString('hex').toUpperCase()}, Calculated: ${calculatedCrc.toString('hex').toUpperCase()}`);
                    resolve(null);
                    return;
                }
            }

            // Parse data
            const result = parseFlowResponse(response);

            if (result) {
                console.log(`\n✅ Flow Sensor ${slaveId.toString().padStart(2, '0')} Data:`);
                console.log(`  ├─ Instantaneous Flow  : ${result.instantaneousFlowM3h.toFixed(4)} m³/h`);
                console.log(`  │   (Raw value: ${result.instantFlowRaw} ÷ 1000 = ${(result.instantFlowRaw / 1000).toFixed(3)})`);
                console.log(`  └─ Total Accumulated   : ${result.totalAccumulatedM3.toFixed(8)} m³`);
                console.log(`      (Integer part: ${result.totalInt}, Decimal part: ${result.totalDec} ÷ 100000000 = ${(result.totalDec / 100000000).toFixed(8)})`);
            }

            resolve(result);
        };

        // Set timeout 2 giây
        timeout = setTimeout(() => {
            port.removeListener('data', dataHandler);
            processResponse();
        }, 2000);

        // Lắng nghe data
        port.on('data', dataHandler);

        // Gửi request
        try {
            port.write(packet, (err) => {
                if (err) {
                    console.error(`❌ Error writing to port: ${err.message}`);
                    clearTimeout(timeout);
                    port.removeListener('data', dataHandler);
                    resolve(null);
                }
            });
        } catch (error) {
            console.error(`❌ Error reading sensor ${slaveId.toString().padStart(2, '0')}: ${error.message}`);
            clearTimeout(timeout);
            port.removeListener('data', dataHandler);
            resolve(null);
        }
    });
}

/**
 * Delay helper function
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Đọc tất cả 6 flow sensors
 * @param {string} portPath - Serial port path (e.g., /dev/ttyACM0)
 * @returns {Promise<Object|null>} - Promise với results object hoặc null
 */
async function readAllSensors(portPath) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🌊 READING ALL FLOW SENSORS (DH6400)`);
    console.log(`${'='.repeat(70)}`);
    console.log(`Port      : ${portPath}`);
    console.log(`Baudrate  : 9600`);
    console.log(`Parity    : None`);
    console.log(`Data bits : 8`);
    console.log(`Stop bits : 1`);
    console.log(`Sensors   : 01 - 06`);
    console.log(`${'='.repeat(70)}`);

    const results = {};

    try {
        // Tạo serial port
        const port = new SerialPort({
            path: portPath,
            baudRate: 9600,
            dataBits: 8,
            parity: 'none',
            stopBits: 1,
            autoOpen: false
        });

        // Mở port
        await new Promise((resolve, reject) => {
            port.open((err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Đợi port ổn định sau khi mở
        await delay(500);

        // Đọc từ sensor 01 đến 06
        for (let slaveId = 1; slaveId <= 6; slaveId++) {
            const result = await readFlowSensor(port, slaveId);
            if (result) {
                results[`FS${slaveId.toString().padStart(2, '0')}`] = result;
            }

            // Đợi giữa các request để thiết bị xử lý
            await delay(500);
        }

        // Summary
        console.log(`\n${'='.repeat(70)}`);
        console.log(`📊 SUMMARY - All Flow Sensors`);
        console.log(`${'='.repeat(70)}`);
        console.log(`${'Sensor'.padEnd(10)} ${'Instant Flow (m³/h)'.padEnd(25)} ${'Total Accumulated (m³)'.padEnd(25)}`);
        console.log(`${'─'.repeat(70)}`);

        for (const [sensorName, data] of Object.entries(results)) {
            console.log(`${sensorName.padEnd(10)} ${data.instantaneousFlowM3h.toFixed(4).padStart(22)}   ${data.totalAccumulatedM3.toFixed(8).padStart(22)}`);
        }

        console.log(`${'='.repeat(70)}\n`);

        // Đóng port
        await new Promise((resolve) => {
            port.close(() => resolve());
        });

        return results;

    } catch (error) {
        console.error(`\n❌ Serial port error: ${error.message}`);
        console.log('  Make sure you have permission to access the port');
        console.log('  Try: sudo usermod -a -G dialout $USER');
        return null;
    }
}

/**
 * Test parse function với data mẫu từ hình
 */
function testParseWithSample() {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🧪 TESTING PARSE FUNCTION WITH SAMPLE DATA`);
    console.log(`${'='.repeat(70)}`);

    // Sample response từ hình
    const sampleHex = '010314000000010284064000000001028A064000000000271F';
    const sampleResponse = Buffer.from(sampleHex, 'hex');

    console.log(`Sample response: ${sampleHex}`);

    const result = parseFlowResponse(sampleResponse);

    if (result) {
        console.log(`\n✅ Parsed Data:`);
        console.log(`  ├─ Slave ID                : ${result.slaveId}`);
        console.log(`  ├─ Function Code           : ${result.functionCode.toString(16).toUpperCase().padStart(2, '0')}`);
        console.log(`  ├─ Length                  : ${result.length}`);
        console.log(`  ├─ Instantaneous Flow      : ${result.instantaneousFlowM3h.toFixed(4)} m³/h`);
        console.log(`  │   (Raw value: ${result.instantFlowRaw} ÷ 1000)`);
        console.log(`  └─ Total Accumulated       : ${result.totalAccumulatedM3.toFixed(8)} m³`);
        console.log(`      (Integer: ${result.totalInt}, Decimal: ${result.totalDec} ÷ 100000000)`);
    }

    console.log(`${'='.repeat(70)}\n`);
}

// Main execution
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length < 1) {
        console.log('Usage:');
        console.log('  node test-flow-sensors.js <serial_port>     # Read all 6 sensors');
        console.log('  node test-flow-sensors.js test              # Test parse with sample data');
        console.log('\nExample:');
        console.log('  node test-flow-sensors.js /dev/ttyACM0');
        console.log('  node test-flow-sensors.js test');
        process.exit(1);
    }

    if (args[0].toLowerCase() === 'test') {
        // Test với data mẫu
        testParseWithSample();
    } else {
        // Đọc thực tế từ serial port
        const portPath = args[0];
        readAllSensors(portPath).then(results => {
            if (results) {
                process.exit(0);
            } else {
                process.exit(1);
            }
        }).catch(err => {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        });
    }
}

// Export functions for use in Node-RED custom nodes
module.exports = {
    calculateCRC,
    parseFlowResponse,
    readFlowSensor,
    readAllSensors,
    testParseWithSample
};
