import { ScheduleService } from '../viis-schedule-executor-service';
import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';
import { Node } from 'node-red';
import { ModbusClientCore } from '../../../core/modbus-client';

const DEVICE1_COILS = {
    power: 30,
    main_pump: 0,
    sub_pump: 1,
    power_A1: 4,
    power_B1: 5,
    power_A2: 6,
    valve_0: 9,
    valve_1: 10,
    valve_2: 11,
};

const DEVICE1_HOLDINGS = {
    valve_program: 20,
    set_ec: 17,
    time_valve_A1: 21,
    time_valve_B1: 22,
    set_flow_A1: 23,
    set_flow_B1: 24,
};

const sampleAction = {
    power: 'true',
    main_pump: 'true',
    sub_pump: 'true',
    input_pump: 'true',
    power_A1: 'true',
    power_B1: 'true',
    power_A2: 'true',
    power_B2: 'false',
    power_A3: 'false',
    power_B3: 'false',
    valve_0: 'true',
    valve_1: 'true',
    valve_2: 'true',
    set_ec: 2.5,
    time_valve_A1: 200,
    time_valve_B1: 300,
    set_flow_A1: 2000,
    set_flow_B1: 3000,
};

function createService(): ScheduleService {
    const mockNode = {
        warn: jest.fn(),
        error: jest.fn(),
        context: () => ({
            global: { get: jest.fn(() => []), set: jest.fn() },
        }),
    } as unknown as Node;
    const service = new ScheduleService(mockNode, true, false, true);
    jest.spyOn(service, 'delay').mockResolvedValue(undefined);
    Object.defineProperty(service, 'globalHelper', {
        value: {
            getJsonEnvVar: jest.fn((key: string, fallback: any) => {
                if (key === 'MODBUS_BOARD1_COILS' || key === 'MODBUS_COILS') return DEVICE1_COILS;
                if (key === 'MODBUS_BOARD1_HOLDING_REGISTERS' || key === 'MODBUS_HOLDING_REGISTERS') {
                    return DEVICE1_HOLDINGS;
                }
                return fallback;
            }),
            getEnvVar: jest.fn(() => null),
        },
        configurable: true,
    });
    return service;
}

function createSchedule(action: Record<string, unknown>): TabiotSchedule {
    return {
        name: 'device1-start',
        label: 'device1',
        status: 'running',
        action: JSON.stringify(action),
        start_time: '08:00:00',
        end_time: '09:00:00',
    } as TabiotSchedule;
}

test('device1 sample action maps valve_program=7 and treats input_pump as config', () => {
    const service = createService();
    const mapped = service.mapScheduleToModbus(createSchedule(sampleAction));
    expect(mapped.coilCommands.find(c => c.key === 'input_pump')).toBeUndefined();
    expect(mapped.configParameters.some(c => c.key === 'input_pump')).toBe(true);
    expect(mapped.coilCommands.some(c => c.value === false)).toBe(false);
    expect(mapped.holdingCommands[0]).toMatchObject({
        key: 'valve_program', value: 7, address: 20,
    });
});

test('customer-style valves produce valve_program = 3', () => {
    const service = createService();
    const mapped = service.mapScheduleToModbus(createSchedule({
        ...sampleAction,
        valve_2: 'false',
    }));
    expect(mapped.holdingCommands[0]).toMatchObject({
        key: 'valve_program', value: 3, address: 20,
    });
});

test('START writes valve_program before power; set_ec retry does not skip power', async () => {
    const service = createService();
    const schedule = createSchedule(sampleAction);
    const mapped = service.mapScheduleToModbus(schedule);

    const writeCoil = jest.fn().mockResolvedValue(undefined);
    const writeRegister = jest.fn().mockResolvedValue(undefined);
    const readHoldingRegisters = jest.fn(async (address: number) => ({
        data: [address === 17 ? 0 : address === 20 ? 7 : 200],
    }));
    const modbusClient = {
        writeCoil,
        writeRegister,
        readCoils: jest.fn().mockResolvedValue({ data: [true] }),
        readHoldingRegisters,
    } as unknown as ModbusClientCore;

    const report = await service.executeModbusCommands(
        modbusClient,
        { holdingCommands: mapped.holdingCommands, coilCommands: mapped.coilCommands },
        schedule
    );

    const firstReg20 = writeRegister.mock.calls.findIndex((c: any[]) => c[0] === 20 && c[1] === 7);
    const firstPower = writeCoil.mock.calls.findIndex((c: any[]) => c[0] === 30);
    expect(firstReg20).toBeGreaterThanOrEqual(0);
    expect(firstPower).toBeGreaterThanOrEqual(0);
    expect(firstReg20).toBeLessThan(firstPower);

    expect(writeRegister.mock.calls.filter((c: any[]) => c[0] === 17)).toHaveLength(3);
    expect(writeCoil.mock.calls.filter((c: any[]) => c[0] === 30)).toHaveLength(1);

    expect(report.steps.map(s => s.phase)).toEqual(expect.arrayContaining([
        'set_valve_program',
        'set_holding',
        'open_valves',
        'water_hammer_delay',
        'start_pumps',
        'system_power',
    ]));
});
