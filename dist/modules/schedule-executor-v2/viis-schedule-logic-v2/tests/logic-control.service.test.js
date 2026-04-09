"use strict";
/**
 * Unit tests for LogicControlService
 * Tests control mode checks, safety conditions, and command overlap detection
 */
Object.defineProperty(exports, "__esModule", { value: true });
const logic_control_service_1 = require("../logic-control-service");
// Shared mock global context - accessible in all tests
let mockGlobalContext;
// Mock Node-RED node - create context object once to maintain reference
const createMockNode = () => {
    const contextObject = {
        global: {
            get: jest.fn((key) => mockGlobalContext.get(key)),
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
// NOTE: We don't mock GlobalContextHelper - it uses node.context() which we mock above
describe('LogicControlService', () => {
    let service;
    let mockNode;
    beforeEach(() => {
        jest.clearAllMocks();
        mockGlobalContext = new Map();
        // Set default CONTROL_MODE to AUTO (1)
        mockGlobalContext.set('CONTROL_MODE', 1);
        mockNode = createMockNode();
        service = new logic_control_service_1.LogicControlService(mockNode, true);
    });
    describe('Constructor', () => {
        it('should initialize with debug enabled', () => {
            const debugService = new logic_control_service_1.LogicControlService(mockNode, true);
            expect(debugService).toBeDefined();
        });
        it('should initialize with debug disabled', () => {
            const nonDebugService = new logic_control_service_1.LogicControlService(mockNode, false);
            expect(nonDebugService).toBeDefined();
        });
    });
    describe('readControlMode', () => {
        it('should return AUTO when control mode is 1', async () => {
            mockGlobalContext.set('CONTROL_MODE', 1);
            const mode = await service.readControlMode();
            expect(mode).toBe('AUTO');
        });
        it('should return OFF when control mode is 0', async () => {
            // Mock control mode as 0 (OFF)
            mockGlobalContext.set('CONTROL_MODE', 0);
            // Create new service instance to pick up the updated mock
            const mockService = new logic_control_service_1.LogicControlService(mockNode, false);
            const mode = await mockService.readControlMode();
            expect(mode).toBe('OFF');
        });
        it('should return MANUAL when control mode is 2', async () => {
            mockGlobalContext.set('CONTROL_MODE', 2);
            // Create new service instance to pick up the updated mock
            const mockService = new logic_control_service_1.LogicControlService(mockNode, false);
            const mode = await mockService.readControlMode();
            expect(mode).toBe('MANUAL');
        });
        it('should default to AUTO on error', async () => {
            // Simulate error by clearing CONTROL_MODE
            mockGlobalContext.set('CONTROL_MODE', null);
            const mockService = new logic_control_service_1.LogicControlService(mockNode, false);
            mockService.globalHelper.getJsonEnvVar = jest.fn().mockImplementation(() => {
                throw new Error('Not found');
            });
            const mode = await mockService.readControlMode();
            expect(mode).toBe('AUTO');
        });
    });
    describe('readSafetyConditions', () => {
        beforeEach(() => {
            // Initialize default safety conditions
            mockGlobalContext.set('water_level_low', false);
            mockGlobalContext.set('water_level_high', false);
            mockGlobalContext.set('emergency_stop', false);
            mockGlobalContext.set('pump_error', false);
            mockGlobalContext.set('flow_error', false);
            mockGlobalContext.set('ec_error', false);
            mockGlobalContext.set('ph_error', false);
        });
        it('should return safety conditions from global context', async () => {
            const conditions = await service.readSafetyConditions();
            expect(conditions.water_level_low).toBe(false);
            expect(conditions.emergency_stop).toBe(false);
            expect(conditions.pump_error).toBe(false);
            expect(conditions.flow_error).toBe(false);
        });
        it('should return true for blocking conditions when set', async () => {
            mockGlobalContext.set('water_level_low', true);
            mockGlobalContext.set('emergency_stop', true);
            const conditions = await service.readSafetyConditions();
            expect(conditions.water_level_low).toBe(true);
            expect(conditions.emergency_stop).toBe(true);
        });
        it('should default to false when conditions not in context', async () => {
            const conditions = await service.readSafetyConditions();
            expect(conditions.water_level_low).toBe(false);
            expect(conditions.emergency_stop).toBe(false);
        });
    });
    describe('checkControlMode', () => {
        it('should block when mode is OFF', () => {
            const result = service.checkControlMode('OFF');
            expect(result.allowed).toBe(false);
            expect(result.blockedReason).toContain('OFF');
        });
        it('should allow when mode is AUTO', () => {
            const result = service.checkControlMode('AUTO');
            expect(result.allowed).toBe(true);
            expect(result.blockedReason).toBeUndefined();
        });
        it('should allow when mode is MANUAL', () => {
            const result = service.checkControlMode('MANUAL');
            expect(result.allowed).toBe(true);
        });
    });
    describe('checkSafetyConditions', () => {
        it('should block when emergency_stop is true', () => {
            const conditions = {
                water_level_low: false,
                water_level_high: false,
                emergency_stop: true,
                pump_error: false,
                flow_error: false,
                ec_error: false,
                ph_error: false
            };
            const result = service.checkSafetyConditions(conditions);
            expect(result.allowed).toBe(false);
            expect(result.blockedReason).toContain('Emergency stop');
        });
        it('should block when water_level_low is true', () => {
            const conditions = {
                water_level_low: true,
                water_level_high: false,
                emergency_stop: false,
                pump_error: false,
                flow_error: false,
                ec_error: false,
                ph_error: false
            };
            const result = service.checkSafetyConditions(conditions);
            expect(result.allowed).toBe(false);
            expect(result.blockedReason).toContain('Water level');
        });
        it('should block when pump_error is true', () => {
            const conditions = {
                water_level_low: false,
                water_level_high: false,
                emergency_stop: false,
                pump_error: true,
                flow_error: false,
                ec_error: false,
                ph_error: false
            };
            const result = service.checkSafetyConditions(conditions);
            expect(result.allowed).toBe(false);
            expect(result.blockedReason).toContain('Pump error');
        });
        it('should block when flow_error is true', () => {
            const conditions = {
                water_level_low: false,
                water_level_high: false,
                emergency_stop: false,
                pump_error: false,
                flow_error: true,
                ec_error: false,
                ph_error: false
            };
            const result = service.checkSafetyConditions(conditions);
            expect(result.allowed).toBe(false);
            expect(result.blockedReason).toContain('Flow error');
        });
        it('should allow when all conditions are false', () => {
            const conditions = {
                water_level_low: false,
                water_level_high: false,
                emergency_stop: false,
                pump_error: false,
                flow_error: false,
                ec_error: false,
                ph_error: false
            };
            const result = service.checkSafetyConditions(conditions);
            expect(result.allowed).toBe(true);
        });
        it('should allow when only ec_error is true (non-blocking)', () => {
            const conditions = {
                water_level_low: false,
                water_level_high: false,
                emergency_stop: false,
                pump_error: false,
                flow_error: false,
                ec_error: true,
                ph_error: false
            };
            const result = service.checkSafetyConditions(conditions);
            expect(result.allowed).toBe(true);
        });
    });
    describe('hasCommandOverlap', () => {
        it('should detect overlapping commands', () => {
            const activeCommands = {
                'schedule-1': [
                    { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
                ]
            };
            const newCommands = [
                { key: 'valve_1', value: false, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];
            const result = service.hasCommandOverlap(newCommands, activeCommands);
            expect(result).toBe(true);
        });
        it('should not detect overlap when commands are different', () => {
            const activeCommands = {
                'schedule-1': [
                    { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
                ]
            };
            const newCommands = [
                { key: 'valve_2', value: true, fc: 5, unitid: 1, address: 11, quantity: 1 }
            ];
            const result = service.hasCommandOverlap(newCommands, activeCommands);
            expect(result).toBe(false);
        });
        it('should handle empty active commands', () => {
            const activeCommands = {};
            const newCommands = [
                { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];
            const result = service.hasCommandOverlap(newCommands, activeCommands);
            expect(result).toBe(false);
        });
    });
    describe('getManualOverrides', () => {
        beforeEach(() => {
            mockGlobalContext.set('manualModbusOverrides', {});
        });
        it('should return manual overrides when present', () => {
            const commands = [
                { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];
            mockGlobalContext.set('manualModbusOverrides', {
                '5_10': { fc: 5, value: false, timestamp: Date.now() }
            });
            const overrides = service.getManualOverrides(commands);
            expect(overrides).toHaveLength(1);
            expect(overrides[0].key).toBe('valve_1');
            expect(overrides[0].overrideValue).toBe(false);
        });
        it('should return empty array when no overrides', () => {
            const commands = [
                { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];
            const overrides = service.getManualOverrides(commands);
            expect(overrides).toHaveLength(0);
        });
    });
    describe('applyManualOverrides', () => {
        beforeEach(() => {
            mockGlobalContext.set('manualModbusOverrides', {});
        });
        it('should apply overrides to commands', () => {
            const commands = [
                { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];
            mockGlobalContext.set('manualModbusOverrides', {
                '5_10': { fc: 5, value: false, timestamp: Date.now() }
            });
            const result = service.applyManualOverrides(commands);
            expect(result).toHaveLength(1);
            expect(result[0].value).toBe(false);
        });
        it('should not modify commands without overrides', () => {
            const commands = [
                { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
            ];
            const result = service.applyManualOverrides(commands);
            expect(result).toHaveLength(1);
            expect(result[0].value).toBe(true);
        });
    });
    describe('checkBeforeExecute - Integration', () => {
        beforeEach(() => {
            // Initialize default safety conditions
            mockGlobalContext.set('water_level_low', false);
            mockGlobalContext.set('water_level_high', false);
            mockGlobalContext.set('emergency_stop', false);
            mockGlobalContext.set('pump_error', false);
            mockGlobalContext.set('flow_error', false);
            mockGlobalContext.set('ec_error', false);
            mockGlobalContext.set('ph_error', false);
            mockGlobalContext.set('manualModbusOverrides', {});
            mockGlobalContext.set('activeModbusCommands', {});
        });
        it('should allow execution when mode is AUTO and conditions are OK', async () => {
            const input = {
                schedules: [],
                commands: [
                    { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
                ]
            };
            const result = await service.checkBeforeExecute(input);
            expect(result.allowed).toBe(true);
            expect(result.mode).toBe('AUTO');
        });
        it('should block execution when mode is OFF', async () => {
            mockGlobalContext.set('CONTROL_MODE', 0); // OFF
            const mockService = new logic_control_service_1.LogicControlService(mockNode, false);
            const input = {
                schedules: [],
                commands: []
            };
            const result = await mockService.checkBeforeExecute(input);
            expect(result.allowed).toBe(false);
            expect(result.mode).toBe('OFF');
            expect(result.blockedReason).toContain('OFF');
        });
        it('should block execution when emergency_stop is active', async () => {
            mockGlobalContext.set('emergency_stop', true);
            const input = {
                schedules: [],
                commands: []
            };
            const result = await service.checkBeforeExecute(input);
            expect(result.allowed).toBe(false);
            expect(result.blockedReason).toContain('Emergency stop');
        });
        it('should apply manual overrides to commands', async () => {
            mockGlobalContext.set('manualModbusOverrides', {
                '5_10': { fc: 5, value: false, timestamp: Date.now() }
            });
            const input = {
                schedules: [],
                commands: [
                    { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
                ]
            };
            const result = await service.checkBeforeExecute(input);
            expect(result.allowed).toBe(true);
            expect(result.commands[0].value).toBe(false);
        });
    });
    describe('handleRpcSetMode', () => {
        it('should set control mode to AUTO', async () => {
            const success = await service.handleRpcSetMode('AUTO');
            expect(success).toBe(true);
            expect(mockNode.context().global.set).toHaveBeenCalledWith('CONTROL_MODE', 1 // Numeric value for AUTO
            );
        });
        it('should set control mode to OFF', async () => {
            const success = await service.handleRpcSetMode('OFF');
            expect(success).toBe(true);
            expect(mockNode.context().global.set).toHaveBeenCalledWith('CONTROL_MODE', 0 // Numeric value for OFF
            );
        });
        it('should set control mode to MANUAL', async () => {
            const success = await service.handleRpcSetMode('MANUAL');
            expect(success).toBe(true);
            expect(mockNode.context().global.set).toHaveBeenCalledWith('CONTROL_MODE', 2 // Numeric value for MANUAL
            );
        });
    });
    describe('clearManualOverrides', () => {
        beforeEach(() => {
            mockGlobalContext.set('manualModbusOverrides', {});
        });
        it('should clear specific override', () => {
            mockGlobalContext.set('manualModbusOverrides', {
                '5_10': { fc: 5, value: false, timestamp: Date.now() },
                '5_11': { fc: 5, value: true, timestamp: Date.now() }
            });
            service.clearManualOverride(5, 10);
            // Check that global.set was called with updated overrides
            const setCalls = mockNode.context().global.set.mock.calls;
            const lastCall = setCalls[setCalls.length - 1];
            expect(lastCall[0]).toBe('manualModbusOverrides');
            expect(lastCall[1]['5_10']).toBeUndefined();
            expect(lastCall[1]['5_11']).toBeDefined();
        });
        it('should clear all overrides', () => {
            mockGlobalContext.set('manualModbusOverrides', {
                '5_10': { fc: 5, value: false, timestamp: Date.now() }
            });
            service.clearAllManualOverrides();
            // Check that global.set was called with empty object
            const setCalls = mockNode.context().global.set.mock.calls;
            const lastCall = setCalls[setCalls.length - 1];
            expect(lastCall[0]).toBe('manualModbusOverrides');
            expect(lastCall[1]).toEqual({});
        });
    });
    describe('Debug logging', () => {
        it('should log debug messages when enabled', () => {
            const debugService = new logic_control_service_1.LogicControlService(mockNode, true);
            debugService.checkControlMode('AUTO');
            expect(mockNode.warn).toHaveBeenCalled();
        });
        it('should not log debug messages when disabled', () => {
            jest.clearAllMocks();
            const nonDebugService = new logic_control_service_1.LogicControlService(mockNode, false);
            nonDebugService.checkControlMode('AUTO');
            expect(mockNode.warn).not.toHaveBeenCalled();
        });
    });
});
