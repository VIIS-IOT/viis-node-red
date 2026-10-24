import { ActuatorClaim, ArbiterCore, ClaimSource, SOURCE_PRIORITY } from '../arbiter-core';
import { coilKeysFromMappings, loadActuatorPolicy } from '../actuator-policy';

const mappings = { board1: { coils: { valve_1: 0, valve_2: 1, valve_3: 2, main_pump: 3 } } };
const policy = loadActuatorPolicy(
    { valve_1: 'managed', valve_2: 'managed', valve_3: 'hold' },
    { manualLeaseS: 1800, coilKeys: coilKeysFromMappings(mappings), warn: () => undefined },
);

const NOW = 1_800_000_000_000;

function claim(over: Partial<ActuatorClaim> & { source: ClaimSource }): ActuatorClaim {
    return {
        key: 'valve_1',
        value: true,
        ownerId: `${over.source}:1`,
        expiresAt: NOW + 60_000,
        createdAt: NOW,
        ...over,
    };
}

describe('ArbiterCore', () => {
    test('priorities follow the plan order', () => {
        const order = (Object.keys(SOURCE_PRIORITY) as ClaimSource[]).sort((a, b) => SOURCE_PRIORITY[b] - SOURCE_PRIORITY[a]);
        expect(order).toEqual(['safety', 'alarm_action', 'manual', 'scenario', 'schedule', 'automation']);
    });

    test('higher priority wins regardless of order', () => {
        const manual = claim({ source: 'manual', value: false, createdAt: NOW - 5_000 });
        const schedule = claim({ source: 'schedule', value: true, createdAt: NOW });

        for (const sequence of [[manual, schedule], [schedule, manual]]) {
            const core = new ArbiterCore(policy);
            sequence.forEach(c => core.claim(c));
            const resolution = core.resolve('valve_1', NOW);
            expect(resolution.desired).toBe(false);
            expect(resolution.winner?.ownerId).toBe('manual:1');
        }
    });

    test('same priority: newest wins', () => {
        const core = new ArbiterCore(policy);
        // Two RPC paths (TB broker + local EMQX) claim within one second with opposite values.
        core.claim(claim({ source: 'manual', ownerId: 'manual:tb-1', value: true, createdAt: NOW + 400 }));
        core.claim(claim({ source: 'manual', ownerId: 'manual:emqx-1', value: false, createdAt: NOW }));

        expect(core.resolve('valve_1', NOW + 500)).toMatchObject({ desired: true, winner: { ownerId: 'manual:tb-1' } });

        core.claim(claim({ source: 'manual', ownerId: 'manual:emqx-2', value: false, createdAt: NOW + 900 }));
        expect(core.resolve('valve_1', NOW + 1_000)).toMatchObject({ desired: false, winner: { ownerId: 'manual:emqx-2' } });
    });

    test('a claim replaces the same owner and key', () => {
        const core = new ArbiterCore(policy);
        core.claim(claim({ source: 'schedule', ownerId: 'schedule:s1', value: true }));
        core.claim(claim({ source: 'schedule', ownerId: 'schedule:s1', value: false, createdAt: NOW + 1 }));

        expect(core.snapshot()).toHaveLength(1);
        expect(core.resolve('valve_1', NOW).desired).toBe(false);
    });

    test('release is not OFF: next owner takes over', () => {
        const core = new ArbiterCore(policy);
        core.claim(claim({ source: 'manual', ownerId: 'manual:c1', value: false }));
        core.claim(claim({ source: 'manual', ownerId: 'manual:c2', key: 'valve_2', value: false }));
        core.claim(claim({ source: 'schedule', ownerId: 'schedule:s1', value: true }));

        expect(core.release('manual:c1', 'valve_1')).toEqual(['valve_1']);
        expect(core.resolve('valve_1', NOW)).toMatchObject({ desired: true, winner: { ownerId: 'schedule:s1' } });

        core.claim(claim({ source: 'manual', ownerId: 'manual:c3', value: false }));
        expect(core.release('manual:*').sort()).toEqual(['valve_1', 'valve_2']);
        expect(core.resolve('valve_1', NOW).winner?.ownerId).toBe('schedule:s1');
        expect(core.release('nobody')).toEqual([]);
    });

    test('managed with no claim → false', () => {
        const core = new ArbiterCore(policy);
        expect(core.resolve('valve_2', NOW)).toEqual({ key: 'valve_2', desired: false, winner: null });
    });

    test('hold with no claim → null', () => {
        const core = new ArbiterCore(policy);
        expect(core.resolve('valve_3', NOW)).toEqual({ key: 'valve_3', desired: null, winner: null });

        core.claim(claim({ source: 'manual', key: 'valve_3', value: true }));
        expect(core.resolve('valve_3', NOW).desired).toBe(true);
    });

    test('unmanaged keys are never arbitrated', () => {
        const core = new ArbiterCore(policy);
        expect(() => core.claim(claim({ source: 'manual', key: 'main_pump' }))).toThrow(/not arbitrated/);
        expect(core.resolve('main_pump', NOW)).toEqual({ key: 'main_pump', desired: null, winner: null });
        expect(core.resolveAll(NOW).map(r => r.key)).toEqual(['valve_1', 'valve_2', 'valve_3']);
    });

    test('expired claims ignored and returned by expire()', () => {
        const core = new ArbiterCore(policy);
        const manual = claim({ source: 'manual', value: true, expiresAt: NOW + 1_000 });
        core.claim(manual);

        expect(core.resolve('valve_1', NOW + 999).desired).toBe(true);
        expect(core.resolve('valve_1', NOW + 1_000)).toEqual({ key: 'valve_1', desired: false, winner: null });
        expect(core.snapshot()).toHaveLength(1);

        expect(core.expire(NOW + 1_000)).toEqual([manual]);
        expect(core.snapshot()).toEqual([]);
        expect(core.expire(NOW + 2_000)).toEqual([]);
    });

    test('safety with expiresAt null never expires', () => {
        const core = new ArbiterCore(policy);
        core.claim(claim({ source: 'safety', ownerId: 'safety:estop', value: false, expiresAt: null }));
        core.claim(claim({ source: 'alarm_action', value: true }));

        const later = NOW + 365 * 24 * 3600 * 1000;
        expect(core.expire(later)).toHaveLength(1);
        expect(core.resolve('valve_1', later)).toMatchObject({ desired: false, winner: { ownerId: 'safety:estop' } });
    });

    test('load drops claims created more than 60 s in the future', () => {
        const core = new ArbiterCore(policy);
        core.claim(claim({ source: 'manual', ownerId: 'manual:stale-memory' }));

        core.load(
            [
                claim({ source: 'manual', ownerId: 'manual:ok', createdAt: NOW + 60_000 }),
                claim({ source: 'scenario', ownerId: 'scenario:future', createdAt: NOW + 60_001, expiresAt: null }),
                claim({ source: 'schedule', ownerId: 'schedule:expired', expiresAt: NOW }),
                claim({ source: 'manual', ownerId: 'manual:unmanaged', key: 'main_pump' }),
            ],
            NOW,
        );

        expect(core.snapshot().map(c => c.ownerId)).toEqual(['manual:ok']);
    });

    test('snapshot returns copies', () => {
        const core = new ArbiterCore(policy);
        core.claim(claim({ source: 'manual' }));
        core.snapshot()[0].value = false;
        expect(core.resolve('valve_1', NOW).desired).toBe(true);
    });
});
