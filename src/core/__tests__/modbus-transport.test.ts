import { getModbusTransportKey } from "../modbus-transport";

describe("getModbusTransportKey", () => {
  it("identifies RTU boards by serial port and ignores unit id", () => {
    expect(
      getModbusTransportKey({
        type: "RTU",
        serialPort: "/dev/ttyUSB0",
        unitId: 3,
      }),
    ).toBe("rtu:/dev/ttyUSB0");

    expect(
      getModbusTransportKey({
        type: "RTU",
        serialPort: "/dev/ttyUSB0",
        unitId: 1,
      }),
    ).toBe("rtu:/dev/ttyUSB0");
  });

  it("identifies TCP boards by host and port and ignores unit id", () => {
    expect(
      getModbusTransportKey({
        type: "TCP",
        host: "192.168.1.10",
        tcpPort: 502,
        unitId: 1,
      }),
    ).toBe("tcp:192.168.1.10:502");
  });
});
