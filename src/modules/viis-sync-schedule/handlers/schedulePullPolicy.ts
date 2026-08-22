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
