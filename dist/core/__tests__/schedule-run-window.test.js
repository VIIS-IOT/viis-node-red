"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const farm_time_1 = require("../farm-time");
const schedule_run_window_1 = require("../schedule-run-window");
// Farm time is Asia/Ho_Chi_Minh. 2026-10-13 is a Tuesday (weekday 2).
const at = (date, time) => (0, farm_time_1.civilToUnixMs)(date, time);
const schedule = (overrides = {}) => (Object.assign({ start_time: '10:00:00', end_time: '10:15:00', start_date: null, end_date: null, interval: '0,1,2,3,4,5,6' }, overrides));
describe('evaluateScheduleRun — one rule for plan dates, schedule dates and start/end time', () => {
    it('is due inside the window with no date bounds', () => {
        expect((0, schedule_run_window_1.evaluateScheduleRun)(schedule(), null, at('2026-10-13', '10:05:00'))).toEqual({
            due: true,
            runDate: '2026-10-13',
        });
    });
    it('is not due outside the window', () => {
        expect((0, schedule_run_window_1.evaluateScheduleRun)(schedule(), null, at('2026-10-13', '10:15:00'))).toEqual({
            due: false,
            reason: 'outside_window',
        });
    });
    it('needs both a start and an end time', () => {
        expect((0, schedule_run_window_1.evaluateScheduleRun)(schedule({ end_time: null }), null, at('2026-10-13', '10:00:00'))).toEqual({
            due: false,
            reason: 'missing_time',
        });
        expect((0, schedule_run_window_1.evaluateScheduleRun)(schedule({ start_time: '' }), null, at('2026-10-13', '10:00:00'))).toEqual({
            due: false,
            reason: 'missing_time',
        });
    });
    it("honours the plan's end date", () => {
        const plan = { start_date: '2026-10-01', end_date: '2026-10-12' };
        expect((0, schedule_run_window_1.evaluateScheduleRun)(schedule(), plan, at('2026-10-13', '10:05:00'))).toEqual({
            due: false,
            reason: 'plan_dates',
        });
        expect((0, schedule_run_window_1.evaluateScheduleRun)(schedule(), plan, at('2026-10-12', '10:05:00'))).toEqual({
            due: true,
            runDate: '2026-10-12',
        });
    });
    it("honours the plan's start date", () => {
        const plan = { start_date: '2026-10-14', end_date: '2027-10-14' };
        expect((0, schedule_run_window_1.evaluateScheduleRun)(schedule(), plan, at('2026-10-13', '10:05:00'))).toEqual({
            due: false,
            reason: 'plan_dates',
        });
    });
    it('treats a missing plan date as open on that side', () => {
        expect((0, schedule_run_window_1.evaluateScheduleRun)(schedule(), { start_date: null, end_date: '2026-10-13' }, at('2026-10-13', '10:05:00'))).toEqual({ due: true, runDate: '2026-10-13' });
    });
    it("honours a single schedule date bound (end only, start only)", () => {
        expect((0, schedule_run_window_1.evaluateScheduleRun)(schedule({ end_date: '2026-10-12' }), null, at('2026-10-13', '10:05:00'))).toEqual({
            due: false,
            reason: 'schedule_dates',
        });
        expect((0, schedule_run_window_1.evaluateScheduleRun)(schedule({ start_date: '2026-10-14' }), null, at('2026-10-13', '10:05:00'))).toEqual({
            due: false,
            reason: 'schedule_dates',
        });
    });
    it('accepts Date values for date columns', () => {
        const plan = { start_date: new Date('2026-10-01T00:00:00Z'), end_date: new Date('2026-10-12T00:00:00Z') };
        expect((0, schedule_run_window_1.evaluateScheduleRun)(schedule(), plan, at('2026-10-13', '10:05:00'))).toEqual({
            due: false,
            reason: 'plan_dates',
        });
    });
    it('checks the weekday of the run date', () => {
        expect((0, schedule_run_window_1.evaluateScheduleRun)(schedule({ interval: '1,3' }), null, at('2026-10-13', '10:05:00'))).toEqual({
            due: false,
            reason: 'weekday',
        });
        expect((0, schedule_run_window_1.evaluateScheduleRun)(schedule({ interval: '[2]' }), null, at('2026-10-13', '10:05:00'))).toEqual({
            due: true,
            runDate: '2026-10-13',
        });
        expect((0, schedule_run_window_1.evaluateScheduleRun)(schedule({ interval: '' }), null, at('2026-10-13', '10:05:00'))).toEqual({
            due: true,
            runDate: '2026-10-13',
        });
    });
    describe('a window that crosses midnight is judged by the day it starts', () => {
        const night = schedule({ start_time: '23:30:00', end_time: '00:15:00', interval: '2' }); // Tuesday only
        it("keeps running after midnight on the plan's last day", () => {
            const plan = { start_date: '2026-10-01', end_date: '2026-10-13' };
            expect((0, schedule_run_window_1.evaluateScheduleRun)(night, plan, at('2026-10-14', '00:05:00'))).toEqual({
                due: true,
                runDate: '2026-10-13',
            });
        });
        it('keeps running into Wednesday for a Tuesday-only schedule', () => {
            expect((0, schedule_run_window_1.evaluateScheduleRun)(night, null, at('2026-10-13', '23:45:00'))).toEqual({
                due: true,
                runDate: '2026-10-13',
            });
            expect((0, schedule_run_window_1.evaluateScheduleRun)(night, null, at('2026-10-14', '00:05:00'))).toEqual({
                due: true,
                runDate: '2026-10-13',
            });
        });
        it('does not start a run on a day the plan has not begun', () => {
            const plan = { start_date: '2026-10-14', end_date: null };
            expect((0, schedule_run_window_1.evaluateScheduleRun)(night, plan, at('2026-10-14', '00:05:00'))).toEqual({
                due: false,
                reason: 'plan_dates',
            });
        });
    });
    it('treats equal start and end as a 24 h window', () => {
        const allDay = schedule({ start_time: '06:00:00', end_time: '06:00:00' });
        expect((0, schedule_run_window_1.evaluateScheduleRun)(allDay, null, at('2026-10-14', '05:59:00'))).toEqual({
            due: true,
            runDate: '2026-10-13',
        });
    });
});
