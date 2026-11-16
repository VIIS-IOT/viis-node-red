import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ScheduleService } from '../viis-schedule-executor-service';
import { ModbusClientCore } from '../../../core/modbus-client';
import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';
import { resetCoilCommandRegistersCache } from '../../../ultils/coil-command-registers';
import { Node } from 'node-red';

// Delta PLCs: Y0..Y7 (coils 1280..1287) follow D220..D227 (holding 4316..4323).
// A direct coil write is overwritten by the ladder, so outputs are commanded through D.
const ENV: Record<string, any> = {
    MODBUS_BOARDS: [{ id: 'board1', unitId: 1 }, { id: 'board2', unitId: 2 }],
    MODBUS_BOARD1_COILS: { pump_tank_a: 1280, main_pump: 1285 },
    MODBUS_BOARD2_COILS: { valve_1: 1280 },
    MODBUS_BOARD1_HOLDING_REGISTERS: {},
    MODBUS_BOARD2_HOLDING_REGISTERS: {},
};
const MAPPINGS = {
    board1: { coils: ENV.MODBUS_BOARD1_COILS, coilCommandRegisters: { pump_tank_a: 4316, main_pump: 4321 } },
    board2: { coils: ENV.MODBUS_BOARD2_COILS, coilCommandRegisters: { valve_1: 4316 } },
};

type Write = { board: string; fn: string; address: number; value: unknown };

/** PLC model: writes to D220+i drive coil 1280+i; direct coil writes are ignored by the ladder. */
function deltaPlc(board: string, log: Write[]): ModbusClientCore {
    const y = new Map<number, boolean>();
    const d = new Map<number, number>();
    return {
        writeCoil: jest.fn(async (address: number, value: boolean) => {
            log.push({ board, fn: 'writeCoil', address, value });
        }),
        writeRegister: jest.fn(async (address: number, value: number) => {
            d.set(address, value);
            if (address >= 4316 && address <= 4323) y.set(1280 + address - 4316, value === 1);
            log.push({ board, fn: 'writeRegister', address, value });
        }),
        readCoils: jest.fn(async (address: number) => ({ data: [y.get(address) ?? false] })),
        readHoldingRegisters: jest.fn(async (address: number) => ({ data: [d.get(address) ?? 0] })),
    } as unknown as ModbusClientCore;
}

let dir: string;

function setup() {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccr-exec-'));
    const file = path.join(dir, 'device1.json');
    fs.writeFileSync(file, JSON.stringify({ modbusMappings: MAPPINGS }));
    process.env.ENV_LOADER_JSON_CONFIG_PATH = file;
    resetCoilCommandRegistersCache();

    const store: Record<string, any> = {};
    const node = {
        warn: jest.fn(), error: jest.fn(), log: jest.fn(),
        context: () => ({ global: { get: jest.fn((k: string) => store[k]), set: jest.fn((k: string, v: any) => { store[k] = v; }) } }),
    } as unknown as Node;
    // Verify coils after write, as on the gateway.
    const service = new ScheduleService(node, true, false, false, 7000);
    (service as any).globalHelper = {
        getEnvVar: (name: string, def?: any) => (name in ENV ? ENV[name] : def),
        getJsonEnvVar: (name: string, def: any = {}) => (name in ENV ? ENV[name] : def),
    };
    jest.spyOn(service, 'delay').mockResolvedValue(undefined);
    const log: Write[] = [];
    const clients: Record<string, ModbusClientCore> = { board1: deltaPlc('board1', log), board2: deltaPlc('board2', log) };
    service.setBoardClientProvider(async (boardId) => clients[boardId]);
    return { service, log, defaultClient: clients.board1 };
}

afterEach(() => {
    delete process.env.ENV_LOADER_JSON_CONFIG_PATH;
    resetCoilCommandRegistersCache();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

function schedule(status: string): TabiotSchedule {
    return {
        name: 's1', label: 's1', status, start_time: '07:00:00', end_time: '07:01:00',
        action: JSON.stringify({ valve_1: 'true', main_pump: 'true' }),
    } as TabiotSchedule;
}

test('start commands outputs through D registers on each board and verifies the coil', async () => {
    const { service, log, defaultClient } = setup();
    const s = schedule('running');
    const cmds = service.mapScheduleToModbus(s, { dryRun: true });

    const report = await service.executeModbusCommands(defaultClient, cmds, s, { runId: 'r1' });

    expect(log).toEqual([
        { board: 'board2', fn: 'writeRegister', address: 4316, value: 1 },
        { board: 'board1', fn: 'writeRegister', address: 4321, value: 1 },
    ]);
    const outcomes = report.steps.flatMap((step: any) => step.keys || []);
    expect(outcomes.filter((o: any) => o.status !== 'pass')).toEqual([]);
});

test('finish turns the outputs off through the same registers, pumps before valves', async () => {
    const { service, log, defaultClient } = setup();
    const s = schedule('running');
    const cmds = service.mapScheduleToModbus(s, { dryRun: true });
    await service.executeModbusCommands(defaultClient, cmds, s, { runId: 'r1' });
    log.length = 0;

    const { allSuccessful } = await service.resetModbusCommands(defaultClient, cmds.coilCommands, schedule('finished'), true);

    expect(allSuccessful).toBe(true);
    expect(log.every(w => w.fn === 'writeRegister')).toBe(true);
    const valveOff = log.findIndex(w => w.board === 'board2' && w.address === 4316 && w.value === 0);
    const pumpOff = log.findIndex(w => w.board === 'board1' && w.address === 4321 && w.value === 0);
    expect(pumpOff).toBeGreaterThanOrEqual(0);
    expect(valveOff).toBeGreaterThan(pumpOff);
    // implied pump stop also goes through its D register
    expect(log).toContainEqual({ board: 'board1', fn: 'writeRegister', address: 4316, value: 0 });
});
