"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const board_scoped_modbus_client_1 = require("../../../../core/board-scoped-modbus-client");
const modbusService_1 = require("../modbusService");
function createService(client) {
    const flow = new Map();
    const global = new Map();
    const node = {
        id: "rpc-node",
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        context: () => ({
            global: {
                get: (key) => global.get(key),
                set: (key, value) => global.set(key, value),
            },
        }),
    };
    return new modbusService_1.ModbusService({
        node,
        flowContext: {
            get: (key) => flow.get(key),
            set: (key, value) => flow.set(key, value),
        },
        globalContext: {
            get: (key) => global.get(key),
            set: (key, value) => global.set(key, value),
        },
    }, client, {
        scaleValue: (_key, value) => value,
    });
}
describe("ModbusService.writeToModbus", () => {
    it("writes a coil through BoardScopedModbusClient when the shared transport is connected", async () => {
        const transport = {
            readCoils: jest.fn(),
            readInputRegisters: jest.fn(),
            readHoldingRegisters: jest.fn(),
            writeCoil: jest.fn().mockResolvedValue(undefined),
            writeRegister: jest.fn(),
            isConnectedCheck: jest.fn().mockReturnValue(true),
            disconnect: jest.fn(),
        };
        const client = new board_scoped_modbus_client_1.BoardScopedModbusClient(transport, 3);
        const service = createService(client);
        await service.writeToModbus("main_pump", { address: 0, fc: 5, value: true }, true);
        expect(transport.writeCoil).toHaveBeenCalledWith(0, true, 3);
    });
});
