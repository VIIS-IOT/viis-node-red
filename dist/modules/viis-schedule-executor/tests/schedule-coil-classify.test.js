"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const schedule_coil_classify_1 = require("../schedule-coil-classify");
test('groups power, pump+channel, valve, other', () => {
    const cmds = [
        { key: 'power' },
        { key: 'main_pump' },
        { key: 'power_A1' },
        { key: 'valve_0' },
        { key: 'schedule_sync_coil' },
    ];
    const g = (0, schedule_coil_classify_1.classifyCoils)(cmds);
    expect(g.powerCoils.map(c => c.key)).toEqual(['power']);
    expect(g.pumpCoils.map(c => c.key)).toEqual(['main_pump', 'power_A1']);
    expect(g.valveCoils.map(c => c.key)).toEqual(['valve_0']);
    expect(g.otherCoils.map(c => c.key)).toEqual(['schedule_sync_coil']);
});
test('implied finish pumps add mapped main_pump when schedule only has power', () => {
    const implied = (0, schedule_coil_classify_1.impliedFinishPumpCommands)([{ key: 'power', fc: 5, address: 30 }], { main_pump: 0, power: 30, valve_0: 10 });
    expect(implied).toEqual([
        { key: 'main_pump', value: false, fc: 5, unitid: 1, address: 0, quantity: 1 },
    ]);
});
test('prefixed fertigation keys classify like unprefixed START groups', () => {
    const g = (0, schedule_coil_classify_1.classifyCoils)([
        { key: 'fertigation_control_power' },
        { key: 'fertigation_control_power_1' },
        { key: 'fertigation_control_main_pump' },
        { key: 'fertigation_control_valve_0' },
        { key: 'fertigation_protect_en_alarm' },
    ]);
    expect(g.powerCoils.map(c => c.key)).toEqual(['fertigation_control_power']);
    expect(g.pumpCoils.map(c => c.key)).toEqual(['fertigation_control_power_1', 'fertigation_control_main_pump']);
    expect(g.valveCoils.map(c => c.key)).toEqual(['fertigation_control_valve_0']);
    expect(g.otherCoils.map(c => c.key)).toEqual(['fertigation_protect_en_alarm']);
});
test('implied finish pumps skip keys already in the command list', () => {
    const implied = (0, schedule_coil_classify_1.impliedFinishPumpCommands)([{ key: 'power', fc: 5, address: 30 }, { key: 'main_pump', fc: 5, address: 0 }], { main_pump: 0, input_pump: 1, power: 30 });
    expect(implied.map(c => c.key)).toEqual(['input_pump']);
});
// Fertigation-VIIS-RS485-007 (anh Khiếu, 172.30.108.233): every irrigation end also switched off the running
// sub pump and wrote the pump status/error coils, because every coil named "pump" was stopped.
describe('implied finish pumps on the RS485-007 coil map', () => {
    const coilMap = {
        fertigation_monitor_irri_pump_status: 16,
        fertigation_monitor_mix_pump_status: 17,
        fertigation_monitor_error_pump_2: 18,
        fertigation_monitor_error_pump_1: 19,
        fertigation_control_power: 30,
        fertigation_control_main_pump: 31,
        fertigation_control_water_pump: 32,
        fertigation_control_sub_pump: 33,
        fertigation_control_power_1: 34,
        fertigation_control_valve_5: 45,
    };
    test('an irrigation end stops only what it ran: no sub/water pump, no status coils', () => {
        const irrigation = [
            { key: 'fertigation_control_power', fc: 5, address: 30 },
            { key: 'fertigation_control_main_pump', fc: 5, address: 31 },
            { key: 'fertigation_control_valve_5', fc: 5, address: 45 },
        ];
        expect((0, schedule_coil_classify_1.impliedFinishPumpCommands)(irrigation, coilMap)).toEqual([]);
    });
    test('a power-only end still stops the main pump the board may have started', () => {
        const implied = (0, schedule_coil_classify_1.impliedFinishPumpCommands)([{ key: 'fertigation_control_power', fc: 5, address: 30 }], coilMap);
        expect(implied.map(c => c.key)).toEqual(['fertigation_control_main_pump']);
    });
    test('a sub pump schedule end leaves the main pump of a running irrigation alone', () => {
        const implied = (0, schedule_coil_classify_1.impliedFinishPumpCommands)([{ key: 'fertigation_control_sub_pump', fc: 5, address: 33 }], coilMap);
        expect(implied).toEqual([]);
    });
});
