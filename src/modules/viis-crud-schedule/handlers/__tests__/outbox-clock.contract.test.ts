import { readFileSync } from 'fs';
import { join } from 'path';

describe('outbox clock', () => {
    const schedule = readFileSync(join(__dirname, '../scheduleHandler.ts'), 'utf8');
    const plan = readFileSync(join(__dirname, '../schedulePlanHandler.ts'), 'utf8');

    it('marks synced without rewriting modified', () => {
        expect(schedule).toMatch(/\{\s*is_synced:\s*1\s*\}/);
        expect(schedule).not.toMatch(/is_synced:\s*1,\s*modified:\s*new Date\(\)/);
        expect(plan).toMatch(/\{\s*is_synced:\s*1\s*\}/);
        expect(plan).not.toMatch(/is_synced:\s*1,\s*modified:\s*new Date\(\)/);
    });
});
