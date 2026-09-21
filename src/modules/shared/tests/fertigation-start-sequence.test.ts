import {
    isFertigationBatch,
    planFertigationStartWrites,
    resolveWaterHammerDelayMs,
} from '../fertigation-start-sequence';

const CUSTOMER_HOLDINGS = {
    time_valve_0: 10,
    set_ec: 11,
    set_flow: 12,
    valve_program: 20,
};

const CUSTOMER_COILS = {
    valve_0: 0,
    valve_1: 1,
    main_pump: 8,
    power: 9,
};

const CUSTOMER_COMMANDS = [
    { key: 'valve_0', value: true },
    { key: 'valve_1', value: true },
    { key: 'main_pump', value: true },
    { key: 'power', value: true },
    { key: 'set_ec', value: 1.2 },
    { key: 'time_valve_0', value: 30 },
    { key: 'iri_time', value: 600 },
];

function writeKeys(ops: ReturnType<typeof planFertigationStartWrites>): string[] {
    return ops.filter((op) => op.kind === 'write').map((op) => op.key);
}

test('customer 2-valve start writes unused set_flow, derived valve_program=3, holdings, valves, hammer, pump, power', () => {
    const ops = planFertigationStartWrites({
        commands: CUSTOMER_COMMANDS,
        holdings: CUSTOMER_HOLDINGS,
        coils: CUSTOMER_COILS,
    });

    expect(ops).toEqual([
        { kind: 'write', key: 'set_flow', value: 0 },
        { kind: 'write', key: 'valve_program', value: 3 },
        { kind: 'write', key: 'set_ec', value: 1.2 },
        { kind: 'write', key: 'time_valve_0', value: 30 },
        { kind: 'write', key: 'valve_0', value: true },
        { kind: 'write', key: 'valve_1', value: true },
        { kind: 'delay', ms: 7000 },
        { kind: 'write', key: 'main_pump', value: true },
        { kind: 'write', key: 'power', value: true },
    ]);
    expect(writeKeys(ops)).not.toContain('iri_time');
});

test('three valves derive valve_program=7', () => {
    const ops = planFertigationStartWrites({
        commands: [
            { key: 'valve_0', value: true },
            { key: 'valve_1', value: true },
            { key: 'valve_2', value: true },
            { key: 'power', value: true },
        ],
        holdings: { valve_program: 20 },
        coils: { valve_0: 0, valve_1: 1, valve_2: 2, power: 9 },
    });

    expect(ops.find((op) => op.kind === 'write' && op.key === 'valve_program')).toEqual({
        kind: 'write',
        key: 'valve_program',
        value: 7,
    });
});

test('skips valve_program when address 20 is occupied by another holding', () => {
    const ops = planFertigationStartWrites({
        commands: [
            { key: 'valve_0', value: true },
            { key: 'power', value: true },
        ],
        holdings: { valve_program: 20, schedule_data_0: 20 },
        coils: { valve_0: 0, power: 9 },
    });

    expect(writeKeys(ops)).not.toContain('valve_program');
});

test('emits valve_program when unmapped and address 20 is free', () => {
    const ops = planFertigationStartWrites({
        commands: [
            { key: 'valve_0', value: true },
            { key: 'power', value: true },
        ],
        holdings: { set_ec: 17 },
        coils: { valve_0: 0, power: 9 },
    });

    expect(ops.find((op) => op.kind === 'write' && op.key === 'valve_program')).toEqual({
        kind: 'write',
        key: 'valve_program',
        value: 1,
    });
});

test('skips falsy valve coils at start', () => {
    const ops = planFertigationStartWrites({
        commands: [
            { key: 'valve_0', value: true },
            { key: 'valve_2', value: false },
            { key: 'power', value: true },
        ],
        holdings: { valve_program: 20 },
        coils: { valve_0: 0, valve_2: 2, power: 9 },
    });

    expect(writeKeys(ops)).not.toContain('valve_2');
});

test('ignores client valve_program and writes derived bitmask', () => {
    const ops = planFertigationStartWrites({
        commands: [
            { key: 'valve_0', value: true },
            { key: 'valve_1', value: true },
            { key: 'valve_program', value: 99 },
            { key: 'power', value: true },
        ],
        holdings: CUSTOMER_HOLDINGS,
        coils: CUSTOMER_COILS,
    });

    const programWrites = ops.filter((op) => op.kind === 'write' && op.key === 'valve_program');
    expect(programWrites).toEqual([{ kind: 'write', key: 'valve_program', value: 3 }]);
});

