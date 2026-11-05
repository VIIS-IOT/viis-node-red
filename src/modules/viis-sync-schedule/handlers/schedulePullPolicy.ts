import { mysqlUtcDatetimeToIso } from '../../../core/farm-time';

export function shouldSoftDeleteLocalOnPull(local: {
    is_from_local?: number | boolean | null;
    is_synced?: number | boolean | null;
}): boolean {
    return !(Number(local.is_from_local) === 1 && Number(local.is_synced) === 0);
}

export function localInstantFromServer(value: unknown): Date | null {
    const iso = mysqlUtcDatetimeToIso(value as string | Date | null | undefined);
    if (!iso) return null;
    return new Date(iso);
}

export function shouldSkipIncomingUpdate(
    local: {
        is_from_local?: number | boolean | null;
        is_synced?: number | boolean | null;
        modified?: Date | string | null;
    },
    incomingModified: unknown,
): boolean {
    const incomingIso = mysqlUtcDatetimeToIso(incomingModified as string | Date | null | undefined);
    const unsyncedLocal = Number(local.is_from_local) === 1 && Number(local.is_synced) === 0;
    if (!incomingIso) return unsyncedLocal;
    if (Number(local.is_from_local) !== 1) return false;
    const localIso = mysqlUtcDatetimeToIso(local.modified);
    if (!localIso) return false;
    return new Date(localIso).getTime() >= new Date(incomingIso).getTime();
}

export type PulledScheduleStatus = 'running' | 'stopped' | 'finished' | '';

/**
 * Run status is gateway-owned: the server only mirrors what the gateway last managed to report, so a
 * pull never takes it. A schedule the gateway has not seen yet starts `finished`. Taking the server's
 * value turned a status POST lost to an outage (server kept `running`) into a finish run at pull time
 * (valve_program 0 and an end notification hours late), and a stale server `finished` into a second
 * START of a run in progress.
 */
export function pulledScheduleStatus(local?: { status?: string | null } | null): PulledScheduleStatus {
    return (local?.status as PulledScheduleStatus) || 'finished';
}

/**
 * `is_synced` after a pull. An executor status change the backend has not acknowledged yet
 * (`is_from_local = 0 AND is_synced = 0`, re-posted by the executor's retryUnsyncedStatuses) stays
 * unsynced; marking it synced would end that retry and leave the server on the old status.
 */
export function pulledIsSynced(local?: { is_from_local?: number | boolean | null; is_synced?: number | boolean | null } | null): 0 | 1 {
    if (!local) return 1;
    return Number(local.is_from_local) !== 1 && Number(local.is_synced) === 0 ? 0 : 1;
}
