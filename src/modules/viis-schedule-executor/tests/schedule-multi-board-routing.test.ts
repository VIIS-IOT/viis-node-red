import { ScheduleService } from '../viis-schedule-executor-service';
import { ModbusClientCore } from '../../../core/modbus-client';
import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';
import { Node } from 'node-red';

// Two Delta PLCs on separate RTU ports with the SAME coil addresses (Y0..Y7 = 1280..1287).
const ENV: Record<string, any> = {
    MODBUS_BOARDS: [
        { id: 'board1', unitId: 1 },
        { id: 'board2', unitId: 2 },
    ],
    MODBUS_BOARD1_COILS: { pump_tank_a: 1280, pump_water_in: 1284, main_pump: 1285 },
    MODBUS_BOARD2_COILS: { valve_1: 1280, valve_2: 1281 },
    MODBUS_BOARD1_HOLDING_REGISTERS: {},
    MODBUS_BOARD2_HOLDING_REGISTERS: { current_ec: 4206 },
};

type Write = { board: string; fn: string; address: number; value: unknown };

function boardClient(board: string, log: Write[]): ModbusClientCore {
    const coils = new Map<number, boolean>();
    const registers = new Map<number, number>();
    return {
        writeCoil: jest.fn(async (address: number, value: boolean) => {
            coils.set(address, value);
            log.push({ board, fn: 'writeCoil', address, value });
        }),
        writeRegister: jest.fn(async (address: number, value: number) => {
            registers.set(address, value);
            log.push({ board, fn: 'writeRegister', address, value });
        }),
        readCoils: jest.fn(async (address: number) => ({ data: [coils.get(address) ?? false] })),
        readHoldingRegisters: jest.fn(async (address: number) => ({ data: [registers.get(address) ?? 0] })),
    } as unknown as ModbusClientCore;
}

function setup(env: Record<string, any> = ENV) {
    const store: Record<string, any> = {};
    const node = {
        warn: jest.fn(),
        error: jest.fn(),
        log: jest.fn(),
        context: () => ({
            global: { get: jest.fn((k: string) => store[k]), set: jest.fn((k: string, v: any) => { store[k] = v; }) },
        }),
    } as unknown as Node;
    const service = new ScheduleService(node, true, false, true, 7000);
    (service as any).globalHelper = {
        getEnvVar: (name: string, def?: any) => (name in env ? env[name] : def),
        getJsonEnvVar: (name: string, def: any = {}) => (name in env ? env[name] : def),
    };
    jest.spyOn(service, 'delay').mockResolvedValue(undefined);
    const log: Write[] = [];
    const clients: Record<string, ModbusClientCore> = {
        board1: boardClient('board1', log),
        board2: boardClient('board2', log),
    };
    service.setBoardClientProvider(async (boardId: string) => clients[boardId]);
    return { service, log, defaultClient: clients.board1 };
}

function schedule(action: Record<string, unknown>, status = 'running'): TabiotSchedule {
    return {
        name: 'sched-1',
        label: 'Băng 1',
        status,
        start_time: '07:00:00',
        end_time: '07:03:00',
        action: JSON.stringify(action),
    } as TabiotSchedule;
}

test('start writes each key to its own board, valves before pumps', async () => {
    const { service, log, defaultClient } = setup();
    const s = schedule({ valve_1: 'true', main_pump: 'true' });
    const { holdingCommands, coilCommands } = service.mapScheduleToModbus(s, { dryRun: true });

    expect(coilCommands.find(c => c.key === 'valve_1')).toMatchObject({ boardId: 'board2', unitid: 2, address: 1280 });
    expect(coilCommands.find(c => c.key === 'main_pump')).toMatchObject({ boardId: 'board1', unitid: 1, address: 1285 });
    // No valve_program mapped on any board → no stray write to holding 20 on a PLC.
    expect(holdingCommands).toEqual([]);

    await service.executeModbusCommands(defaultClient, { holdingCommands, coilCommands }, s, { runId: 'r1' });

    const writes = log.filter(w => w.fn === 'writeCoil');
    expect(writes).toEqual([
        { board: 'board2', fn: 'writeCoil', address: 1280, value: true },
        { board: 'board1', fn: 'writeCoil', address: 1285, value: true },
    ]);
});

