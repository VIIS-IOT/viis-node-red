import { INVALID_MODBUS_ADDRESSES } from "../constants";
import type { BoardMappings, RegisterType, ResolvedBoardPollConfig, ResolvedPollerConfig } from "../types";

export interface ConfigValidationResult {
  errors: string[];
  warnings: string[];
}

const REGISTER_TYPES: RegisterType[] = ["coils", "input", "holding"];

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isReadableAddress(address: unknown): address is number {
  return (
    Number.isInteger(address) &&
    (address as number) >= 0 &&
    !INVALID_MODBUS_ADDRESSES.includes(address as (typeof INVALID_MODBUS_ADDRESSES)[number])
  );
}

function addDuplicateAddressWarnings(
  mappings: BoardMappings,
  warnings: string[],
  boardId?: string,
): void {
  const prefix = boardId ? `${boardId} ` : "";

  for (const registerType of REGISTER_TYPES) {
    const keysByAddress = new Map<number, string[]>();

    for (const [key, address] of Object.entries(mappings[registerType] ?? {})) {
      if (!isReadableAddress(address)) {
        continue;
      }

      const aliases = keysByAddress.get(address) ?? [];
      aliases.push(key);
      keysByAddress.set(address, aliases);
    }

    for (const [address, keys] of keysByAddress.entries()) {
      if (keys.length > 1) {
        warnings.push(`${prefix}${registerType} address ${address} is used by keys: ${keys.join(", ")}`);
      }
    }
  }
}

function getBoardConfigs(config: ResolvedPollerConfig): ResolvedBoardPollConfig[] {
  if (config.boards && config.boards.length > 0) {
    return config.boards;
  }

  return [
    {
      boardId: config.boardId,
      unitId: 1,
      mappings: config.mappings,
      pollingConfig: config.pollingConfig,
    },
  ];
}

function findKeyOwners(
  boards: ResolvedBoardPollConfig[],
  registerType: RegisterType,
  key: string,
): ResolvedBoardPollConfig[] {
  return boards.filter((board) => hasOwn(board.mappings[registerType] as Record<string, unknown>, key));
}

function validatePollKey(
  config: ResolvedPollerConfig,
  boards: ResolvedBoardPollConfig[],
  groupName: string,
  registerType: RegisterType,
  key: string,
  errors: string[],
): void {
  const owners = findKeyOwners(boards, registerType, key);
  const thresholds = config.thresholds as Record<string, unknown>;

  if (owners.length === 0) {
    errors.push(`${groupName}.${registerType} references missing key "${key}"`);
  } else if (owners.length > 1) {
    errors.push(
      `${groupName}.${registerType} key "${key}" is mapped on multiple boards: ${owners.map((board) => board.boardId).join(", ")}`,
    );
  } else {
    const address = owners[0].mappings[registerType][key];
    if (INVALID_MODBUS_ADDRESSES.includes(address as (typeof INVALID_MODBUS_ADDRESSES)[number])) {
      errors.push(`${groupName}.${registerType} key "${key}" maps to unreadable placeholder address ${address}`);
    } else if (!isReadableAddress(address)) {
      errors.push(`${groupName}.${registerType} key "${key}" maps to invalid address ${String(address)}`);
    }
  }

  if (!hasOwn(thresholds, key)) {
    errors.push(`${groupName}.${registerType} missing threshold for key "${key}"`);
  }
}

function validatePollingConfig(config: ResolvedPollerConfig, errors: string[]): void {
  const groupEntries = Object.entries(config.pollingConfig ?? {});
  const boards = getBoardConfigs(config);

  if (groupEntries.length === 0) {
    errors.push("pollingConfig must define at least one poll group");
    return;
  }

  for (const [groupName, group] of groupEntries) {
    if (!Number.isFinite(group.interval) || group.interval <= 0) {
      errors.push(`${groupName}.interval must be a positive number`);
    }

    for (const registerType of REGISTER_TYPES) {
      const keys = group[registerType] ?? [];
      for (const key of keys) {
        validatePollKey(config, boards, groupName, registerType, key, errors);
      }
    }
  }
}

function validateScaleConfigs(config: ResolvedPollerConfig, errors: string[]): void {
  for (const [index, scaleConfig] of config.scaleConfigs.entries()) {
    if (!scaleConfig.key) {
      errors.push(`scaleConfigs[${index}].key must be a non-empty string`);
    }

    if (scaleConfig.operation !== "multiply" && scaleConfig.operation !== "divide") {
      errors.push(`scaleConfigs[${index}].operation must be "multiply" or "divide"`);
    }

    if (!Number.isFinite(scaleConfig.factor) || scaleConfig.factor <= 0) {
      errors.push(`scaleConfigs[${index}].factor must be a positive number`);
    }

    if (scaleConfig.direction !== "read" && scaleConfig.direction !== "write") {
      errors.push(`scaleConfigs[${index}].direction must be "read" or "write"`);
    }
  }
}

export function validateResolvedConfig(config: ResolvedPollerConfig): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  validatePollingConfig(config, errors);
  validateScaleConfigs(config, errors);

  const boards = getBoardConfigs(config);
  if (boards.length === 1) {
    addDuplicateAddressWarnings(boards[0].mappings, warnings);
  } else {
    for (const board of boards) {
      addDuplicateAddressWarnings(board.mappings, warnings, board.boardId);
    }
  }

  return { errors, warnings };
}
