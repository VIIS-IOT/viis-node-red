import type { ScaleConfig } from "../viis-telemetry/viis-telemetry-utils";

export type RegisterType = "coils" | "input" | "holding";

export interface PollGroupConfig {
  interval: number;
  coils?: string[];
  input?: string[];
  holding?: string[];
}

export interface PollingConfig {
  [groupName: string]: PollGroupConfig;
}

export interface BoardMappings {
  coils: Record<string, number>;
  input: Record<string, number>;
  holding: Record<string, number>;
}

export interface ResolvedPollerConfig {
  deviceId: string;
  boardId: string;
  pollingConfig: PollingConfig;
  mappings: BoardMappings;
  thresholds: Record<string, number>;
  scaleConfigs: ScaleConfig[];
}

export interface AddressRange {
  registerType: RegisterType;
  functionCode: 1 | 3 | 4;
  start: number;
  quantity: number;
  addresses: number[];
  keysByAddress: Record<number, string[]>;
}

export interface RangePlanInput {
  registerType: RegisterType;
  functionCode: 1 | 3 | 4;
  requestedKeys: string[];
  mapping: Record<string, number>;
  maxGap: number;
  maxQuantity: number;
}
