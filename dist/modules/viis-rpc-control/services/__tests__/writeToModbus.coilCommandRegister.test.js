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
const board_scoped_modbus_client_1 = require("../../../../core/board-scoped-modbus-client");
const modbusService_1 = require("../modbusService");
const coil_command_registers_1 = require("../../../../ultils/coil-command-registers");
function createService(client) {
    const node = { id: "rpc-node", log: jest.fn(), warn: jest.fn(), error: jest.fn(), context: () => ({ global: { get: jest.fn(), set: jest.fn() } }) };
    const ctx = { get: jest.fn(), set: jest.fn() };
    return new modbusService_1.ModbusService({ node, flowContext: ctx, globalContext: ctx }, client, { scaleValue: (_k, v) => v });
}
function transport() {
    return {
        readCoils: jest.fn(), readInputRegisters: jest.fn(), readHoldingRegisters: jest.fn(),
        writeCoil: jest.fn().mockResolvedValue(undefined), writeRegister: jest.fn().mockResolvedValue(undefined),
        isConnectedCheck: jest.fn().mockReturnValue(true), disconnect: jest.fn(),
    };
}
let dir;
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccr-rpc-"));
    const file = path.join(dir, "device1.json");
    fs.writeFileSync(file, JSON.stringify({
        modbusMappings: {
            board1: { coils: { pump_tank_b: 1281 }, coilCommandRegisters: { pump_tank_b: 4317 } },
            board2: { coils: { valve_2: 1281 } },
        },
    }));
    process.env.ENV_LOADER_JSON_CONFIG_PATH = file;
    (0, coil_command_registers_1.resetCoilCommandRegistersCache)();
});
afterEach(() => {
    delete process.env.ENV_LOADER_JSON_CONFIG_PATH;
    (0, coil_command_registers_1.resetCoilCommandRegistersCache)();
    fs.rmSync(dir, { recursive: true, force: true });
});
describe("ModbusService.writeToModbus with a coil command register (Delta D220..D227)", () => {
    it("writes 1/0 to the command register instead of the coil", async () => {
        const t = transport();
        const service = createService(new board_scoped_modbus_client_1.BoardScopedModbusClient(t, 1));
        await service.writeToModbus("pump_tank_b", { address: 1281, fc: 5, value: true, boardId: "board1" }, true);
        await service.writeToModbus("pump_tank_b", { address: 1281, fc: 5, value: false, boardId: "board1" }, false);
        expect(t.writeCoil).not.toHaveBeenCalled();
        expect(t.writeRegister.mock.calls.map((c) => [c[0], c[1]])).toEqual([[4317, 1], [4317, 0]]);
    });
    it("keeps writing the coil for keys without a command register", async () => {
        const t = transport();
        const service = createService(new board_scoped_modbus_client_1.BoardScopedModbusClient(t, 2));
        await service.writeToModbus("valve_2", { address: 1281, fc: 5, value: true, boardId: "board2" }, true);
        expect(t.writeRegister).not.toHaveBeenCalled();
        expect(t.writeCoil).toHaveBeenCalledWith(1281, true, 2);
    });
});
