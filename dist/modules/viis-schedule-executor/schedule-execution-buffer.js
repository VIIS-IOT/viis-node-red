"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionStepBuffer = void 0;
class ExecutionStepBuffer {
    constructor(runId, action, scheduleId) {
        this.runId = runId;
        this.action = action;
        this.scheduleId = scheduleId;
        this.steps = [];
    }
    pushPhase(step) {
        var _a, _b, _c;
        const keys = (_a = step.keys) !== null && _a !== void 0 ? _a : [];
        const ok = (_b = step.ok) !== null && _b !== void 0 ? _b : keys.every(k => k.status === 'pass' || k.status === 'skipped');
        this.steps.push({
            phase: step.phase,
            ts: (_c = step.ts) !== null && _c !== void 0 ? _c : Date.now(),
            ok,
            duration_ms: step.duration_ms,
            keys,
        });
    }
    toReport() {
        return { runId: this.runId, action: this.action, scheduleId: this.scheduleId, steps: [...this.steps] };
    }
}
exports.ExecutionStepBuffer = ExecutionStepBuffer;