test('finish stops pumps on board1 even when board2 uses the same address', async () => {
    const { service, log, defaultClient } = setup();
    const s = schedule({ valve_1: 'true', main_pump: 'true' }, 'finished');
    const { coilCommands } = service.mapScheduleToModbus(s, { dryRun: true });

    await service.resetModbusCommands(defaultClient, coilCommands, s, true, { runId: 'r2' });

    const writes = log.filter(w => w.fn === 'writeCoil');
    // pump_tank_a@1280 on board1 must not be deduped against valve_1@1280 on board2.
    expect(writes).toEqual(expect.arrayContaining([
        { board: 'board1', fn: 'writeCoil', address: 1285, value: false },
        { board: 'board1', fn: 'writeCoil', address: 1280, value: false },
        { board: 'board1', fn: 'writeCoil', address: 1284, value: false },
        { board: 'board2', fn: 'writeCoil', address: 1280, value: false },
    ]));
    expect(writes.some(w => w.board === 'board2' && w.address !== 1280)).toBe(false);
    const lastPumpStop = Math.max(...writes.map((w, i) => (w.board === 'board1' ? i : -1)));
    const valveClose = writes.findIndex(w => w.board === 'board2');
    expect(valveClose).toBeGreaterThan(lastPumpStop);
});

test('active commands stored without boardId are routed by key when read back', async () => {
    const { service, log, defaultClient } = setup();
    service.storeActiveCommands('sched-1', [
        { key: 'valve_1', value: true, fc: 5, unitid: 1, address: 1280, quantity: 1 },
    ]);
    const [cmd] = service.getActiveCommands('sched-1');
    expect(cmd).toMatchObject({ boardId: 'board2', unitid: 2 });

    await service.resetModbusCommands(defaultClient, [cmd], schedule({}, 'finished'), false);
    expect(log.filter(w => w.fn === 'writeCoil')).toEqual([
        { board: 'board2', fn: 'writeCoil', address: 1280, value: false },
    ]);
});

test('modbusBoards with one board keeps the default valve_program register 20', async () => {
    const { service, log, defaultClient } = setup({
        MODBUS_BOARDS: [{ id: 'board1', unitId: 1 }],
        MODBUS_BOARD1_COILS: { valve_0: 9, main_pump: 0 },
        MODBUS_BOARD1_HOLDING_REGISTERS: {},
    });
    const s = schedule({ valve_0: 'true', main_pump: 'true' });
    const { holdingCommands, coilCommands } = service.mapScheduleToModbus(s, { dryRun: true });

    expect(holdingCommands).toEqual([
        expect.objectContaining({ key: 'valve_program', address: 20, value: 1 }),
    ]);

    await service.executeModbusCommands(defaultClient, { holdingCommands, coilCommands }, s);
    expect(log.map(w => `${w.board}:${w.fn}@${w.address}`)).toEqual([
        'board1:writeRegister@20',
        'board1:writeCoil@9',
        'board1:writeCoil@0',
    ]);
    const off = service.mergeValveProgramOffCommand([]);
    expect(off).toEqual([expect.objectContaining({ key: 'valve_program', address: 20, value: 0 })]);
});

test('single-board mode keeps the default client and the default valve_program register', async () => {
    const { service, log, defaultClient } = setup({
        MODBUS_COILS: { valve_0: 9, main_pump: 0 },
        MODBUS_HOLDING_REGISTERS: {},
    });
    const s = schedule({ valve_0: 'true', main_pump: 'true' });
    const { holdingCommands, coilCommands } = service.mapScheduleToModbus(s, { dryRun: true });

    expect(coilCommands.every(c => c.boardId === undefined)).toBe(true);
    expect(holdingCommands).toEqual([expect.objectContaining({ key: 'valve_program', address: 20, value: 1 })]);

    await service.executeModbusCommands(defaultClient, { holdingCommands, coilCommands }, s);
    expect(log.map(w => `${w.board}:${w.fn}@${w.address}`)).toEqual([
        'board1:writeRegister@20',
        'board1:writeCoil@9',
        'board1:writeCoil@0',
    ]);
});
