import type { TelemetryValue } from "./change-detector";

/**
 * Curtain (lưới) state from its motor coil pair, published as the profile Enum `luoi_N`
 * (ADR-033 wire values): 0 = Thu, 1 = Dải, 2 = N/A.
 *
 * The coils drive the motor, so both off means the motor stopped and the curtain stays where it went:
 * keep the last known direction. With no history (first read after a fresh start) or both on, report N/A.
 */
export const LUOI_THU = 0;
export const LUOI_DAI = 1;
export const LUOI_UNKNOWN = 2;

const LUOI_COIL_PATTERN = /^(luoi_\d+)_(thu|dai)$/;

function isOn(value: TelemetryValue | undefined): boolean {
  return value === true || value === 1;
}

/** `luoi_N` keys whose `_thu` and `_dai` coils are both mapped. */
export function luoiKeysFromCoils(coilKeys: Iterable<string>): string[] {
  const halves = new Map<string, Set<string>>();
  for (const key of coilKeys) {
    const match = LUOI_COIL_PATTERN.exec(key);
    if (!match) continue;
    const seen = halves.get(match[1]) ?? new Set<string>();
    seen.add(match[2]);
    halves.set(match[1], seen);
  }
  return Array.from(halves.entries())
    .filter(([, seen]) => seen.has("thu") && seen.has("dai"))
    .map(([luoiKey]) => luoiKey)
    .sort();
}

export function deriveLuoiStates(
  luoiKeys: string[],
  coilValues: Record<string, TelemetryValue>,
  lastStates: Record<string, number>,
): Record<string, number> {
  const states: Record<string, number> = {};
  for (const luoiKey of luoiKeys) {
    const thu = coilValues[`${luoiKey}_thu`];
    const dai = coilValues[`${luoiKey}_dai`];
    if (thu === undefined || dai === undefined) continue;

    if (isOn(thu) && !isOn(dai)) {
      states[luoiKey] = LUOI_THU;
    } else if (isOn(dai) && !isOn(thu)) {
      states[luoiKey] = LUOI_DAI;
    } else if (!isOn(thu) && !isOn(dai)) {
      const last = lastStates[luoiKey];
      states[luoiKey] = last === LUOI_THU || last === LUOI_DAI ? last : LUOI_UNKNOWN;
    } else {
      states[luoiKey] = LUOI_UNKNOWN;
    }
  }
  return states;
}
