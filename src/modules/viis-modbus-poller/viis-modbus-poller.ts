import { Node, NodeAPI, NodeDef } from "node-red";
import ClientRegistry, { MultiModbusConfig } from "../../core/client-registry";
import { ModbusClientCore, ModbusConfig } from "../../core/modbus-client";
import { GlobalContextHelper } from "../../ultils/global-context-helper";
import { DEFAULT_CONFIG, ENV_KEYS } from "../viis-modbus-flex/constants";
import { GLOBAL_CONTEXT_KEYS } from "../viis-telemetry/viis-telemetry-constants";
import { TelemetryValue } from "./services/change-detector";
import { PollerDiagnostics } from "./services/diagnostics";
import { resolvePollerConfig } from "./services/config-resolver";
import { validateResolvedConfig } from "./services/config-validator";
import { runPollTick } from "./services/poll-runner";
import { BoardMappings, PollingConfig, ResolvedPollerConfig } from "./types";
import { buildDeviceTelemetryTopic } from "../../core/demeter-mqtt-topics";

interface ViisModbusPollerNodeDef extends NodeDef {
  name: string;
  boardId?: string;
  maxGap?: string | number;
  maxCoilsPerRead?: string | number;
  maxRegistersPerRead?: string | number;
  staleLockMs?: string | number;
  publishFullSnapshotOnFirstRead?: boolean;
  enableDiagnostics?: boolean;
  scaleConfigOverrides?: string;
}

interface PollerOptions {
  maxGap: number;
  maxCoilsPerRead: number;
  maxRegistersPerRead: number;
  staleLockMs: number;
  publishFullSnapshotOnFirstRead: boolean;
  enableDiagnostics: boolean;
}

type SharedClientTarget =
  | { mode: "board"; boardId: string; signature: string }
  | { mode: "single"; config: ModbusConfig };

const DEFAULT_POLLER_OPTIONS: PollerOptions = {
  maxGap: 5,
  maxCoilsPerRead: 64,
  maxRegistersPerRead: 32,
  staleLockMs: 5000,
  publishFullSnapshotOnFirstRead: true,
  enableDiagnostics: true,
};

function toPositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptions(config: ViisModbusPollerNodeDef): PollerOptions {
  return {
    maxGap: toPositiveNumber(config.maxGap, DEFAULT_POLLER_OPTIONS.maxGap),
    maxCoilsPerRead: toPositiveNumber(config.maxCoilsPerRead, DEFAULT_POLLER_OPTIONS.maxCoilsPerRead),
    maxRegistersPerRead: toPositiveNumber(
      config.maxRegistersPerRead,
      DEFAULT_POLLER_OPTIONS.maxRegistersPerRead,
    ),
    staleLockMs: toPositiveNumber(config.staleLockMs, DEFAULT_POLLER_OPTIONS.staleLockMs),
    publishFullSnapshotOnFirstRead:
      config.publishFullSnapshotOnFirstRead !== false,
    enableDiagnostics: config.enableDiagnostics !== false,
  };
}

function parseJsonMaybe<T>(value: unknown, label: string): T | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    return value as T;
  }

  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(`Invalid JSON in ${label}: ${(error as Error).message}`);
  }
}

