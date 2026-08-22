"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markOutboxSynced = markOutboxSynced;
/**
 * Mark a local row synced after a successful outbox POST.
 * Gateway `modified` has ON UPDATE CURRENT_TIMESTAMP(6), so a plain
 * `SET is_synced = 1` would steal the LWW clock. Pin `modified = modified`.
 */
async function markOutboxSynced(repo, table, name) {
    await repo.query(`UPDATE ${table} SET is_synced = 1, modified = modified WHERE name = ?`, [name]);
}
