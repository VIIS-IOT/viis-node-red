"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const modbus_transport_1 = require("../modbus-transport");
describe("getModbusTransportKey", () => {
    it("identifies RTU boards by serial port and ignores unit id", () => {
        expect((0, modbus_transport_1.getModbusTransportKey)({
            type: "RTU",
            serialPort: "/dev/ttyUSB0",
            unitId: 3,
        })).toBe("rtu:/dev/ttyUSB0");
        expect((0, modbus_transport_1.getModbusTransportKey)({
            type: "RTU",
            serialPort: "/dev/ttyUSB0",
            unitId: 1,
        })).toBe("rtu:/dev/ttyUSB0");
    });
    it("identifies TCP boards by host and port and ignores unit id", () => {
        expect((0, modbus_transport_1.getModbusTransportKey)({
            type: "TCP",
            host: "192.168.1.10",
            tcpPort: 502,
            unitId: 1,
        })).toBe("tcp:192.168.1.10:502");
    });
});
