import { ScheduleService } from '../viis-schedule-executor-service';
import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';
import { Node } from 'node-red';
import { ModbusClientCore } from '../../../core/modbus-client';

function createService(): ScheduleService {
    const mockNode = {
        warn: jest.fn(),
        error: jest.fn(),
        context: () => ({
            global: { get: jest.fn(() => []), set: jest.fn() },
        }),
    } as unknown as Node;
    const service = new ScheduleService(mockNode, true, false, false);
    jest.spyOn(service, 'delay').mockResolvedValue(undefined);
    return service;
}

test('FINISH pump OFF verify fail still closes valves after delay', async () => {
    const service = createService();
    const writeCoil = jest.fn().mockResolvedValue(undefined);
    const writeRegister = jest.fn().mockResolvedValue(undefined);
    const readCoils = jest.fn(async (address: number) => ({
        data: [address === 0 ? true : false],
    }));
    const readHoldingRegisters = jest.fn().mockResolvedValue({ data: [0] });
    const modbusClient = {
        writeCoil,
        writeRegister,
        readCoils,
        readHoldingRegisters,
    } as unknown as ModbusClientCore;

    const { report, allSuccessful } = await service.resetModbusCommands(
        modbusClient,
        [
            { key: 'main_pump', value: true, fc: 5, unitid: 1, address: 0, quantity: 1 },
            { key: 'valve_0', value: true, fc: 5, unitid: 1, address: 1, quantity: 1 },
        ],
        { name: 'reset-report' } as TabiotSchedule,
        true
    );

    expect(writeCoil.mock.calls.filter((c: any[]) => c[0] === 0)).toHaveLength(3);
    expect(writeCoil.mock.calls.filter((c: any[]) => c[0] === 1)).toHaveLength(1);
    expect(report.steps.map(s => s.phase)).toEqual([
        'stop_pumps',
        'water_hammer_delay',
        'close_valves',
    ]);
    expect(report.steps.find(s => s.phase === 'stop_pumps')?.ok).toBe(false);
    expect(report.steps.find(s => s.phase === 'close_valves')?.ok).toBe(true);
    expect(allSuccessful).toBe(false);
});

test('FINISH stops pumps, delays, closes valves, then zeros holdings and power', async () => {
    const service = createService();
    const writeCoil = jest.fn().mockResolvedValue(undefined);
    const writeRegister = jest.fn().mockResolvedValue(undefined);
    const modbusClient = {
        writeCoil,
        writeRegister,
        readCoils: jest.fn().mockResolvedValue({ data: [false] }),
        readHoldingRegisters: jest.fn().mockResolvedValue({ data: [0] }),
    } as unknown as ModbusClientCore;

    const { report } = await service.resetModbusCommands(
        modbusClient,
        [
            { key: 'valve_program', value: 4200, fc: 6, unitid: 1, address: 20, quantity: 1 },
            { key: 'control_mode', value: 1, fc: 6, unitid: 1, address: 1, quantity: 1 },
            { key: 'main_pump', value: true, fc: 5, unitid: 1, address: 0, quantity: 1 },
            { key: 'power', value: true, fc: 5, unitid: 1, address: 30, quantity: 1 },
            { key: 'valve_3', value: true, fc: 5, unitid: 1, address: 12, quantity: 1 },
        ],
        { name: 'finish-order' } as TabiotSchedule,
        true
    );

    expect(report.steps.map(s => s.phase)).toEqual([
        'stop_pumps',
        'water_hammer_delay',
        'close_valves',
        'reset_holding',
        'system_power',
    ]);

    const firstValve = writeCoil.mock.calls.findIndex((c: any[]) => c[0] === 12);
    const firstPump = writeCoil.mock.calls.findIndex((c: any[]) => c[0] === 0);
    const firstPower = writeCoil.mock.calls.findIndex((c: any[]) => c[0] === 30);
    const firstValveProgramOff = writeRegister.mock.calls.findIndex((c: any[]) => c[0] === 20 && c[1] === 0);
    expect(firstPump).toBeGreaterThanOrEqual(0);
    expect(firstValve).toBeGreaterThan(firstPump);
    expect(firstValveProgramOff).toBeGreaterThanOrEqual(0);
    expect(writeRegister.mock.invocationCallOrder[firstValveProgramOff])
        .toBeGreaterThan(writeCoil.mock.invocationCallOrder[firstValve]);
    expect(firstPower).toBeGreaterThan(-1);
    expect(writeCoil.mock.invocationCallOrder[firstPower])
        .toBeGreaterThan(writeRegister.mock.invocationCallOrder[firstValveProgramOff]);
});
