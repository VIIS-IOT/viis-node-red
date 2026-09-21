import {
    DEFAULT_WATER_HAMMER_DELAY_MS,
    resolveWaterHammerDelayMs,
    ScheduleService,
} from '../viis-schedule-executor-service';
import { ModbusClientCore } from '../../../core/modbus-client';
import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';
import { Node } from 'node-red';

const mockNode = {
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
    context: () => ({
        global: { get: jest.fn(() => []), set: jest.fn() },
    }),
} as unknown as Node;

function createSchedule(): TabiotSchedule {
    return {
        name: 'delay-config',
        label: 'Delay config',
        status: 'running',
        action: '{}',
    } as TabiotSchedule;
}

test('resolveWaterHammerDelayMs defaults to 7s when missing or invalid', () => {
    expect(resolveWaterHammerDelayMs(undefined)).toBe(DEFAULT_WATER_HAMMER_DELAY_MS);
    expect(resolveWaterHammerDelayMs('')).toBe(DEFAULT_WATER_HAMMER_DELAY_MS);
    expect(resolveWaterHammerDelayMs('abc')).toBe(DEFAULT_WATER_HAMMER_DELAY_MS);
    expect(resolveWaterHammerDelayMs(-1)).toBe(DEFAULT_WATER_HAMMER_DELAY_MS);
    expect(DEFAULT_WATER_HAMMER_DELAY_MS).toBe(7000);
});

test('resolveWaterHammerDelayMs accepts seconds from UI number or string', () => {
    expect(resolveWaterHammerDelayMs(7)).toBe(7000);
    expect(resolveWaterHammerDelayMs('20')).toBe(20000);
    expect(resolveWaterHammerDelayMs(0)).toBe(0);
});

test('constructor stores default 7s delay and accepts a custom value', () => {
    const defaultService = new ScheduleService(mockNode);
    expect((defaultService as any).waterHammerDelayMs).toBe(7000);

    const customService = new ScheduleService(mockNode, true, false, true, 20000);
    expect((customService as any).waterHammerDelayMs).toBe(20000);
});

test('START waits the configured delay between valves and pump/power', async () => {
    const service = new ScheduleService(mockNode, true, false, true, 20000);
    const delaySpy = jest.spyOn(service, 'delay').mockResolvedValue(undefined);
    const writeCoil = jest.fn().mockResolvedValue(undefined);
    const writeRegister = jest.fn().mockResolvedValue(undefined);
    const modbusClient = {
        writeCoil,
        writeRegister,
        readCoils: jest.fn(),
        readHoldingRegisters: jest.fn(),
    } as unknown as ModbusClientCore;

    await service.executeModbusCommands(
        modbusClient,
        {
            holdingCommands: [],
            coilCommands: [
                { key: 'valve_0', value: true, fc: 5, unitid: 1, address: 1, quantity: 1 },
                { key: 'power', value: true, fc: 5, unitid: 1, address: 30, quantity: 1 },
            ],
        },
        createSchedule(),
        { runId: 'run-delay' }
    );

    expect(delaySpy).toHaveBeenCalledWith(20000);
});
