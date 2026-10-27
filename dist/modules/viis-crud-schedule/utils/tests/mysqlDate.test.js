"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mysqlDate_1 = require("../mysqlDate");
describe('toMysqlDate', () => {
    it('keeps a date-only string', () => {
        expect((0, mysqlDate_1.toMysqlDate)('2025-06-18')).toBe('2025-06-18');
    });
    it('maps a Vietnam midnight ISO instant back to the ICT calendar day', () => {
        expect((0, mysqlDate_1.toMysqlDate)('2025-06-18T17:00:00.000Z')).toBe('2025-06-19');
        expect((0, mysqlDate_1.toMysqlDate)('2027-06-29T17:00:00.000Z')).toBe('2027-06-30');
    });
    it('returns undefined for empty values', () => {
        expect((0, mysqlDate_1.toMysqlDate)(undefined)).toBeUndefined();
        expect((0, mysqlDate_1.toMysqlDate)(null)).toBeUndefined();
        expect((0, mysqlDate_1.toMysqlDate)('')).toBeUndefined();
    });
});
