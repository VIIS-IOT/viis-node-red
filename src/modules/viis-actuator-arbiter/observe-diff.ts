/**
 * observe mode writes nothing, so its value is the log of where the arbiter would have written. One line
 * per change of the diff set (not per tick), so a steady diff does not flood the gateway log.
 */
import type { TickReport } from './reconciler';

export interface ObserveDiffLog {
    /** The line to log for this tick, or null when the diff set did not change. */
    next(report: Pick<TickReport, 'desired' | 'actual' | 'diffs'>): string | null;
}

export function createObserveDiffLog(): ObserveDiffLog {
    let last = '';
    return {
        next(report) {
            const parts = [...report.diffs].sort().map(key => `${key} desired=${String(report.desired[key])} actual=${String(report.actual[key])}`);
            const signature = parts.join(', ');
            if (signature === last) return null;
            last = signature;
            return parts.length > 0 ? `[arbiter] observe diff: ${signature}` : '[arbiter] observe diff: none';
        },
    };
}