function getGlobalValue(globalContext: any, keys: string[]): unknown {
  for (const key of keys) {
    const value = globalContext.get(key);
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return undefined;
}

function readBoardConfigs(globalContext: any, globalHelper: GlobalContextHelper): {
  boards?: MultiModbusConfig["boards"];
  defaultBoard?: string;
} {
  const rawBoards =
    getGlobalValue(globalContext, ["modbusBoards", "modbus_boards"]) ??
    globalHelper.getEnvVar(ENV_KEYS.MODBUS_BOARDS, undefined);
  const boards = parseJsonMaybe<MultiModbusConfig["boards"]>(rawBoards, "modbusBoards");

  if (!Array.isArray(boards) || boards.length === 0) {
    return {};
  }

  const defaultBoardRaw =
    getGlobalValue(globalContext, ["modbusDefaultBoard", "modbus_default_board"]) ??
    globalHelper.getEnvVar(ENV_KEYS.MODBUS_DEFAULT_BOARD, boards[0].id);
  const defaultBoard = typeof defaultBoardRaw === "string" && defaultBoardRaw.trim()
    ? defaultBoardRaw.trim()
    : boards[0].id;

  return { boards, defaultBoard };
}

function readSingleModbusConfig(globalHelper: GlobalContextHelper): ModbusConfig {
  return {
    type: globalHelper.getEnvVar(ENV_KEYS.MODBUS_TYPE, DEFAULT_CONFIG.MODBUS_TYPE) as "TCP" | "RTU",
    host: globalHelper.getEnvVar(ENV_KEYS.MODBUS_HOST, DEFAULT_CONFIG.MODBUS_HOST),
    tcpPort: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_TCP_PORT, DEFAULT_CONFIG.MODBUS_TCP_PORT),
    serialPort: globalHelper.getEnvVar(ENV_KEYS.MODBUS_SERIAL_PORT, DEFAULT_CONFIG.MODBUS_SERIAL_PORT),
    baudRate: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_BAUD_RATE, DEFAULT_CONFIG.MODBUS_BAUD_RATE),
    parity: globalHelper.getEnvVar(ENV_KEYS.MODBUS_PARITY, DEFAULT_CONFIG.MODBUS_PARITY) as "none" | "even" | "odd",
    unitId: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_UNIT_ID, DEFAULT_CONFIG.MODBUS_UNIT_ID),
    timeout: globalHelper.getNumericEnvVar(ENV_KEYS.MODBUS_TIMEOUT, DEFAULT_CONFIG.MODBUS_TIMEOUT),
    reconnectInterval: globalHelper.getNumericEnvVar(
      ENV_KEYS.MODBUS_RECONNECT_INTERVAL,
      DEFAULT_CONFIG.MODBUS_RECONNECT_INTERVAL,
    ),
  };
}

function resolveSharedClientTarget(
  node: Node,
  globalContext: any,
  boardId: string,
): SharedClientTarget {
  const globalHelper = new GlobalContextHelper(node.context());
  const { boards, defaultBoard } = readBoardConfigs(globalContext, globalHelper);

  if (boards && boards.length > 0) {
    ClientRegistry.initializeMultiBoardConfig(
      {
        mode: "multi",
        defaultBoard,
        boards,
      },
      node,
    );

    const targetBoardId = boardId || defaultBoard || boards[0].id;
    const boardConfig = boards.find((board) => board.id === targetBoardId);
    const signature = boardConfig
      ? targetKey({ mode: "single", config: boardConfig })
      : `missing:${targetBoardId}`;

    return { mode: "board", boardId: targetBoardId, signature };
  }

  return { mode: "single", config: readSingleModbusConfig(globalHelper) };
}

function targetKey(target: SharedClientTarget): string {
  if (target.mode === "board") {
    return `board:${target.boardId}:${target.signature}`;
  }

  const config = target.config;
  return config.type === "TCP"
    ? `single:tcp:${config.host}:${config.tcpPort}`
    : `single:rtu:${config.serialPort}`;
}

function buildDiagnosticsMessage(
  status: PollerDiagnostics["status"],
  errors: string[] = [],
  warnings: string[] = [],
  extra: Partial<PollerDiagnostics> = {},
) {
  const now = Date.now();

  return {
    topic: "viis/modbus-poller/diagnostics",
    payload: {
      status,
      errors,
      warnings,
      readCount: 0,
      errorCount: errors.length,
      requests: [],
      startedAt: now,
      endedAt: now,
      durationMs: 0,
      timestamp: now,
      ...extra,
    },
  };
}

function getDueGroups(
  pollingConfig: PollingConfig,
  lastPollTimes: Record<string, number>,
  now: number,
): string[] {
  const dueGroups: string[] = [];

  for (const [groupName, group] of Object.entries(pollingConfig)) {
    const interval = toPositiveNumber(group.interval, 0);
    const lastPoll = lastPollTimes[groupName] || 0;

    if (interval > 0 && now - lastPoll >= interval) {
      dueGroups.push(groupName);
    }
  }

  return dueGroups;
}

function markDueGroups(
  lastPollTimes: Record<string, number>,
  dueGroups: string[],
  now: number,
): void {
  for (const groupName of dueGroups) {
    lastPollTimes[groupName] = now;
  }
}

function splitLatestDataByRegister(
  latestData: Record<string, TelemetryValue>,
  mappings: BoardMappings,
): {
  coils: Record<string, TelemetryValue>;
  input: Record<string, TelemetryValue>;
  holding: Record<string, TelemetryValue>;
} {
  const result = { coils: {}, input: {}, holding: {} } as {
    coils: Record<string, TelemetryValue>;
    input: Record<string, TelemetryValue>;
    holding: Record<string, TelemetryValue>;
  };

  for (const [key, value] of Object.entries(latestData)) {
    if (Object.prototype.hasOwnProperty.call(mappings.coils, key)) {
      result.coils[key] = value;
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(mappings.input, key)) {
      result.input[key] = value;
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(mappings.holding, key)) {
      result.holding[key] = value;
    }
  }

  return result;
}

