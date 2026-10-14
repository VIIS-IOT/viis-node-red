"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCHEDULE_ACTIVE_RUN_IDS_KEY = void 0;
exports.rememberRunId = rememberRunId;
exports.activeRunId = activeRunId;
exports.forgetRunId = forgetRunId;
exports.scheduleEventParams = scheduleEventParams;
/** Global-context key: schedule name → runId of its active run. */
exports.SCHEDULE_ACTIVE_RUN_IDS_KEY = 'scheduleActiveRunIds';
function readRunIds(store) {
    return Object.assign({}, (store.get(exports.SCHEDULE_ACTIVE_RUN_IDS_KEY) || {}));
}
function rememberRunId(store, scheduleName, runId) {
    const runIds = readRunIds(store);
    runIds[scheduleName] = runId;
    store.set(exports.SCHEDULE_ACTIVE_RUN_IDS_KEY, runIds);
}
function activeRunId(store, scheduleName) {
    var _a;
    return (_a = readRunIds(store)[scheduleName]) !== null && _a !== void 0 ? _a : null;
}
function forgetRunId(store, scheduleName) {
    const runIds = readRunIds(store);
    if (!(scheduleName in runIds))
        return;
    delete runIds[scheduleName];
    store.set(exports.SCHEDULE_ACTIVE_RUN_IDS_KEY, runIds);
}
/** `scheduleId` is the backend schedule UUID, which the gateway stores as `name`. */
function scheduleEventParams(schedule, runId) {
    return {
        scheduleName: schedule.label || schedule.name,
        scheduleId: schedule.name,
        planId: schedule.schedule_plan_id || null,
        runId: runId !== null && runId !== void 0 ? runId : null,
    };
}
