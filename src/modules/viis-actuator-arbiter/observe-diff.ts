/**
 * observe mode writes nothing through the reconciler, so its value is the log of where the arbiter would
 * have written. Every source submits claims exactly as in enforce while the old direct writers still
 * write, so a healthy gateway shows no diff except where a claim and the coil truly disagree (a lease that
 * ended with the coil still ON, a panel/PLC change). One line per change of the diff set (not per tick),
 * so a steady diff does not flood the gateway log; a diff must also hold for `settleMs` before it counts,
 * because a claim is recorded a moment before its direct write lands (and the other way round at a finish).
 *
 * Line format: `[arbiter] observe diff: <key> desired=<v> actual=<v> owner=<source:ownerId>` per key, joined by
 * `, `. `owner` names the winning claim (`schedule:<name>`, `manual:<commandId>`, `scenario:offline:<intent>`)
 * and is `none` when no claim holds the key (the managed default OFF is what differs).
 */
import type { TickReport } from './reconciler';

export type ObserveReport = Pick<TickReport, 'desired' | 'actual' | 'diffs'> & Partial<Pick<TickReport, 'winners'>>;

export interface ObserveDiffLog {
    /** The line to log for this tick, or null when the diff set did not change. */
    next(report: ObserveReport, nowMs?: number): string | null;
}

export const OBSERVE_SETTLE_MS = 3000;

/** `source:ownerId`, without repeating the source when the owner id already starts with it. */
export function ownerLabel(winner: { source: string; ownerId: string } | null | undefined): string {
    if (!winner) return 'none';
    return winner.ownerId.startsWith(`${winner.source}:`) ? winner.ownerId : `${winner.source}:${winner.ownerId}`;
}

export function createObserveDiffLog(options: { settleMs?: number } = {}): ObserveDiffLog {
    const settleMs = options.settleMs ?? OBSERVE_SETTLE_MS;
    let last = '';
    /** key -> time of the first report that showed the diff, for the diffs still present. */
    const firstSeen = new Map<string, number>();
    return {
        next(report, nowMs = Date.now()) {
            const present = new Set(report.diffs);
            for (const key of Array.from(firstSeen.keys())) {
                if (!present.has(key)) firstSeen.delete(key);
            }
            for (const key of present) {
                if (!firstSeen.has(key)) firstSeen.set(key, nowMs);
            }
            const settled = [...report.diffs].filter(key => nowMs - (firstSeen.get(key) ?? nowMs) >= settleMs).sort();
            const parts = settled.map(
                key => `${key} desired=${String(report.desired[key])} actual=${String(report.actual[key])} owner=${ownerLabel(report.winners?.[key])}`
            );
            const signature = parts.join(', ');
            if (signature === last) return null;
            last = signature;
            return parts.length > 0 ? `[arbiter] observe diff: ${signature}` : '[arbiter] observe diff: none';
        },
    };
}