function mergeGlobalTelemetry(
  globalContext: any,
  key: string,
  data: Record<string, TelemetryValue>,
  timestamp: number,
): void {
  if (Object.keys(data).length === 0) {
    return;
  }

  const previous = globalContext.get(key) || {};
  globalContext.set(key, { ...previous, ts: timestamp, ...data });
}

function writeLatestGlobalState(
  globalContext: any,
  config: ResolvedPollerConfig,
  latestData: Record<string, TelemetryValue>,
): void {
  const timestamp = Date.now();
  const split = splitLatestDataByRegister(latestData, config.mappings);

  mergeGlobalTelemetry(globalContext, GLOBAL_CONTEXT_KEYS.COIL_REGISTER_DATA, split.coils, timestamp);
  mergeGlobalTelemetry(globalContext, GLOBAL_CONTEXT_KEYS.INPUT_REGISTER_DATA, split.input, timestamp);
  mergeGlobalTelemetry(globalContext, GLOBAL_CONTEXT_KEYS.HOLDING_REGISTER_DATA, split.holding, timestamp);
}

function buildTelemetryMessages(
  config: ResolvedPollerConfig,
  changedData: Record<string, TelemetryValue>,
  pollDurationMs: number,
) {
  const payload = {
    ...changedData,
    ts: Date.now(),
    _poll_duration_ms: pollDurationMs,
  };

  return [
    {
      topic: buildDeviceTelemetryTopic(config.deviceId),
      payload,
      qos: 0,
      retain: false,
    },
    {
      topic: buildDeviceTelemetryTopic(config.deviceId),
      payload,
      qos: 0,
      retain: false,
    },
  ];
}

