"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const modbus_client_1 = require("../modbus-client");
describe("isRetryableModbusWriteError", () => {
    it("retries modbus-serial Timed out and the wrapper timeout", () => {
        expect((0, modbus_client_1.isRetryableModbusWriteError)("Timed out")).toBe(true);
        expect((0, modbus_client_1.isRetryableModbusWriteError)("[STM32-TIMEOUT] Write coil timeout after 5000ms")).toBe(true);
    });
    it("does not retry a normal exception", () => {
        expect((0, modbus_client_1.isRetryableModbusWriteError)("Illegal Data Address")).toBe(false);
    });
});
