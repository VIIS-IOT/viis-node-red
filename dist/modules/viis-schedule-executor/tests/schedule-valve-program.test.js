"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const schedule_valve_program_1 = require("../schedule-valve-program");
const viis_schedule_executor_service_1 = require("../viis-schedule-executor-service");
test('customer beef-lot action → mask 3', () => {
    expect((0, schedule_valve_program_1.buildValveProgramBitmask)({
        valve_0: 'true', valve_1: 'true', valve_2: 'false',
    })).toBe(3);
});
test('test-device action → mask 7', () => {
    expect((0, schedule_valve_program_1.buildValveProgramBitmask)({
        valve_0: 'true', valve_1: 'true', valve_2: 'true',
    })).toBe(7);
});
test('ignores explicit action.valve_program and uses valve_* only', () => {
    expect((0, schedule_valve_program_1.buildValveProgramBitmask)({
        valve_0: true, valve_program: 99,
    })).toBe(1);
});
test('valve_program mapped to 20 and no other key at 20 → write addr 20', () => {
    var _a;
    const map = { valve_program: 20, set_ec: 17 };
    expect((0, schedule_valve_program_1.resolveValveProgramAddress)(map)).toBe(20);
    expect((_a = (0, schedule_valve_program_1.buildValveProgramCommand)({ valve_0: true, valve_1: true }, map)) === null || _a === void 0 ? void 0 : _a.address).toBe(20);
});
test('no valve_program key and nothing at 20 → default addr 20', () => {
    expect((0, schedule_valve_program_1.resolveValveProgramAddress)({ set_ec: 17 })).toBe(20);
    expect((0, schedule_valve_program_1.buildValveProgramCommand)({ valve_0: true }, { set_ec: 17 })).toEqual({
        key: 'valve_program', value: 1, fc: 6, unitid: 1, address: 20, quantity: 1,
    });
});
test('another holding already at 20 → skip even if valve_program is mapped', () => {
    const map = { valve_program: 20, schedule_data_0: 20 };
    expect((0, schedule_valve_program_1.resolveValveProgramAddress)(map)).toBeNull();
    expect((0, schedule_valve_program_1.buildValveProgramCommand)({ valve_0: true }, map)).toBeNull();
});
test('board1-style map: other key at 20, no valve_program → skip', () => {
    const board1 = { set_ec: 17, TIME_DELAY: 20 };
    expect((0, schedule_valve_program_1.resolveValveProgramAddress)(board1)).toBeNull();
});
test('off command is value 0 only when the gate allows', () => {
    var _a;
    expect((_a = (0, schedule_valve_program_1.buildValveProgramOffCommand)({ valve_program: 20 })) === null || _a === void 0 ? void 0 : _a.value).toBe(0);
    expect((0, schedule_valve_program_1.buildValveProgramOffCommand)({ foo: 20 })).toBeNull();
});
describe('mapScheduleToModbus valve_program', () => {
    function serviceWithHoldings(holdings) {
        const mockNode = {
            warn: jest.fn(),
            context: () => ({ global: { get: jest.fn(() => ({})), set: jest.fn() } }),
        };
        const service = new viis_schedule_executor_service_1.ScheduleService(mockNode);
        Object.defineProperty(service, 'globalHelper', {
            value: {
                getJsonEnvVar: jest.fn((key, fallback) => {
                    if (key === 'MODBUS_BOARD1_HOLDING_REGISTERS')
                        return holdings;
                    if (key === 'MODBUS_HOLDING_REGISTERS')
                        return holdings;
                    if (key === 'MODBUS_COILS' || key === 'MODBUS_BOARD1_COILS') {
                        return { valve_0: 9, valve_1: 10, power: 30 };
                    }
                    return fallback;
                }),
                getEnvVar: jest.fn(() => null),
            },
            configurable: true,
        });
        return service;
    }
    test('valve_0/1 true and valve_program at 20 → first holding is mask 3', () => {
        const service = serviceWithHoldings({ valve_program: 20, set_ec: 17 });
        const result = service.mapScheduleToModbus({
            name: 'map-vp',
            action: JSON.stringify({ valve_0: true, valve_1: true, set_ec: 2.5 }),
            start_time: '08:00:00',
            end_time: '09:00:00',
        });
        expect(result.holdingCommands[0]).toEqual({
            key: 'valve_program', value: 3, fc: 6, unitid: 1, address: 20, quantity: 1,
        });
    });
    test('TIME_DELAY at 20 → no valve_program command', () => {
        const service = serviceWithHoldings({ TIME_DELAY: 20, set_ec: 17 });
        const result = service.mapScheduleToModbus({
            name: 'map-skip',
            action: JSON.stringify({ valve_0: true, set_ec: 2.5 }),
            start_time: '08:00:00',
            end_time: '09:00:00',
        });
        expect(result.holdingCommands.find((c) => c.key === 'valve_program')).toBeUndefined();
    });
});
