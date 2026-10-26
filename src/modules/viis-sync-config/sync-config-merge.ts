/**
 * @fileoverview Pure helpers for `viis-sync-config`: what a downloaded config may do to the gateway's own
 * `device1.json`. The cloud copy is often a partial projection (mostly ENV keys on gateways that were never
 * exported as a full revision), so it is refused when it would drop what the gateway has, and the
 * gateway-owned sections (`actuatorPolicy`, rollout `featureFlags`) are merged rather than replaced.
 */

import * as fs from 'fs';
import * as path from 'path';

export type SyncRefusal = 'config_device_mismatch' | 'config_incomplete';

export const MANUAL_LEASE_FLAG = 'ARBITER_MANUAL_LEASE_S';
const BACKUPS_KEPT = 5;

function isPlainObject(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasEntries(value: unknown): boolean {
    if (Array.isArray(value)) return value.length > 0;
    return isPlainObject(value) && Object.keys(value).length > 0;
}

/** The file may carry the API's `{ result: {...} }` wrapper; the config proper is inside it. */
export function unwrapConfig(raw: any): any {
    return raw?.result && typeof raw.result === 'object' ? raw.result : raw;
}

/**
 * Null when `downloaded` may replace `local`; otherwise why not. `runningDeviceId` is the identity this
 * gateway is running as. A download for another device would swap the gateway's identity and token.
 */
export function refuseDownloadedConfig(downloaded: any, local: any, runningDeviceId: string): SyncRefusal | null {
    const downloadedId = String(downloaded?.deviceIdentity?.DEVICE_ID ?? '').trim();
    if (runningDeviceId && downloadedId !== runningDeviceId) return 'config_device_mismatch';

    if (local) {
        const lost = (key: string) => hasEntries(local[key]) && !hasEntries(downloaded?.[key]);
        if (lost('modbusBoards') || lost('modbusMappings')) return 'config_incomplete';
    }
    return null;
}

/**
 * `downloaded` with the gateway-owned sections of `local` put back:
 * - `actuatorPolicy` stays the local one (the cloud never generates it);
 * - `featureFlags` keeps every local key the download does not set, so rollout flags written on the
 *   gateway survive; `ARBITER_MANUAL_LEASE_S` is the one flag that always follows the download: the
 *   export already applied "device override beats profile ceiling" on the cloud copy (ADR-038
 *   amendment 7), and the file's value is only the last synced one — a profile change must land and a
 *   cleared ceiling must disappear (ADR-038 amendment 8).
 */
export function mergeGatewayOwned(downloaded: any, local: any): any {
    if (!local) return downloaded;
    const merged: Record<string, any> = { ...downloaded };

    if (local.actuatorPolicy !== undefined) merged.actuatorPolicy = local.actuatorPolicy;

    const localFlags = isPlainObject(local.featureFlags) ? local.featureFlags : null;
    if (localFlags) {
        const downloadedFlags: Record<string, any> = isPlainObject(downloaded?.featureFlags) ? downloaded.featureFlags : {};
        const flags: Record<string, any> = { ...localFlags, ...downloadedFlags };
        if (downloadedFlags[MANUAL_LEASE_FLAG] === undefined) delete flags[MANUAL_LEASE_FLAG];
        merged.featureFlags = flags;
    }
    return merged;
}

const BACKUP_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

/** `device1.json.<ISO>.bak`, with the ISO stamp's `:` and `.` replaced so it is a legal file name everywhere. */
export function backupPathFor(configPath: string, now: Date = new Date()): string {
    return `${configPath}.${now.toISOString().replace(/[:.]/g, '-')}.bak`;
}

/** Copies the file to a timestamped backup and deletes all but the newest {@link BACKUPS_KEPT}. */
export function backupConfig(configPath: string, now: Date = new Date()): string {
    const backupPath = backupPathFor(configPath, now);
    fs.copyFileSync(configPath, backupPath);

    const dir = path.dirname(configPath);
    const prefix = `${path.basename(configPath)}.`;
    const stale = fs
        .readdirSync(dir)
        .filter((name) => name.startsWith(prefix) && name.endsWith('.bak') && BACKUP_STAMP.test(name.slice(prefix.length, -'.bak'.length)))
        .sort()
        .reverse()
        .slice(BACKUPS_KEPT);
    for (const name of stale) {
        try {
            fs.unlinkSync(path.join(dir, name));
        } catch {
            // A backup that cannot be removed is not worth failing the sync.
        }
    }
    return backupPath;
}
