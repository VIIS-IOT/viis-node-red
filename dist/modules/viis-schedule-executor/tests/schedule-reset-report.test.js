"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viis_schedule_executor_service_1 = require("../viis-schedule-executor-service");
function createService() {
    const mockNode = {
        warn: jest.fn(),
        error: jest.fn(),
        context: () => ({
            global: { get: jest.fn(() => []), set: jest.fn() },
        }),
    };
    const service = new viis_schedule_executor_service_1.ScheduleService(mockNode, true, false, false);
    jest.spyOn(service, 'delay').mockResolvedValue(undefined);
    return service;
}
test('FINISH pump OFF verify fail still closes valves after delay', async () => {
    var _a, _b;
    const service = createService();
    const writeCoil = jest.fn().mockResolvedValue(undefined);
    const writeRegister = jest.fn().mockResolvedValue(undefined);
    const readCoils = jest.fn(async (address) => ({
        data: [address === 0 ? true : false],
    }));
    const readHoldingRegisters = jest.fn().mockResolvedValue({ data: [0] });
    const modbusClient = {
        writeCoil,
        writeRegister,
        readCoils,
        readHoldingRegisters,
    };
    const { report, allSuccessful } = await service.resetModbusCommands(modbusClient, [
        { key: 'main_pump', value: true, fc: 5, unitid: 1, address: 0, quantity: 1 },
        { key: 'valve_0', value: true, fc: 5, unitid: 1, address: 1, quantity: 1 },
    ], { name: 'reset-report' }, true);
    expect(writeCoil.mock.calls.filter((c) => c[0] === 0)).toHaveLength(3);
    expect(writeCoil.mock.calls.filter((c) => c[0] === 1)).toHaveLength(1);
    expect(report.steps.map(s => s.phase)).toEqual([
        'close_valves',
        'water_hammer_delay',
        'stop_pumps',
    ]);
    expect((_a = report.steps.find(s => s.phase === 'stop_pumps')) === null || _a === void 0 ? void 0 : _a.ok).toBe(false);
    expect((_b = report.steps.find(s => s.phase === 'close_valves')) === null || _b === void 0 ? void 0 : _b.ok).toBe(true);
    expect(allSuccessful).toBe(false);
});
test('FINISH closes valves before pumps/power and zeros holdings last', async () => {
    const service = createService();
    const writeCoil = jest.fn().mockResolvedValue(undefined);
    const writeRegister = jest.fn().mockResolvedValue(undefined);
    const modbusClient = {
        writeCoil,
        writeRegister,
        readCoils: jest.fn().mockResolvedValue({ data: [false] }),
        readHoldingRegisters: jest.fn().mockResolvedValue({ data: [0] }),
    };
    const { report } = await service.resetModbusCommands(modbusClient, [
        { key: 'valve_program', value: 4200, fc: 6, unitid: 1, address: 20, quantity: 1 },
        { key: 'control_mode', value: 1, fc: 6, unitid: 1, address: 1, quantity: 1 },
        { key: 'main_pump', value: true, fc: 5, unitid: 1, address: 0, quantity: 1 },
        { key: 'power', value: true, fc: 5, unitid: 1, address: 30, quantity: 1 },
        { key: 'valve_3', value: true, fc: 5, unitid: 1, address: 12, quantity: 1 },
    ], { name: 'finish-order' }, true);
    expect(report.steps.map(s => s.phase)).toEqual([
        'close_valves',
        'water_hammer_delay',
        'stop_pumps',
        'system_power',
        'reset_holding',
    ]);
    const firstValve = writeCoil.mock.calls.findIndex((c) => c[0] === 12);
    const firstPump = writeCoil.mock.calls.findIndex((c) => c[0] === 0);
    const firstPower = writeCoil.mock.calls.findIndex((c) => c[0] === 30);
    const firstValveProgramOff = writeRegister.mock.calls.findIndex((c) => c[0] === 20 && c[1] === 0);
    expect(firstValve).toBeGreaterThanOrEqual(0);
    expect(firstPump).toBeGreaterThan(firstValve);
    expect(firstPower).toBeGreaterThan(firstPump);
    expect(firstValveProgramOff).toBeGreaterThanOrEqual(0);
    expect(writeRegister.mock.invocationCallOrder[firstValveProgramOff])
        .toBeGreaterThan(writeCoil.mock.invocationCallOrder[firstPower]);
});
