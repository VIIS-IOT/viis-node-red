import { waitForEnvLoad } from '../env-load-wait';

/** Fake clock: every sleep advances time, so the loop runs without real waiting. */
const fakeClock = (start: number) => {
    let t = start;
    return { now: () => t, sleep: async (ms: number) => { t += ms; } };
};

describe('waitForEnvLoad', () => {
    const started = 1_000_000;

    test('a stamp left by a previous run (older than the tolerance) is not this run', async () => {
        const clock = fakeClock(started);
        const result = await waitForEnvLoad(() => started - 3_600_000, started, { ...clock, timeoutMs: 5000 });
        expect(result).toBe(false);
    });

    test('resolves once env-loader stamps this run', async () => {
        const clock = fakeClock(started);
        let stamp: number | undefined;
        const read = () => { if (clock.now() >= started + 2000) stamp = started + 2000; return stamp; };
        await expect(waitForEnvLoad(read, started, { ...clock })).resolves.toBe(true);
        expect(clock.now()).toBeLessThan(started + 3000);
    });

    test('a load that finished just before the node started counts', async () => {
        const clock = fakeClock(started);
        await expect(waitForEnvLoad(() => started - 1000, started, { ...clock })).resolves.toBe(true);
    });

    test('stops when cancelled', async () => {
        const clock = fakeClock(started);
        await expect(waitForEnvLoad(() => undefined, started, { ...clock, isCancelled: () => true })).resolves.toBe(false);
    });
});
