"use strict";
/**
 * Unit tests for ProtectionGateService integration in ScheduleService (V1)
 * Tests gate check before coil writes and state update after writes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const viis_schedule_executor_service_1 = require("../viis-schedule-executor-service");
// Mock Node-RED node
const mockNode = {
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
    context: jest.fn(() => ({
        global: {
            get: jest.fn((key) => {
                if (key === 'scaleConfigs')
                    return [];
                if (key === 'activeModbusCommands')
                    return {};
                if (key === 'manualModbusOverrides')
                    return {};
                return null;
            }),
            set: jest.fn()
        },
        flow: {
            get: jest.fn(),
            set: jest.fn()
        }
    }))
};
// Mock Modbus client
const createMockModbusClient = () => ({
    readCoils: jest.fn().mockResolvedValue({ data: [false] }),
    readHoldingRegisters: jest.fn().mockResolvedValue({ data: [0] }),
    writeCoil: jest.fn().mockResolvedValue(undefined),
    writeRegister: jest.fn().mockResolvedValue(undefined),
});
// Mock ProtectionGateService
const createMockGate = () => ({
    checkGate: jest.fn().mockReturnValue({ allowed: true, reason: 'OK', action: 'allow' }),
    updateState: jest.fn(),
    refreshConfig: jest.fn(),
    syncCoilState: jest.fn(),
    updateSensorValue: jest.fn(),
    getProtectionConfigForCoil: jest.fn(),
    getSensorIdForCoil: jest.fn(),
    getCoilState: jest.fn(),
});
describe('ScheduleService - Protection Gate Integration', () => {
    let service;
    let mockModbus;
    let mockGate;
    beforeEach(() => {
        jest.clearAllMocks();
        service = new viis_schedule_executor_service_1.ScheduleService(mockNode, true, true, true);
        mockModbus = createMockModbusClient();
        mockGate = createMockGate();
    });
    describe('setProtectionGate', () => {
        test('should set gate service', () => {
            service.setProtectionGate(mockGate);
            expect(service.protectionGate).toBe(mockGate);
        });
    });
    describe('executeModbusCommands - Gate allows ON', () => {
        test('should write coil and call updateState when gate allows', async () => {
            service.setProtectionGate(mockGate);
            mockGate.checkGate.mockReturnValue({ allowed: true, reason: 'OK', action: 'allow' });
            const commands = {
                holdingCommands: [],
                coilCommands: [
                    { key: 'lamp_control_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
                ]
            };
            await service.executeModbusCommands(mockModbus, commands);
            expect(mockGate.checkGate).toHaveBeenCalledWith('lamp_control_1', true, 'schedule');
            expect(mockModbus.writeCoil).toHaveBeenCalledWith(10, true);
            expect(mockGate.updateState).toHaveBeenCalledWith('lamp_control_1', true);
        });
    });
    describe('executeModbusCommands - Gate blocks ON', () => {
        test('should skip blocked coil and not call writeCoil', async () => {
            service.setProtectionGate(mockGate);
            mockGate.checkGate.mockReturnValue({
                allowed: false,
                reason: 'Min off time not met',
                action: 'block',
            });
            const commands = {
                holdingCommands: [],
                coilCommands: [
                    { key: 'lamp_control_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
                ]
            };
            await service.executeModbusCommands(mockModbus, commands);
            expect(mockGate.checkGate).toHaveBeenCalledWith('lamp_control_1', true, 'schedule');
            expect(mockModbus.writeCoil).not.toHaveBeenCalled();
            expect(mockGate.updateState).not.toHaveBeenCalled();
            expect(mockNode.warn).toHaveBeenCalledWith(expect.stringContaining('[PROTECTION] Schedule coil blocked: lamp_control_1'));
        });
    });
    describe('executeModbusCommands - Mixed blocked and allowed', () => {
        test('should write allowed coils and skip blocked ones', async () => {
            service.setProtectionGate(mockGate);
            mockGate.checkGate
                .mockReturnValueOnce({ allowed: false, reason: 'Max time exceeded', action: 'block' })
                .mockReturnValueOnce({ allowed: true, reason: 'OK', action: 'allow' });
            const commands = {
                holdingCommands: [],
                coilCommands: [
                    { key: 'lamp_control_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 },
                    { key: 'fan_control_1', value: true, fc: 5, unitid: 1, address: 11, quantity: 1 },
                ]
            };
            await service.executeModbusCommands(mockModbus, commands);
            expect(mockModbus.writeCoil).toHaveBeenCalledTimes(1);
            expect(mockModbus.writeCoil).toHaveBeenCalledWith(11, true);
            expect(mockGate.updateState).toHaveBeenCalledTimes(1);
            expect(mockGate.updateState).toHaveBeenCalledWith('fan_control_1', true);
        });
    });
    describe('executeModbusCommands - OFF always allowed', () => {
        test('should write OFF without gate check', async () => {
            service.setProtectionGate(mockGate);
            const commands = {
                holdingCommands: [],
                coilCommands: [
                    { key: 'lamp_control_1', value: false, fc: 5, unitid: 1, address: 10, quantity: 1 }
                ]
            };
            await service.executeModbusCommands(mockModbus, commands);
            // Gate check should NOT be called for OFF commands
            expect(mockGate.checkGate).not.toHaveBeenCalled();
            expect(mockModbus.writeCoil).toHaveBeenCalledWith(10, false);
            expect(mockGate.updateState).toHaveBeenCalledWith('lamp_control_1', false);
        });
    });
    describe('executeModbusCommands - No gate set', () => {
        test('should write coil normally when no gate is set', async () => {
            // Don't set gate
            const commands = {
                holdingCommands: [],
                coilCommands: [
                    { key: 'lamp_control_1', value: true, fc: 5, unitid: 1, address: 10, quantity: 1 }
                ]
            };
            await service.executeModbusCommands(mockModbus, commands);
            expect(mockModbus.writeCoil).toHaveBeenCalledWith(10, true);
        });
    });
    describe('executeModbusCommands - Holding registers bypass gate', () => {
        test('should not check gate for holding register commands (fc=6)', async () => {
            service.setProtectionGate(mockGate);
            const commands = {
                holdingCommands: [
                    { key: 'temperature_setpoint', value: 25, fc: 6, unitid: 1, address: 100, quantity: 1 }
                ],
                coilCommands: []
            };
            await service.executeModbusCommands(mockModbus, commands);
            expect(mockGate.checkGate).not.toHaveBeenCalled();
            expect(mockModbus.writeRegister).toHaveBeenCalledWith(100, 25);
        });
    });
    describe('executeModbusCommands - Default order with gate', () => {
        test('should check gate in default order when no schedule provided', async () => {
            service.setProtectionGate(mockGate);
            mockGate.checkGate.mockReturnValue({ allowed: true, reason: 'OK', action: 'allow' });
            const commands = {
                holdingCommands: [],
                coilCommands: [
                    { key: 'pump_control_1', value: true, fc: 5, unitid: 1, address: 20, quantity: 1 }
                ]
            };
            // No schedule → default order
            await service.executeModbusCommands(mockModbus, commands);
            expect(mockGate.checkGate).toHaveBeenCalledWith('pump_control_1', true, 'schedule');
            expect(mockModbus.writeCoil).toHaveBeenCalledWith(20, true);
            expect(mockGate.updateState).toHaveBeenCalledWith('pump_control_1', true);
        });
    });
});
