"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configParamsToStep = configParamsToStep;
exports.startNotificationDue = startNotificationDue;
exports.emitStartSideEffects = emitStartSideEffects;
exports.emitEndSideEffects = emitEndSideEffects;
const schedule_execution_types_1 = require("./schedule-execution-types");
function configParamsToStep(params) {
    return {
        phase: 'config_publish',
        ts: Date.now(),
        ok: true,
        keys: params.map(cp => ({
            key: cp.key,
            phase: 'config_publish',
            fc: 0,
            address: 0,
            expected: cp.value,
            status: 'pass',
            attempts: 1,
            verifySkipped: true,
        })),
    };
}
/**
 * ADR-033 D1: a run is reported `started` only when every key of its start report passed verify.
 * A miss is reported by the verify-fail notifications alone.
 */
function startNotificationDue(report) {
    return (0, schedule_execution_types_1.failedOutcomes)(report).length === 0;
}
async function emitStartSideEffects(service, schedule, report, clients, commands, 
/** The run the events belong to (ADR-033): the start's runId, not this report's own. */
eventRunId) {
    var _a;
    if (eventRunId === void 0) { eventRunId = (_a = report.runId) !== null && _a !== void 0 ? _a : null; }
    await service.publishAuditLog(clients.tb, clients.emqx, schedule, 'start', commands, (0, schedule_execution_types_1.failedOutcomes)(report).length === 0, undefined, { runId: report.runId, steps: report.steps });
    for (const outcome of (0, schedule_execution_types_1.failedOutcomes)(report)) {
        await service.sendKeyVerifyFailNotification(schedule, 'start', outcome, eventRunId);
    }
}
async function emitEndSideEffects(service, schedule, report, clients, commands, 
/** The run the events belong to (ADR-033): the start's runId, not this report's own. */
eventRunId) {
    var _a;
    if (eventRunId === void 0) { eventRunId = (_a = report.runId) !== null && _a !== void 0 ? _a : null; }
    await service.publishAuditLog(clients.tb, clients.emqx, schedule, 'end', commands, (0, schedule_execution_types_1.failedOutcomes)(report).length === 0, undefined, { runId: report.runId, steps: report.steps });
    for (const outcome of (0, schedule_execution_types_1.failedOutcomes)(report)) {
        await service.sendKeyVerifyFailNotification(schedule, 'end', outcome, eventRunId);
    }
}
