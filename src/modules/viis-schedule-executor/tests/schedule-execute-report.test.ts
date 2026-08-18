import { ScheduleService } from '../viis-schedule-executor-service';
import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';
import { Node } from 'node-red';
import { failedOutcomes } from '../schedule-execution-types';
import { ModbusClientCore } from '../../../core/modbus-client';

function createService(skipCoilVerify = false): ScheduleService {
    const mockNode = {
        warn: jest.fn(),
        error: jest.fn(),
        context: () => ({
            global: { get: jest.fn(() => []), set: jest.fn() },
        }),
    } as unknown as Node;
    const service = new ScheduleService(mockNode, true, false, skipCoilVerify);
    jest.spyOn(service, 'delay').mockResolvedValue(undefined);
    return service;
}

function createSchedule(): TabiotSchedule {
    return {
        name: 'exec-report',
        label: 'Exec report',
        status: 'running',
        action: '{}',
    } as TabiotSchedule;
}

test('per-key retry does not stop later coils; report lists only failed pump', async () => {
    const service = createService(false);
    const writeCoil = jest.fn().mockResolvedValue(undefined);
    const writeRegister = jest.fn().mockResolvedValue(undefined);
    const readCoils = jest.fn(async (address: number) => ({
        data: [address === 0 ? false : true],
    }));
    const readHoldingRegisters = jest.fn().mockResolvedValue({ data: [100] });
    const modbusClient = {
        writeCoil,
        writeRegister,
        readCoils,
        readHoldingRegisters,
    } as unknown as ModbusClientCore;

    const report = await service.executeModbusCommands(
        modbusClient,
        {
            holdingCommands: [
                { key: 'setpoint', value: 100, fc: 6, unitid: 1, address: 20, quantity: 1 },
            ],
            coilCommands: [
                { key: 'valve_0', value: true, fc: 5, unitid: 1, address: 1, quantity: 1 },
                { key: 'main_pump', value: true, fc: 5, unitid: 1, address: 0, quantity: 1 },
                { key: 'power', value: true, fc: 5, unitid: 1, address: 30, quantity: 1 },
            ],
        },
        createSchedule(),
        { runId: 'run-exec' }
    );

    expect(writeCoil).toHaveBeenCalledWith(0, true);
    expect(writeCoil.mock.calls.filter((c: any[]) => c[0] === 0)).toHaveLength(3);
    expect(writeCoil.mock.calls.filter((c: any[]) => c[0] === 30)).toHaveLength(1);
    expect(report.steps.map(s => s.phase)).toEqual([
        'set_holding',
        'open_valves',
        'water_hammer_delay',
        'start_pumps',
        'system_power',
    ]);
    expect(failedOutcomes(report).map(k => k.key)).toEqual(['main_pump']);
    expect(report.runId).toBe('run-exec');
});
