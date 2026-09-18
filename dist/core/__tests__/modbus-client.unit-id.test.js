"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const modbus_client_1 = require("../modbus-client");
const setID = jest.fn();
const readCoils = jest.fn().mockResolvedValue({ data: [true] });
const writeCoil = jest.fn().mockResolvedValue(undefined);
const writeRegister = jest.fn().mockResolvedValue(undefined);
jest.mock("modbus-serial", () => {
    return jest.fn().mockImplementation(() => ({
        setID,
        setTimeout: jest.fn(),
        connectRTUBuffered: jest.fn().mockResolvedValue(undefined),
        readCoils,
        readHoldingRegisters: jest.fn().mockResolvedValue({ data: [1] }),
        readInputRegisters: jest.fn().mockResolvedValue({ data: [1] }),
        writeCoil,
        writeRegister,
        close: jest.fn((cb) => cb === null || cb === void 0 ? void 0 : cb()),
        isOpen: true,
    }));
});
function fakeNode() {
    return {
        id: "unit-id-test",
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        status: jest.fn(),
    };
}
async function waitUntilConnected(client) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        if (client.isConnectedCheck()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("Modbus client did not connect in time");
}
describe("ModbusClientCore unit id per request", () => {
    let client;
    beforeEach(async () => {
        setID.mockClear();
        readCoils.mockClear();
        writeCoil.mockClear();
        writeRegister.mockClear();
        client = new modbus_client_1.ModbusClientCore({
            type: "RTU",
            serialPort: "/dev/ttyUSB0",
            baudRate: 115200,
            parity: "none",
            unitId: 1,
        }, fakeNode());
        await waitUntilConnected(client);
        setID.mockClear();
    });
    afterEach(() => {
        client.disconnect();
    });
    it("sets unit id 3 then 1 inside the serialized request queue", async () => {
        await Promise.all([client.readCoils(0, 1, 3), client.readCoils(10, 1, 1)]);
        expect(setID.mock.calls.map((call) => call[0])).toEqual([3, 1]);
    });
    it("falls back to the connection unit id when a request omits it", async () => {
        await client.readCoils(0, 1);
        expect(setID).toHaveBeenCalledWith(1);
    });
    it("applies the request unit id for writes", async () => {
        await client.writeCoil(5, true, 3);
        await client.writeRegister(8, 42, 2);
        expect(setID.mock.calls.map((call) => call[0])).toEqual([3, 2]);
    });
});
