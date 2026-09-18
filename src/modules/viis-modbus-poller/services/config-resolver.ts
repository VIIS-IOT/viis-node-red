import type { ScaleConfig } from "../../viis-telemetry/viis-telemetry-utils";
import { GLOBAL_CONTEXT_KEYS } from "../../viis-telemetry/viis-telemetry-constants";
import { mergeScaleConfigs } from "./scale-config-merger";
import type { BoardMappings, PollingConfig, ResolvedBoardPollConfig, ResolvedPollerConfig } from "../types";

interface GlobalContext {
  get(key: string): unknown;
}

interface PollerNodeConfig {
  boardId?: string;
  scaleConfigOverrides?: string;
}

function readGlobal(globalContext: GlobalContext, keys: string[]): { key: string; value: unknown } {
  for (const key of keys) {
    const value = globalContext.get(key);
    if (value !== undefined && value !== null && value !== "") {
      return { key, value };
    }
  }

  return { key: keys[0], value: undefined };
}

function parseJsonString(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON in ${label}: ${(error as Error).message}`);
  }
}

function parseConfigValue(value: unknown, label: string): unknown {
  if (typeof value !== "string") {
    return value;
  }

  return parseJsonString(value, label);
}

function parseOptionalArray(value: unknown, label: string): ScaleConfig[] {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  const parsed = parseConfigValue(value, label);
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be an array`);
  }

  return parsed as ScaleConfig[];
}

function readBoardId(nodeConfig: PollerNodeConfig, globalContext: GlobalContext): string {
  if (nodeConfig.boardId?.trim()) {
    return nodeConfig.boardId.trim();
  }

  const boardId = readGlobal(globalContext, ["modbusDefaultBoard", "modbus_default_board"]).value;
  return typeof boardId === "string" && boardId.trim() ? boardId.trim() : "board1";
}

function readDeviceId(globalContext: GlobalContext): string {
  const deviceId = readGlobal(globalContext, ["device_id", "DEVICE_ID"]).value;
  return typeof deviceId === "string" && deviceId.trim() ? deviceId.trim() : "unknown_device";
}

function readConfigObject<T>(
  globalContext: GlobalContext,
  keys: string[],
  fallback: T,
): T {
  const entry = readGlobal(globalContext, keys);
  if (entry.value === undefined) {
    return fallback;
  }

  return parseConfigValue(entry.value, `global context key ${entry.key}`) as T;
}

function readMappingRecord(
  globalContext: GlobalContext,
  boardMapping: Record<string, unknown> | undefined,
  preferredKey: string,
  fallbackKey: string,
): Record<string, number> {
  const preferred = boardMapping?.[preferredKey];
  if (preferred !== undefined && preferred !== null) {
    return parseConfigValue(preferred, `modbusMappings board ${preferredKey}`) as Record<string, number>;
  }

  const fallback = globalContext.get(fallbackKey);
  if (fallback === undefined || fallback === null || fallback === "") {
    return {};
  }

  return parseConfigValue(fallback, `global context key ${fallbackKey}`) as Record<string, number>;
}

function readMappings(globalContext: GlobalContext, boardId: string): BoardMappings {
  const allMappings = readConfigObject<Record<string, Record<string, unknown>> | undefined>(
    globalContext,
    ["modbusMappings"],
    undefined,
  );
  const boardMapping = allMappings?.[boardId];

  return {
    coils: readMappingRecord(globalContext, boardMapping, "coils", `modbus_${boardId}_coils`),
    input: readMappingRecord(
      globalContext,
      boardMapping,
      "inputRegisters",
      `modbus_${boardId}_input_registers`,
    ),
    holding: readMappingRecord(
      globalContext,
      boardMapping,
      "holdingRegisters",
      `modbus_${boardId}_holding_registers`,
    ),
  };
}

function readScaleConfigs(
  nodeConfig: PollerNodeConfig,
  globalContext: GlobalContext,
): ScaleConfig[] {
  const globalScaleConfigs = parseOptionalArray(
    globalContext.get(GLOBAL_CONTEXT_KEYS.SCALE_CONFIGS),
    `global context key ${GLOBAL_CONTEXT_KEYS.SCALE_CONFIGS}`,
  );
  const envLoaderScaleConfigs = parseOptionalArray(
    readGlobal(globalContext, ["scale_configs", "scaleConfigs", "SCALE_CONFIGS"]).value,
    "global context scale configs",
  );
  const overrides = parseOptionalArray(nodeConfig.scaleConfigOverrides, "node config scaleConfigOverrides");
  const mergedGlobalConfigs = mergeScaleConfigs(globalScaleConfigs, envLoaderScaleConfigs);

  return mergeScaleConfigs(mergedGlobalConfigs, overrides);
}

function hasMappingKey(mappings: BoardMappings, registerType: keyof BoardMappings, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(mappings[registerType], key);
}

export function partitionPollingConfig(pollingConfig: PollingConfig, mappings: BoardMappings): PollingConfig {
  const partitioned: PollingConfig = {};

  for (const [groupName, group] of Object.entries(pollingConfig ?? {})) {
    partitioned[groupName] = {
      interval: group.interval,
      coils: (group.coils ?? []).filter((key) => hasMappingKey(mappings, "coils", key)),
      input: (group.input ?? []).filter((key) => hasMappingKey(mappings, "input", key)),
      holding: (group.holding ?? []).filter((key) => hasMappingKey(mappings, "holding", key)),
    };
  }

  return partitioned;
}

function readConfiguredBoards(globalContext: GlobalContext): Array<{ id: string; unitId: number }> {
  const entry = readGlobal(globalContext, ["modbusBoards", "modbus_boards"]);
  if (entry.value === undefined) {
    return [];
  }

  const parsed = parseConfigValue(entry.value, `global context key ${entry.key}`);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter((board: { id?: unknown; unitId?: unknown }) => board && typeof board.id === "string" && board.id.trim())
    .map((board: { id: string; unitId?: unknown }) => ({
      id: String(board.id).trim(),
      unitId: Number(board.unitId) > 0 ? Number(board.unitId) : 1,
    }));
}

export function resolvePollerConfig(
  nodeConfig: PollerNodeConfig,
  globalContext: GlobalContext,
): ResolvedPollerConfig {
  const fallbackBoardId = readBoardId(nodeConfig, globalContext);
  const configuredBoards = readConfiguredBoards(globalContext);
  const pollingConfig = readConfigObject<PollingConfig>(
    globalContext,
    ["modbusPollGroups", "modbus_poll_groups", "pollingConfig"],
    {},
  );
  const boardIds = configuredBoards.length > 0
    ? configuredBoards.map((board) => board.id)
    : [fallbackBoardId];

  const boards: ResolvedBoardPollConfig[] = boardIds.map((boardId) => {
    const mappings = readMappings(globalContext, boardId);
    return {
      boardId,
      unitId: configuredBoards.find((board) => board.id === boardId)?.unitId ?? 1,
      mappings,
      pollingConfig: partitionPollingConfig(pollingConfig, mappings),
    };
  });

  const primary = boards[0];

  return {
    deviceId: readDeviceId(globalContext),
    boardId: primary?.boardId ?? fallbackBoardId,
    pollingConfig,
    mappings: primary?.mappings ?? { coils: {}, input: {}, holding: {} },
    thresholds: readConfigObject<Record<string, number>>(
      globalContext,
      ["modbusPublishThresholds", "modbus_publish_thresholds", "modbusThresholds"],
      {},
    ),
    scaleConfigs: readScaleConfigs(nodeConfig, globalContext),
    boards,
  };
}
