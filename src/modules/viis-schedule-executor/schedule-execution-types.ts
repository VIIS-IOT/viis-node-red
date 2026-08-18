import { ModbusCmd } from './type';

export type ScheduleAction = 'start' | 'end';

export type SchedulePhase =
    | 'reset_unused_holding'
    | 'set_holding'
    | 'set_valve_program'
    | 'open_valves'
    | 'other_coils'
    | 'water_hammer_delay'
    | 'start_pumps'
    | 'system_power'
    | 'reset_holding'
    | 'stop_pumps'
    | 'close_valves'
    | 'config_publish';

export type KeyOutcomeStatus = 'pass' | 'fail' | 'skipped' | 'blocked';

export interface KeyOutcome {
    key: string;
    phase: SchedulePhase;
    fc: number;
    address: number;
    expected: number | boolean;
    rawWritten?: number | boolean;
    read?: number | boolean;
    status: KeyOutcomeStatus;
    attempts: number;
    error?: string;
    verifySkipped?: boolean;
}

export interface ExecutionStep {
    phase: SchedulePhase;
    ts: number;
    ok: boolean;
    duration_ms?: number;
    keys: KeyOutcome[];
}

export interface ExecutionReport {
    runId: string;
    action: ScheduleAction;
    scheduleId: string;
    steps: ExecutionStep[];
}

export function failedOutcomes(report: ExecutionReport): KeyOutcome[] {
    return report.steps.flatMap(step => step.keys.filter(k => k.status === 'fail'));
}

export type { ModbusCmd };
