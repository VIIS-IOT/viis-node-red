import type { ModbusClientCore } from "../../../core/modbus-client";
import { applyScaling } from "../../viis-telemetry/viis-telemetry-utils";
import type { ScaleConfig } from "../../viis-telemetry/viis-telemetry-utils";
import type { AddressRange, RegisterType, ResolvedPollerConfig } from "../types";
import { detectChangedData, type TelemetryValue } from "./change-detector";
import {
  addDiagnosticError,
  addDiagnosticRequest,
  addDiagnosticWarning,
  createPollerDiagnostics,
  finalizePollerDiagnostics,
  markDiagnosticRead,
  type PollerDiagnostics,
} from "./diagnostics";
import { planAddressRanges } from "./range-planner";

export interface RunPollTickInput {
  modbusClient: Pick<ModbusClientCore, "readCoils" | "readInputRegisters" | "readHoldingRegisters">;
  dueGroups: string[];
  config: ResolvedPollerConfig;
  previousState: Record<string, TelemetryValue>;
  options: {
    maxGap: number;
    maxCoilsPerRead: number;
    maxRegistersPerRead: number;
    publishFullSnapshot: boolean;
  };
}

export interface PollTickResult {
  latestData: Record<string, TelemetryValue>;
  changedData: Record<string, TelemetryValue>;
  diagnostics: PollerDiagnostics;
}

type ModbusReadResult = {
  address?: number;
  data: Array<number | boolean>;
};

const READ_ORDER: RegisterType[] = ["coils", "input", "holding"];

const FUNCTION_CODES = {
  coils: 1,
  input: 4,
  holding: 3,
} as const;

function collectRequestedKeys(input: RunPollTickInput, registerType: RegisterType): string[] {
  const requestedKeys = new Set<string>();

  for (const groupName of input.dueGroups) {
    const group = input.config.pollingConfig[groupName];
    for (const key of group?.[registerType] ?? []) {
      requestedKeys.add(key);
    }
  }

  return Array.from(requestedKeys);
}

function getMaxQuantity(input: RunPollTickInput, registerType: RegisterType): number {
  return registerType === "coils" ? input.options.maxCoilsPerRead : input.options.maxRegistersPerRead;
}

function createRanges(input: RunPollTickInput, registerType: RegisterType): AddressRange[] {
  return planAddressRanges({
    registerType,
    functionCode: FUNCTION_CODES[registerType],
    requestedKeys: collectRequestedKeys(input, registerType),
    mapping: input.config.mappings[registerType],
    maxGap: input.options.maxGap,
    maxQuantity: getMaxQuantity(input, registerType),
  });
}

function readRange(input: RunPollTickInput, range: AddressRange): Promise<ModbusReadResult> {
  if (range.registerType === "coils") {
    return input.modbusClient.readCoils(range.start, range.quantity);
  }

  if (range.registerType === "input") {
    return input.modbusClient.readInputRegisters(range.start, range.quantity);
  }

  return input.modbusClient.readHoldingRegisters(range.start, range.quantity);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function mapValue(key: string, rawValue: number | boolean, scaleConfigs: ScaleConfig[]): TelemetryValue {
  if (typeof rawValue === "number") {
    return applyScaling(key, rawValue, "read", scaleConfigs);
  }

  return Boolean(rawValue);
}

function mapRangeResult(
  range: AddressRange,
  result: ModbusReadResult,
  scaleConfigs: ScaleConfig[],
  diagnostics: PollerDiagnostics,
): Record<string, TelemetryValue> {
  const mapped: Record<string, TelemetryValue> = {};
  const resultAddress = result.address ?? range.start;

  for (const address of range.addresses) {
    const offset = address - resultAddress;
    const rawValue = result.data[offset];

    if (rawValue === undefined) {
      addDiagnosticError(
        diagnostics,
        `${range.registerType} missing data at ${address} from read ${resultAddress} qty ${range.quantity}`,
      );
      continue;
    }

    for (const key of range.keysByAddress[address] ?? []) {
      mapped[key] = mapValue(key, rawValue, scaleConfigs);
    }
  }

  return mapped;
}

function addMissingGroupWarnings(input: RunPollTickInput, diagnostics: PollerDiagnostics): void {
  for (const groupName of input.dueGroups) {
    if (!input.config.pollingConfig[groupName]) {
      addDiagnosticWarning(diagnostics, `due group "${groupName}" is not configured`);
    }
  }
}

export async function runPollTick(input: RunPollTickInput): Promise<PollTickResult> {
  const diagnostics = createPollerDiagnostics(input.config.boardId, input.dueGroups);
  const latestData: Record<string, TelemetryValue> = {};

  addMissingGroupWarnings(input, diagnostics);

  for (const registerType of READ_ORDER) {
    for (const range of createRanges(input, registerType)) {
      addDiagnosticRequest(diagnostics, {
        registerType,
        start: range.start,
        quantity: range.quantity,
      });

      try {
        const result = await readRange(input, range);
        Object.assign(latestData, mapRangeResult(range, result, input.config.scaleConfigs, diagnostics));
        markDiagnosticRead(diagnostics);
      } catch (error) {
        addDiagnosticError(
          diagnostics,
          `${registerType} read failed at ${range.start} qty ${range.quantity}: ${formatError(error)}`,
        );
      }
    }
  }

  return {
    latestData,
    changedData: detectChangedData({
      current: latestData,
      previous: input.previousState,
      thresholds: input.config.thresholds,
      publishFullSnapshot: input.options.publishFullSnapshot,
    }),
    diagnostics: finalizePollerDiagnostics(diagnostics),
  };
}
