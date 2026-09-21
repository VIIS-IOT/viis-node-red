import { classifyCoils } from '../schedule-coil-classify';

test('groups power, pump+channel, valve, other', () => {
    const cmds = [
        { key: 'power' },
        { key: 'main_pump' },
        { key: 'power_A1' },
        { key: 'valve_0' },
        { key: 'schedule_sync_coil' },
    ];
    const g = classifyCoils(cmds);
    expect(g.powerCoils.map(c => c.key)).toEqual(['power']);
    expect(g.pumpCoils.map(c => c.key)).toEqual(['main_pump', 'power_A1']);
    expect(g.valveCoils.map(c => c.key)).toEqual(['valve_0']);
    expect(g.otherCoils.map(c => c.key)).toEqual(['schedule_sync_coil']);
});

test('prefixed fertigation keys classify like unprefixed START groups', () => {
    const g = classifyCoils([
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
