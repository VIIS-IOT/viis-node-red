import { coilKeysFromMappings, loadActuatorPolicy } from '../actuator-policy';

const mappings = {
    board1: {
        coils: { valve_1: 0, valve_2: 1, main_pump: 2 },
        holdingRegisters: { time_valve_1: 10 },
    },
};

const opts = (warn = jest.fn()) => ({ manualLeaseS: 1800, coilKeys: coilKeysFromMappings(mappings), warn });

describe('loadActuatorPolicy', () => {
    test('missing key is unmanaged', () => {
        const policy = loadActuatorPolicy({ valve_1: 'managed' }, opts());

        expect(policy.mode('valve_2')).toBe('unmanaged');
        expect(policy.mode('main_pump')).toBe('unmanaged');
        expect(loadActuatorPolicy(undefined, opts()).managedKeys()).toEqual([]);
    });

    test('string and object forms, from an object or the ACTUATOR_POLICY JSON string', () => {
        const raw = { valve_1: 'managed', valve_2: { mode: 'hold', manualLeaseS: 60 } };

        for (const input of [raw, JSON.stringify(raw)]) {
            const policy = loadActuatorPolicy(input, opts());
            expect(policy.mode('valve_1')).toBe('managed');
            expect(policy.mode('valve_2')).toBe('hold');
            expect(policy.managedKeys()).toEqual(['valve_1', 'valve_2']);
            expect(policy.manualLeaseS('valve_2')).toBe(60);
        }
    });

    test('manualLeaseS falls back to default', () => {
        const policy = loadActuatorPolicy(
            { valve_1: 'managed', valve_2: { mode: 'managed', manualLeaseS: -5 } },
            opts(),
        );

        expect(policy.manualLeaseS('valve_1')).toBe(1800);
        expect(policy.manualLeaseS('valve_2')).toBe(1800);
        expect(policy.manualLeaseS('main_pump')).toBe(1800);
    });

    test('non-coil key ignored', () => {
        const warn = jest.fn();
        const policy = loadActuatorPolicy(
            { time_valve_1: 'managed', ghost: 'hold', valve_1: 'bogus', valve_2: 'managed' },
            opts(warn),
        );

        expect(policy.mode('time_valve_1')).toBe('unmanaged');
        expect(policy.mode('ghost')).toBe('unmanaged');
        expect(policy.mode('valve_1')).toBe('unmanaged');
        expect(policy.managedKeys()).toEqual(['valve_2']);
        expect(warn).toHaveBeenCalledTimes(3);
    });

    test('invalid JSON string gives an empty policy with a warning', () => {
        const warn = jest.fn();
        const policy = loadActuatorPolicy('{not json', opts(warn));

        expect(policy.managedKeys()).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(1);
    });
});
