"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Port of the backend value-rule tests: iot-platform-backend
 * `tests/services/device-intent-predicate-compare.test.ts` @ 2940375b (`dev`).
 * The `DeviceIntentService.*` describes are mirrored in `deviceIntents.test.ts`.
 */
const intentValue_1 = require("../intentValue");
const ALL_OPS = ['=', '!=', '>', '>=', '<', '<='];
describe('compareIntentPredicate', () => {
    describe('Enum', () => {
        it('matches an Enum str_v label against the same telemetry label (web writes Enum to str_v)', () => {
            expect((0, intentValue_1.compareIntentPredicate)('Auto EC/PH', { operation: '=', str_v: 'Auto EC/PH' })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)('Manual', { operation: '=', str_v: 'Auto EC/PH' })).toBe(false);
            expect((0, intentValue_1.compareIntentPredicate)('Manual', { operation: '!=', str_v: 'Auto EC/PH' })).toBe(true);
        });
        it('does NOT false-match telemetry 0 for an Enum str_v label (Number(null) === 0 regression)', () => {
            expect((0, intentValue_1.compareIntentPredicate)(0, { operation: '=', str_v: 'Auto EC/PH', dbl_v: null, bool_v: null })).toBe(false);
            expect((0, intentValue_1.compareIntentPredicate)('0', { operation: '=', str_v: 'Auto EC/PH', dbl_v: null, bool_v: null })).toBe(false);
            // Different value, so `!=` is (correctly) true; ordering on enum text is plain string ordering.
            expect((0, intentValue_1.compareIntentPredicate)(0, { operation: '!=', str_v: 'Auto EC/PH' })).toBe(true);
        });
        it('matches an Enum str_v numeric code against numeric telemetry', () => {
            expect((0, intentValue_1.compareIntentPredicate)(2, { operation: '=', str_v: '2' })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)('2', { operation: '=', str_v: '2' })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)(3, { operation: '=', str_v: '2' })).toBe(false);
            expect((0, intentValue_1.compareIntentPredicate)(3, { operation: '!=', str_v: '2' })).toBe(true);
        });
        it('matches an Enum dbl_v code against numeric and numeric-string telemetry (mobile writes numeric text to dbl_v)', () => {
            expect((0, intentValue_1.compareIntentPredicate)(1, { operation: '=', dbl_v: 1 })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)('1', { operation: '=', dbl_v: 1 })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)(2, { operation: '=', dbl_v: 1 })).toBe(false);
            expect((0, intentValue_1.compareIntentPredicate)(0, { operation: '=', dbl_v: 1 })).toBe(false);
        });
    });
    describe('Raw', () => {
        it('compares Raw text stored in str_v as an exact, trimmed, case-sensitive string', () => {
            expect((0, intentValue_1.compareIntentPredicate)('ON-AUTO', { operation: '=', str_v: 'ON-AUTO' })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)('  ON-AUTO ', { operation: '=', str_v: 'ON-AUTO' })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)('on-auto', { operation: '=', str_v: 'ON-AUTO' })).toBe(false);
            expect((0, intentValue_1.compareIntentPredicate)('OFF', { operation: '=', str_v: 'ON-AUTO' })).toBe(false);
            expect((0, intentValue_1.compareIntentPredicate)('OFF', { operation: '!=', str_v: 'ON-AUTO' })).toBe(true);
        });
        it('does not false-match telemetry 0 for a Raw str_v predicate', () => {
            expect((0, intentValue_1.compareIntentPredicate)(0, { operation: '=', str_v: 'ready' })).toBe(false);
        });
    });
    describe('Button / Checkbox-bit (bool_v)', () => {
        it('matches a Button bool_v true against true / 1 / "true" and variants', () => {
            for (const telemetry of [true, 1, '1', 'true', 'TRUE', ' True ', 'on', 'ON']) {
                expect((0, intentValue_1.compareIntentPredicate)(telemetry, { operation: '=', bool_v: true })).toBe(true);
                expect((0, intentValue_1.compareIntentPredicate)(telemetry, { operation: '!=', bool_v: true })).toBe(false);
            }
        });
        it('does not match a Button bool_v true against false / 0 / "false" / "off"', () => {
            for (const telemetry of [false, 0, '0', 'false', 'FALSE', 'off', 'Off']) {
                expect((0, intentValue_1.compareIntentPredicate)(telemetry, { operation: '=', bool_v: true })).toBe(false);
                expect((0, intentValue_1.compareIntentPredicate)(telemetry, { operation: '!=', bool_v: true })).toBe(true);
            }
        });
        it('matches a Checkbox-bit bool_v false against false / 0 / "0" / "off"', () => {
            for (const telemetry of [false, 0, '0', 'false', 'off']) {
                expect((0, intentValue_1.compareIntentPredicate)(telemetry, { operation: '=', bool_v: false })).toBe(true);
            }
            for (const telemetry of [true, 1, '1', 'true', 'on']) {
                expect((0, intentValue_1.compareIntentPredicate)(telemetry, { operation: '=', bool_v: false })).toBe(false);
                expect((0, intentValue_1.compareIntentPredicate)(telemetry, { operation: '!=', bool_v: false })).toBe(true);
            }
        });
        it('breaks a multi-column tie by function data_type', () => {
            expect((0, intentValue_1.compareIntentPredicate)(25, { operation: '=', bool_v: false, dbl_v: 25 }, 'Value')).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)('AUTO', { operation: '=', bool_v: false, dbl_v: 0, str_v: 'AUTO' }, 'Enum')).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)(0, { operation: '=', bool_v: false, dbl_v: 0, str_v: 'AUTO' }, 'Enum')).toBe(false);
            expect((0, intentValue_1.compareIntentPredicate)(1, { operation: '=', bool_v: true, dbl_v: 0 }, 'Bool')).toBe(true);
        });
        it('treats bool_v false as populated (it must not fall through to dbl_v / str_v)', () => {
            expect((0, intentValue_1.compareIntentPredicate)(0, { operation: '=', bool_v: false, dbl_v: null, str_v: null })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)(0, { operation: '=', bool_v: false, dbl_v: 0 }, 'Bool')).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)(1, { operation: '=', bool_v: false, dbl_v: 0 }, 'Bool')).toBe(false);
        });
        it('reads any other non-zero number as true (a coil or register reporting 255 for on)', () => {
            for (const telemetry of [2, 255, -1, 0.5, '255', ' 2 ']) {
                expect((0, intentValue_1.compareIntentPredicate)(telemetry, { operation: '=', bool_v: true })).toBe(true);
                expect((0, intentValue_1.compareIntentPredicate)(telemetry, { operation: '=', bool_v: false })).toBe(false);
                expect((0, intentValue_1.compareIntentPredicate)(telemetry, { operation: '!=', bool_v: false })).toBe(true);
            }
            expect((0, intentValue_1.compareIntentPredicate)('0.0', { operation: '=', bool_v: false })).toBe(true);
        });
        it('returns false for unparseable boolean telemetry, including for !=', () => {
            for (const telemetry of ['maybe', '', '  ', null, undefined, NaN, Infinity, {}, []]) {
                expect((0, intentValue_1.compareIntentPredicate)(telemetry, { operation: '=', bool_v: true })).toBe(false);
                expect((0, intentValue_1.compareIntentPredicate)(telemetry, { operation: '!=', bool_v: true })).toBe(false);
                expect((0, intentValue_1.compareIntentPredicate)(telemetry, { operation: '=', bool_v: false })).toBe(false);
                expect((0, intentValue_1.compareIntentPredicate)(telemetry, { operation: '!=', bool_v: false })).toBe(false);
            }
        });
        it('returns false for ordering operators on booleans', () => {
            for (const operation of ['>', '>=', '<', '<=']) {
                for (const boolV of [true, false]) {
                    for (const telemetry of [true, false, 1, 0, 'true', 'false']) {
                        expect((0, intentValue_1.compareIntentPredicate)(telemetry, { operation, bool_v: boolV })).toBe(false);
                    }
                }
            }
        });
    });
    describe('Value / Accumulate (dbl_v)', () => {
        it('supports every numeric operator', () => {
            const cases = [
                ['=', 10, true],
                ['=', 11, false],
                ['!=', 10, false],
                ['!=', 11, true],
                ['>', 11, true],
                ['>', 10, false],
                ['>', 9, false],
                ['>=', 11, true],
                ['>=', 10, true],
                ['>=', 9, false],
                ['<', 9, true],
                ['<', 10, false],
                ['<', 11, false],
                ['<=', 9, true],
                ['<=', 10, true],
                ['<=', 11, false],
            ];
            for (const [operation, telemetry, expected] of cases) {
                expect([operation, telemetry, (0, intentValue_1.compareIntentPredicate)(telemetry, { operation, dbl_v: 10 })]).toEqual([
                    operation,
                    telemetry,
                    expected,
                ]);
            }
        });
        it('handles decimals, negatives, zero and numeric-string telemetry', () => {
            expect((0, intentValue_1.compareIntentPredicate)('25.5', { operation: '>', dbl_v: 25 })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)(-3, { operation: '<', dbl_v: 0 })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)(0, { operation: '=', dbl_v: 0 })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)(' 7 ', { operation: '=', dbl_v: 7 })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)('1e2', { operation: '=', dbl_v: 100 })).toBe(true);
        });
        it('accepts a dbl_v delivered as a numeric string (pg float over the wire)', () => {
            expect((0, intentValue_1.compareIntentPredicate)(10, { operation: '=', dbl_v: '10' })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)(10.5, { operation: '>', dbl_v: '10' })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)(10, { operation: '=', dbl_v: 'abc' })).toBe(false);
        });
        it('returns false for non-finite or non-numeric telemetry against dbl_v, for every operator', () => {
            for (const telemetry of [NaN, Infinity, -Infinity, 'abc', '', '  ', null, undefined, {}, [], [5]]) {
                for (const operation of ALL_OPS) {
                    expect([operation, String(telemetry), (0, intentValue_1.compareIntentPredicate)(telemetry, { operation, dbl_v: 10 })]).toEqual([
                        operation,
                        String(telemetry),
                        false,
                    ]);
                }
            }
        });
        it('does not treat telemetry null / blank as 0 against dbl_v 0', () => {
            expect((0, intentValue_1.compareIntentPredicate)(null, { operation: '=', dbl_v: 0 })).toBe(false);
            expect((0, intentValue_1.compareIntentPredicate)('', { operation: '=', dbl_v: 0 })).toBe(false);
            expect((0, intentValue_1.compareIntentPredicate)(undefined, { operation: '<=', dbl_v: 0 })).toBe(false);
        });
        it('treats dbl_v 0 as populated (it must not fall through to str_v)', () => {
            expect((0, intentValue_1.compareIntentPredicate)(0, { operation: '=', bool_v: null, dbl_v: 0, str_v: null })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)(0, { operation: '=', bool_v: false, dbl_v: 0, str_v: '' }, 'Value')).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)(1, { operation: '=', bool_v: false, dbl_v: 0, str_v: '' }, 'Value')).toBe(false);
        });
    });
    describe('String type (str_v)', () => {
        it('compares text with every operator using string ordering', () => {
            expect((0, intentValue_1.compareIntentPredicate)('b', { operation: '=', str_v: 'b' })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)('b', { operation: '!=', str_v: 'a' })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)('b', { operation: '>', str_v: 'a' })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)('b', { operation: '>=', str_v: 'b' })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)('a', { operation: '<', str_v: 'b' })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)('b', { operation: '<=', str_v: 'b' })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)('b', { operation: '<', str_v: 'a' })).toBe(false);
            expect((0, intentValue_1.compareIntentPredicate)('a', { operation: '>=', str_v: 'b' })).toBe(false);
        });
        it('is case-sensitive and trims both sides', () => {
            expect((0, intentValue_1.compareIntentPredicate)('Auto', { operation: '=', str_v: 'auto' })).toBe(false);
            expect((0, intentValue_1.compareIntentPredicate)(' Auto', { operation: '=', str_v: 'Auto  ' })).toBe(true);
        });
        it('compares numerically when both sides parse as numbers, not lexicographically', () => {
            expect((0, intentValue_1.compareIntentPredicate)(10, { operation: '>', str_v: '9' })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)('10', { operation: '>', str_v: '9' })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)(2.0, { operation: '=', str_v: '2.0' })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)('2.00', { operation: '=', str_v: '2' })).toBe(true);
        });
        it('returns false when the telemetry value is null or undefined', () => {
            expect((0, intentValue_1.compareIntentPredicate)(null, { operation: '=', str_v: 'null' })).toBe(false);
            expect((0, intentValue_1.compareIntentPredicate)(undefined, { operation: '!=', str_v: 'x' })).toBe(false);
        });
        it('treats an empty-string str_v as populated', () => {
            expect((0, intentValue_1.compareIntentPredicate)('', { operation: '=', str_v: '' })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)('x', { operation: '=', str_v: '' })).toBe(false);
        });
    });
    describe('field precedence and degenerate predicates', () => {
        it('reads the single populated column; with several, non-empty str_v, then bool_v for Bool types, then dbl_v', () => {
            expect((0, intentValue_1.compareIntentPredicate)(true, { operation: '=', bool_v: true, dbl_v: null, str_v: null })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)(9, { operation: '=', bool_v: null, dbl_v: 9, str_v: null })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)('z', { operation: '=', bool_v: null, dbl_v: null, str_v: 'z' })).toBe(true);
            // Several populated (legacy rows): str_v was never coerced, so it wins.
            expect((0, intentValue_1.compareIntentPredicate)('z', { operation: '=', bool_v: false, dbl_v: 0, str_v: 'z' })).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)(0, { operation: '=', bool_v: false, dbl_v: 0, str_v: 'z' })).toBe(false);
            // No str_v: bool_v only for Bool-type functions, dbl_v otherwise.
            expect((0, intentValue_1.compareIntentPredicate)(true, { operation: '=', bool_v: true, dbl_v: 0 }, 'Button')).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)(9, { operation: '=', bool_v: false, dbl_v: 9 }, 'Value')).toBe(true);
            expect((0, intentValue_1.compareIntentPredicate)(9, { operation: '=', bool_v: false, dbl_v: 9 })).toBe(true);
        });
        it('returns false when every predicate field is null or undefined', () => {
            for (const operation of ALL_OPS) {
                expect((0, intentValue_1.compareIntentPredicate)(0, { operation, bool_v: null, dbl_v: null, str_v: null })).toBe(false);
                expect((0, intentValue_1.compareIntentPredicate)('x', { operation })).toBe(false);
                expect((0, intentValue_1.compareIntentPredicate)(true, { operation, bool_v: undefined, dbl_v: undefined, str_v: undefined })).toBe(false);
            }
        });
        it('returns false for an unknown operator on every field type', () => {
            expect((0, intentValue_1.compareIntentPredicate)(1, { operation: '~=', dbl_v: 1 })).toBe(false);
            expect((0, intentValue_1.compareIntentPredicate)('a', { operation: 'LIKE', str_v: 'a' })).toBe(false);
            expect((0, intentValue_1.compareIntentPredicate)(true, { operation: '==', bool_v: true })).toBe(false);
            expect((0, intentValue_1.compareIntentPredicate)(1, { operation: '', dbl_v: 1 })).toBe(false);
        });
    });
});
describe('resolveIntentActionValue', () => {
    it('sends an Enum / Raw value stored in str_v (web), numeric text as a number', () => {
        expect((0, intentValue_1.resolveIntentActionValue)({ bool_v: null, dbl_v: null, str_v: '2' })).toBe(2);
        expect((0, intentValue_1.resolveIntentActionValue)({ bool_v: null, dbl_v: null, str_v: ' 0 ' })).toBe(0);
        expect((0, intentValue_1.resolveIntentActionValue)({ bool_v: null, dbl_v: null, str_v: 'Auto EC/PH' })).toBe('Auto EC/PH');
    });
    it('sends a Button / Checkbox-bit value stored in bool_v as a boolean', () => {
        expect((0, intentValue_1.resolveIntentActionValue)({ bool_v: true, dbl_v: null, str_v: null })).toBe(true);
        expect((0, intentValue_1.resolveIntentActionValue)({ bool_v: false })).toBe(false);
    });
    it('sends dbl_v as a number (mobile numeric enum codes, Value functions)', () => {
        expect((0, intentValue_1.resolveIntentActionValue)({ dbl_v: 1 })).toBe(1);
        expect((0, intentValue_1.resolveIntentActionValue)({ dbl_v: '12.5' })).toBe(12.5);
        expect((0, intentValue_1.resolveIntentActionValue)({ dbl_v: 0 })).toBe(0);
    });
    it('sends only canonical numeric text as a number; keeps leading zeros, exponents and String functions as text', () => {
        expect((0, intentValue_1.resolveIntentActionValue)({ str_v: '-1.5' })).toBe(-1.5);
        expect((0, intentValue_1.resolveIntentActionValue)({ str_v: '007' })).toBe('007');
        expect((0, intentValue_1.resolveIntentActionValue)({ str_v: '0912345678' })).toBe('0912345678');
        expect((0, intentValue_1.resolveIntentActionValue)({ str_v: '1e3' })).toBe('1e3');
        expect((0, intentValue_1.resolveIntentActionValue)({ str_v: '2.50' })).toBe('2.50');
        expect((0, intentValue_1.resolveIntentActionValue)({ str_v: '2' }, 'String')).toBe('2');
    });
    it('breaks a multi-column tie (rows saved with coerced bool_v=false / dbl_v=0) by function data_type', () => {
        // Value setpoint saved as {bool_v:false, dbl_v:12}: the old evaluator sent 12, so must we.
        expect((0, intentValue_1.resolveIntentActionValue)({ bool_v: false, dbl_v: 12, str_v: null }, 'Value')).toBe(12);
        // Web Enum saved as {bool_v:false, dbl_v:0, str_v:'2'}.
        expect((0, intentValue_1.resolveIntentActionValue)({ bool_v: false, dbl_v: 0, str_v: '2' }, 'Enum')).toBe(2);
        // Mobile numeric Enum code saved as {bool_v:false, dbl_v:1}.
        expect((0, intentValue_1.resolveIntentActionValue)({ bool_v: false, dbl_v: 1, str_v: null }, 'Enum')).toBe(1);
        // Web Button saved as {bool_v:true, dbl_v:0}.
        expect((0, intentValue_1.resolveIntentActionValue)({ bool_v: true, dbl_v: 0, str_v: null }, 'Button')).toBe(true);
        expect((0, intentValue_1.resolveIntentActionValue)({ bool_v: false, dbl_v: 0, str_v: 'x' }, 'Raw')).toBe('x');
        // Other writable types: web text in str_v, mobile numbers in dbl_v, never the coerced bool_v=false.
        expect((0, intentValue_1.resolveIntentActionValue)({ bool_v: false, dbl_v: 0, str_v: '12.5' }, 'Double')).toBe(12.5);
        expect((0, intentValue_1.resolveIntentActionValue)({ bool_v: false, dbl_v: 0, str_v: '10.0.0.1' }, 'IP')).toBe('10.0.0.1');
        expect((0, intentValue_1.resolveIntentActionValue)({ bool_v: false, dbl_v: 3, str_v: null }, 'Float_1')).toBe(3);
        // Missing function row (LEFT JOIN) has no data_type.
        expect((0, intentValue_1.resolveIntentActionValue)({ bool_v: false, dbl_v: 12, str_v: null })).toBe(12);
        expect((0, intentValue_1.resolveIntentActionValue)({ bool_v: false, dbl_v: 0, str_v: '' }, 'Value')).toBe(0);
    });
    it('returns undefined when no column holds a usable value', () => {
        expect((0, intentValue_1.resolveIntentActionValue)({})).toBeUndefined();
        expect((0, intentValue_1.resolveIntentActionValue)({ bool_v: null, dbl_v: null, str_v: null })).toBeUndefined();
        expect((0, intentValue_1.resolveIntentActionValue)({ str_v: '   ' })).toBeUndefined();
        expect((0, intentValue_1.resolveIntentActionValue)({ dbl_v: 'abc' })).toBeUndefined();
    });
});
describe('intentActionAlreadyApplied', () => {
    it('skips only when the cached telemetry already equals the value that would be sent', () => {
        expect((0, intentValue_1.intentActionAlreadyApplied)(2, { str_v: '2' })).toBe(true);
        expect((0, intentValue_1.intentActionAlreadyApplied)('2', { str_v: '2' })).toBe(true);
        expect((0, intentValue_1.intentActionAlreadyApplied)(0, { str_v: '2' })).toBe(false);
        expect((0, intentValue_1.intentActionAlreadyApplied)(1, { bool_v: true })).toBe(true);
        expect((0, intentValue_1.intentActionAlreadyApplied)(0, { bool_v: true })).toBe(false);
        expect((0, intentValue_1.intentActionAlreadyApplied)('Auto', { str_v: 'Auto' })).toBe(true);
        expect((0, intentValue_1.intentActionAlreadyApplied)(null, { str_v: 'Auto' })).toBe(false);
        expect((0, intentValue_1.intentActionAlreadyApplied)(5, {})).toBe(false);
    });
});
