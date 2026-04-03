/**
 * Unit tests for Flow Sensors functions
 * Run: npm test test-flow-sensors.test.js
 */

const {
    calculateCRC,
    parseFlowResponse
} = require('./test-flow-sensors.js');

describe('Flow Sensors - Modbus Functions', () => {

    describe('calculateCRC', () => {
        test('should calculate correct CRC for standard Modbus request', () => {
            // Request: 01030000000A (without CRC)
            const data = Buffer.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x0A]);
            const crc = calculateCRC(data);

            // Expected CRC: C5CD (little endian)
            const expectedCRC = Buffer.from([0xC5, 0xCD]);

            expect(crc.equals(expectedCRC)).toBe(true);
            expect(crc.toString('hex').toUpperCase()).toBe('C5CD');
        });

        test('should calculate correct CRC for different slave IDs', () => {
            // Slave ID 02
            const data2 = Buffer.from([0x02, 0x03, 0x00, 0x00, 0x00, 0x0A]);
            const crc2 = calculateCRC(data2);
            expect(crc2.toString('hex').toUpperCase()).toBe('C51C');

            // Slave ID 06
            const data6 = Buffer.from([0x06, 0x03, 0x00, 0x00, 0x00, 0x0A]);
            const crc6 = calculateCRC(data6);
            expect(crc6.toString('hex').toUpperCase()).toBe('C46C');
        });

        test('should handle empty buffer', () => {
            const data = Buffer.from([]);
            const crc = calculateCRC(data);
            // CRC of empty data should be 0xFFFF in little endian
            expect(crc.toString('hex').toUpperCase()).toBe('FFFF');
        });
    });

    describe('parseFlowResponse', () => {
        test('should parse sample response correctly', () => {
            // Sample từ documentation
            const sampleHex = '010314000000010284064000000001028A064000000000271F';
            const response = Buffer.from(sampleHex, 'hex');

            const result = parseFlowResponse(response);

            expect(result).not.toBeNull();
            expect(result.slaveId).toBe(1);
            expect(result.functionCode).toBe(0x03);
            expect(result.length).toBe(20);

            // Instantaneous flow calculations
            expect(result.instantInt).toBe(1);
            expect(result.instantDec).toBe(6600);
            expect(result.instantaneousFlowM3h).toBeCloseTo(1.66, 4);

            // Total accumulated calculations
            expect(result.totalInt).toBe(1);
            expect(result.totalDec).toBe(6600);
            expect(result.totalAccumulatedM3).toBeCloseTo(1.000066, 8);
        });

        test('should parse zero flow correctly', () => {
            // Response với flow = 0
            const zeroFlowHex = '010314000000000000000000000000000000000000000000C5CD';
            const response = Buffer.from(zeroFlowHex, 'hex');

            const result = parseFlowResponse(response);

            expect(result).not.toBeNull();
            expect(result.instantaneousFlowM3h).toBe(0);
            expect(result.totalAccumulatedM3).toBe(0);
        });

        test('should handle different slave IDs', () => {
            // Slave ID 06
            const response6Hex = '060314000000010284064000000001028A064000000000271F';
            const response = Buffer.from(response6Hex, 'hex');

            const result = parseFlowResponse(response);

            expect(result).not.toBeNull();
            expect(result.slaveId).toBe(6);
        });

        test('should return null for invalid response (too short)', () => {
            const shortResponse = Buffer.from([0x01, 0x03, 0x14]);
            const result = parseFlowResponse(shortResponse);

            expect(result).toBeNull();
        });

        test('should parse high flow values correctly', () => {
            // High flow: 999.9999 m³/h
            // instantInt = 999999 (0x000F423F), instantDec = 9999 (0x0000270F)
            const highFlowHex = '010314000F423F000027' + '0F00000064' + '00001388' + '000000000000' + 'FFFF';
            const response = Buffer.from(highFlowHex, 'hex');

            const result = parseFlowResponse(response);

            expect(result).not.toBeNull();
            expect(result.instantInt).toBe(999999);
            expect(result.instantDec).toBe(9999);
            expect(result.instantaneousFlowM3h).toBeCloseTo(1000.9999, 4);
        });

        test('should parse decimal parts correctly', () => {
            // Test với instant_dec = 5000 (0.5 m³/h phần thập phân)
            const decimalTestHex = '0103140000000000001388' + '0000000A' + '00000000' + '000000000000' + 'FFFF';
            const response = Buffer.from(decimalTestHex, 'hex');

            const result = parseFlowResponse(response);

            expect(result).not.toBeNull();
            expect(result.instantDec).toBe(5000);
            expect(result.instantaneousFlowM3h).toBeCloseTo(0.5, 4);
        });

        test('should handle maximum values', () => {
            // Max uint32 values
            const maxHex = '010314FFFFFFFF' + 'FFFFFFFF' + 'FFFFFFFF' + 'FFFFFFFF' + '00000000' + 'FFFF';
            const response = Buffer.from(maxHex, 'hex');

            const result = parseFlowResponse(response);

            expect(result).not.toBeNull();
            expect(result.instantInt).toBe(4294967295);
            expect(result.instantDec).toBe(4294967295);
            expect(result.totalInt).toBe(4294967295);
            expect(result.totalDec).toBe(4294967295);
        });
    });

    describe('Integration Tests', () => {
        test('CRC should validate response correctly', () => {
            // Complete valid response with CRC
            const validResponseHex = '010314000000010284064000000001028A064000000000271F';
            const response = Buffer.from(validResponseHex, 'hex');

            // Extract data and CRC
            const receivedCrc = response.slice(-2);
            const dataForCrc = response.slice(0, -2);
            const calculatedCrc = calculateCRC(dataForCrc);

            expect(receivedCrc.equals(calculatedCrc)).toBe(true);
        });

        test('should detect invalid CRC', () => {
            // Response với CRC sai
            const invalidCrcHex = '010314000000010284064000000001028A064000000000FFFF'; // CRC sai
            const response = Buffer.from(invalidCrcHex, 'hex');

            const receivedCrc = response.slice(-2);
            const dataForCrc = response.slice(0, -2);
            const calculatedCrc = calculateCRC(dataForCrc);

            expect(receivedCrc.equals(calculatedCrc)).toBe(false);
        });

        test('complete request-response cycle for slave 01', () => {
            // Build request
            const slaveId = 0x01;
            const requestData = Buffer.from([
                slaveId,
                0x03,        // Function Code
                0x00, 0x00,  // Starting address
                0x00, 0x0A   // Quantity
            ]);

            const requestCrc = calculateCRC(requestData);
            const fullRequest = Buffer.concat([requestData, requestCrc]);

            // Verify request format
            expect(fullRequest.toString('hex').toUpperCase()).toBe('01030000000AC5CD');

            // Simulate response
            const responseHex = '010314000000010284064000000001028A064000000000271F';
            const response = Buffer.from(responseHex, 'hex');

            // Parse response
            const result = parseFlowResponse(response);

            expect(result).not.toBeNull();
            expect(result.slaveId).toBe(slaveId);
            expect(result.instantaneousFlowM3h).toBeGreaterThan(0);
        });
    });

    describe('Edge Cases', () => {
        test('should handle response with exact 25 bytes', () => {
            const response25 = Buffer.alloc(25);
            response25[0] = 0x01;  // slave ID
            response25[1] = 0x03;  // function code
            response25[2] = 0x14;  // length

            const result = parseFlowResponse(response25);

            expect(result).not.toBeNull();
            expect(result.slaveId).toBe(1);
        });

        test('should handle response with more than 25 bytes', () => {
            // Response dài hơn sẽ vẫn parse được
            const longResponse = Buffer.alloc(30);
            longResponse[0] = 0x01;
            longResponse[1] = 0x03;
            longResponse[2] = 0x14;

            const result = parseFlowResponse(longResponse);

            expect(result).not.toBeNull();
        });
    });
});
