"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viis_schedule_executor_service_1 = require("../viis-schedule-executor-service");
const mockNode = {
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
    context: () => ({
        global: { get: jest.fn(() => []), set: jest.fn() },
    }),
};
function createSchedule() {
    return {
        name: 'delay-config',
        label: 'Delay config',
        status: 'running',
        action: '{}',
    };
}
test('resolveWaterHammerDelayMs defaults to 7s when missing or invalid', () => {
    expect((0, viis_schedule_executor_service_1.resolveWaterHammerDelayMs)(undefined)).toBe(viis_schedule_executor_service_1.DEFAULT_WATER_HAMMER_DELAY_MS);
    expect((0, viis_schedule_executor_service_1.resolveWaterHammerDelayMs)('')).toBe(viis_schedule_executor_service_1.DEFAULT_WATER_HAMMER_DELAY_MS);
    expect((0, viis_schedule_executor_service_1.resolveWaterHammerDelayMs)('abc')).toBe(viis_schedule_executor_service_1.DEFAULT_WATER_HAMMER_DELAY_MS);
    expect((0, viis_schedule_executor_service_1.resolveWaterHammerDelayMs)(-1)).toBe(viis_schedule_executor_service_1.DEFAULT_WATER_HAMMER_DELAY_MS);
    expect(viis_schedule_executor_service_1.DEFAULT_WATER_HAMMER_DELAY_MS).toBe(7000);
});
test('resolveWaterHammerDelayMs accepts seconds from UI number or string', () => {
    expect((0, viis_schedule_executor_service_1.resolveWaterHammerDelayMs)(7)).toBe(7000);
    expect((0, viis_schedule_executor_service_1.resolveWaterHammerDelayMs)('20')).toBe(20000);
    expect((0, viis_schedule_executor_service_1.resolveWaterHammerDelayMs)(0)).toBe(0);
});
test('constructor stores default 7s delay and accepts a custom value', () => {
    const defaultService = new viis_schedule_executor_service_1.ScheduleService(mockNode);
    expect(defaultService.waterHammerDelayMs).toBe(7000);
    const customService = new viis_schedule_executor_service_1.ScheduleService(mockNode, true, false, true, 20000);
    expect(customService.waterHammerDelayMs).toBe(20000);
});
test('START waits the configured delay between valves and pump/power', async () => {
    const service = new viis_schedule_executor_service_1.ScheduleService(mockNode, true, false, true, 20000);
    const delaySpy = jest.spyOn(service, 'delay').mockResolvedValue(undefined);
    const writeCoil = jest.fn().mockResolvedValue(undefined);
    const writeRegister = jest.fn().mockResolvedValue(undefined);
    const modbusClient = {
        writeCoil,
        writeRegister,
        readCoils: jest.fn(),
        readHoldingRegisters: jest.fn(),
    };
    await service.executeModbusCommands(modbusClient, {
        holdingCommands: [],
        coilCommands: [
            { key: 'valve_0', value: true, fc: 5, unitid: 1, address: 1, quantity: 1 },
            { key: 'power', value: true, fc: 5, unitid: 1, address: 30, quantity: 1 },
        ],
    }, createSchedule(), { runId: 'run-delay' });
    expect(delaySpy).toHaveBeenCalledWith(20000);
});
