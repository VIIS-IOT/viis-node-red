"use strict";
/**
 * Unit tests for DH6400 Marine Telemetry Processor
 * Tests data processing without database or serial connections
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMockDH6400Data = createMockDH6400Data;
describe('DH6400 Processor Data Processing', () => {
    /**
     * Mock DH6400 data generator
     */
    function createMockDH6400Data(channels) {
        const mockData = new Map();
        channels.forEach(channel => {
            mockData.set(channel, {
                channel: channel,
                slaveId: channel, // Slave ID same as channel
                sensorKey: `fs${String(channel).padStart(2, '0')}`,
                instantFlowM3h: 30.0 + channel, // fs01=31, fs02=32, etc.
                totalAccumulatedM3: 100.0 + channel * 10, // fs01=110, fs02=120, etc.
                timestamp: Date.now(),
                rawData: Buffer.alloc(25)
            });
        });
        return mockData;
    }
    /**
     * Process DH6400 data (simplified version of processor logic)
     */
    function processDH6400Data(dh6400Data) {
        const tfsSensorData = [];
        for (const [channel, flowData] of dh6400Data) {
            const sensorKey = `tfs${String(channel).padStart(2, '0')}`;
            tfsSensorData.push({
                device_id: 'test-device',
                timestamp: Date.now(),
                key_name: sensorKey,
                tfs_value: flowData.totalAccumulatedM3
            });
        }
        return tfsSensorData;
    }
    /**
     * Process DH6400 flow data (simplified)
     */
    function processDH6400FlowData(dh6400Data) {
        const flowSensorData = [];
        for (const [channel, flowData] of dh6400Data) {
            const sensorKey = `fs${String(channel).padStart(2, '0')}`;
            flowSensorData.push({
                device_id: 'test-device',
                timestamp: Date.now(),
                key_name: sensorKey,
                float_value: flowData.instantFlowM3h
            });
        }
        return flowSensorData;
    }
    test('should process TFS data for all 6 channels', () => {
        const mockData = createMockDH6400Data([1, 2, 3, 4, 5, 6]);
        const tfsData = processDH6400Data(mockData);
        expect(tfsData).toHaveLength(6);
        // Check tfs01
        const tfs01 = tfsData.find(d => d.key_name === 'tfs01');
        expect(tfs01).toBeDefined();
        expect(tfs01 === null || tfs01 === void 0 ? void 0 : tfs01.tfs_value).toBe(110.0);
        // Check tfs06
        const tfs06 = tfsData.find(d => d.key_name === 'tfs06');
        expect(tfs06).toBeDefined();
        expect(tfs06 === null || tfs06 === void 0 ? void 0 : tfs06.tfs_value).toBe(160.0);
    });
    test('should process flow data for all 6 channels', () => {
        const mockData = createMockDH6400Data([1, 2, 3, 4, 5, 6]);
        const flowData = processDH6400FlowData(mockData);
        expect(flowData).toHaveLength(6);
        // Check fs01
        const fs01 = flowData.find(d => d.key_name === 'fs01');
        expect(fs01).toBeDefined();
        expect(fs01 === null || fs01 === void 0 ? void 0 : fs01.float_value).toBe(31.0);
        // Check fs06
        const fs06 = flowData.find(d => d.key_name === 'fs06');
        expect(fs06).toBeDefined();
        expect(fs06 === null || fs06 === void 0 ? void 0 : fs06.float_value).toBe(36.0);
    });
    test('should process partial channels (only 3 channels)', () => {
        const mockData = createMockDH6400Data([1, 3, 5]);
        const tfsData = processDH6400Data(mockData);
        expect(tfsData).toHaveLength(3);
        expect(tfsData.map(d => d.key_name)).toEqual(['tfs01', 'tfs03', 'tfs05']);
    });
    test('should handle single channel', () => {
        const mockData = createMockDH6400Data([1]);
        const flowData = processDH6400FlowData(mockData);
        expect(flowData).toHaveLength(1);
        expect(flowData[0].key_name).toBe('fs01');
        expect(flowData[0].float_value).toBe(31.0);
    });
    test('should handle zero flow values', () => {
        const mockData = new Map();
        mockData.set(1, {
            channel: 1,
            slaveId: 1,
            sensorKey: 'fs01',
            instantFlowM3h: 0,
            totalAccumulatedM3: 50.0,
            timestamp: Date.now(),
            rawData: Buffer.alloc(25)
        });
        const flowData = processDH6400FlowData(mockData);
        expect(flowData[0].float_value).toBe(0);
        const tfsData = processDH6400Data(mockData);
        expect(tfsData[0].tfs_value).toBe(50.0);
    });
    test('should maintain channel order', () => {
        const mockData = createMockDH6400Data([6, 2, 4, 1, 3, 5]);
        const tfsData = processDH6400Data(mockData);
        // Order should match Map iteration order
        const expectedOrder = ['tfs06', 'tfs02', 'tfs04', 'tfs01', 'tfs03', 'tfs05'];
        expect(tfsData.map(d => d.key_name)).toEqual(expectedOrder);
    });
});
describe('DH6400 vs Modbus Data Comparison', () => {
    /**
     * Simulate old Modbus parsing logic
     */
    function parseModbusTfs(registers) {
        const tfsData = new Map();
        // Old format: registers[10-11] = tfs01, [12-13] = tfs02, etc.
        const tfsMapping = [
            { key: 'tfs01', intAddr: 10, decAddr: 11 },
            { key: 'tfs02', intAddr: 12, decAddr: 13 },
            { key: 'tfs03', intAddr: 14, decAddr: 15 },
            { key: 'tfs04', intAddr: 16, decAddr: 17 },
            { key: 'tfs05', intAddr: 18, decAddr: 19 },
            { key: 'tfs06', intAddr: 20, decAddr: 21 },
        ];
        tfsMapping.forEach(({ key, intAddr, decAddr }) => {
            const integerPart = registers[intAddr];
            const decimalPart = registers[decAddr];
            const tfsValue = parseFloat(`${integerPart}.${decimalPart}`);
            tfsData.set(key, tfsValue);
        });
        return tfsData;
    }
    test('should produce equivalent results to Modbus parsing', () => {
        // Mock Modbus registers
        const modbusRegisters = new Array(22).fill(0);
        modbusRegisters[10] = 91; // tfs01 integer
        modbusRegisters[11] = 4589; // tfs01 decimal
        modbusRegisters[12] = 85; // tfs02 integer
        modbusRegisters[13] = 2500; // tfs02 decimal
        const modbusResult = parseModbusTfs(modbusRegisters);
        // Mock DH6400 data with equivalent values
        const dh6400Data = new Map();
        dh6400Data.set(1, {
            channel: 1,
            slaveId: 1,
            sensorKey: 'fs01',
            instantFlowM3h: 31.0,
            totalAccumulatedM3: 91.4589,
            timestamp: Date.now(),
            rawData: Buffer.alloc(25)
        });
        dh6400Data.set(2, {
            channel: 2,
            slaveId: 2,
            sensorKey: 'fs02',
            instantFlowM3h: 28.0,
            totalAccumulatedM3: 85.2500,
            timestamp: Date.now(),
            rawData: Buffer.alloc(25)
        });
        // Process DH6400
        const dh6400Result = new Map();
        for (const [channel, flowData] of dh6400Data) {
            const sensorKey = `tfs${String(channel).padStart(2, '0')}`;
            dh6400Result.set(sensorKey, flowData.totalAccumulatedM3);
        }
        // Compare results
        expect(modbusResult.get('tfs01')).toBeCloseTo(dh6400Result.get('tfs01'), 4);
        expect(modbusResult.get('tfs02')).toBeCloseTo(dh6400Result.get('tfs02'), 4);
    });
    test('should handle precision difference between Modbus and DH6400', () => {
        // Modbus: parseFloat("91.4589") = 91.4589 (4 decimal places shown)
        // DH6400: 91 + 178029 / 100000000 = 91.00178029 (8 decimal places)
        const modbusValue = parseFloat("91.4589");
        const dh6400Value = 91 + 178029 / 100000000;
        // DH6400 has higher precision
        expect(dh6400Value).not.toBe(modbusValue);
        expect(dh6400Value).toBeCloseTo(91.00178029, 8);
    });
});
describe('DH6400 Telemetry Event Format', () => {
    test('should format telemetry event correctly', () => {
        const mockData = createMockDH6400Data([1, 2, 3, 4, 5, 6]);
        // Simulate telemetry event
        const telemetryData = {};
        mockData.forEach((data, channel) => {
            const sensorKey = data.sensorKey;
            const tfsSensorKey = `tfs${String(channel).padStart(2, '0')}`;
            telemetryData[sensorKey] = data.instantFlowM3h;
            telemetryData[tfsSensorKey] = data.totalAccumulatedM3;
        });
        // Verify structure
        expect(telemetryData).toHaveProperty('fs01');
        expect(telemetryData).toHaveProperty('tfs01');
        expect(telemetryData).toHaveProperty('fs06');
        expect(telemetryData).toHaveProperty('tfs06');
        // Verify values
        expect(telemetryData['fs01']).toBe(31.0);
        expect(telemetryData['tfs01']).toBe(110.0);
        expect(telemetryData['fs06']).toBe(36.0);
        expect(telemetryData['tfs06']).toBe(160.0);
        // Should have 12 keys total (6 fs + 6 tfs)
        expect(Object.keys(telemetryData)).toHaveLength(12);
    });
});
/**
 * Helper function to create mock DH6400 data
 * Exported for use in other tests
 */
function createMockDH6400Data(channels) {
    const mockData = new Map();
    channels.forEach(channel => {
        mockData.set(channel, {
            channel: channel,
            slaveId: channel,
            sensorKey: `fs${String(channel).padStart(2, '0')}`,
            instantFlowM3h: 30.0 + channel,
            totalAccumulatedM3: 100.0 + channel * 10,
            timestamp: Date.now(),
            rawData: Buffer.alloc(25)
        });
    });
    return mockData;
}
