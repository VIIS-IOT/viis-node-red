import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { coilCommandRegister, resetCoilCommandRegistersCache } from '../coil-command-registers';

let dir: string;
let file: string;

function writeDevice(mappings: Record<string, unknown>) {
    fs.writeFileSync(file, JSON.stringify({ deviceIdentity: { DEVICE_ID: 'd' }, modbusMappings: mappings }));
    resetCoilCommandRegistersCache();
}

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccr-'));
    file = path.join(dir, 'device1.json');
    process.env.ENV_LOADER_JSON_CONFIG_PATH = file;
});

afterEach(() => {
    delete process.env.ENV_LOADER_JSON_CONFIG_PATH;
    resetCoilCommandRegistersCache();
    fs.rmSync(dir, { recursive: true, force: true });
});

test('looks up the command register of a key on its board', () => {
    writeDevice({
        board1: { coils: { pump_tank_a: 1280 }, coilCommandRegisters: { pump_tank_a: 4316 } },
        board2: { coils: { valve_1: 1280 }, coilCommandRegisters: { valve_1: 4316 } },
    });
    expect(coilCommandRegister('pump_tank_a', 'board1')).toBe(4316);
    expect(coilCommandRegister('valve_1', 'board2')).toBe(4316);
    // Wrong board: the key is not commanded there.
    expect(coilCommandRegister('valve_1', 'board1')).toBeUndefined();
    // No board given: first board that lists the key.
    expect(coilCommandRegister('valve_1')).toBe(4316);
});

test('keys without a command register, a missing section or a missing file write coils as before', () => {
    writeDevice({ board1: { coils: { main_pump: 1285 } } });
    expect(coilCommandRegister('main_pump', 'board1')).toBeUndefined();

    fs.rmSync(file);
    resetCoilCommandRegistersCache();
    expect(coilCommandRegister('main_pump', 'board1')).toBeUndefined();
});

test('ignores invalid register numbers', () => {
    writeDevice({ board1: { coilCommandRegisters: { a: -1, b: 'x', c: 1.5, d: 4316 } } });
    expect(coilCommandRegister('a', 'board1')).toBeUndefined();
    expect(coilCommandRegister('b', 'board1')).toBeUndefined();
    expect(coilCommandRegister('c', 'board1')).toBeUndefined();
    expect(coilCommandRegister('d', 'board1')).toBe(4316);
});