test('time_valve_0 is written as a holding before valve coils', () => {
    const ops = planFertigationStartWrites({
        commands: CUSTOMER_COMMANDS,
        holdings: CUSTOMER_HOLDINGS,
        coils: CUSTOMER_COILS,
    });
    const keys = writeKeys(ops);

    expect(keys.indexOf('time_valve_0')).toBeLessThan(keys.indexOf('valve_0'));
    expect(keys.indexOf('set_ec')).toBeLessThan(keys.indexOf('valve_0'));
});

test('isFertigationBatch detects numbered valves and ignores holdings-only batches', () => {
    expect(isFertigationBatch(['set_ec'])).toBe(false);
    expect(isFertigationBatch(['valve_0'])).toBe(true);
    expect(isFertigationBatch(['power'])).toBe(true);
    expect(isFertigationBatch(['main_pump'])).toBe(true);
    expect(isFertigationBatch(['input_pump'])).toBe(true);
    expect(isFertigationBatch(['fertigation_control_valve_0'])).toBe(true);
    expect(isFertigationBatch(['fertigation_control_power'])).toBe(true);
    expect(isFertigationBatch(['fertigation_control_main_pump'])).toBe(true);
    expect(isFertigationBatch(['fertigation_control_set_ec'])).toBe(false);
    expect(isFertigationBatch(['fertigation_control_power_1'])).toBe(false);
});

test('omits water-hammer delay when no pump or power write follows', () => {
    const ops = planFertigationStartWrites({
        commands: [
            { key: 'valve_0', value: true },
            { key: 'set_ec', value: 1 },
        ],
        holdings: { set_ec: 11, valve_program: 20 },
        coils: { valve_0: 0 },
    });

    expect(ops.some((op) => op.kind === 'delay')).toBe(false);
    expect(writeKeys(ops)).toEqual(['valve_program', 'set_ec', 'valve_0']);
});

test('prefixed fertigation keys sort like schedule START and write mapped valve_program_index', () => {
    const ops = planFertigationStartWrites({
        commands: [
            { key: 'fertigation_control_power', value: true },
            { key: 'fertigation_control_main_pump', value: true },
            { key: 'fertigation_control_power_1', value: true },
            { key: 'fertigation_control_valve_0', value: true },
            { key: 'fertigation_control_valve_1', value: true },
            { key: 'fertigation_control_set_ec', value: 1.2 },
            { key: 'fertigation_control_time_valve_1', value: 30 },
            { key: 'fertigation_control_valve_program_index', value: 99 },
        ],
        holdings: {
            fertigation_control_time_valve_1: 4,
            fertigation_control_time_valve_2: 5,
            fertigation_control_set_ec: 16,
            fertigation_control_set_flow: 999,
            fertigation_control_set_flow_1: 9,
            fertigation_control_valve_program_index: 19,
            fertigation_control_water_only_time: 20,
        },
        coils: {
            fertigation_control_valve_0: 39,
            fertigation_control_valve_1: 40,
            fertigation_control_main_pump: 31,
            fertigation_control_power_1: 34,
            fertigation_control_power: 30,
        },
    }, { waterHammerDelayMs: 20000 });

    expect(ops).toEqual([
        { kind: 'write', key: 'fertigation_control_time_valve_2', value: 0 },
        { kind: 'write', key: 'fertigation_control_set_flow', value: 0 },
        { kind: 'write', key: 'fertigation_control_set_flow_1', value: 0 },
        { kind: 'write', key: 'fertigation_control_valve_program_index', value: 3 },
        { kind: 'write', key: 'fertigation_control_set_ec', value: 1.2 },
        { kind: 'write', key: 'fertigation_control_time_valve_1', value: 30 },
        { kind: 'write', key: 'fertigation_control_valve_0', value: true },
        { kind: 'write', key: 'fertigation_control_valve_1', value: true },
        { kind: 'delay', ms: 20000 },
        { kind: 'write', key: 'fertigation_control_main_pump', value: true },
        { kind: 'write', key: 'fertigation_control_power_1', value: true },
        { kind: 'write', key: 'fertigation_control_power', value: true },
    ]);
});

test('resolveWaterHammerDelayMs treats empty as 7s', () => {
    expect(resolveWaterHammerDelayMs(undefined)).toBe(7000);
    expect(resolveWaterHammerDelayMs('')).toBe(7000);
    expect(resolveWaterHammerDelayMs(7)).toBe(7000);
    expect(resolveWaterHammerDelayMs(20)).toBe(20000);
});
