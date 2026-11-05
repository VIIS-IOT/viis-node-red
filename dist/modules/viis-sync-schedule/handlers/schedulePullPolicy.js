"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldSoftDeleteLocalOnPull = shouldSoftDeleteLocalOnPull;
exports.localInstantFromServer = localInstantFromServer;
exports.shouldSkipIncomingUpdate = shouldSkipIncomingUpdate;
exports.pulledScheduleStatus = pulledScheduleStatus;
exports.pulledIsSynced = pulledIsSynced;
const farm_time_1 = require("../../../core/farm-time");
function shouldSoftDeleteLocalOnPull(local) {
    return !(Number(local.is_from_local) === 1 && Number(local.is_synced) === 0);
}
function localInstantFromServer(value) {
    const iso = (0, farm_time_1.mysqlUtcDatetimeToIso)(value);
    if (!iso)
        return null;
    return new Date(iso);
}
function shouldSkipIncomingUpdate(local, incomingModified) {
    const incomingIso = (0, farm_time_1.mysqlUtcDatetimeToIso)(incomingModified);
    const unsyncedLocal = Number(local.is_from_local) === 1 && Number(local.is_synced) === 0;
    if (!incomingIso)
        return unsyncedLocal;
    if (Number(local.is_from_local) !== 1)
        return false;
    const localIso = (0, farm_time_1.mysqlUtcDatetimeToIso)(local.modified);
    if (!localIso)
        return false;
    return new Date(localIso).getTime() >= new Date(incomingIso).getTime();
}
/**
 * Run status is gateway-owned: the server only mirrors what the gateway last managed to report, so a
 * pull never takes it. A schedule the gateway has not seen yet starts `finished`. Taking the server's
 * value turned a status POST lost to an outage (server kept `running`) into a finish run at pull time
 * (valve_program 0 and an end notification hours late), and a stale server `finished` into a second
 * START of a run in progress.
 */
function pulledScheduleStatus(local) {
    return (local === null || local === void 0 ? void 0 : local.status) || 'finished';
}
/**
 * `is_synced` after a pull. An executor status change the backend has not acknowledged yet
 * (`is_from_local = 0 AND is_synced = 0`, re-posted by the executor's retryUnsyncedStatuses) stays
 * unsynced; marking it synced would end that retry and leave the server on the old status.
 */
function pulledIsSynced(local) {
    if (!local)
        return 1;
    return Number(local.is_from_local) !== 1 && Number(local.is_synced) === 0 ? 0 : 1;
}
