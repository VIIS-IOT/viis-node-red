import * as fs from 'fs';
import * as path from 'path';
import { ScheduleService } from '../viis-schedule-executor-service';
import { Node } from 'node-red';

test('applyStartCommandStore keeps commands after a failed key report', () => {
    const store: Record<string, any> = { activeModbusCommands: {} };
    const mockNode = {
        warn: jest.fn(),
        context: () => ({
            global: {
                get: (key: string) => store[key],
                set: (key: string, value: any) => { store[key] = value; },
            },
        }),
    } as unknown as Node;
    const service = new ScheduleService(mockNode, true, false, true);
    service.applyStartCommandStore('sched-1', [
        { key: 'set_ec', value: 2.5, fc: 6, unitid: 1, address: 17, quantity: 1 },
        { key: 'power', value: true, fc: 5, unitid: 1, address: 30, quantity: 1 },
    ]);
    expect(service.getActiveCommands('sched-1')).toHaveLength(2);
});

test('node no longer gates START status on batch verify failure', () => {
    const nodeSrc = fs.readFileSync(
        path.join(__dirname, '..', 'viis-schedule-executor.ts'),
        'utf8'
    );
    expect(nodeSrc).not.toContain('failed to start after');
    expect(nodeSrc).not.toContain('while (!writeSuccess && attempt < 3)');
});
