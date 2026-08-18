"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viis_schedule_executor_service_1 = require("../viis-schedule-executor-service");
test('publishAuditLog includes steps and run_id once per client', async () => {
    const mockNode = {
        warn: jest.fn(),
        context: () => ({
            global: { get: jest.fn(() => 'device-1'), set: jest.fn() },
        }),
    };
    const service = new viis_schedule_executor_service_1.ScheduleService(mockNode, true, true, true);
    Object.defineProperty(service, 'globalHelper', {
        value: { getEnvVar: jest.fn(() => 'device-1') },
        configurable: true,
    });
    const tb = { publish: jest.fn().mockResolvedValue(undefined) };
    const emqx = { publish: jest.fn().mockResolvedValue(undefined) };
    const steps = [
        {
            phase: 'set_holding',
            ts: 1,
            ok: true,
            keys: [{
                    key: 'set_ec', phase: 'set_holding', fc: 6, address: 17,
                    expected: 2.5, status: 'pass', attempts: 1,
                }],
        },
        {
            phase: 'start_pumps',
            ts: 2,
            ok: false,
            keys: [{
                    key: 'main_pump', phase: 'start_pumps', fc: 5, address: 0,
                    expected: true, status: 'fail', attempts: 3,
                }],
        },
    ];
    await service.publishAuditLog(tb, emqx, { name: 'sched-audit', label: 'Audit' }, 'start', {
        holdingCommands: [{ key: 'set_ec', value: 2.5, fc: 6, unitid: 1, address: 17, quantity: 1 }],
        coilCommands: [{ key: 'main_pump', value: true, fc: 5, unitid: 1, address: 0, quantity: 1 }],
    }, true, undefined, { runId: 'run-audit', steps });
    expect(tb.publish).toHaveBeenCalledTimes(1);
    expect(emqx.publish).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(tb.publish.mock.calls[0][1]);
    expect(payload.logs.metadata.steps[1].keys[0].status).toBe('fail');
    expect(payload.logs.metadata.run_id).toBe('run-audit');
    expect(payload.logs.metadata.status).toBe('FAIL');
});
