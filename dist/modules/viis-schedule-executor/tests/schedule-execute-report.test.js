"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viis_schedule_executor_service_1 = require("../viis-schedule-executor-service");
const schedule_execution_types_1 = require("../schedule-execution-types");
function createService(skipCoilVerify = false) {
    const mockNode = {
        warn: jest.fn(),
        error: jest.fn(),
        context: () => ({
            global: { get: jest.fn(() => []), set: jest.fn() },
        }),
    };
    const service = new viis_schedule_executor_service_1.ScheduleService(mockNode, true, false, skipCoilVerify);
    jest.spyOn(service, 'delay').mockResolvedValue(undefined);
    return service;
}
function createSchedule() {
    return {
        name: 'exec-report',
        label: 'Exec report',
        status: 'running',
        action: '{}',
    };
}
test('per-key retry does not stop later coils; report lists only failed pump', async () => {
    const service = createService(false);
    const writeCoil = jest.fn().mockResolvedValue(undefined);
    const writeRegister = jest.fn().mockResolvedValue(undefined);
    const readCoils = jest.fn(async (address) => ({
        data: [address === 0 ? false : true],
    }));
    const readHoldingRegisters = jest.fn().mockResolvedValue({ data: [100] });
    const modbusClient = {
        writeCoil,
        writeRegister,
        readCoils,
        readHoldingRegisters,
    };
    const report = await service.executeModbusCommands(modbusClient, {
        holdingCommands: [
            { key: 'setpoint', value: 100, fc: 6, unitid: 1, address: 20, quantity: 1 },
        ],
        coilCommands: [
            { key: 'valve_0', value: true, fc: 5, unitid: 1, address: 1, quantity: 1 },
            { key: 'main_pump', value: true, fc: 5, unitid: 1, address: 0, quantity: 1 },
            { key: 'power', value: true, fc: 5, unitid: 1, address: 30, quantity: 1 },
        ],
    }, createSchedule(), { runId: 'run-exec' });
    expect(writeCoil).toHaveBeenCalledWith(0, true);
    expect(writeCoil.mock.calls.filter((c) => c[0] === 0)).toHaveLength(3);
    expect(writeCoil.mock.calls.filter((c) => c[0] === 30)).toHaveLength(1);
    expect(report.steps.map(s => s.phase)).toEqual([
        'set_holding',
        'open_valves',
        'water_hammer_delay',
        'start_pumps',
        'system_power',
    ]);
    expect((0, schedule_execution_types_1.failedOutcomes)(report).map(k => k.key)).toEqual(['main_pump']);
    expect(report.runId).toBe('run-exec');
});
