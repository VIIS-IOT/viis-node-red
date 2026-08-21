"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const farm_time_1 = require("../farm-time");
describe('farm-time', () => {
    it('maps 05:00 ICT to the UTC instant TargetLine already documented', () => {
        expect((0, farm_time_1.civilToUnixMs)('2026-03-30', '05:00:00')).toBe(1774821600000);
        expect((0, farm_time_1.unixMsToCivil)(1774821600000)).toEqual({ date: '2026-03-30', time: '05:00:00' });
    });
    it('opens an overnight window on the next farm day', () => {
        const w = (0, farm_time_1.plannedWindowUnixMs)('2026-08-21', '22:00:00', '06:00:00');
        expect(w.endMs).toBe((0, farm_time_1.civilToUnixMs)('2026-08-22', '06:00:00'));
        expect(w.startMs).toBe((0, farm_time_1.civilToUnixMs)('2026-08-21', '22:00:00'));
    });
    it('treats ISO Z as UTC naive DATETIME with no +7', () => {
        expect((0, farm_time_1.isoUtcToMysqlUtcDatetime)('2026-08-21T04:54:13.000Z')).toBe('2026-08-21 04:54:13');
        expect((0, farm_time_1.mysqlUtcDatetimeToIso)('2026-08-21 04:54:13')).toBe('2026-08-21T04:54:13.000Z');
    });
    it('debugClocks prints both clocks', () => {
        expect((0, farm_time_1.debugClocks)(1774821600000)).toContain('utc=2026-03-29T22:00:00.000Z');
        expect((0, farm_time_1.debugClocks)(1774821600000)).toContain('farm=2026-03-30 05:00:00+07');
    });
});
