"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitForEnvLoad = waitForEnvLoad;
/** Resolves true when this run's load stamp is seen, false on timeout or cancel. */
async function waitForEnvLoad(readStamp, startedAt, options = {}) {
    const { toleranceMs = 30000, timeoutMs = 60000, pollMs = 500, isCancelled = () => false, sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)), now = () => Date.now(), } = options;
    while (!isCancelled()) {
        const stamp = Number(readStamp());
        if (Number.isFinite(stamp) && stamp >= startedAt - toleranceMs)
            return true;
        if (now() - startedAt >= timeoutMs)
            return false;
        await sleep(pollMs);
    }
    return false;
}
