"use strict";
/**
 * @fileoverview Tests for Marine Telemetry Controller
 *
 * Comprehensive test suite for Marine IoT telemetry API endpoints
 */
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const marine_telemetry_controller_1 = require("../controllers/marine-telemetry.controller");
const marine_telemetry_dto_1 = require("../dto/marine-telemetry.dto");
// Mock Node
const mockNode = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    status: jest.fn()
};
// Mock Marine Telemetry Service
const mockMarineTelemetryService = {
    getLatestTelemetry: jest.fn(),
    getTelemetryHistory: jest.fn(),
    getMachineSummary: jest.fn()
};
describe('MarineTelemetryController', () => {
    let controller;
    const TEST_DEVICE_ID = 'test_ship_001';
    beforeAll(() => {
        controller = new marine_telemetry_controller_1.MarineTelemetryController(mockMarineTelemetryService, mockNode);
    });
    beforeEach(() => {
        jest.clearAllMocks();
    });
    describe('GET /api/v2/marine/telemetry/latest/:device_id', () => {
        const mockLatestTelemetryResponse = {
            device_id: TEST_DEVICE_ID,
            timestamp: Date.now(),
            data: [
                {
                    key_name: 'fs01',
                    value: 1000,
                    value_tons: 850,
                    oil_profile_id: 'test_generator_do',
                    density_snapshot: 850,
                    machine_type: marine_telemetry_dto_1.MachineType.GENERATOR
                },
                {
                    key_name: 'fs02',
                    value: 980,
                    value_tons: 833,
                    oil_profile_id: 'test_generator_do',
                    density_snapshot: 850,
                    machine_type: marine_telemetry_dto_1.MachineType.GENERATOR
                },
                {
                    key_name: 'fs03',
                    value: 500,
                    value_tons: 475,
                    oil_profile_id: 'test_main_engine_bo',
                    density_snapshot: 950,
                    machine_type: marine_telemetry_dto_1.MachineType.MAIN_ENGINE
                },
                {
                    key_name: 'fs04',
                    value: 490,
                    value_tons: 465.5,
                    oil_profile_id: 'test_main_engine_bo',
                    density_snapshot: 950,
                    machine_type: marine_telemetry_dto_1.MachineType.MAIN_ENGINE
                },
                {
                    key_name: 'fs05',
                    value: 200,
                    value_tons: 196,
                    oil_profile_id: 'test_boiler_hfo',
                    density_snapshot: 980,
                    machine_type: marine_telemetry_dto_1.MachineType.BOILER
                },
                {
                    key_name: 'fs06',
                    value: 198,
                    value_tons: 194.04,
                    oil_profile_id: 'test_boiler_hfo',
                    density_snapshot: 980,
                    machine_type: marine_telemetry_dto_1.MachineType.BOILER
                }
            ],
            machines: {
                [marine_telemetry_dto_1.MachineType.GENERATOR]: {
                    flow_in: { key: 'fs01', m3h: 1000, th: 850 },
                    flow_return: { key: 'fs02', m3h: 980, th: 833 },
                    consumption_rate: { m3h: 20, th: 17 },
                    oil_profile: 'test_generator_do',
                    density: 850
                },
                [marine_telemetry_dto_1.MachineType.MAIN_ENGINE]: {
                    flow_in: { key: 'fs03', m3h: 500, th: 475 },
                    flow_return: { key: 'fs04', m3h: 490, th: 465.5 },
                    consumption_rate: { m3h: 10, th: 9.5 },
                    oil_profile: 'test_main_engine_bo',
                    density: 950
                },
                [marine_telemetry_dto_1.MachineType.BOILER]: {
                    flow_in: { key: 'fs05', m3h: 200, th: 196 },
                    flow_return: { key: 'fs06', m3h: 198, th: 194.04 },
                    consumption_rate: { m3h: 2, th: 1.96 },
                    oil_profile: 'test_boiler_hfo',
                    density: 980
                }
            }
        };
        it('should return latest telemetry with all machines', async () => {
            mockMarineTelemetryService.getLatestTelemetry.mockResolvedValue(mockLatestTelemetryResponse);
            const result = await controller.getLatestTelemetry(TEST_DEVICE_ID, {});
            expect(mockMarineTelemetryService.getLatestTelemetry).toHaveBeenCalledWith(TEST_DEVICE_ID, undefined);
            expect(result.device_id).toBe(TEST_DEVICE_ID);
            expect(result.data).toHaveLength(6);
            expect(result.machines[marine_telemetry_dto_1.MachineType.GENERATOR]).toBeDefined();
            expect(result.machines[marine_telemetry_dto_1.MachineType.MAIN_ENGINE]).toBeDefined();
            expect(result.machines[marine_telemetry_dto_1.MachineType.BOILER]).toBeDefined();
        });
        it('should calculate consumption rate correctly for Generator', async () => {
            mockMarineTelemetryService.getLatestTelemetry.mockResolvedValue(mockLatestTelemetryResponse);
            const result = await controller.getLatestTelemetry(TEST_DEVICE_ID, {});
            const generator = result.machines[marine_telemetry_dto_1.MachineType.GENERATOR];
            expect(generator).toBeDefined();
            expect(generator.flow_in.m3h).toBe(1000);
            expect(generator.flow_return.m3h).toBe(980);
            expect(generator.consumption_rate.m3h).toBe(20);
            expect(generator.consumption_rate.th).toBe(17);
        });
        it('should calculate consumption rate correctly for Main Engine', async () => {
            mockMarineTelemetryService.getLatestTelemetry.mockResolvedValue(mockLatestTelemetryResponse);
            const result = await controller.getLatestTelemetry(TEST_DEVICE_ID, {});
            const mainEngine = result.machines[marine_telemetry_dto_1.MachineType.MAIN_ENGINE];
            expect(mainEngine).toBeDefined();
            expect(mainEngine.flow_in.m3h).toBe(500);
            expect(mainEngine.flow_return.m3h).toBe(490);
            expect(mainEngine.consumption_rate.m3h).toBe(10);
            expect(mainEngine.consumption_rate.th).toBe(9.5);
        });
        it('should calculate consumption rate correctly for Boiler', async () => {
            mockMarineTelemetryService.getLatestTelemetry.mockResolvedValue(mockLatestTelemetryResponse);
            const result = await controller.getLatestTelemetry(TEST_DEVICE_ID, {});
            const boiler = result.machines[marine_telemetry_dto_1.MachineType.BOILER];
            expect(boiler).toBeDefined();
            expect(boiler.flow_in.m3h).toBe(200);
            expect(boiler.flow_return.m3h).toBe(198);
            expect(boiler.consumption_rate.m3h).toBe(2);
            expect(boiler.consumption_rate.th).toBe(1.96);
        });
        it('should filter by specified sensor keys', async () => {
            const filteredResponse = Object.assign(Object.assign({}, mockLatestTelemetryResponse), { data: mockLatestTelemetryResponse.data.filter(d => d.key_name === 'fs01' || d.key_name === 'fs02'), machines: {
                    [marine_telemetry_dto_1.MachineType.GENERATOR]: mockLatestTelemetryResponse.machines[marine_telemetry_dto_1.MachineType.GENERATOR]
                } });
            mockMarineTelemetryService.getLatestTelemetry.mockResolvedValue(filteredResponse);
            const result = await controller.getLatestTelemetry(TEST_DEVICE_ID, {
                keys: 'fs01,fs02'
            });
            expect(mockMarineTelemetryService.getLatestTelemetry).toHaveBeenCalledWith(TEST_DEVICE_ID, ['fs01', 'fs02']);
            expect(result.data).toHaveLength(2);
            expect(result.machines[marine_telemetry_dto_1.MachineType.GENERATOR]).toBeDefined();
            expect(result.machines[marine_telemetry_dto_1.MachineType.MAIN_ENGINE]).toBeUndefined();
        });
        it('should return empty structure for device with no telemetry data', async () => {
            const emptyResponse = {
                device_id: 'non_existent',
                timestamp: Date.now(),
                data: [],
                machines: {}
            };
            mockMarineTelemetryService.getLatestTelemetry.mockResolvedValue(emptyResponse);
            const result = await controller.getLatestTelemetry('non_existent', {});
            expect(result.device_id).toBe('non_existent');
            expect(result.data).toHaveLength(0);
            expect(Object.keys(result.machines)).toHaveLength(0);
        });
    });
    describe('GET /api/v2/marine/telemetry/machines/:device_id', () => {
        const mockMachinesSummaryResponse = {
            device_id: TEST_DEVICE_ID,
            machines: [
                {
                    type: marine_telemetry_dto_1.MachineType.GENERATOR,
                    sensors: { flow_in: 'fs01', flow_return: 'fs02' },
                    current_profile: {
                        id: 'test_generator_do',
                        oil_type: 'DO',
                        density: 850,
                        label: 'Generator Diesel'
                    },
                    status: marine_telemetry_dto_1.MachineStatus.OPERATIONAL,
                    last_update: Date.now()
                },
                {
                    type: marine_telemetry_dto_1.MachineType.MAIN_ENGINE,
                    sensors: { flow_in: 'fs03', flow_return: 'fs04' },
                    current_profile: {
                        id: 'test_main_engine_fo',
                        oil_type: 'FO',
                        density: 950,
                        label: 'Main Engine FO'
                    },
                    status: marine_telemetry_dto_1.MachineStatus.OPERATIONAL,
                    last_update: Date.now()
                },
                {
                    type: marine_telemetry_dto_1.MachineType.BOILER,
                    sensors: { flow_in: 'fs05', flow_return: 'fs06' },
                    current_profile: {
                        id: 'test_boiler_fo',
                        oil_type: 'FO',
                        density: 980,
                        label: 'Boiler FO'
                    },
                    status: marine_telemetry_dto_1.MachineStatus.OPERATIONAL,
                    last_update: Date.now()
                }
            ]
        };
        it('should return summary for all machines', async () => {
            mockMarineTelemetryService.getMachineSummary.mockResolvedValue(mockMachinesSummaryResponse);
            const result = await controller.getMachinesSummary(TEST_DEVICE_ID);
            expect(mockMarineTelemetryService.getMachineSummary).toHaveBeenCalledWith(TEST_DEVICE_ID);
            expect(result.device_id).toBe(TEST_DEVICE_ID);
            expect(result.machines).toHaveLength(3);
        });
        it('should include correct sensor mapping for each machine', async () => {
            mockMarineTelemetryService.getMachineSummary.mockResolvedValue(mockMachinesSummaryResponse);
            const result = await controller.getMachinesSummary(TEST_DEVICE_ID);
            const generator = result.machines.find(m => m.type === marine_telemetry_dto_1.MachineType.GENERATOR);
            expect(generator.sensors).toEqual({ flow_in: 'fs01', flow_return: 'fs02' });
            const mainEngine = result.machines.find(m => m.type === marine_telemetry_dto_1.MachineType.MAIN_ENGINE);
            expect(mainEngine.sensors).toEqual({ flow_in: 'fs03', flow_return: 'fs04' });
            const boiler = result.machines.find(m => m.type === marine_telemetry_dto_1.MachineType.BOILER);
            expect(boiler.sensors).toEqual({ flow_in: 'fs05', flow_return: 'fs06' });
        });
        it('should include active oil profiles', async () => {
            mockMarineTelemetryService.getMachineSummary.mockResolvedValue(mockMachinesSummaryResponse);
            const result = await controller.getMachinesSummary(TEST_DEVICE_ID);
            const generator = result.machines.find(m => m.type === marine_telemetry_dto_1.MachineType.GENERATOR);
            expect(generator.current_profile.oil_type).toBe('DO');
            expect(generator.current_profile.density).toBe(850);
            const mainEngine = result.machines.find(m => m.type === marine_telemetry_dto_1.MachineType.MAIN_ENGINE);
            expect(mainEngine.current_profile.oil_type).toBe('FO');
            expect(mainEngine.current_profile.density).toBe(950);
            const boiler = result.machines.find(m => m.type === marine_telemetry_dto_1.MachineType.BOILER);
            expect(boiler.current_profile.oil_type).toBe('FO');
            expect(boiler.current_profile.density).toBe(980);
        });
        it('should show OPERATIONAL status when recent data exists', async () => {
            mockMarineTelemetryService.getMachineSummary.mockResolvedValue(mockMachinesSummaryResponse);
            const result = await controller.getMachinesSummary(TEST_DEVICE_ID);
            result.machines.forEach(machine => {
                expect(machine.status).toBe(marine_telemetry_dto_1.MachineStatus.OPERATIONAL);
                expect(machine.last_update).toBeGreaterThan(0);
            });
        });
        it('should show NO_DATA status when no telemetry', async () => {
            const noDataResponse = Object.assign(Object.assign({}, mockMachinesSummaryResponse), { machines: mockMachinesSummaryResponse.machines.map(m => (Object.assign(Object.assign({}, m), { status: marine_telemetry_dto_1.MachineStatus.NO_DATA, last_update: 0 }))) });
            mockMarineTelemetryService.getMachineSummary.mockResolvedValue(noDataResponse);
            const result = await controller.getMachinesSummary(TEST_DEVICE_ID);
            result.machines.forEach(machine => {
                expect(machine.status).toBe(marine_telemetry_dto_1.MachineStatus.NO_DATA);
                expect(machine.last_update).toBe(0);
            });
        });
    });
    describe('GET /api/v2/marine/telemetry/history/:device_id', () => {
        const mockHistoryResponse = {
            device_id: TEST_DEVICE_ID,
            time_range: {
                start: Date.now() - 10 * 60 * 1000,
                end: Date.now()
            },
            interval: 60000,
            data: [
                {
                    timestamp: Date.now() - 5 * 60 * 1000,
                    fs01: 1000,
                    fs02: 980,
                    fs03: 500,
                    fs04: 490,
                    fs05: 200,
                    fs06: 198,
                    profiles: {
                        [marine_telemetry_dto_1.MachineType.GENERATOR]: { id: 'test_generator_do', density: 850 },
                        [marine_telemetry_dto_1.MachineType.MAIN_ENGINE]: { id: 'test_main_engine_bo', density: 950 },
                        [marine_telemetry_dto_1.MachineType.BOILER]: { id: 'test_boiler_hfo', density: 980 }
                    }
                }
            ]
        };
        it('should return historical data in specified time range', async () => {
            mockMarineTelemetryService.getTelemetryHistory.mockResolvedValue(mockHistoryResponse);
            const endTime = Date.now();
            const startTime = endTime - 10 * 60 * 1000;
            const result = await controller.getTelemetryHistory(TEST_DEVICE_ID, {
                start_time: startTime,
                end_time: endTime,
                interval: 60000
            });
            expect(mockMarineTelemetryService.getTelemetryHistory).toHaveBeenCalledWith(TEST_DEVICE_ID, startTime, endTime, undefined, 60000, undefined);
            expect(result.device_id).toBe(TEST_DEVICE_ID);
            expect(result.interval).toBe(60000);
            expect(result.data.length).toBeGreaterThan(0);
        });
        it('should filter by specified sensor keys', async () => {
            mockMarineTelemetryService.getTelemetryHistory.mockResolvedValue(mockHistoryResponse);
            const endTime = Date.now();
            const startTime = endTime - 10 * 60 * 1000;
            await controller.getTelemetryHistory(TEST_DEVICE_ID, {
                start_time: startTime,
                end_time: endTime,
                keys: 'fs01,fs02',
                interval: 60000
            });
            expect(mockMarineTelemetryService.getTelemetryHistory).toHaveBeenCalledWith(TEST_DEVICE_ID, startTime, endTime, ['fs01', 'fs02'], 60000, undefined);
        });
        it('should filter by machine type', async () => {
            mockMarineTelemetryService.getTelemetryHistory.mockResolvedValue(mockHistoryResponse);
            const endTime = Date.now();
            const startTime = endTime - 10 * 60 * 1000;
            await controller.getTelemetryHistory(TEST_DEVICE_ID, {
                start_time: startTime,
                end_time: endTime,
                interval: 60000,
                machine_type: marine_telemetry_dto_1.MachineType.GENERATOR
            });
            expect(mockMarineTelemetryService.getTelemetryHistory).toHaveBeenCalledWith(TEST_DEVICE_ID, startTime, endTime, undefined, 60000, marine_telemetry_dto_1.MachineType.GENERATOR);
        });
    });
});
