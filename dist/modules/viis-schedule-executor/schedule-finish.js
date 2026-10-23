"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCHEDULE_OFF_FAILED_KEY = void 0;
exports.offFailures = offFailures;
exports.decideFinish = decideFinish;
exports.retryNeedsImpliedPumps = retryNeedsImpliedPumps;
exports.rebuildOffCommands = rebuildOffCommands;
exports.offFailedAlarmKey = offFailedAlarmKey;
exports.pendingOffRetry = pendingOffRetry;
exports.noteOffFailure = noteOffFailure;
exports.offReportForAudit = offReportForAudit;
exports.clearOffFailure = clearOffFailure;
const schedule_coil_classify_1 = require("./schedule-coil-classify");
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
    // Kept at the OFF value, not the start value: stuck recovery reads a register that still holds
    // its start value as OFF when the active command carries that value.
    const retainCommands = failed.map(outcome => {
        const cmd = commands.find(c => c.key === outcome.key && c.fc === outcome.fc);
        // An implied pump-off is added by the reset itself, so it is not in the list.
        return cmd
            ? Object.assign(Object.assign({}, cmd), { value: outcome.expected }) : { key: outcome.key, fc: outcome.fc, address: outcome.address, value: outcome.expected, unitid, quantity: 1 };
    });
    return { done: false, retainCommands, failedKeys: failed.map(outcome => outcome.key) };
}
/**
 * A retry writes the implied pump-off of every mapped pump only when a valve is retried, so the
 * pumps are off before it closes. Retrying a register or another coil each tick must not keep
 * stopping pumps that other schedules or the PLC run.
 */
function retryNeedsImpliedPumps(commands) {
    return commands.some(cmd => cmd.fc === 5 && (0, schedule_coil_classify_1.isValveKey)(cmd.key));
}
/**
 * The OFF of a run whose active commands were lost (a restart clears them) is rebuilt from the
 * schedule: every mapped coil OFF, every mapped register 0, in mapping order.
 */
function rebuildOffCommands(mapped) {
    return [
        ...mapped.coilCommands.map(cmd => (Object.assign(Object.assign({}, cmd), { value: false }))),
        ...mapped.holdingCommands.map(cmd => (Object.assign(Object.assign({}, cmd), { value: 0 }))),
    ];
}
function offFailedAlarmKey(scheduleId) {
    return `schedule_off_failed:${scheduleId}`;
}
/** Global-context key: schedule name → the run whose OFF failed, with that run's first full reset list. */
exports.SCHEDULE_OFF_FAILED_KEY = 'scheduleOffFailedRuns';
/** The steps of a failed attempt with only their passed keys; a step with none left is dropped. */
function passedSteps(report) {
    return report.steps
        .map(step => ({ step, keys: step.keys.filter(k => k.status === 'pass') }))
        .filter(({ step, keys }) => keys.length > 0 || (step.keys.length === 0 && step.ok))
        .map(({ step, keys }) => (Object.assign(Object.assign({}, step), { ok: true, keys })));
}
function readMarkers(store) {
    return Object.assign({}, (store.get(exports.SCHEDULE_OFF_FAILED_KEY) || {}));
}
/** The pending OFF retry of this run, or null. A marker left by an earlier run does not count. */
function pendingOffRetry(store, scheduleName, runId) {
    const marker = readMarkers(store)[scheduleName];
    return marker && marker.runId === runId ? marker : null;
}
/** Record a failed OFF attempt; true only on the first failed attempt of this run (notify once). */
function noteOffFailure(store, scheduleName, runId, commands, report) {
    var _a;
    const pending = pendingOffRetry(store, scheduleName, runId);
    const markers = readMarkers(store);
    markers[scheduleName] = pending
        ? Object.assign(Object.assign({}, pending), { passedSteps: [...((_a = pending.passedSteps) !== null && _a !== void 0 ? _a : []), ...passedSteps(report)] }) : { runId, commands, passedSteps: passedSteps(report) };
    store.set(exports.SCHEDULE_OFF_FAILED_KEY, markers);
    return !pending;
}
/** The end audit after retries: the keys that passed earlier, then the attempt that finished the OFF. */
function offReportForAudit(retry, finalReport) {
    var _a;
    if (!retry)
        return finalReport;
    return Object.assign(Object.assign({}, finalReport), { steps: [...((_a = retry.passedSteps) !== null && _a !== void 0 ? _a : []), ...finalReport.steps] });
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
