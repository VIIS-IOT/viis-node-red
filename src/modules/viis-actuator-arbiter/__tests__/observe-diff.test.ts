import { createObserveDiffLog, ownerLabel } from '../observe-diff';

const report = (
    diffs: string[],
    desired: Record<string, boolean | null>,
    actual: Record<string, boolean | undefined>,
    winners: Record<string, { source: string; ownerId: string } | null> = {},
) => ({ diffs, desired, actual, winners });

describe('observe diff log', () => {
    test('names the winning claim; a diff counts once it held for the settle time, then stays quiet', () => {
        const log = createObserveDiffLog({ settleMs: 3000 });
        const r = report(['valve_1'], { valve_1: false }, { valve_1: true }, { valve_1: { source: 'schedule', ownerId: 'schedule:s1' } });
        // The first sighting may be a write that has not landed yet (claim recorded before the direct write).
        expect(log.next(r, 1000)).toBeNull();
        expect(log.next(r, 6000)).toBe('[arbiter] observe diff: valve_1 desired=false actual=true owner=schedule:s1');
        expect(log.next(r, 11000)).toBeNull();
    });

    test('a diff that is gone before it settled is never logged', () => {
        const log = createObserveDiffLog({ settleMs: 3000 });
        expect(log.next(report(['valve_1'], { valve_1: true }, { valve_1: false }), 0)).toBeNull();
        expect(log.next(report([], { valve_1: true }, { valve_1: true }), 5000)).toBeNull();
    });

    test('logs when the diff goes away', () => {
        const log = createObserveDiffLog({ settleMs: 0 });
        log.next(report(['valve_1'], { valve_1: false }, { valve_1: true }), 0);
        expect(log.next(report([], { valve_1: false }, { valve_1: false }), 5000)).toBe('[arbiter] observe diff: none');
    });

    test('a start with no diff logs nothing', () => {
        expect(createObserveDiffLog().next(report([], {}, {}), 0)).toBeNull();
    });

    test('no winner prints owner=none', () => {
        const log = createObserveDiffLog({ settleMs: 0 });
        expect(log.next(report(['light_1'], { light_1: false }, { light_1: true }, { light_1: null }), 0))
            .toBe('[arbiter] observe diff: light_1 desired=false actual=true owner=none');
    });

    test('ownerLabel does not repeat a source the owner id already carries', () => {
        expect(ownerLabel({ source: 'manual', ownerId: 'manual:cmd-1' })).toBe('manual:cmd-1');
        expect(ownerLabel({ source: 'scenario', ownerId: 'offline:intent-7' })).toBe('scenario:offline:intent-7');
        expect(ownerLabel(null)).toBe('none');
    });
});
