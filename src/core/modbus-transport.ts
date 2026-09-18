import type { ModbusConfig } from "./modbus-client";

export function getModbusTransportKey(
  config: Pick<ModbusConfig, "type" | "serialPort" | "host" | "tcpPort"> & { unitId?: number },
): string {
  if (config.type === "TCP") {
    return `tcp:${config.host}:${config.tcpPort ?? 502}`;
  }

  return `rtu:${config.serialPort}`;
}
