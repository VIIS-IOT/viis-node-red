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
        'stop_pumps',
        'water_hammer_delay',
        'close_valves',
    ]);
    expect((_a = report.steps.find(s => s.phase === 'stop_pumps')) === null || _a === void 0 ? void 0 : _a.ok).toBe(false);
    expect((_b = report.steps.find(s => s.phase === 'close_valves')) === null || _b === void 0 ? void 0 : _b.ok).toBe(true);
    expect(allSuccessful).toBe(false);
});
