export type TelemetryValue = number | boolean;

/** A change at least this many deadbands wide skips the minimum interval. */
export const LARGE_CHANGE_FACTOR = 5;

export interface DetectChangedDataInput {
  current: Record<string, TelemetryValue>;
  previous: Record<string, TelemetryValue | null | undefined>;
  thresholds: Record<string, number>;
  publishFullSnapshot: boolean;
  /**
   * Small analog changes (deadband > 0) are sent at most once per this interval for the whole device, so keys that
   * drift at different moments still leave together instead of one message each. A change of at least
   * {@link LARGE_CHANGE_FACTOR} deadbands is sent at once. State keys (deadband 0: coils, modes) are never held back.
   * 0 disables the limit.
   */
  minPublishIntervalMs?: number;
  /** When a small analog change was last published, for {@link minPublishIntervalMs}. */
  lastAnalogPublishAt?: number;
  now?: number;
}

function positiveThreshold(threshold: number | undefined): number {
  return Number.isFinite(threshold) && (threshold as number) > 0 ? (threshold as number) : 0;
}

function hasMetNumericThreshold(
  currentValue: number,
  previousValue: number,
  threshold: number,
): boolean {
  const delta = Math.abs(currentValue - previousValue);
  return delta > 0 && delta >= threshold;
}

function isHeldBackByInterval(delta: number, threshold: number, input: DetectChangedDataInput): boolean {
  const minInterval = input.minPublishIntervalMs ?? 0;
  if (minInterval <= 0 || threshold <= 0) return false;
  if (delta >= threshold * LARGE_CHANGE_FACTOR) return false;
  if (input.lastAnalogPublishAt === undefined) return false;
  return (input.now ?? Date.now()) - input.lastAnalogPublishAt < minInterval;
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
      const threshold = positiveThreshold(input.thresholds[key]);
      if (
        hasMetNumericThreshold(currentValue, previousValue, threshold) &&
        !isHeldBackByInterval(Math.abs(currentValue - previousValue), threshold, input)
      ) {
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
