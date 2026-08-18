"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configParamsToStep = configParamsToStep;
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
async function emitStartSideEffects(service, schedule, report, clients, commands) {
    await service.publishAuditLog(clients.tb, clients.emqx, schedule, 'start', commands, (0, schedule_execution_types_1.failedOutcomes)(report).length === 0, undefined, { runId: report.runId, steps: report.steps });
    for (const outcome of (0, schedule_execution_types_1.failedOutcomes)(report)) {
        await service.sendKeyVerifyFailNotification(schedule, 'start', outcome);
    }
}
async function emitEndSideEffects(service, schedule, report, clients, commands) {
    await service.publishAuditLog(clients.tb, clients.emqx, schedule, 'end', commands, (0, schedule_execution_types_1.failedOutcomes)(report).length === 0, undefined, { runId: report.runId, steps: report.steps });
    for (const outcome of (0, schedule_execution_types_1.failedOutcomes)(report)) {
        await service.sendKeyVerifyFailNotification(schedule, 'end', outcome);
    }
}
