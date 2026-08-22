import { readFileSync } from 'fs';
import { join } from 'path';

describe('outbox clock', () => {
    const schedule = readFileSync(join(__dirname, '../scheduleHandler.ts'), 'utf8');
    const plan = readFileSync(join(__dirname, '../schedulePlanHandler.ts'), 'utf8');

    it('marks synced without rewriting modified', () => {
        expect(schedule).toMatch(/markOutboxSynced\(this\.scheduleRepo, 'tabiot_schedule'/);
        expect(schedule).not.toMatch(/is_synced:\s*1,\s*modified:\s*new Date\(\)/);
        expect(plan).toMatch(/markOutboxSynced\(this\.planRepo, 'tabiot_schedule_plan'/);
        expect(plan).not.toMatch(/is_synced:\s*1,\s*modified:\s*new Date\(\)/);
        const ack = readFileSync(join(__dirname, '../outboxAck.ts'), 'utf8');
        expect(ack).toContain('SET is_synced = 1, modified = modified');
    });
});
