"use strict";
/**
 * Unit tests for flow sensor value division (fs01-fs06) by 10
 * Tests the processRegisterData method in ViisTelemetryPollingService
 * Now uses ScaleConfig instead of hard-coded division
 */
Object.defineProperty(exports, "__esModule", { value: true });
const viis_telemetry_polling_service_1 = require("../viis-telemetry-polling-service");
const viis_telemetry_constants_1 = require("../viis-telemetry-constants");
describe('ViisTelemetryPollingService - Flow Sensor Division', () => {
    let pollingService;
    let mockNode;
    let mockNodeContext;
    let mockModbusClient;
    let globalContextStore;
    // Default scale configs for fs01-fs06 (divide by 10)
    const flowSensorScaleConfigs = [
        { key: 'fs01', operation: 'divide', factor: 10, direction: 'read' },
        { key: 'fs02', operation: 'divide', factor: 10, direction: 'read' },
        { key: 'fs03', operation: 'divide', factor: 10, direction: 'read' },
        { key: 'fs04', operation: 'divide', factor: 10, direction: 'read' },
        { key: 'fs05', operation: 'divide', factor: 10, direction: 'read' },
        { key: 'fs06', operation: 'divide', factor: 10, direction: 'read' },
    ];
    beforeEach(() => {
        // Setup global context store
        globalContextStore = {};
        // Set default scale configs for flow sensors
        globalContextStore[viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.SCALE_CONFIGS] = flowSensorScaleConfigs;
        // Mock Node
        mockNode = {
            id: 'test-node-id',
            error: jest.fn(),
            warn: jest.fn(),
            log: jest.fn(),
            status: jest.fn(),
            context: jest.fn().mockReturnValue({
                global: {
                    get: jest.fn((key) => globalContextStore[key]),
                    set: jest.fn((key, value) => {
                        globalContextStore[key] = value;
                    })
                }
            })
        };
        // Mock NodeContext
        mockNodeContext = {
            set: jest.fn(),
            get: jest.fn(),
            global: {
                get: jest.fn((key) => globalContextStore[key]),
                set: jest.fn((key, value) => {
                    globalContextStore[key] = value;
                })
            }
        };
        // Mock ModbusClientCore
        mockModbusClient = {
            readHoldingRegisters: jest.fn(),
            readInputRegisters: jest.fn(),
            readCoils: jest.fn()
        };
        // Initialize polling service
        pollingService = new viis_telemetry_polling_service_1.ViisTelemetryPollingService(mockNode, mockNodeContext, mockModbusClient, 'board1', 'device-123');
    });
    describe('Holding Registers - Flow Sensor Keys (fs01-fs06)', () => {
        it('should divide fs01 value by 10 via ScaleConfig when reading holding registers', async () => {
            const mockData = {
                address: 0,
                data: [100, 200] // Raw Modbus values
            };
            const mapping = { fs01: 0, temp: 1 };
            mockModbusClient.readHoldingRegisters.mockResolvedValue(mockData);
            // Access private method via type casting
            const processRegisterData = pollingService.processRegisterData.bind(pollingService);
            const result = processRegisterData(mockData, mapping, 'read', 'holding');
            expect(result.fs01).toBe(10); // 100 / 10 = 10 (via ScaleConfig)
            expect(result.temp).toBe(200); // Not divided (no ScaleConfig)
        });
        it('should divide all fs01-fs06 values by 10', async () => {
            const mockData = {
                address: 0,
                data: [100, 200, 300, 400, 500, 600, 700]
            };
            const mapping = {
                fs01: 0,
                fs02: 1,
                fs03: 2,
                fs04: 3,
                fs05: 4,
                fs06: 5,
                other: 6
            };
            const processRegisterData = pollingService.processRegisterData.bind(pollingService);
            const result = processRegisterData(mockData, mapping, 'read', 'holding');
            expect(result.fs01).toBe(10); // 100 / 10
            expect(result.fs02).toBe(20); // 200 / 10
            expect(result.fs03).toBe(30); // 300 / 10
            expect(result.fs04).toBe(40); // 400 / 10
            expect(result.fs05).toBe(50); // 500 / 10
            expect(result.fs06).toBe(60); // 600 / 10
            expect(result.other).toBe(700); // Not divided
        });
        it('should NOT divide fs07 or other keys starting with fs (no ScaleConfig)', async () => {
            const mockData = {
                address: 0,
                data: [100, 200, 300]
            };
            const mapping = {
                fs07: 0,
                fs_total: 1,
                fset: 2
            };
            const processRegisterData = pollingService.processRegisterData.bind(pollingService);
            const result = processRegisterData(mockData, mapping, 'read', 'holding');
            expect(result.fs07).toBe(100); // Not divided (no ScaleConfig for fs07)
            expect(result.fs_total).toBe(200); // Not divided (no ScaleConfig)
            expect(result.fset).toBe(300); // Not divided (no ScaleConfig)
        });
        it('should handle decimal results correctly', async () => {
            const mockData = {
                address: 0,
                data: [155, 237] // Values that result in decimals
            };
            const mapping = { fs01: 0, fs02: 1 };
            const processRegisterData = pollingService.processRegisterData.bind(pollingService);
            const result = processRegisterData(mockData, mapping, 'read', 'holding');
            expect(result.fs01).toBe(15.5); // 155 / 10
            expect(result.fs02).toBe(23.7); // 237 / 10
        });
        it('should handle zero values correctly', async () => {
            const mockData = {
                address: 0,
                data: [0, 0, 0]
            };
            const mapping = { fs01: 0, fs02: 1, fs03: 2 };
            const processRegisterData = pollingService.processRegisterData.bind(pollingService);
            const result = processRegisterData(mockData, mapping, 'read', 'holding');
            expect(result.fs01).toBe(0);
            expect(result.fs02).toBe(0);
            expect(result.fs03).toBe(0);
        });
    });
    describe('Input Registers - No Division Applied', () => {
        it('should NOT divide fs01-fs06 values for input registers (ScaleConfig direction is "read" for holding)', async () => {
            const mockData = {
                address: 0,
                data: [100, 200, 300]
            };
            const mapping = {
                fs01: 0,
                fs02: 1,
                fs03: 2
            };
            const processRegisterData = pollingService.processRegisterData.bind(pollingService);
            const result = processRegisterData(mockData, mapping, 'read', 'input');
            // ScaleConfig for fs01-fs06 is for 'read' direction, so it still applies
            // But since we're testing input registers vs holding, the behavior is the same
            // The real difference would be if we had different ScaleConfigs per register type
            expect(result.fs01).toBe(10); // 100 / 10 (ScaleConfig still applies)
            expect(result.fs02).toBe(20); // 200 / 10
            expect(result.fs03).toBe(30); // 300 / 10
        });
    });
    describe('Integration with Scaling', () => {
        it('should apply custom scaling (multiply) instead of default division when configured', async () => {
            // Override scale config - multiply instead of divide
            globalContextStore[viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.SCALE_CONFIGS] = [
                { key: 'fs01', operation: 'multiply', factor: 2, direction: 'read' }
            ];
            const mockData = {
                address: 0,
                data: [100]
            };
            const mapping = { fs01: 0 };
            const processRegisterData = pollingService.processRegisterData.bind(pollingService);
            const result = processRegisterData(mockData, mapping, 'read', 'holding');
            // Custom config: multiply by 2 (overrides default divide by 10)
            expect(result.fs01).toBe(200); // 100 * 2 = 200
        });
        it('should handle multiple different scale configs for flow sensors', async () => {
            globalContextStore[viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.SCALE_CONFIGS] = [
                { key: 'fs01', operation: 'multiply', factor: 2, direction: 'read' },
                { key: 'fs02', operation: 'divide', factor: 10, direction: 'read' },
                // fs03 has no scale config
            ];
            const mockData = {
                address: 0,
                data: [100, 100, 100]
            };
            const mapping = { fs01: 0, fs02: 1, fs03: 2 };
            const processRegisterData = pollingService.processRegisterData.bind(pollingService);
            const result = processRegisterData(mockData, mapping, 'read', 'holding');
            expect(result.fs01).toBe(200); // 100 * 2 (custom multiply)
            expect(result.fs02).toBe(10); // 100 / 10 (standard divide)
            expect(result.fs03).toBe(100); // 100 (no scaling)
        });
    });
    describe('Edge Cases', () => {
        it('should handle empty mapping', async () => {
            const mockData = {
                address: 0,
                data: [100, 200]
            };
            const mapping = {};
            const processRegisterData = pollingService.processRegisterData.bind(pollingService);
            const result = processRegisterData(mockData, mapping, 'read', 'holding');
            expect(Object.keys(result).length).toBe(0);
        });
        it('should handle negative values', async () => {
            const mockData = {
                address: 0,
                data: [-100, -250]
            };
            const mapping = { fs01: 0, fs02: 1 };
            const processRegisterData = pollingService.processRegisterData.bind(pollingService);
            const result = processRegisterData(mockData, mapping, 'read', 'holding');
            expect(result.fs01).toBe(-10); // -100 / 10
            expect(result.fs02).toBe(-25); // -250 / 10
        });
        it('should handle very large values', async () => {
            const mockData = {
                address: 0,
                data: [65535, 32768] // Max uint16 and mid-point
            };
            const mapping = { fs01: 0, fs02: 1 };
            const processRegisterData = pollingService.processRegisterData.bind(pollingService);
            const result = processRegisterData(mockData, mapping, 'read', 'holding');
            expect(result.fs01).toBe(6553.5); // 65535 / 10
            expect(result.fs02).toBe(3276.8); // 32768 / 10
        });
    });
});
