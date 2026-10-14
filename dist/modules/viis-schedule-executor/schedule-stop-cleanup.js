"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopRunsNoLongerEnabled = stopRunsNoLongerEnabled;
const schedule_run_identity_1 = require("./schedule-run-identity");
/**
 * A schedule that left the enabled list (plan turned off, schedule turned off by sync, deleted)
 * while it still held outputs: turn them off, finish the run and report it as stopped — once,
 * because a successful reset clears its commands. A failed reset keeps the commands and reports
 * nothing; the next tick retries.
 */
async function stopRunsNoLongerEnabled(deps, enabledScheduleNames) {
    const active = deps.activeCommands();
    for (const scheduleName of Object.keys(active)) {
        if (enabledScheduleNames.includes(scheduleName))
            continue;
        const reset = await deps.resetCommands(scheduleName, active[scheduleName]);
        if (!reset)
            continue;
        deps.clearActiveCommands(scheduleName);
        const { schedule, reason } = await deps.loadStopped(scheduleName);
        const runId = (0, schedule_run_identity_1.activeRunId)(deps.runIds, scheduleName);
        // A deleted row is not written back: syncing it to the server could undo the delete.
        if (schedule && reason !== 'deleted') {
            schedule.status = 'finished';
            await deps.finishSchedule(schedule);
        }
        await deps.sendStopped(schedule !== null && schedule !== void 0 ? schedule : { name: scheduleName, label: '' }, reason, runId);
        (0, schedule_run_identity_1.forgetRunId)(deps.runIds, scheduleName);
    }
}
