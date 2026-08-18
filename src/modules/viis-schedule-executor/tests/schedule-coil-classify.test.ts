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
