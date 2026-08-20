"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fertigation_start_sequence_1 = require("../fertigation-start-sequence");
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
function writeKeys(ops) {
    return ops.filter((op) => op.kind === 'write').map((op) => op.key);
}
test('customer 2-valve start writes unused set_flow, derived valve_program=3, holdings, valves, hammer, pump, power', () => {
    const ops = (0, fertigation_start_sequence_1.planFertigationStartWrites)({
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
    const ops = (0, fertigation_start_sequence_1.planFertigationStartWrites)({
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
    const ops = (0, fertigation_start_sequence_1.planFertigationStartWrites)({
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
    const ops = (0, fertigation_start_sequence_1.planFertigationStartWrites)({
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
    const ops = (0, fertigation_start_sequence_1.planFertigationStartWrites)({
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
    const ops = (0, fertigation_start_sequence_1.planFertigationStartWrites)({
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
    const ops = (0, fertigation_start_sequence_1.planFertigationStartWrites)({
        commands: CUSTOMER_COMMANDS,
        holdings: CUSTOMER_HOLDINGS,
        coils: CUSTOMER_COILS,
    });
    const keys = writeKeys(ops);
    expect(keys.indexOf('time_valve_0')).toBeLessThan(keys.indexOf('valve_0'));
    expect(keys.indexOf('set_ec')).toBeLessThan(keys.indexOf('valve_0'));
});
test('isFertigationBatch detects numbered valves and ignores holdings-only batches', () => {
    expect((0, fertigation_start_sequence_1.isFertigationBatch)(['set_ec'])).toBe(false);
    expect((0, fertigation_start_sequence_1.isFertigationBatch)(['valve_0'])).toBe(true);
    expect((0, fertigation_start_sequence_1.isFertigationBatch)(['power'])).toBe(true);
    expect((0, fertigation_start_sequence_1.isFertigationBatch)(['main_pump'])).toBe(true);
    expect((0, fertigation_start_sequence_1.isFertigationBatch)(['input_pump'])).toBe(true);
});
test('omits water-hammer delay when no pump or power write follows', () => {
    const ops = (0, fertigation_start_sequence_1.planFertigationStartWrites)({
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
