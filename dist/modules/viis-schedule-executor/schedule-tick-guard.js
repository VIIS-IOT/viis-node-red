"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCHEDULE_IN_FLIGHT_KEY = void 0;
exports.createSerializedQueue = createSerializedQueue;
exports.runBoundedSideEffect = runBoundedSideEffect;
exports.tryBeginScheduleTransition = tryBeginScheduleTransition;
exports.endScheduleTransition = endScheduleTransition;
exports.isScheduleTransitionInFlight = isScheduleTransitionInFlight;
exports.clearAllScheduleTransitions = clearAllScheduleTransitions;
exports.isStaleRunningSchedule = isStaleRunningSchedule;
exports.SCHEDULE_IN_FLIGHT_KEY = "scheduleTransitionsInFlight";
/** Reject with `message` after `timeoutMs`; `clear` stops the timer once the race is decided. */
function deadline(timeoutMs, message) {
    let timer;
    const promise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return { promise, clear: () => { if (timer)
            clearTimeout(timer); } };
}
/**
 * Serialize Node-RED input ticks so START/FINISH (including the 7s water-hammer)
 * cannot overlap when inject repeats every few seconds.
 */
function createSerializedQueue(options = {}) {
    let tail = Promise.resolve();
    const guarded = (work) => async () => {
        var _a;
        if (!options.jobTimeoutMs)
            return work();
        const job = work();
        job.catch(() => undefined);
        const limit = deadline(options.jobTimeoutMs, `Schedule executor tick exceeded ${options.jobTimeoutMs}ms`);
        try {
            return await Promise.race([job, limit.promise]);
        }
        catch (error) {
            if (error instanceof Error && error.message.startsWith('Schedule executor tick exceeded')) {
                (_a = options.onJobTimeout) === null || _a === void 0 ? void 0 : _a.call(options, options.jobTimeoutMs);
            }
            throw error;
        }
        finally {
            limit.clear();
        }
    };
    return function enqueue(work) {
        const step = guarded(work);
        const run = tail.then(step, step);
        tail = run.then(() => undefined, () => undefined);
        return run;
    };
}
/**
 * Run a reporting side effect (notification, schedule log, telemetry, audit) without letting it
 * stall the tick: it may fail or take at most `timeoutMs`. Device control never waits longer.
 * Resolves `true` when it completed, `false` (after calling `onFailure`) otherwise; never rejects.
 */
async function runBoundedSideEffect(label, work, timeoutMs, onFailure) {
    var _a;
    const limit = deadline(timeoutMs, `timed out after ${timeoutMs}ms`);
    try {
        const job = work();
        job.catch(() => undefined);
        await Promise.race([job, limit.promise]);
        return true;
    }
    catch (error) {
        onFailure(`${label} failed: ${(_a = error === null || error === void 0 ? void 0 : error.message) !== null && _a !== void 0 ? _a : String(error)}`);
        return false;
    }
    finally {
        limit.clear();
    }
}
function readInFlight(store) {
    return Object.assign({}, (store.get(exports.SCHEDULE_IN_FLIGHT_KEY) || {}));
}
function tryBeginScheduleTransition(store, scheduleName, kind) {
    const current = readInFlight(store);
    if (current[scheduleName]) {
        return false;
    }
    current[scheduleName] = kind;
    store.set(exports.SCHEDULE_IN_FLIGHT_KEY, current);
    return true;
}
function endScheduleTransition(store, scheduleName) {
    const current = readInFlight(store);
    delete current[scheduleName];
    store.set(exports.SCHEDULE_IN_FLIGHT_KEY, current);
}
function isScheduleTransitionInFlight(store, scheduleName) {
    const current = store.get(exports.SCHEDULE_IN_FLIGHT_KEY) || {};
    return Boolean(current[scheduleName]);
}
function clearAllScheduleTransitions(store) {
    store.set(exports.SCHEDULE_IN_FLIGHT_KEY, {});
}
/**
 * Power-recovery check: a "running" schedule with no stored active commands is stale
 * only if its START would write Modbus. A config-only start never stores commands,
 * so treating it as stale restarts it on every tick.
 */
function isStaleRunningSchedule(status, activeCommandCount, hasWritableCommands) {
    if (status !== "running" || activeCommandCount > 0) {
        return false;
    }
    return hasWritableCommands();
}
