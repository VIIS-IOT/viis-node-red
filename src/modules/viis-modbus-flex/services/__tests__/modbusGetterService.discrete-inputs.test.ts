import { ModbusGetterService } from "../modbusGetterService";

describe("viis-modbus-flex FC02", () => {
  it("reads discrete inputs with readDiscreteInputs, not readCoils", async () => {
    const node = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const client = {
      isConnectedCheck: jest.fn(() => true),
      isConnected: jest.fn(() => true),
      readCoils: jest.fn(async () => ({ address: 2, data: [true, true] })),
      readDiscreteInputs: jest.fn(async () => ({ address: 2, data: [false, true] })),
    };
    const service = new ModbusGetterService({ node: node as any, nodeId: "n1", enableLogging: false }, client as any);

    const response: any = await service.processRequest({ fc: 2, unitid: 1, address: 2, quantity: 2 });

    expect(client.readDiscreteInputs).toHaveBeenCalledWith(2, 2);
    expect(client.readCoils).not.toHaveBeenCalled();
    expect(JSON.stringify(response)).toContain("false");
  });
});
