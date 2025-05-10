"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viis_telemetry_utils_1 = require("../viis-telemetry-utils");
/**
 * Unit test for getChangedKeys function.
 */
describe('getChangedKeys', () => {
    it('should detect numeric change above threshold', () => {
        const prev = { temp: 10 };
        const curr = { temp: 12 };
        const threshold = { temp: 1 };
        expect((0, viis_telemetry_utils_1.getChangedKeys)(curr, prev, threshold)).toEqual({ temp: 12 });
    });
    it('should ignore numeric change below threshold', () => {
        const prev = { temp: 10 };
        const curr = { temp: 10.5 };
        const threshold = { temp: 1 };
        expect((0, viis_telemetry_utils_1.getChangedKeys)(curr, prev, threshold)).toEqual({});
    });
    it('should detect non-numeric change', () => {
        const prev = { status: 'ok' };
        const curr = { status: 'fail' };
        const threshold = {};
        expect((0, viis_telemetry_utils_1.getChangedKeys)(curr, prev, threshold)).toEqual({ status: 'fail' });
    });
});
