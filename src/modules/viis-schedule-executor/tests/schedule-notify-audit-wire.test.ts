import { emitStartSideEffects } from '../schedule-side-effects';
import { ExecutionReport } from '../schedule-execution-types';
import { TabiotSchedule } from '../../../orm/entities/schedule/TabiotSchedule';
import { ScheduleService } from '../viis-schedule-executor-service';

test('two failed keys notify twice and audit once', async () => {
    const publishAuditLog = jest.fn().mockResolvedValue(undefined);
    const sendKeyVerifyFailNotification = jest.fn().mockResolvedValue(true);
    const service = {
        publishAuditLog,
        sendKeyVerifyFailNotification,
    } as unknown as ScheduleService;

    const report: ExecutionReport = {
        runId: 'run-wire',
        action: 'start',
        scheduleId: 'sched-wire',
        steps: [{
            phase: 'set_holding',
            ts: 1,
            ok: false,
            keys: [
                { key: 'set_ec', phase: 'set_holding', fc: 6, address: 17, expected: 2.5, status: 'fail', attempts: 3 },
                { key: 'set_ph', phase: 'set_holding', fc: 6, address: 18, expected: 6, status: 'fail', attempts: 3 },
                { key: 'set_flow', phase: 'set_holding', fc: 6, address: 19, expected: 1, status: 'pass', attempts: 1 },
            ],
        }],
    };

    await emitStartSideEffects(
        service,
        { name: 'sched-wire', label: 'Wire' } as TabiotSchedule,
        report,
        { tb: {} as any, emqx: {} as any },
        { holdingCommands: [], coilCommands: [] }
    );

    expect(sendKeyVerifyFailNotification).toHaveBeenCalledTimes(2);
    expect(publishAuditLog).toHaveBeenCalledTimes(1);
    expect(publishAuditLog.mock.calls[0][7]).toEqual({ runId: 'run-wire', steps: report.steps });
});
