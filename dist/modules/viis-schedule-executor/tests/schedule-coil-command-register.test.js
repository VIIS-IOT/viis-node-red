"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const viis_schedule_executor_service_1 = require("../viis-schedule-executor-service");
const coil_command_registers_1 = require("../../../ultils/coil-command-registers");
// Delta PLCs: Y0..Y7 (coils 1280..1287) follow D220..D227 (holding 4316..4323).
// A direct coil write is overwritten by the ladder, so outputs are commanded through D.
const ENV = {
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
/** PLC model: writes to D220+i drive coil 1280+i; direct coil writes are ignored by the ladder. */
function deltaPlc(board, log) {
    const y = new Map();
    const d = new Map();
    return {
        writeCoil: jest.fn(async (address, value) => {
            log.push({ board, fn: 'writeCoil', address, value });
        }),
        writeRegister: jest.fn(async (address, value) => {
            d.set(address, value);
            if (address >= 4316 && address <= 4323)
                y.set(1280 + address - 4316, value === 1);
            log.push({ board, fn: 'writeRegister', address, value });
        }),
        readCoils: jest.fn(async (address) => { var _a; return ({ data: [(_a = y.get(address)) !== null && _a !== void 0 ? _a : false] }); }),
        readHoldingRegisters: jest.fn(async (address) => { var _a; return ({ data: [(_a = d.get(address)) !== null && _a !== void 0 ? _a : 0] }); }),
    };
}
let dir;
function setup() {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccr-exec-'));
    const file = path.join(dir, 'device1.json');
    fs.writeFileSync(file, JSON.stringify({ modbusMappings: MAPPINGS }));
    process.env.ENV_LOADER_JSON_CONFIG_PATH = file;
    (0, coil_command_registers_1.resetCoilCommandRegistersCache)();
    const store = {};
    const node = {
        warn: jest.fn(), error: jest.fn(), log: jest.fn(),
        context: () => ({ global: { get: jest.fn((k) => store[k]), set: jest.fn((k, v) => { store[k] = v; }) } }),
    };
    // Verify coils after write, as on the gateway.
    const service = new viis_schedule_executor_service_1.ScheduleService(node, true, false, false, 7000);
    service.globalHelper = {
        getEnvVar: (name, def) => (name in ENV ? ENV[name] : def),
        getJsonEnvVar: (name, def = {}) => (name in ENV ? ENV[name] : def),
    };
    jest.spyOn(service, 'delay').mockResolvedValue(undefined);
    const log = [];
    const clients = { board1: deltaPlc('board1', log), board2: deltaPlc('board2', log) };
    service.setBoardClientProvider(async (boardId) => clients[boardId]);
    return { service, log, defaultClient: clients.board1 };
}
afterEach(() => {
    delete process.env.ENV_LOADER_JSON_CONFIG_PATH;
    (0, coil_command_registers_1.resetCoilCommandRegistersCache)();
    if (dir)
        fs.rmSync(dir, { recursive: true, force: true });
});
function schedule(status) {
    return {
        name: 's1', label: 's1', status, start_time: '07:00:00', end_time: '07:01:00',
        action: JSON.stringify({ valve_1: 'true', main_pump: 'true' }),
    };
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
    const outcomes = report.steps.flatMap((step) => step.keys || []);
    expect(outcomes.filter((o) => o.status !== 'pass')).toEqual([]);
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
