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
