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
