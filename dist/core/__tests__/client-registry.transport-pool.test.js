"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const constructed = [];
jest.mock("../modbus-client", () => ({
    ModbusClientCore: jest.fn().mockImplementation((config) => {
        const instance = {
            config,
            disconnect: jest.fn(),
            isConnectedCheck: jest.fn(() => true),
            readCoils: jest.fn().mockResolvedValue({ address: 0, data: [true] }),
            readInputRegisters: jest.fn(),
            readHoldingRegisters: jest.fn(),
            writeCoil: jest.fn(),
            writeRegister: jest.fn(),
        };
        constructed.push(instance);
        return instance;
    }),
}));
const client_registry_1 = __importDefault(require("../client-registry"));
function fakeNode(id) {
    return {
        id,
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        status: jest.fn(),
    };
}
describe("ClientRegistry transport pool", () => {
    const nodeA = fakeNode("node-a");
    const nodeB = fakeNode("node-b");
    beforeEach(() => {
        constructed.length = 0;
        client_registry_1.default.resetForTests();
    });
    afterEach(() => {
        client_registry_1.default.resetForTests();
    });
    it("shares one RTU connection for two boards on the same serial port", async () => {
        client_registry_1.default.initializeMultiBoardConfig({
            mode: "multi",
            defaultBoard: "board1",
            boards: [
                {
                    id: "board1",
                    type: "RTU",
                    serialPort: "/dev/ttyUSB0",
                    baudRate: 115200,
                    parity: "none",
                    unitId: 3,
                },
                {
                    id: "board2",
                    type: "RTU",
                    serialPort: "/dev/ttyUSB0",
                    baudRate: 115200,
                    parity: "none",
                    unitId: 1,
                },
            ],
        }, nodeA);
        const board1 = await client_registry_1.default.getModbusClientV2("board1", nodeA);
        const board2 = await client_registry_1.default.getModbusClientV2("board2", nodeB);
        expect(constructed).toHaveLength(1);
        expect(board1).not.toBe(board2);
        await board1.readCoils(0, 1);
        await board2.readCoils(4, 2);
        expect(constructed[0].readCoils).toHaveBeenNthCalledWith(1, 0, 1, 3);
        expect(constructed[0].readCoils).toHaveBeenNthCalledWith(2, 4, 2, 1);
    });
    it("opens two connections when RTU boards use different serial ports", async () => {
        client_registry_1.default.initializeMultiBoardConfig({
            mode: "multi",
            defaultBoard: "board1",
            boards: [
                { id: "board1", type: "RTU", serialPort: "/dev/ttyUSB0", unitId: 3 },
                { id: "board2", type: "RTU", serialPort: "/dev/ttyUSB1", unitId: 1 },
            ],
        }, nodeA);
        await client_registry_1.default.getModbusClientV2("board1", nodeA);
        await client_registry_1.default.getModbusClientV2("board2", nodeB);
        expect(constructed).toHaveLength(2);
    });
    it("disconnects the shared transport only after the last board is released", async () => {
        client_registry_1.default.initializeMultiBoardConfig({
            mode: "multi",
            defaultBoard: "board1",
            boards: [
                { id: "board1", type: "RTU", serialPort: "/dev/ttyUSB0", unitId: 3 },
                { id: "board2", type: "RTU", serialPort: "/dev/ttyUSB0", unitId: 1 },
            ],
        }, nodeA);
        await client_registry_1.default.getModbusClientV2("board1", nodeA);
        await client_registry_1.default.getModbusClientV2("board2", nodeB);
        client_registry_1.default.releaseClientV2("modbus-board", nodeA, "board1");
        expect(constructed[0].disconnect).not.toHaveBeenCalled();
        client_registry_1.default.releaseClientV2("modbus-board", nodeB, "board2");
        expect(constructed[0].disconnect).toHaveBeenCalledTimes(1);
    });
});
