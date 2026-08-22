import { Repository } from 'typeorm';

/**
 * Mark a local row synced after a successful outbox POST.
 * Gateway `modified` has ON UPDATE CURRENT_TIMESTAMP(6), so a plain
 * `SET is_synced = 1` would steal the LWW clock. Pin `modified = modified`.
 */
export async function markOutboxSynced<T extends { name: string }>(
    repo: Repository<T>,
    table: 'tabiot_schedule' | 'tabiot_schedule_plan',
    name: string,
): Promise<void> {
    await repo.query(`UPDATE ${table} SET is_synced = 1, modified = modified WHERE name = ?`, [name]);
}
