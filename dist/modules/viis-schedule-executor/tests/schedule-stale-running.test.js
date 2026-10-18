"use strict";
/**
 * Regression: a "running" schedule whose action produces no Modbus write
 * (all coils "false", luoi = 2 (invalid on this version), the rest config keys) never stores active
 * commands. The power-recovery check must not treat it as stale, otherwise the
 * executor restarts it on every tick (seen on gateway 172.30.108.115: restart,
 * config republish and server sync every 15 s).
 */
Object.defineProperty(exports, "__esModule", { value: true });
const viis_schedule_executor_service_1 = require("../viis-schedule-executor-service");
const schedule_stale_guard_1 = require("../schedule-stale-guard");
const COILS = {
    quat_1: 0, quat_2: 1, quat_3: 2, quat_4: 3, quat_5: 4, quat_6: 5,
    quat_dao_1: 6, quat_dao_2: 7, quat_dao_3: 8, bom_nuoc_1: 9,
    luoi_1_thu: 10, luoi_1_dai: 11, luoi_2_thu: 12, luoi_2_dai: 13,
};
const HOLDING = { temp_indoor: 0, humi_indoor: 1 };
// Action of schedule 2e4b364b033e39c4 on gateway 172.30.108.115
const GATEWAY_115_ACTION = {
    quat_1: 'false', quat_2: 'false', quat_3: 'false', quat_4: 'false', quat_5: 'false', quat_6: 'false',
    quat_dao_1: 'false', quat_dao_2: 'false', quat_dao_3: 'false', bom_nuoc_1: 'false',
    luoi_1: 2, luoi_2: 2,
    set_mode_fan: 1, set_auto_mode_fan: 0, set_k1_fan: 21, set_k2_fan: 25, set_k3_fan: 26, set_k4_fan: 27,
    set_gr_alternate_fan: 2, set_time_alternate_fan: 6, set_mode_fan_dao: 1, set_auto_mode_fan_dao: 1,
    set_time_fan_dao_off: 50, set_time_fan_dao_on: 4, set_mode_tuong_nuoc: 1,
    set_threshold_low_water_bump: 75, set_threshold_high_water_bump: 85, set_mode_luoi: 0,
};
const createSchedule = (action) => ({
    name: '2e4b364b033e39c4',
    action: JSON.stringify(action),
    label: 'Chương trình ban ngày',
    status: 'running',
    start_time: '07:00:00',
    end_time: '17:00:00',
    enable: 1,
    is_deleted: 0,
    device_id: 'test-device',
});
describe('Stale running schedule detection', () => {
    let service;
    let store;
    beforeEach(() => {
        store = new Map();
        const global = {
            get: jest.fn((key) => store.get(key)),
            set: jest.fn((key, value) => store.set(key, value)),
        };
        const node = { context: () => ({ global }), warn: jest.fn(), error: jest.fn() };
        service = new viis_schedule_executor_service_1.ScheduleService(node);
        Object.defineProperty(service, 'globalHelper', {
            value: {
                getJsonEnvVar: jest.fn((key, fallback) => {
                    if (key === 'MODBUS_COILS')
                        return COILS;
                    if (key === 'MODBUS_HOLDING_REGISTERS')
                        return HOLDING;
                    return fallback;
                }),
                getEnvVar: jest.fn((_key, fallback) => fallback),
            },
            writable: true,
            configurable: true,
        });
    });
    describe('hasWritableModbusCommands', () => {
        it('returns false for the gateway 115 action (all coils off, luoi 2, config only)', () => {
            expect(service.hasWritableModbusCommands(createSchedule(GATEWAY_115_ACTION))).toBe(false);
        });
        it('does not store config parameters while checking', () => {
            service.hasWritableModbusCommands(createSchedule(GATEWAY_115_ACTION));
            expect(store.get('configKeyValues')).toBeUndefined();
            expect(store.get('scheduleConfigKeys')).toBeUndefined();
        });
        it('returns true when a coil is switched on', () => {
            const action = Object.assign(Object.assign({}, GATEWAY_115_ACTION), { quat_1: 'true' });
            expect(service.hasWritableModbusCommands(createSchedule(action))).toBe(true);
        });
        it('returns true when luoi expands to a coil', () => {
            const action = Object.assign(Object.assign({}, GATEWAY_115_ACTION), { luoi_1: 0 });
            expect(service.hasWritableModbusCommands(createSchedule(action))).toBe(true);
        });
        it('returns true for a holding register set to 0', () => {
            const action = Object.assign(Object.assign({}, GATEWAY_115_ACTION), { temp_indoor: 0 });
            expect(service.hasWritableModbusCommands(createSchedule(action))).toBe(true);
        });
    });
    describe('isStaleRunningSchedule', () => {
        const writable = () => true;
        const notWritable = () => false;
        it('is stale when running, no active commands and the action writes Modbus', () => {
            expect((0, schedule_stale_guard_1.isStaleRunningSchedule)('running', 0, writable)).toBe(true);
        });
        it('is not stale when the action writes nothing (restart loop regression)', () => {
            expect((0, schedule_stale_guard_1.isStaleRunningSchedule)('running', 0, notWritable)).toBe(false);
        });
        it('is not stale when active commands exist', () => {
            const check = jest.fn(() => true);
            expect((0, schedule_stale_guard_1.isStaleRunningSchedule)('running', 3, check)).toBe(false);
            expect(check).not.toHaveBeenCalled();
        });
        it('is not stale when the schedule is not running', () => {
            const check = jest.fn(() => true);
            expect((0, schedule_stale_guard_1.isStaleRunningSchedule)('finished', 0, check)).toBe(false);
            expect(check).not.toHaveBeenCalled();
        });
    });
});
