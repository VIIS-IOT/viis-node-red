import { MqttClientCore } from '../../core/mqtt-client';
import { TabiotSchedule } from '../../orm/entities/schedule/TabiotSchedule';
import { ConfigParameter, ModbusCmd } from './type';
import { ExecutionReport, ExecutionStep, failedOutcomes } from './schedule-execution-types';
import { ScheduleService } from './viis-schedule-executor-service';

export function configParamsToStep(params: ConfigParameter[]): ExecutionStep {
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
export function startNotificationDue(report: ExecutionReport): boolean {
    return failedOutcomes(report).length === 0;
}

export async function emitStartSideEffects(
    service: ScheduleService,
    schedule: TabiotSchedule,
    report: ExecutionReport,
    clients: { tb: MqttClientCore; emqx: MqttClientCore },
    commands: { holdingCommands: ModbusCmd[]; coilCommands: ModbusCmd[] },
    /** The run the events belong to (ADR-033): the start's runId, not this report's own. */
    eventRunId: string | null = report.runId ?? null
): Promise<void> {
    await service.publishAuditLog(
        clients.tb,
        clients.emqx,
        schedule,
        'start',
        commands,
        failedOutcomes(report).length === 0,
        undefined,
        { runId: report.runId, steps: report.steps }
    );
    for (const outcome of failedOutcomes(report)) {
        await service.sendKeyVerifyFailNotification(schedule, 'start', outcome, eventRunId);
    }
}

export async function emitEndSideEffects(
    service: ScheduleService,
    schedule: TabiotSchedule,
    report: ExecutionReport,
    clients: { tb: MqttClientCore; emqx: MqttClientCore },
    commands: { holdingCommands: ModbusCmd[]; coilCommands: ModbusCmd[] },
    /** The run the events belong to (ADR-033): the start's runId, not this report's own. */
    eventRunId: string | null = report.runId ?? null
): Promise<void> {
    await service.publishAuditLog(
        clients.tb,
        clients.emqx,
        schedule,
        'end',
        commands,
        failedOutcomes(report).length === 0,
        undefined,
        { runId: report.runId, steps: report.steps }
    );
    for (const outcome of failedOutcomes(report)) {
        await service.sendKeyVerifyFailNotification(schedule, 'end', outcome, eventRunId);
    }
}
