/**
 * Port of the backend value rule: iot-platform-backend
 * `src/services/IoTCoreServices/intentPredicateCompare.ts` @ commit 2940375b (`dev`).
 * Keep the logic identical to that file; change the backend first, then port the change here.
 * Only this header differs from the backend source.
 */

/**
 * Pure comparison used by the device-intent condition evaluator.
 *
 * Clients store a predicate's comparison value in whichever column suits the control they render
 * (web: Enum/Raw text -> `str_v`, Button / Checkbox-bit -> `bool_v`; mobile: numeric-looking text ->
 * `dbl_v`, other text -> `str_v`, Bool / Checkbox-bit -> `bool_v`). The function `data_type` therefore
 * says nothing reliable about which column is populated, so the comparison is chosen by the POPULATED
 * column: `bool_v`, then `dbl_v`, then `str_v`.
 *
 * "No match" is always `false`, including for `!=`: a telemetry value that cannot be interpreted in the
 * predicate's domain must never trigger an automation.
 */

export interface IntentPredicateOperand {
  operation: string;
  bool_v?: boolean | null;
  dbl_v?: number | string | null;
  str_v?: string | null;
}

type Operator = '=' | '!=' | '>' | '>=' | '<' | '<=';

const DECIMAL_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

const TRUE_TOKENS = new Set(['true', '1', 'on']);
const FALSE_TOKENS = new Set(['false', '0', 'off']);

const isPresent = <T>(candidate: T | null | undefined): candidate is T => candidate !== null && candidate !== undefined;

/**
 * Finite number or `undefined`. Blank strings, null, undefined, objects and arrays are NOT numbers
 * (`Number(null)`, `Number('')` and `Number([])` are all `0`, which is exactly the false-match this
 * module exists to prevent).
 */