module.exports = function registerViisModbusPoller(RED: NodeAPI) {
  function ViisModbusPollerNode(this: Node, config: ViisModbusPollerNodeDef) {
    RED.nodes.createNode(this, config as any);

    const node = this;
    const options = parseOptions(config);
    const previousState: Record<string, TelemetryValue> = {};
    const lastPollTimes: Record<string, number> = {};
    const emittedWarnings = new Set<string>();

    let firstSuccessfulRead = true;
    let pollInProgress = 0;
    let modbusClient: ModbusClientCore | null = null;
    let currentTarget: SharedClientTarget | null = null;

    function releaseCurrentModbusClient(): void {
      if (!modbusClient || !currentTarget) {
        return;
      }

      if (currentTarget.mode === "board") {
        ClientRegistry.releaseClientV2("modbus-board", node, currentTarget.boardId);
      } else {
        ClientRegistry.releaseClientV2("modbus", node);
      }

      modbusClient = null;
      currentTarget = null;
    }

    async function getOrCreateSharedModbusClient(boardId: string): Promise<ModbusClientCore> {
      const nextTarget = resolveSharedClientTarget(node, node.context().global, boardId);

      if (modbusClient && currentTarget && targetKey(currentTarget) === targetKey(nextTarget)) {
        return modbusClient;
      }

      releaseCurrentModbusClient();
      currentTarget = nextTarget;
      modbusClient = nextTarget.mode === "board"
        ? await ClientRegistry.getModbusClientV2(nextTarget.boardId, node)
        : await ClientRegistry.getModbusClientV2(nextTarget.config, node);

      return modbusClient;
    }

    function sendDiagnostics(send: (messages: any[]) => void, message: any): void {
      if (options.enableDiagnostics) {
        send([null, null, message]);
      }
    }

    node.status({ fill: "grey", shape: "ring", text: "Waiting for inject" });

    node.on("input", async (msg: any, send: any, done: any) => {
      const nodeSend = send || ((messages: any[]) => node.send(messages));
      const startedAt = Date.now();

      if (pollInProgress && startedAt - pollInProgress < options.staleLockMs) {
        node.status({ fill: "yellow", shape: "ring", text: "Previous poll running" });
        sendDiagnostics(
          nodeSend,
          buildDiagnosticsMessage("skipped", ["previous poll still running"], [], {
            boardId: config.boardId || "board1",
            dueGroups: [],
          }),
        );
        done?.();
        return;
      }

      if (pollInProgress && startedAt - pollInProgress >= options.staleLockMs) {
        node.warn(`Stale poll lock detected after ${startedAt - pollInProgress}ms; resetting`);
        pollInProgress = 0;
      }

      pollInProgress = startedAt;

      try {
        const resolvedConfig = resolvePollerConfig(config, node.context().global);
        const validation = validateResolvedConfig(resolvedConfig);

        if (validation.warnings.length > 0) {
          for (const warning of validation.warnings) {
            if (!emittedWarnings.has(warning)) {
              emittedWarnings.add(warning);
              node.warn(warning);
            }
          }
        }

        if (validation.errors.length > 0) {
          const errorText = validation.errors.join("; ");
          node.error(`Invalid viis-modbus-poller config: ${errorText}`);
          node.status({ fill: "red", shape: "ring", text: "Invalid config" });
          sendDiagnostics(
            nodeSend,
            buildDiagnosticsMessage("error", validation.errors, validation.warnings, {
              boardId: resolvedConfig.boardId,
              dueGroups: [],
            }),
          );
          done?.();
          return;
        }

        const dueGroups = getDueGroups(resolvedConfig.pollingConfig, lastPollTimes, startedAt);

        if (dueGroups.length === 0) {
          node.status({ fill: "grey", shape: "ring", text: "No groups due" });
          sendDiagnostics(
            nodeSend,
            buildDiagnosticsMessage("skipped", ["no groups due"], validation.warnings, {
              boardId: resolvedConfig.boardId,
              dueGroups,
            }),
          );
          done?.();
          return;
        }

        markDueGroups(lastPollTimes, dueGroups, startedAt);
        node.status({ fill: "blue", shape: "dot", text: `Polling ${dueGroups.join(", ")}` });

        const client = await getOrCreateSharedModbusClient(resolvedConfig.boardId);
        const result = await runPollTick({
          modbusClient: client,
          dueGroups,
          config: resolvedConfig,
          previousState,
          options: {
            maxGap: options.maxGap,
            maxCoilsPerRead: options.maxCoilsPerRead,
            maxRegistersPerRead: options.maxRegistersPerRead,
            publishFullSnapshot:
              firstSuccessfulRead && options.publishFullSnapshotOnFirstRead,
          },
        });

        const latestCount = Object.keys(result.latestData).length;
        if (latestCount > 0) {
          Object.assign(previousState, result.latestData);
          firstSuccessfulRead = false;
          writeLatestGlobalState(node.context().global, resolvedConfig, result.latestData);
        }

        const changedCount = Object.keys(result.changedData).length;

        if (changedCount === 0) {
          const statusText = result.diagnostics.errorCount > 0 ? "No changes, read errors" : "No changes";
          node.status({
            fill: result.diagnostics.errorCount > 0 ? "yellow" : "grey",
            shape: "ring",
            text: statusText,
          });
          sendDiagnostics(nodeSend, { payload: result.diagnostics });
          done?.();
          return;
        }

        const [localMessage, thingsboardMessage] = buildTelemetryMessages(
          resolvedConfig,
          result.changedData,
          Date.now() - startedAt,
        );
        const statusText = result.diagnostics.errorCount > 0
          ? `Published ${changedCount} keys, ${result.diagnostics.errorCount} errors`
          : `Published ${changedCount} keys`;

        node.status({
          fill: result.diagnostics.errorCount > 0 ? "yellow" : "green",
          shape: "dot",
          text: statusText,
        });
        nodeSend([localMessage, thingsboardMessage, options.enableDiagnostics ? { payload: result.diagnostics } : null]);
        done?.();
      } catch (error) {
        const errorMessage = (error as Error).message;
        node.error(errorMessage);
        node.status({ fill: "red", shape: "ring", text: "Poll error" });
        sendDiagnostics(
          nodeSend,
          buildDiagnosticsMessage("error", [errorMessage], [], {
            boardId: config.boardId || "board1",
            dueGroups: [],
          }),
        );
        done?.(error);
      } finally {
        pollInProgress = 0;
      }
    });

    node.on("close", (removedOrDone?: boolean | (() => void), done?: () => void) => {
      const closeDone = typeof removedOrDone === "function" ? removedOrDone : done;

      try {
        releaseCurrentModbusClient();
        node.status({});
        closeDone?.();
      } catch (error) {
        node.error(`Error closing viis-modbus-poller: ${(error as Error).message}`);
        closeDone?.();
      }
    });
  }

  RED.nodes.registerType("viis-modbus-poller", ViisModbusPollerNode);
};
