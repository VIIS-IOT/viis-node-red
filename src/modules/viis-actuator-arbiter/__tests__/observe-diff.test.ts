import { createObserveDiffLog } from '../observe-diff';

const report = (diffs: string[], desired: Record<string, boolean | null>, actual: Record<string, boolean | undefined>) => ({ diffs, desired, actual });

describe('observe diff log', () => {
    test('logs a new diff once, then stays quiet while it is unchanged', () => {
        const log = createObserveDiffLog();
        const r = report(['valve_1'], { valve_1: false }, { valve_1: true });
        expect(log.next(r)).toBe('[arbiter] observe diff: valve_1 desired=false actual=true');
        expect(log.next(r)).toBeNull();
    });

    test('logs when the diff goes away', () => {
        const log = createObserveDiffLog();
        log.next(report(['valve_1'], { valve_1: false }, { valve_1: true }));
        expect(log.next(report([], { valve_1: false }, { valve_1: false }))).toBe('[arbiter] observe diff: none');
    });

    test('a start with no diff logs nothing', () => {
        expect(createObserveDiffLog().next(report([], {}, {}))).toBeNull();
    });
});
