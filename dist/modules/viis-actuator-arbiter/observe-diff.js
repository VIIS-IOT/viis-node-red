"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createObserveDiffLog = createObserveDiffLog;
function createObserveDiffLog() {
    let last = '';
    return {
        next(report) {
            const parts = [...report.diffs].sort().map(key => `${key} desired=${String(report.desired[key])} actual=${String(report.actual[key])}`);
            const signature = parts.join(', ');
            if (signature === last)
                return null;
            last = signature;
            return parts.length > 0 ? `[arbiter] observe diff: ${signature}` : '[arbiter] observe diff: none';
        },
    };
}