function toFiniteNumber(candidate: unknown): number | undefined {
  if (typeof candidate === 'number') return Number.isFinite(candidate) ? candidate : undefined;
  if (typeof candidate === 'boolean') return Number(candidate);
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (!DECIMAL_NUMBER.test(trimmed)) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Boolean or `undefined`. On/off words are read as such; any other finite number (or numeric string) is
 * `true` when non-zero, so a coil or register that reports 255 for "on" still reads as on.
 */
function toBoolean(candidate: unknown): boolean | undefined {
  if (typeof candidate === 'boolean') return candidate;
  if (typeof candidate === 'string') {
    const token = candidate.trim().toLowerCase();
    if (TRUE_TOKENS.has(token)) return true;
    if (FALSE_TOKENS.has(token)) return false;
  }
  const numeric = toFiniteNumber(candidate);
  return numeric === undefined ? undefined : numeric !== 0;
}

function compareOrdered<T extends number | string>(left: T, operation: Operator, right: T): boolean {
  switch (operation) {
    case '=':
      return left === right;
    case '!=':
      return left !== right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    case '<':
      return left < right;
    case '<=':
      return left <= right;
  }
}

function asOperator(operation: string): Operator | undefined {
  switch (operation) {
    case '=':
    case '!=':
    case '>':
    case '>=':
    case '<':
    case '<=':
      return operation;
    default:
      return undefined;
  }
}

function compareBoolean(value: unknown, operation: Operator, expected: unknown): boolean {
  if (operation !== '=' && operation !== '!=') return false;
  const actual = toBoolean(value);
  const target = toBoolean(expected);
  if (actual === undefined || target === undefined) return false;
  return compareOrdered(Number(actual), operation, Number(target));
}

function compareNumber(value: unknown, operation: Operator, expected: number | string): boolean {
  const actual = toFiniteNumber(value);
  const target = toFiniteNumber(expected);
  if (actual === undefined || target === undefined) return false;
  return compareOrdered(actual, operation, target);
}

function compareText(value: unknown, operation: Operator, expected: unknown): boolean {
  if (!isPresent(value)) return false;
  const actualNumber = toFiniteNumber(value);
  const expectedNumber = toFiniteNumber(expected);
  if (actualNumber !== undefined && expectedNumber !== undefined) {
    return compareOrdered(actualNumber, operation, expectedNumber);
  }
  return compareOrdered(String(value).trim(), operation, String(expected).trim());
}

type ValueColumn = 'bool_v' | 'dbl_v' | 'str_v';

interface ValueColumns {
  bool_v?: boolean | null;
  dbl_v?: number | string | null;
  str_v?: string | null;
}

const VALUE_COLUMNS: ValueColumn[] = ['bool_v', 'dbl_v', 'str_v'];
const BOOL_TYPES = new Set(['bool', 'boolean', 'button', 'checkbox-bit']);

/**
 * The column that holds the value. Exactly one populated column is the contract. Rows saved between
 * 2026-09-15 and this fix can hold more: the action normaliser turned the unused `bool_v: null` /
 * `dbl_v: null` into `false` / `0` (it never touched `str_v`). For those: non-empty `str_v` wins, then
 * `bool_v` for Bool-type functions, then `dbl_v`.
 */
function valueColumn(operand: ValueColumns, dataType?: string | null): ValueColumn | undefined {
  const populated = VALUE_COLUMNS.filter(column => isPresent(operand[column]));
  if (populated.length <= 1) return populated[0];
  if (isPresent(operand.str_v) && String(operand.str_v).trim()) return 'str_v';
  if (BOOL_TYPES.has(String(dataType || '').trim().toLowerCase()) && isPresent(operand.bool_v)) return 'bool_v';
  if (isPresent(operand.dbl_v)) return 'dbl_v';
  return populated[0];
}

/**
 * Compare a telemetry `value` with an intent predicate, selecting the comparison from the populated
 * predicate field (`bool_v` -> `dbl_v` -> `str_v`; `dataType` breaks a tie, see {@link valueColumn}).
 * Returns `false` for an unknown operator, a predicate with no populated field, ordering operators on
 * booleans, and telemetry that cannot be read in the predicate's domain.
 */
export function compareIntentPredicate(
  value: unknown,
  predicate: IntentPredicateOperand,
  dataType?: string | null,
): boolean {
  const operation = asOperator(predicate.operation);
  if (!operation) return false;

  switch (valueColumn(predicate, dataType)) {
    case 'bool_v':
      return compareBoolean(value, operation, predicate.bool_v);
    case 'dbl_v':
      return compareNumber(value, operation, predicate.dbl_v as number | string);
    case 'str_v':
      return compareText(value, operation, predicate.str_v);
    default:
      return false;
  }
}

export type IntentActionOperand = ValueColumns;

/**
 * The value a `set_state` action sends, read from the POPULATED column for the same reason as
 * {@link compareIntentPredicate}: web stores Enum / Raw values in `str_v` and Button / Checkbox-bit in
 * `bool_v`, whatever the function `data_type` says. Text in canonical number form ('2', '-1.5') is sent
 * as a number (Enum codes, Raw registers) unless the function is a String; other text ('007',
 * '0912345678', '1e3') is sent trimmed. `undefined` means the action has no usable value and must not
 * be sent.
 */
export function resolveIntentActionValue(
  action: IntentActionOperand,
  dataType?: string | null,
): boolean | number | string | undefined {
  switch (valueColumn(action, dataType)) {
    case 'bool_v':
      return toBoolean(action.bool_v);
    case 'dbl_v':
      return toFiniteNumber(action.dbl_v);
    case 'str_v': {
      const text = String(action.str_v).trim();
      if (!text) return undefined;
      if (String(dataType || '').trim().toLowerCase() === 'string') return text;
      const numeric = toFiniteNumber(text);
      return numeric !== undefined && String(numeric) === text ? numeric : text;
    }
    default:
      return undefined;
  }
}

/** True when telemetry already equals the value {@link resolveIntentActionValue} sends. */
export function intentActionAlreadyApplied(
  current: unknown,
  action: IntentActionOperand,
  dataType?: string | null,
): boolean {
  const target = resolveIntentActionValue(action, dataType);
  if (target === undefined) return false;
  if (typeof target === 'boolean') return compareIntentPredicate(current, { operation: '=', bool_v: target });
  if (typeof target === 'number') return compareIntentPredicate(current, { operation: '=', dbl_v: target });
  return compareIntentPredicate(current, { operation: '=', str_v: target });
}
