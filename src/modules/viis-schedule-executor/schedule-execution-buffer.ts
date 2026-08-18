import {
    ExecutionReport,
    ExecutionStep,
    ScheduleAction,
} from './schedule-execution-types';

export class ExecutionStepBuffer {
    constructor(
        private readonly runId: string,
        private readonly action: ScheduleAction,
        private readonly scheduleId: string
    ) {}

    private steps: ExecutionStep[] = [];

    pushPhase(step: Omit<ExecutionStep, 'ts' | 'ok'> & { ts?: number; ok?: boolean }): void {
        const keys = step.keys ?? [];
        const ok = step.ok ?? keys.every(k => k.status === 'pass' || k.status === 'skipped');
        this.steps.push({
            phase: step.phase,
            ts: step.ts ?? Date.now(),
            ok,
            duration_ms: step.duration_ms,
            keys,
        });
    }

    toReport(): ExecutionReport {
        return { runId: this.runId, action: this.action, scheduleId: this.scheduleId, steps: [...this.steps] };
    }
}
