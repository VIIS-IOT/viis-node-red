import type { Node } from "node-red";

/**
 * env-loader fills the persistent global context only after the flows start, so on the first boot after a
 * device1.json board change a node can create board1's client from the previous run's board config. When the
 * fresh config arrives, every holder of that board client must move to the new board.
 */
type FakeTransport = {
  config: any;
  disconnect: jest.Mock;
  isConnectedCheck: jest.Mock;
  readCoils: jest.Mock;
  readInputRegisters: jest.Mock;
  readHoldingRegisters: jest.Mock;
  writeCoil: jest.Mock;
  writeRegister: jest.Mock;
  on: jest.Mock;
  removeListener: jest.Mock;
};
const constructed: FakeTransport[] = [];

jest.mock("../modbus-client", () => ({
  ModbusClientCore: jest.fn().mockImplementation((config) => {
    const instance = {
      config,
      disconnect: jest.fn(),
      isConnectedCheck: jest.fn(() => true),
      readCoils: jest.fn().mockResolvedValue({ address: 0, data: [true] }),
      readInputRegisters: jest.fn(),
      readHoldingRegisters: jest.fn(),
      writeCoil: jest.fn().mockResolvedValue(undefined),
      writeRegister: jest.fn(),
      on: jest.fn(),
      removeListener: jest.fn(),
    };
    constructed.push(instance);
    return instance;
  }),
}));

import ClientRegistry from "../client-registry";

function fakeNode(id: string): Node {
  return { id, log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), status: jest.fn() } as unknown as Node;
}

const tcpBoard = (host: string, tcpPort: number, unitId = 1) => ({
  mode: "multi" as const,
  defaultBoard: "board1",
  boards: [{ id: "board1", type: "TCP" as const, host, tcpPort, unitId }],
});

describe("ClientRegistry board config change", () => {
  const early = fakeNode("modbus-flex");
  const late = fakeNode("arbiter");

  beforeEach(() => {
    constructed.length = 0;
    ClientRegistry.resetForTests();
  });
  afterEach(() => ClientRegistry.resetForTests());

  it("moves a client created from a stale board config to the new board", async () => {
    ClientRegistry.initializeMultiBoardConfig(tcpBoard("modbus-server-test", 503), early);
    const staleHolder = await ClientRegistry.getModbusClientV2("board1", early);

    ClientRegistry.initializeMultiBoardConfig(tcpBoard("host.docker.internal", 5020), late);
    const lateHolder = await ClientRegistry.getModbusClientV2("board1", late);

    expect(constructed).toHaveLength(2);
    expect(constructed[1].config.host).toBe("host.docker.internal");
    await staleHolder.writeCoil(0, true);
    await lateHolder.writeCoil(1, true);
    expect(constructed[1].writeCoil).toHaveBeenCalledTimes(2);
    expect(constructed[0].writeCoil).not.toHaveBeenCalled();
    expect(constructed[0].disconnect).toHaveBeenCalledTimes(1); // old socket no longer used by anyone
  });

  it("keeps status listeners attached across the move", async () => {
    ClientRegistry.initializeMultiBoardConfig(tcpBoard("modbus-server-test", 503), early);
    const holder: any = await ClientRegistry.getModbusClientV2("board1", early);
    const listener = jest.fn();
    holder.on("modbus-status", listener);

    ClientRegistry.initializeMultiBoardConfig(tcpBoard("host.docker.internal", 5020), late);

    expect(constructed[0].removeListener).toHaveBeenCalledWith("modbus-status", listener);
    expect(constructed[1].on).toHaveBeenCalledWith("modbus-status", listener);
  });

  it("the same config again changes nothing", async () => {
    ClientRegistry.initializeMultiBoardConfig(tcpBoard("modbus-server-test", 503), early);
    await ClientRegistry.getModbusClientV2("board1", early);
    ClientRegistry.initializeMultiBoardConfig(tcpBoard("modbus-server-test", 503), late);
    await ClientRegistry.getModbusClientV2("board1", late);

    expect(constructed).toHaveLength(1);
    expect(constructed[0].disconnect).not.toHaveBeenCalled();
  });

  it("does not open a socket past MAX_CONNECTIONS_PER_HOST when a board moves to a host that is full", async () => {
    ClientRegistry.initializeMultiBoardConfig(tcpBoard("modbus-server-test", 503), early);
    const holder = await ClientRegistry.getModbusClientV2("board1", early);
    (ClientRegistry as any).hostConnectionCount.set("full-host:502", 2);

    ClientRegistry.initializeMultiBoardConfig(tcpBoard("full-host", 502), late);

    expect(constructed).toHaveLength(1);
    expect(constructed[0].disconnect).not.toHaveBeenCalled();
    await holder.writeCoil(0, true);
    expect(constructed[0].writeCoil).toHaveBeenCalledTimes(1); // still on the old board
    expect((late.warn as jest.Mock).mock.calls.join(" ")).toContain("MODBUS-CONNECTION-LIMIT");
  });

  it("a unit id change on the same socket keeps the socket and uses the new unit id", async () => {
    ClientRegistry.initializeMultiBoardConfig(tcpBoard("modbus-server-test", 503, 1), early);
    const holder = await ClientRegistry.getModbusClientV2("board1", early);
    ClientRegistry.initializeMultiBoardConfig(tcpBoard("modbus-server-test", 503, 7), late);

    await holder.writeCoil(0, true);
    expect(constructed).toHaveLength(1);
    expect(constructed[0].writeCoil).toHaveBeenCalledWith(0, true, 7);
  });
});
