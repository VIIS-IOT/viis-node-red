import { isRetryableModbusWriteError } from "../modbus-client";

describe("isRetryableModbusWriteError", () => {
  it("retries modbus-serial Timed out and the wrapper timeout", () => {
    expect(isRetryableModbusWriteError("Timed out")).toBe(true);
    expect(isRetryableModbusWriteError("[STM32-TIMEOUT] Write coil timeout after 5000ms")).toBe(true);
  });

  it("does not retry a normal exception", () => {
    expect(isRetryableModbusWriteError("Illegal Data Address")).toBe(false);
  });
});
