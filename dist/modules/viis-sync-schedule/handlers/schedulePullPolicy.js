"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldSoftDeleteLocalOnPull = shouldSoftDeleteLocalOnPull;
exports.localInstantFromServer = localInstantFromServer;
exports.shouldSkipIncomingUpdate = shouldSkipIncomingUpdate;
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
