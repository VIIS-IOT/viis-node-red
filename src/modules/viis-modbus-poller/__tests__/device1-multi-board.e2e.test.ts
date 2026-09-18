import fs from "fs";
import path from "path";
import type { Node } from "node-red";
import ModbusRTU from "modbus-serial";
import ClientRegistry from "../../../core/client-registry";
import { resolvePollerConfig } from "../services/config-resolver";
import { validateResolvedConfig } from "../services/config-validator";
import { getPollTargets, mergePollTickResults } from "../services/multi-board-poll";
import { runPollTick } from "../services/poll-runner";

const DEVICE1_PATH = path.resolve(
  __dirname,
  "../../../../../../../env/configs/device1.json",
);

type DeviceConfig = {
  deviceIdentity: { DEVICE_ID: string };
  modbusBoards: Array<Record<string, unknown>>;
  modbusDefaultBoard: string;
  modbusMappings: Record<string, any>;
  modbusPollGroups: Record<string, any>;
  modbusPublishThresholds: Record<string, number>;
  scaleConfigs: unknown[];
};

function loadDevice1(): DeviceConfig {
  return JSON.parse(fs.readFileSync(DEVICE1_PATH, "utf8"));
}

function fakeNode(): Node {
  return {
    id: "e2e-poller",
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    status: jest.fn(),
  } as unknown as Node;
}

function makeGlobal(config: DeviceConfig, host: string, tcpPort: number) {
  const boards = config.modbusBoards.map((board) => ({
    ...board,
    host,
    tcpPort,
    port: tcpPort,
  }));
  const values: Record<string, unknown> = {
    device_id: config.deviceIdentity.DEVICE_ID,
    DEVICE_ID: config.deviceIdentity.DEVICE_ID,
    modbusBoards: boards,
    modbus_boards: boards,
    modbusDefaultBoard: config.modbusDefaultBoard,
    modbus_default_board: config.modbusDefaultBoard,
    modbusMappings: config.modbusMappings,
    modbusPollGroups: config.modbusPollGroups,
    modbusPublishThresholds: config.modbusPublishThresholds,
    scaleConfigs: config.scaleConfigs,
  };

  return {
    get: (key: string) => values[key],
  };
}

function startDualUnitServer(port: number) {
  const coils: Record<number, Record<number, boolean>> = {
    1: { 0: true, 30: true },
    3: { 0: true },
  };
  const holding: Record<number, Record<number, number>> = {
    1: { 17: 2500 },
    3: { 0: 77, 1: 215 },
  };
  const input: Record<number, Record<number, number>> = {
    1: { 20: 4 },
    3: {},
  };

  const vector = {
    getCoil: (addr: number, unitID: number) => Boolean(coils[unitID]?.[addr]),
    getHoldingRegister: (addr: number, unitID: number) => holding[unitID]?.[addr] ?? 0,
    getInputRegister: (addr: number, unitID: number) => input[unitID]?.[addr] ?? 0,
    setCoil: (addr: number, value: boolean, unitID: number) => {
      coils[unitID] = coils[unitID] || {};
      coils[unitID][addr] = value;
    },
    setRegister: (addr: number, value: number, unitID: number) => {
      holding[unitID] = holding[unitID] || {};
      holding[unitID][addr] = value;
    },
  };

  const server = new (ModbusRTU as any).ServerTCP(vector, {
    host: "127.0.0.1",
    port,
    unitID: 255,
  });

  return { server, coils, holding, input };
}

async function waitForListen(server: { on: Function }, timeoutMs = 3000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Modbus server did not start")), timeoutMs);
    server.on("initialized", () => {
      clearTimeout(timer);
      resolve();
    });
    server.on("error", (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

describe("device1.json multi-board end to end", () => {
  const port = 18503;
  let server: { close: (cb?: () => void) => void };

  beforeAll(async () => {
    ({ server } = startDualUnitServer(port));
    await waitForListen(server as any);
  });

  afterAll(async () => {
    ClientRegistry.resetForTests();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("accepts the local device1.json with two same-bus slaves and polls both unit ids", async () => {
    const device = loadDevice1();

    expect(device.modbusBoards).toHaveLength(2);
    expect(device.modbusBoards.map((board) => board.unitId)).toEqual([1, 3]);
    expect(device.modbusBoards.map((board) => `${board.host}:${board.tcpPort}`)).toEqual([
      "modbus-server-test:503",
      "modbus-server-test:503",
    ]);
    expect(device.modbusMappings.board2.coils.aux_pump).toBe(0);

    const resolved = resolvePollerConfig({ boardId: "board1" }, makeGlobal(device, "127.0.0.1", port));
    const validation = validateResolvedConfig(resolved);

    expect(validation.errors).toEqual([]);
    expect(resolved.boards?.map((board) => board.boardId)).toEqual(["board1", "board2"]);
    expect(resolved.boards?.[1].pollingConfig.realtime.coils).toEqual(["aux_pump"]);
    expect(resolved.boards?.[1].pollingConfig.sensors.holding).toEqual(["soil_moisture", "soil_temp"]);

    ClientRegistry.resetForTests();
    ClientRegistry.initializeMultiBoardConfig(
      {
        mode: "multi",
        defaultBoard: "board1",
        boards: resolved.boards!.map((board) => ({
          id: board.boardId,
          type: "TCP",
          host: "127.0.0.1",
          tcpPort: port,
          unitId: board.unitId,
        })),
      },
      fakeNode(),
    );

    const node = fakeNode();
    const board1Client = await ClientRegistry.getModbusClientV2("board1", node);
    const board2Client = await ClientRegistry.getModbusClientV2("board2", fakeNode());

    expect(board1Client).not.toBe(board2Client);
    expect(ClientRegistry.getHostConnectionCounts()).toEqual({ [`127.0.0.1:${port}`]: 1 });

    const targets = getPollTargets(resolved);
    const tickResults = [];
    for (const board of targets) {
      const client = board.boardId === "board1" ? board1Client : board2Client;
      tickResults.push(
        await runPollTick({
          modbusClient: client,
          dueGroups: ["realtime", "sensors"],
          config: {
            ...resolved,
            boardId: board.boardId,
            mappings: board.mappings,
            pollingConfig: board.pollingConfig,
          },
          previousState: {},
          options: {
            maxGap: 5,
            maxCoilsPerRead: 64,
            maxRegistersPerRead: 32,
            publishFullSnapshot: true,
          },
        }),
      );
    }

    const merged = mergePollTickResults(tickResults);

    expect(merged.latestData.power).toBe(true);
    expect(merged.latestData.main_pump).toBe(true);
    expect(merged.latestData.aux_pump).toBe(true);
    expect(merged.latestData.soil_moisture).toBe(77);
    expect(merged.latestData.soil_temp).toBe(215);
    expect(merged.diagnostics.boardId).toBe("board1,board2");
    expect(merged.diagnostics.errorCount).toBe(0);
  }, 30000);
});
