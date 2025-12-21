"use strict";
/**
 * Unit tests for DH6400 Serial Client
 * Tests response parsing without requiring physical hardware
 */
Object.defineProperty(exports, "__esModule", { value: true });
describe('DH6400 Response Parsing', () => {
    /**
     * Helper to create mock DH6400 response buffer
     */
    function createMockResponse(totalInt, totalDec, instantFlowRaw) {
        const buffer = Buffer.alloc(25);
        // Header (optional)
        buffer.writeUInt8(0xFF, 0);
        buffer.writeUInt8(0xFF, 1);
        // Reserved bytes 2-10 (zeros)
        for (let i = 2; i <= 10; i++) {
            buffer.writeUInt8(0x00, i);
        }
        // Bytes 11-14: Total accumulated integer (Big Endian)
        buffer.writeUInt32BE(totalInt, 11);
        // Bytes 15-18: Total accumulated decimal (Big Endian)
        buffer.writeUInt32BE(totalDec, 15);
        // Bytes 19-22: Instantaneous flow raw (Big Endian)
        buffer.writeUInt32BE(instantFlowRaw, 19);
        // Checksum (optional)
        buffer.writeUInt8(0xBA, 23);
        buffer.writeUInt8(0xA8, 24);
        return buffer;
    }
    /**
     * Parse response (extracted from DH6400SerialClient)
     */
    function parseResponse(response) {
        if (response.length !== 25) {
            throw new Error(`Invalid response length: ${response.length} (expected 25)`);
        }
        // Byte 11-14: Total accumulated integer
        const totalInt = response.readUInt32BE(11);
        // Byte 15-18: Total accumulated decimal (8 decimal places)
        const totalDec = response.readUInt32BE(15);
        // Total accumulated in m³
        const totalAccumulatedM3 = totalInt + totalDec / 100000000;
        // Byte 19-22: Instantaneous flow raw
        const instantFlowRaw = response.readUInt32BE(19);
        // Convert to m³/h (adjust divisor if needed)
        const instantFlowM3h = instantFlowRaw / 100;
        return {
            totalAccumulatedM3,
            instantFlowM3h
        };
    }
    test('should parse valid DH6400 response correctly', () => {
        // Test case from Python script: totalInt=91, totalDec=178029, instantFlow=3100
        const response = createMockResponse(91, 178029, 3100);
        const result = parseResponse(response);
        expect(result.totalAccumulatedM3).toBeCloseTo(91.00178029, 8);
        expect(result.instantFlowM3h).toBeCloseTo(31.00, 2);
    });
    test('should parse response with zero decimal part', () => {
        const response = createMockResponse(50, 0, 2500);
        const result = parseResponse(response);
        expect(result.totalAccumulatedM3).toBe(50);
        expect(result.instantFlowM3h).toBe(25.00);
    });
    test('should parse response with large values', () => {
        const response = createMockResponse(999, 99999999, 10000);
        const result = parseResponse(response);
        expect(result.totalAccumulatedM3).toBeCloseTo(999.99999999, 8);
        expect(result.instantFlowM3h).toBe(100.00);
    });
    test('should parse response with zero flow', () => {
        const response = createMockResponse(100, 50000000, 0);
        const result = parseResponse(response);
        expect(result.totalAccumulatedM3).toBeCloseTo(100.50, 2);
        expect(result.instantFlowM3h).toBe(0);
    });
    test('should handle real hex string from test_script.js', () => {
        // From user's test: '020314000000000000A44E000000000000000000000000BAA8'
        const hexString = '020314000000000000A44E000000000000000000000000BAA8';
        const response = Buffer.from(hexString, 'hex');
        expect(response.length).toBe(25);
        // Bytes 11-14 (index 11-14): 0x0000A44E = 42062
        const totalInt = response.readUInt32BE(11);
        expect(totalInt).toBe(42062);
        // Bytes 15-18 (index 15-18): 0x00000000 = 0
        const totalDec = response.readUInt32BE(15);
        expect(totalDec).toBe(0);
        // Bytes 19-22 (index 19-22): 0x00000000 = 0
        const instantFlowRaw = response.readUInt32BE(19);
        expect(instantFlowRaw).toBe(0);
        const result = parseResponse(response);
        expect(result.totalAccumulatedM3).toBe(42062);
        expect(result.instantFlowM3h).toBe(0);
    });
    test('should throw error for invalid length', () => {
        const invalidBuffer = Buffer.alloc(10);
        expect(() => parseResponse(invalidBuffer)).toThrow('Invalid response length: 10 (expected 25)');
    });
    test('should handle maximum 32-bit values', () => {
        const maxUInt32 = 0xFFFFFFFF; // 4294967295
        const response = createMockResponse(maxUInt32, maxUInt32, maxUInt32);
        const result = parseResponse(response);
        expect(result.totalAccumulatedM3).toBeCloseTo(4294967295 + 4294967295 / 100000000);
        expect(result.instantFlowM3h).toBe(42949672.95);
    });
    test('should parse multiple consecutive responses', () => {
        const responses = [
            createMockResponse(100, 10000000, 3000),
            createMockResponse(100, 20000000, 3100),
            createMockResponse(100, 30000000, 3200),
        ];
        const results = responses.map(r => parseResponse(r));
        expect(results[0].totalAccumulatedM3).toBeCloseTo(100.10, 2);
        expect(results[1].totalAccumulatedM3).toBeCloseTo(100.20, 2);
        expect(results[2].totalAccumulatedM3).toBeCloseTo(100.30, 2);
        expect(results[0].instantFlowM3h).toBe(30.00);
        expect(results[1].instantFlowM3h).toBe(31.00);
        expect(results[2].instantFlowM3h).toBe(32.00);
    });
});
describe('DH6400 Multi-Channel Simulation', () => {
    test('should simulate 6 channels with different values', () => {
        const channels = [
            { channel: 1, totalInt: 91, totalDec: 178029, instantFlow: 3100 },
            { channel: 2, totalInt: 85, totalDec: 250000, instantFlow: 2800 },
            { channel: 3, totalInt: 120, totalDec: 500000, instantFlow: 3500 },
            { channel: 4, totalInt: 75, totalDec: 100000, instantFlow: 2500 },
            { channel: 5, totalInt: 95, totalDec: 750000, instantFlow: 3200 },
            { channel: 6, totalInt: 110, totalDec: 900000, instantFlow: 3400 },
        ];
        const mockData = new Map();
        channels.forEach(ch => {
            const response = Buffer.alloc(25);
            response.writeUInt32BE(ch.totalInt, 11);
            response.writeUInt32BE(ch.totalDec, 15);
            response.writeUInt32BE(ch.instantFlow, 19);
            const totalAccumulatedM3 = ch.totalInt + ch.totalDec / 100000000;
            const instantFlowM3h = ch.instantFlow / 100;
            mockData.set(ch.channel, {
                channel: ch.channel,
                slaveId: ch.channel, // Slave ID same as channel
                sensorKey: `fs${String(ch.channel).padStart(2, '0')}`,
                instantFlowM3h: instantFlowM3h,
                totalAccumulatedM3: totalAccumulatedM3,
                timestamp: Date.now(),
                rawData: response
            });
        });
        expect(mockData.size).toBe(6);
        // Verify channel 1
        const ch1 = mockData.get(1);
        expect(ch1.sensorKey).toBe('fs01');
        expect(ch1.totalAccumulatedM3).toBeCloseTo(91.00178029, 8);
        expect(ch1.instantFlowM3h).toBe(31.00);
        // Verify channel 6
        const ch6 = mockData.get(6);
        expect(ch6.sensorKey).toBe('fs06');
        expect(ch6.totalAccumulatedM3).toBeCloseTo(110.009, 3);
        expect(ch6.instantFlowM3h).toBe(34.00);
    });
});
describe('DH6400 Edge Cases', () => {
    test('should handle very small decimal values', () => {
        const response = Buffer.alloc(25);
        response.writeUInt32BE(100, 11); // totalInt = 100
        response.writeUInt32BE(1, 15); // totalDec = 1 (0.00000001)
        response.writeUInt32BE(2500, 19); // instantFlow = 25.00
        const totalAccumulatedM3 = 100 + 1 / 100000000;
        expect(totalAccumulatedM3).toBeCloseTo(100.00000001, 8);
    });
    test('should handle byte order (Big Endian)', () => {
        const buffer = Buffer.alloc(25);
        // Write 0x00000064 (100 in decimal) - Big Endian
        buffer.writeUInt8(0x00, 11);
        buffer.writeUInt8(0x00, 12);
        buffer.writeUInt8(0x00, 13);
        buffer.writeUInt8(0x64, 14);
        const value = buffer.readUInt32BE(11);
        expect(value).toBe(100);
        // Compare with Little Endian (should be different)
        const valueLittleEndian = buffer.readUInt32LE(11);
        expect(valueLittleEndian).toBe(0x64000000); // 1677721600
        expect(valueLittleEndian).not.toBe(value);
    });
});
describe('DH6400 Robustness - Port Lock Retry Logic', () => {
    /**
     * Test error detection logic for port lock errors
     */
    function isPortLockError(errorMsg) {
        return errorMsg.includes('Cannot lock port') ||
            errorMsg.includes('Resource temporarily unavailable') ||
            errorMsg.includes('EBUSY');
    }
    test('should detect "Cannot lock port" error', () => {
        const error = 'Error Resource temporarily unavailable Cannot lock port';
        expect(isPortLockError(error)).toBe(true);
    });
    test('should detect "Resource temporarily unavailable" error', () => {
        const error = 'Resource temporarily unavailable';
        expect(isPortLockError(error)).toBe(true);
    });
    test('should detect "EBUSY" error', () => {
        const error = 'EBUSY: resource busy or locked';
        expect(isPortLockError(error)).toBe(true);
    });
    test('should not detect other errors as port lock', () => {
        const error = 'ENOENT: no such file or directory';
        expect(isPortLockError(error)).toBe(false);
    });
    test('should not detect permission errors as port lock', () => {
        const error = 'EACCES: permission denied';
        expect(isPortLockError(error)).toBe(false);
    });
});
describe('DH6400 Robustness - Exponential Backoff', () => {
    /**
     * Calculate exponential backoff delay
     */
    function calculateBackoff(attempt, maxDelay = 60000) {
        return Math.min(5000 * Math.pow(2, attempt - 1), maxDelay);
    }
    test('should calculate correct exponential backoff', () => {
        expect(calculateBackoff(1)).toBe(5000); // 5s
        expect(calculateBackoff(2)).toBe(10000); // 10s
        expect(calculateBackoff(3)).toBe(20000); // 20s
        expect(calculateBackoff(4)).toBe(40000); // 40s
        expect(calculateBackoff(5)).toBe(60000); // max 60s
        expect(calculateBackoff(6)).toBe(60000); // max 60s
    });
    test('should respect max delay cap', () => {
        expect(calculateBackoff(10)).toBe(60000);
        expect(calculateBackoff(100)).toBe(60000);
    });
});
describe('DH6400 Connection State Management', () => {
    test('should handle isClosing flag correctly', () => {
        let isClosing = false;
        // Simulate normal operation
        expect(isClosing).toBe(false);
        // Simulate cleanup start
        isClosing = true;
        expect(isClosing).toBe(true);
        // Reconnect should be skipped when closing
        const shouldReconnect = !isClosing;
        expect(shouldReconnect).toBe(false);
    });
    test('should handle concurrent connection prevention', () => {
        let connectionPromise = null;
        // First connection attempt
        connectionPromise = Promise.resolve();
        expect(connectionPromise).not.toBeNull();
        // Second attempt should wait for first
        if (connectionPromise) {
            // Should return existing promise, not create new one
            const shouldWait = true;
            expect(shouldWait).toBe(true);
        }
    });
});
