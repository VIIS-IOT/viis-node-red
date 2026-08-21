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
test('implied finish pumps skip keys already in the command list', () => {
    const implied = (0, schedule_coil_classify_1.impliedFinishPumpCommands)([{ key: 'main_pump', fc: 5, address: 0 }], { main_pump: 0, input_pump: 1 });
    expect(implied.map(c => c.key)).toEqual(['input_pump']);
});
