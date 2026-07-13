import type { ScaleConfig } from "../../viis-telemetry/viis-telemetry-utils";

function scaleConfigKey(config: ScaleConfig): string {
  return `${config.key}:${config.direction}`;
}

export function mergeScaleConfigs(
  globalConfigs?: ScaleConfig[],
  overrideConfigs?: ScaleConfig[],
): ScaleConfig[] {
  const byKey = new Map<string, ScaleConfig>();

  for (const config of globalConfigs ?? []) {
    byKey.set(scaleConfigKey(config), config);
  }

  for (const config of overrideConfigs ?? []) {
    byKey.set(scaleConfigKey(config), config);
  }

  return Array.from(byKey.values());
}
