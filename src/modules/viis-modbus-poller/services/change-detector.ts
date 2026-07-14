export type TelemetryValue = number | boolean;

export interface DetectChangedDataInput {
  current: Record<string, TelemetryValue>;
  previous: Record<string, TelemetryValue | null | undefined>;
  thresholds: Record<string, number>;
  publishFullSnapshot: boolean;
}

function hasMetNumericThreshold(
  currentValue: number,
  previousValue: number,
  threshold: number | undefined,
): boolean {
  const delta = Math.abs(currentValue - previousValue);
  const safeThreshold = Number.isFinite(threshold) && threshold > 0 ? threshold : 0;
  return delta > 0 && delta >= safeThreshold;
}

export function detectChangedData(input: DetectChangedDataInput): Record<string, TelemetryValue> {
  const changed: Record<string, TelemetryValue> = {};

  for (const [key, currentValue] of Object.entries(input.current)) {
    const previousValue = input.previous[key];

    if (input.publishFullSnapshot || previousValue === undefined || previousValue === null) {
      changed[key] = currentValue;
      continue;
    }

    if (typeof currentValue === "number" && typeof previousValue === "number") {
      if (hasMetNumericThreshold(currentValue, previousValue, input.thresholds[key])) {
        changed[key] = currentValue;
      }
      continue;
    }

    if (currentValue !== previousValue) {
      changed[key] = currentValue;
    }
  }

  return changed;
}
