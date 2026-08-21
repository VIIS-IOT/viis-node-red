"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const demeter_schedule_protocol_1 = require("../demeter-schedule-protocol");
describe('demeter-schedule-protocol', () => {
    const localSchedule = {
        name: 'rk-schedule-1',
        label: 'Morning irrigation',
        device_id: 'device-uuid',
        action: '{"pump":1}',
        enable: 1,
        interval: '0,1,2',
        set_time: '06:00:00',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        start_time: '06:00:00',
        end_time: '07:00:00',
        type: 'fixed',
        is_deleted: 0,
        status: 'finished',
        schedule_plan_id: 'rk-plan-1',
        creation: '2026-08-01 00:00:00',
        modified: '2026-08-02 00:00:00',
    };
    const localPlan = {
        name: 'rk-plan-1',
        label: 'Summer plan',
        schedule_count: 2,
        status: 'active',
        enable: 1,
        is_deleted: 0,
        device_id: 'device-uuid',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        creation: '2026-08-01 00:00:00',
        modified: '2026-08-02 00:00:00',
    };
    it('maps local schedule PK name to wire id and label to wire name', () => {
        const wire = (0, demeter_schedule_protocol_1.toDeviceSchedule)(localSchedule);
        expect(wire.id).toBe('rk-schedule-1');
        expect(wire.name).toBe('Morning irrigation');
        expect(wire.schedule_plan_id).toBe('rk-plan-1');
        expect(wire.set_time).toBe('06:00:00');
        expect(wire.time).toBe('06:00:00');
        expect(wire.creation).toBe('2026-08-01T00:00:00.000Z');
        expect(wire.modified).toBe('2026-08-02T00:00:00.000Z');
    });
    it('maps Demeter ISO Z instants onto naive UTC DATETIME for local write', () => {
        const local = (0, demeter_schedule_protocol_1.fromDeviceSchedule)({
            id: 'rk-schedule-1',
            name: 'Morning irrigation',
            creation: '2026-08-21T04:54:13.000Z',
            modified: '2026-08-21T05:10:00.000Z',
        });
        expect(local.creation).toBe('2026-08-21 04:54:13');
        expect(local.modified).toBe('2026-08-21 05:10:00');
    });
    it('maps Demeter wire schedule back onto local name/label columns', () => {
        const local = (0, demeter_schedule_protocol_1.fromDeviceSchedule)({
            id: 'rk-schedule-1',
            name: 'Morning irrigation',
            device_id: 'device-uuid',
            enable: true,
            is_deleted: false,
            schedule_plan_id: 'rk-plan-1',
        });
        expect(local.name).toBe('rk-schedule-1');
        expect(local.label).toBe('Morning irrigation');
        expect(local.enable).toBe(1);
        expect(local.is_deleted).toBe(0);
        expect(local.schedule_plan_id).toBe('rk-plan-1');
    });
    it('keeps legacy Frappe payloads that only have name as the protocol key', () => {
        expect((0, demeter_schedule_protocol_1.deviceProtocolKey)({ name: 'old-pk' })).toBe('old-pk');
        const local = (0, demeter_schedule_protocol_1.fromDeviceSchedule)({
            name: 'old-pk',
            label: 'Legacy label',
            enable: 1,
        });
        expect(local.name).toBe('old-pk');
        expect(local.label).toBe('Legacy label');
    });
    it('maps local plan PK name to wire id and label to wire name', () => {
        const wire = (0, demeter_schedule_protocol_1.toDeviceSchedulePlan)(localPlan);
        expect(wire.id).toBe('rk-plan-1');
        expect(wire.name).toBe('Summer plan');
        expect(wire.enable).toBe(1);
    });
    it('maps Demeter wire plan back onto local name/label columns', () => {
        var _a, _b;
        const local = (0, demeter_schedule_protocol_1.fromDeviceSchedulePlan)({
            id: 'rk-plan-1',
            name: 'Summer plan',
            enable: true,
            schedules: [{ id: 'rk-schedule-1', name: 'Morning irrigation' }],
        });
        expect(local.name).toBe('rk-plan-1');
        expect(local.label).toBe('Summer plan');
        expect((_a = local.schedules) === null || _a === void 0 ? void 0 : _a[0].name).toBe('rk-schedule-1');
        expect((_b = local.schedules) === null || _b === void 0 ? void 0 : _b[0].label).toBe('Morning irrigation');
    });
    it('puts local schedule.name on schedule log as the device protocol key', () => {
        const body = (0, demeter_schedule_protocol_1.toDeviceScheduleLog)({ schedule_id: 'rk-schedule-1', start_time: 't0', end_time: 't1' });
        expect(body.schedule_id).toBe('rk-schedule-1');
    });
    it('unwraps both paginated and raw-array Demeter envelopes', () => {
        expect((0, demeter_schedule_protocol_1.unwrapDevicePlanList)({ result: { data: [{ id: 'a', name: 'A' }] } })).toEqual([
            { id: 'a', name: 'A' },
        ]);
        expect((0, demeter_schedule_protocol_1.unwrapDevicePlanList)({ result: [{ id: 'b', name: 'B' }] })).toEqual([
            { id: 'b', name: 'B' },
        ]);
        expect((0, demeter_schedule_protocol_1.unwrapDevicePlanList)([{ id: 'c', name: 'C' }])).toEqual([{ id: 'c', name: 'C' }]);
    });
});
