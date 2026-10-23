"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCHEDULE_OFF_FAILED_KEY = void 0;
exports.offFailures = offFailures;
exports.decideFinish = decideFinish;
exports.offFailedAlarmKey = offFailedAlarmKey;
exports.pendingOffRetry = pendingOffRetry;
exports.noteOffFailure = noteOffFailure;
exports.clearOffFailure = clearOffFailure;
/** OFF writes bypass the protection gate, so `blocked` should not happen; if it does, the coil is not OFF. */
function offFailures(report) {
    return report.steps.flatMap(step => step.keys.filter(k => k.status === 'fail' || k.status === 'blocked'));
}
function decideFinish(reset, commands) {
    var _a, _b;
    const failed = offFailures(reset.report);
    if (reset.allSuccessful && failed.length === 0) {
        return { done: true, retainCommands: [], failedKeys: [] };
    }
    const unitid = (_b = (_a = commands[0]) === null || _a === void 0 ? void 0 : _a.unitid) !== null && _b !== void 0 ? _b : 1;
    const retainCommands = failed.map(outcome => {
        var _a;
        return (_a = commands.find(c => c.key === outcome.key && c.fc === outcome.fc)) !== null && _a !== void 0 ? _a : { key: outcome.key, fc: outcome.fc, address: outcome.address, value: outcome.expected, unitid, quantity: 1 };
    });
    return { done: false, retainCommands, failedKeys: failed.map(outcome => outcome.key) };
}
function offFailedAlarmKey(scheduleId) {
    return `schedule_off_failed:${scheduleId}`;
}
/** Global-context key: schedule name → the run whose OFF failed, with that run's first full reset list. */
exports.SCHEDULE_OFF_FAILED_KEY = 'scheduleOffFailedRuns';
function readMarkers(store) {
    return Object.assign({}, (store.get(exports.SCHEDULE_OFF_FAILED_KEY) || {}));
}
/** The pending OFF retry of this run, or null. A marker left by an earlier run does not count. */
function pendingOffRetry(store, scheduleName, runId) {
    const marker = readMarkers(store)[scheduleName];
    return marker && marker.runId === runId ? marker : null;
}
/** Record a failed OFF; true only on the first failed attempt of this run (notify once). */
function noteOffFailure(store, scheduleName, runId, commands) {
    if (pendingOffRetry(store, scheduleName, runId))
        return false;
    const markers = readMarkers(store);
    markers[scheduleName] = { runId, commands };
    store.set(exports.SCHEDULE_OFF_FAILED_KEY, markers);
    return true;
}
/** Forget the OFF failure once the OFF passed; true when an earlier attempt had failed. */
function clearOffFailure(store, scheduleName) {
    const markers = readMarkers(store);
    if (!(scheduleName in markers))
        return false;
    delete markers[scheduleName];
    store.set(exports.SCHEDULE_OFF_FAILED_KEY, markers);
    return true;
}
