"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OBSERVE_SETTLE_MS = void 0;
exports.ownerLabel = ownerLabel;
exports.createObserveDiffLog = createObserveDiffLog;
exports.OBSERVE_SETTLE_MS = 3000;
/** `source:ownerId`, without repeating the source when the owner id already starts with it. */
function ownerLabel(winner) {
    if (!winner)
        return 'none';
    return winner.ownerId.startsWith(`${winner.source}:`) ? winner.ownerId : `${winner.source}:${winner.ownerId}`;
}
function createObserveDiffLog(options = {}) {
    var _a;
    const settleMs = (_a = options.settleMs) !== null && _a !== void 0 ? _a : exports.OBSERVE_SETTLE_MS;
    let last = '';
    /** key -> time of the first report that showed the diff, for the diffs still present. */
    const firstSeen = new Map();
    return {
        next(report, nowMs = Date.now()) {
            const present = new Set(report.diffs);
            for (const key of Array.from(firstSeen.keys())) {
                if (!present.has(key))
                    firstSeen.delete(key);
            }
            for (const key of present) {
                if (!firstSeen.has(key))
                    firstSeen.set(key, nowMs);
            }
            const settled = [...report.diffs].filter(key => { var _a; return nowMs - ((_a = firstSeen.get(key)) !== null && _a !== void 0 ? _a : nowMs) >= settleMs; }).sort();
            const parts = settled.map(key => { var _a; return `${key} desired=${String(report.desired[key])} actual=${String(report.actual[key])} owner=${ownerLabel((_a = report.winners) === null || _a === void 0 ? void 0 : _a[key])}`; });
            const signature = parts.join(', ');
            if (signature === last)
                return null;
            last = signature;
            return parts.length > 0 ? `[arbiter] observe diff: ${signature}` : '[arbiter] observe diff: none';
        },
    };
}
