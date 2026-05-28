"use strict";
/**
 * Unit tests for ScheduleMapperService
 * Tests schedule-to-Modbus command mapping, value scaling, and config parameters
 */
Object.defineProperty(exports, "__esModule", { value: true });
const schedule_mapper_service_1 = require("../schedule-mapper-service");
// Define defaults BEFORE they're used
const globalContextDefaults = new Map([
    ['MODBUS_COILS', { 'valve_1': 10, 'valve_2': 11, 'pump_1': 20, 'power': 30 }],
    ['MODBUS_HOLDING_REGISTERS', { 'iri_time': 0, 'set_flow': 100, 'set_ec': 101, 'set_ph': 102 }]
]);
// Shared mock global context - accessible in all tests
let mockGlobalContext;
// Mock Node-RED node - create context object once to maintain reference
const createMockNode = () => {
    const contextObject = {
        global: {
            get: jest.fn((key) => {
                // First check mock context, then defaults
                return mockGlobalContext.has(key) ? mockGlobalContext.get(key) : globalContextDefaults.get(key);
            }),
            set: jest.fn((key, value) => {
                mockGlobalContext.set(key, value);
                return value;
            })
        }
    };
    return {
        context: () => contextObject,
        warn: jest.fn(),
        error: jest.fn()
    };
};
// Mock GlobalContextHelper
jest.mock('../../../../ultils/global-context-helper', () => ({
    GlobalContextHelper: jest.fn().mockImplementation((context) => ({
        getEnvVar: jest.fn((key, defaultValue) => {
            if (key === 'MODBUS_BOARDS')
                return null;
            return defaultValue;
        }),
        getJsonEnvVar: jest.fn((key, defaultValue) => {
            if (key === 'MODBUS_COILS') {
                return {
                    'valve_1': 10,
                    'valve_2': 11,
                    'pump_1': 20,
                    'power': 30,
                    'luoi_1_thu': 40,
                    'luoi_1_dai': 41,
                    'luoi_2_thu': 42,
                    'luoi_2_dai': 43,
                    'luoi_3_thu': 44,
                    'luoi_3_dai': 45
                };
            }
            if (key === 'MODBUS_HOLDING_REGISTERS') {
                return {
                    'iri_time': 0,
                    'set_flow': 100,
                    'set_ec': 101,
                    'set_ph': 102
                };
            }
            return defaultValue;
        })
    }))
}));
describe('ScheduleMapperService', () => {
    let service;
    let mockNode;
    beforeEach(() => {
        jest.clearAllMocks();
        mockGlobalContext = new Map();
        mockNode = createMockNode();
        service = new schedule_mapper_service_1.ScheduleMapperService(mockNode, true);
    });
    describe('Constructor', () => {
        it('should initialize with debug enabled', () => {
            const debugService = new schedule_mapper_service_1.ScheduleMapperService(mockNode, true);
            expect(debugService).toBeDefined();
        });
        it('should initialize with debug disabled', () => {
            const nonDebugService = new schedule_mapper_service_1.ScheduleMapperService(mockNode, false);
            expect(nonDebugService).toBeDefined();
        });
    });
    describe('scaleValue', () => {
        beforeEach(() => {
            mockGlobalContext.set('scaleConfigs', []);
        });
        it('should return original value when no scale config exists', () => {
            const result = service.scaleValue('test_key', 100, 'write');
            expect(result).toBe(100);
        });
        it('should multiply value when operation is multiply', () => {
            mockGlobalContext.set('scaleConfigs', [
                { key: 'test_key', operation: 'multiply', factor: 10, direction: 'write' }
            ]);
            const result = service.scaleValue('test_key', 100, 'write');
            expect(result).toBe(1000);
        });
        it('should divide value when operation is divide', () => {
            mockGlobalContext.set('scaleConfigs', [
                { key: 'test_key', operation: 'divide', factor: 10, direction: 'write' }
            ]);
            const result = service.scaleValue('test_key', 100, 'write');
            expect(result).toBe(10);
        });
        it('should only apply matching direction config', () => {
            mockGlobalContext.set('scaleConfigs', [
                { key: 'test_key', operation: 'multiply', factor: 10, direction: 'read' }
            ]);
            const result = service.scaleValue('test_key', 100, 'write');
            expect(result).toBe(100); // Should not apply read config to write
        });
    });
    describe('loadAllModbusCoils', () => {
        it('should load legacy single-board coils', () => {
            const coils = service.loadAllModbusCoils();
            expect(coils['valve_1']).toBe(10);
            expect(coils['valve_2']).toBe(11);
            expect(coils['pump_1']).toBe(20);
        });
        it('should load multi-board coils when configured', () => {
            const mockService = new schedule_mapper_service_1.ScheduleMapperService(mockNode, false);
            mockService.globalHelper.getEnvVar = jest.fn().mockReturnValue(JSON.stringify([
                { id: 'board1', name: 'Board 1' },
                { id: 'board2', name: 'Board 2' }
            ]));
            mockService.globalHelper.getJsonEnvVar = jest.fn((key) => {
                if (key === 'MODBUS_BOARD1_COILS')
                    return { 'valve_1': 10 };
                if (key === 'MODBUS_BOARD2_COILS')
                    return { 'valve_2': 20 };
                return {};
            });
            const coils = mockService.loadAllModbusCoils();
            expect(coils['valve_1']).toBe(10);
            expect(coils['valve_2']).toBe(20);
        });
        it('should handle invalid MODBUS_BOARDS gracefully', () => {
            const mockService = new schedule_mapper_service_1.ScheduleMapperService(mockNode, false);
            mockService.globalHelper.getEnvVar = jest.fn().mockReturnValue('invalid json');
            const coils = mockService.loadAllModbusCoils();
            // Should return empty or legacy coils, not throw
            expect(typeof coils).toBe('object');
        });
    });
    describe('loadAllModbusHoldingRegisters', () => {
        it('should load legacy single-board holding registers', () => {
            const holding = service.loadAllModbusHoldingRegisters();
            expect(holding['iri_time']).toBe(0);
            expect(holding['set_flow']).toBe(100);
            expect(holding['set_ec']).toBe(101);
        });
        it('should load multi-board holding registers', () => {
            const mockService = new schedule_mapper_service_1.ScheduleMapperService(mockNode, false);
            mockService.globalHelper.getEnvVar = jest.fn().mockReturnValue(JSON.stringify([
                { id: 'board1', name: 'Board 1' }
            ]));
            mockService.globalHelper.getJsonEnvVar = jest.fn((key) => {
                if (key === 'MODBUS_BOARD1_HOLDING_REGISTERS')
                    return { 'iri_time': 0, 'test': 50 };
                return {};
            });
            const holding = mockService.loadAllModbusHoldingRegisters();
            expect(holding['iri_time']).toBe(0);
            expect(holding['test']).toBe(50);
        });
    });
    describe('storeConfigParameter', () => {
        beforeEach(() => {
            mockGlobalContext.set('scheduleConfigValues', {});
        });
        it('should store numeric config parameter', () => {
            const result = service.storeConfigParameter('custom_param', 42, 'test-schedule');
            expect(result).not.toBeNull();
            expect(result === null || result === void 0 ? void 0 : result.key).toBe('custom_param');
            expect(result === null || result === void 0 ? void 0 : result.value).toBe(42);
            expect(result === null || result === void 0 ? void 0 : result.type).toBe('number');
            expect(result === null || result === void 0 ? void 0 : result.scheduleId).toBe('test-schedule');
        });
        it('should store boolean config parameter', () => {
            const result = service.storeConfigParameter('enabled', true, 'test-schedule');
            expect(result).not.toBeNull();
            expect(result === null || result === void 0 ? void 0 : result.type).toBe('boolean');
            expect(result === null || result === void 0 ? void 0 : result.value).toBe(true);
        });
        it('should store string config parameter', () => {
            const result = service.storeConfigParameter('label', 'Test Label', 'test-schedule');
            expect(result).not.toBeNull();
            expect(result === null || result === void 0 ? void 0 : result.type).toBe('string');
            expect(result === null || result === void 0 ? void 0 : result.value).toBe('Test Label');
        });
        it('should convert string "true" to boolean', () => {
            const result = service.storeConfigParameter('enabled', 'true', 'test-schedule');
            expect(result === null || result === void 0 ? void 0 : result.type).toBe('boolean');
            expect(result === null || result === void 0 ? void 0 : result.value).toBe(true);
        });
        it('should convert string "123" to number', () => {
            const result = service.storeConfigParameter('count', '123', 'test-schedule');
            expect(result === null || result === void 0 ? void 0 : result.type).toBe('number');
            expect(result === null || result === void 0 ? void 0 : result.value).toBe(123);
        });
        it('should store config in global context', () => {
            service.storeConfigParameter('test_param', 100, 'test-schedule');
            const configValues = mockGlobalContext.get('configKeyValues');
            expect(configValues['test_param']).toBe(100);
        });
        it('should track config keys per schedule', () => {
            service.storeConfigParameter('test_param', 100, 'test-schedule');
            const scheduleConfigKeys = mockGlobalContext.get('scheduleConfigKeys');
            expect(scheduleConfigKeys['test-schedule']).toContain('test_param');
        });
    });
    describe('getActiveCommands', () => {
        beforeEach(() => {
            mockGlobalContext.set('activeModbusCommands', {});
        });
        it('should return active commands for schedule', () => {
            const testCommands = [
                { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];
            mockGlobalContext.set('activeModbusCommands', {
                'schedule-1': testCommands
            });
            const result = service.getActiveCommands('schedule-1');
            expect(result).toHaveLength(1);
            expect(result[0].key).toBe('valve_1');
        });
        it('should return empty array when no active commands', () => {
            const result = service.getActiveCommands('schedule-1');
            expect(result).toHaveLength(0);
        });
    });
    describe('clearActiveCommands', () => {
        beforeEach(() => {
            mockGlobalContext.set('activeModbusCommands', {});
        });
        it('should clear active commands for schedule', () => {
            mockGlobalContext.set('activeModbusCommands', {
                'schedule-1': [
                    { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
                ],
                'schedule-2': [
                    { key: 'valve_2', value: true, fc: 5, unitid: 1, address: 11, quantity: 1 }
                ]
            });
            service.clearActiveCommands('schedule-1');
            const activeCommands = mockGlobalContext.get('activeModbusCommands');
            expect(activeCommands['schedule-1']).toBeUndefined();
            expect(activeCommands['schedule-2']).toBeDefined();
        });
        it('should handle non-existent schedule gracefully', () => {
            // Should not throw
            expect(() => service.clearActiveCommands('non-existent')).not.toThrow();
        });
    });
    describe('mapScheduleToModbus', () => {
        beforeEach(() => {
            mockGlobalContext.set('scheduleConfigValues', {});
            mockGlobalContext.set('activeModbusCommands', {});
        });
        it('should map schedule action to holding commands', () => {
            const schedule = {
                name: 'test-schedule',
                label: 'Test Schedule',
                status: 'finished',
                start_time: '08:00:00',
                end_time: '18:00:00',
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device-001',
                creation: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null,
                action: JSON.stringify({
                    set_flow: 50,
                    set_ec: 2.5
                })
            };
            const result = service.mapScheduleToModbus(schedule);
            // Should have at least the 2 specified commands + iri_time
            expect(result.holdingCommands.length).toBeGreaterThanOrEqual(2);
            // Find set_flow command
            const setFlowCmd = result.holdingCommands.find(cmd => cmd.key === 'set_flow');
            expect(setFlowCmd).toBeDefined();
            expect(setFlowCmd === null || setFlowCmd === void 0 ? void 0 : setFlowCmd.value).toBe(50);
            expect(setFlowCmd === null || setFlowCmd === void 0 ? void 0 : setFlowCmd.fc).toBe(6);
        });
        it('should map schedule action to coil commands', () => {
            const schedule = {
                name: 'test-schedule',
                label: 'Test Schedule',
                status: 'finished',
                start_time: '08:00:00',
                end_time: '18:00:00',
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device-001',
                creation: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null,
                action: JSON.stringify({
                    valve_1: true,
                    pump_1: false
                })
            };
            const result = service.mapScheduleToModbus(schedule);
            // pump_1 with false value is falsy, so only valve_1 should be in coilCommands
            expect(result.coilCommands.length).toBeGreaterThanOrEqual(1);
            const valve1Cmd = result.coilCommands.find(cmd => cmd.key === 'valve_1');
            expect(valve1Cmd).toBeDefined();
            expect(valve1Cmd === null || valve1Cmd === void 0 ? void 0 : valve1Cmd.value).toBe(true);
            expect(valve1Cmd === null || valve1Cmd === void 0 ? void 0 : valve1Cmd.fc).toBe(5);
        });
        it('should handle unmapped keys as config parameters', () => {
            const schedule = {
                name: 'test-schedule',
                label: 'Test Schedule',
                status: 'finished',
                start_time: '08:00:00',
                end_time: '18:00:00',
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device-001',
                creation: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null,
                action: JSON.stringify({
                    valve_1: true,
                    custom_param: 42
                })
            };
            const result = service.mapScheduleToModbus(schedule);
            expect(result.coilCommands).toHaveLength(1);
            expect(result.configParameters).toHaveLength(1);
            expect(result.configParameters[0].key).toBe('custom_param');
        });
        it('should skip falsy values', () => {
            const schedule = {
                name: 'test-schedule',
                label: 'Test Schedule',
                status: 'finished',
                start_time: '08:00:00',
                end_time: '18:00:00',
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device-001',
                creation: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null,
                action: JSON.stringify({
                    valve_1: 0,
                    valve_2: false,
                    set_flow: '0',
                    set_ec: null
                })
            };
            const result = service.mapScheduleToModbus(schedule);
            // All action values are falsy, but iri_time is auto-added
            expect(result.holdingCommands.length).toBeGreaterThanOrEqual(1); // At least iri_time
            expect(result.coilCommands).toHaveLength(0);
            // Verify iri_time was added
            expect(result.holdingCommands.some(cmd => cmd.key === 'iri_time')).toBe(true);
        });
        it('should add iri_time if not present in action', () => {
            const schedule = {
                name: 'test-schedule',
                label: 'Test Schedule',
                status: 'finished',
                start_time: '08:00:00',
                end_time: '18:00:00',
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device-001',
                creation: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null,
                action: JSON.stringify({
                    valve_1: true
                })
            };
            const result = service.mapScheduleToModbus(schedule);
            // Should have iri_time added (36000 seconds = 10 hours)
            expect(result.holdingCommands.some(cmd => cmd.key === 'iri_time')).toBe(true);
        });
        it('should handle missing action gracefully', () => {
            const schedule = {
                name: 'test-schedule',
                label: 'Test Schedule',
                status: 'finished',
                start_time: '08:00:00',
                end_time: '18:00:00',
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device-001',
                creation: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null
            };
            const result = service.mapScheduleToModbus(schedule);
            expect(result.holdingCommands).toHaveLength(0);
            expect(result.coilCommands).toHaveLength(0);
            expect(result.configParameters).toHaveLength(0);
        });
        it('should handle invalid JSON action gracefully', () => {
            const schedule = {
                name: 'test-schedule',
                label: 'Test Schedule',
                status: 'finished',
                start_time: '08:00:00',
                end_time: '18:00:00',
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device-001',
                creation: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null,
                action: 'invalid json{'
            };
            const result = service.mapScheduleToModbus(schedule);
            // Should not throw, return empty arrays
            expect(result.holdingCommands).toHaveLength(0);
            expect(result.coilCommands).toHaveLength(0);
        });
        it('should normalize string numbers', () => {
            const schedule = {
                name: 'test-schedule',
                label: 'Test Schedule',
                status: 'finished',
                start_time: '08:00:00',
                end_time: '18:00:00',
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device-001',
                creation: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null,
                action: JSON.stringify({
                    set_flow: '1,800.00'
                })
            };
            const result = service.mapScheduleToModbus(schedule);
            expect(result.holdingCommands[0].value).toBe(1800);
        });
        it('should convert string booleans to actual booleans', () => {
            const schedule = {
                name: 'test-schedule',
                label: 'Test Schedule',
                status: 'finished',
                start_time: '08:00:00',
                end_time: '18:00:00',
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device-001',
                creation: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null,
                action: JSON.stringify({
                    valve_1: 'true',
                    valve_2: 'FALSE'
                })
            };
            const result = service.mapScheduleToModbus(schedule);
            // valve_2 with 'FALSE' is falsy, so only valve_1 should be in coilCommands
            expect(result.coilCommands.length).toBeGreaterThanOrEqual(1);
            expect(result.coilCommands[0].value).toBe(true);
        });
    });
    describe('getAllModbusCoils', () => {
        it('should return all coil mappings', () => {
            const coils = service.getAllModbusCoils();
            expect(coils['valve_1']).toBe(10);
            expect(coils['pump_1']).toBe(20);
        });
    });
    describe('getAllModbusHoldingRegisters', () => {
        it('should return all holding register mappings', () => {
            const holding = service.getAllModbusHoldingRegisters();
            expect(holding['iri_time']).toBe(0);
            expect(holding['set_flow']).toBe(100);
        });
    });
    describe('Luoi mapping', () => {
        it('should expand luoi_1=1 to luoi_1_dai=true (coil written), luoi_1_thu=false (skipped)', () => {
            const schedule = {
                name: 'luoi-schedule',
                label: 'Luoi Schedule',
                status: 'finished',
                start_time: '08:00:00',
                end_time: '18:00:00',
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device-001',
                creation: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null,
                action: JSON.stringify({
                    luoi_1: 1
                })
            };
            const result = service.mapScheduleToModbus(schedule);
            // luoi_1=1 means dai mode → luoi_1_dai=true (written), luoi_1_thu=false (skipped as falsy)
            const daiCmd = result.coilCommands.find(cmd => cmd.key === 'luoi_1_dai');
            const thuCmd = result.coilCommands.find(cmd => cmd.key === 'luoi_1_thu');
            expect(daiCmd).toBeDefined();
            expect(daiCmd === null || daiCmd === void 0 ? void 0 : daiCmd.value).toBe(true);
            expect(thuCmd).toBeUndefined(); // false coils are skipped
        });
        it('should expand luoi_2=0 to luoi_2_thu=true (coil written), luoi_2_dai=false (skipped)', () => {
            const schedule = {
                name: 'luoi-schedule-2',
                label: 'Luoi Schedule 2',
                status: 'finished',
                start_time: '08:00:00',
                end_time: '18:00:00',
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device-001',
                creation: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null,
                action: JSON.stringify({
                    luoi_2: 0
                })
            };
            const result = service.mapScheduleToModbus(schedule);
            // luoi_2=0 means thu mode → luoi_2_thu=true (written), luoi_2_dai=false (skipped)
            const thuCmd = result.coilCommands.find(cmd => cmd.key === 'luoi_2_thu');
            const daiCmd = result.coilCommands.find(cmd => cmd.key === 'luoi_2_dai');
            expect(thuCmd).toBeDefined();
            expect(thuCmd === null || thuCmd === void 0 ? void 0 : thuCmd.value).toBe(true);
            expect(daiCmd).toBeUndefined(); // false coils are skipped
        });
        it('should handle string luoi values ("true" → dai mode)', () => {
            const schedule = {
                name: 'luoi-schedule-3',
                label: 'Luoi Schedule 3',
                status: 'finished',
                start_time: '08:00:00',
                end_time: '18:00:00',
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device-001',
                creation: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null,
                action: JSON.stringify({
                    luoi_3: 'true'
                })
            };
            const result = service.mapScheduleToModbus(schedule);
            // 'true' → 1 → dai mode
            const daiCmd = result.coilCommands.find(cmd => cmd.key === 'luoi_3_dai');
            expect(daiCmd).toBeDefined();
            expect(daiCmd === null || daiCmd === void 0 ? void 0 : daiCmd.value).toBe(true);
        });
        it('should remove original luoi_1/2/3 keys from action after expansion', () => {
            const schedule = {
                name: 'luoi-schedule-4',
                label: 'Luoi Schedule 4',
                status: 'finished',
                start_time: '08:00:00',
                end_time: '18:00:00',
                enable: 1,
                is_deleted: 0,
                device_id: 'test-device-001',
                creation: new Date(),
                modified: new Date(),
                type: 'fixed',
                deleted: null,
                action: JSON.stringify({
                    luoi_1: 1,
                    set_flow: 50
                })
            };
            const result = service.mapScheduleToModbus(schedule);
            // luoi_1 should be expanded, not present as original key
            const luoiKey = result.holdingCommands.find(cmd => cmd.key === 'luoi_1');
            expect(luoiKey).toBeUndefined();
            // set_flow should still be present
            const setFlowCmd = result.holdingCommands.find(cmd => cmd.key === 'set_flow');
            expect(setFlowCmd).toBeDefined();
        });
    });
    describe('clearScheduleConfigValues', () => {
        beforeEach(() => {
            mockGlobalContext.set('configKeyValues', {});
            mockGlobalContext.set('scheduleConfigKeys', {});
            mockGlobalContext.set('configKeys', {
                'set_ec': 'number',
                'set_ph': 'number',
                'control_mode': 'number'
            });
        });
        it('should reset config values to falsy defaults', () => {
            // Setup: store some config values
            mockGlobalContext.set('configKeyValues', {
                'set_ec': 2.5,
                'set_ph': 6.0,
                'control_mode': 1
            });
            mockGlobalContext.set('scheduleConfigKeys', {
                'test-schedule': ['set_ec', 'set_ph', 'control_mode']
            });
            const resetValues = service.clearScheduleConfigValues('test-schedule');
            expect(resetValues['set_ec']).toBe(0); // number → 0
            expect(resetValues['set_ph']).toBe(0);
            expect(resetValues['control_mode']).toBe(0);
            // Verify configKeyValues was updated
            const configValues = mockGlobalContext.get('configKeyValues');
            expect(configValues['set_ec']).toBe(0);
            expect(configValues['set_ph']).toBe(0);
        });
        it('should clear schedule config key tracking', () => {
            mockGlobalContext.set('scheduleConfigKeys', {
                'test-schedule': ['set_ec']
            });
            service.clearScheduleConfigValues('test-schedule');
            const scheduleConfigKeys = mockGlobalContext.get('scheduleConfigKeys');
            expect(scheduleConfigKeys['test-schedule']).toBeUndefined();
        });
        it('should return empty object when no config keys tracked', () => {
            const resetValues = service.clearScheduleConfigValues('non-existent');
            expect(resetValues).toEqual({});
        });
    });
    describe('Debug logging', () => {
        it('should log debug messages when enabled', () => {
            const debugService = new schedule_mapper_service_1.ScheduleMapperService(mockNode, true);
            debugService.getAllModbusCoils();
            expect(mockNode.warn).toHaveBeenCalled();
        });
        it('should not log debug messages when disabled', () => {
            jest.clearAllMocks();
            const nonDebugService = new schedule_mapper_service_1.ScheduleMapperService(mockNode, false);
            nonDebugService.getAllModbusCoils();
            expect(mockNode.warn).not.toHaveBeenCalled();
        });
    });
});
