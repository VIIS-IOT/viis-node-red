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
const coil_command_registers_1 = require("../coil-command-registers");
let dir;
let file;
function writeDevice(mappings) {
    fs.writeFileSync(file, JSON.stringify({ deviceIdentity: { DEVICE_ID: 'd' }, modbusMappings: mappings }));
    (0, coil_command_registers_1.resetCoilCommandRegistersCache)();
}
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccr-'));
    file = path.join(dir, 'device1.json');
    process.env.ENV_LOADER_JSON_CONFIG_PATH = file;
});
afterEach(() => {
    delete process.env.ENV_LOADER_JSON_CONFIG_PATH;
    (0, coil_command_registers_1.resetCoilCommandRegistersCache)();
    fs.rmSync(dir, { recursive: true, force: true });
});
test('looks up the command register of a key on its board', () => {
    writeDevice({
        board1: { coils: { pump_tank_a: 1280 }, coilCommandRegisters: { pump_tank_a: 4316 } },
        board2: { coils: { valve_1: 1280 }, coilCommandRegisters: { valve_1: 4316 } },
    });
    expect((0, coil_command_registers_1.coilCommandRegister)('pump_tank_a', 'board1')).toBe(4316);
    expect((0, coil_command_registers_1.coilCommandRegister)('valve_1', 'board2')).toBe(4316);
    // Wrong board: the key is not commanded there.
    expect((0, coil_command_registers_1.coilCommandRegister)('valve_1', 'board1')).toBeUndefined();
    // No board given: first board that lists the key.
    expect((0, coil_command_registers_1.coilCommandRegister)('valve_1')).toBe(4316);
});
test('keys without a command register, a missing section or a missing file write coils as before', () => {
    writeDevice({ board1: { coils: { main_pump: 1285 } } });
    expect((0, coil_command_registers_1.coilCommandRegister)('main_pump', 'board1')).toBeUndefined();
    fs.rmSync(file);
    (0, coil_command_registers_1.resetCoilCommandRegistersCache)();
    expect((0, coil_command_registers_1.coilCommandRegister)('main_pump', 'board1')).toBeUndefined();
});
test('ignores invalid register numbers', () => {
    writeDevice({ board1: { coilCommandRegisters: { a: -1, b: 'x', c: 1.5, d: 4316 } } });
    expect((0, coil_command_registers_1.coilCommandRegister)('a', 'board1')).toBeUndefined();
    expect((0, coil_command_registers_1.coilCommandRegister)('b', 'board1')).toBeUndefined();
    expect((0, coil_command_registers_1.coilCommandRegister)('c', 'board1')).toBeUndefined();
    expect((0, coil_command_registers_1.coilCommandRegister)('d', 'board1')).toBe(4316);
});
