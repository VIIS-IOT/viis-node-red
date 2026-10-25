"use strict";
/**
 * @fileoverview Pure helpers for `viis-sync-config`: what a downloaded config may do to the gateway's own
 * `device1.json`. The cloud copy is often a partial projection (mostly ENV keys on gateways that were never
 * exported as a full revision), so it is refused when it would drop what the gateway has, and the
 * gateway-owned sections (`actuatorPolicy`, rollout `featureFlags`) are merged rather than replaced.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MANUAL_LEASE_FLAG = void 0;
exports.unwrapConfig = unwrapConfig;
exports.refuseDownloadedConfig = refuseDownloadedConfig;
exports.mergeGatewayOwned = mergeGatewayOwned;
exports.backupPathFor = backupPathFor;
exports.backupConfig = backupConfig;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
exports.MANUAL_LEASE_FLAG = 'ARBITER_MANUAL_LEASE_S';
const BACKUPS_KEPT = 5;
function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function hasEntries(value) {
    if (Array.isArray(value))
        return value.length > 0;
    return isPlainObject(value) && Object.keys(value).length > 0;
}
/** The file may carry the API's `{ result: {...} }` wrapper; the config proper is inside it. */
function unwrapConfig(raw) {
    return (raw === null || raw === void 0 ? void 0 : raw.result) && typeof raw.result === 'object' ? raw.result : raw;
}
/**
 * Null when `downloaded` may replace `local`; otherwise why not. `runningDeviceId` is the identity this
 * gateway is running as. A download for another device would swap the gateway's identity and token.
 */
function refuseDownloadedConfig(downloaded, local, runningDeviceId) {
    var _a, _b;
    const downloadedId = String((_b = (_a = downloaded === null || downloaded === void 0 ? void 0 : downloaded.deviceIdentity) === null || _a === void 0 ? void 0 : _a.DEVICE_ID) !== null && _b !== void 0 ? _b : '').trim();
    if (runningDeviceId && downloadedId !== runningDeviceId)
        return 'config_device_mismatch';
    if (local) {
        const lost = (key) => hasEntries(local[key]) && !hasEntries(downloaded === null || downloaded === void 0 ? void 0 : downloaded[key]);
        if (lost('modbusBoards') || lost('modbusMappings'))
            return 'config_incomplete';
    }
    return null;
}
/**
 * `downloaded` with the gateway-owned sections of `local` put back:
 * - `actuatorPolicy` stays the local one (the cloud never generates it);
 * - `featureFlags` keeps every local key the download does not set, so rollout flags written on the
 *   gateway survive; `ARBITER_MANUAL_LEASE_S` is the one flag where the local value always wins
 *   (ADR-038 amendment 7: a device override beats the profile ceiling the download carries).
 */
function mergeGatewayOwned(downloaded, local) {
    if (!local)
        return downloaded;
    const merged = Object.assign({}, downloaded);
    if (local.actuatorPolicy !== undefined)
        merged.actuatorPolicy = local.actuatorPolicy;
    const localFlags = isPlainObject(local.featureFlags) ? local.featureFlags : null;
    if (localFlags) {
        const flags = Object.assign(Object.assign({}, localFlags), (isPlainObject(downloaded === null || downloaded === void 0 ? void 0 : downloaded.featureFlags) ? downloaded.featureFlags : {}));
        if (localFlags[exports.MANUAL_LEASE_FLAG] !== undefined)
            flags[exports.MANUAL_LEASE_FLAG] = localFlags[exports.MANUAL_LEASE_FLAG];
        merged.featureFlags = flags;
    }
    return merged;
}
const BACKUP_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
/** `device1.json.<ISO>.bak`, with the ISO stamp's `:` and `.` replaced so it is a legal file name everywhere. */
function backupPathFor(configPath, now = new Date()) {
    return `${configPath}.${now.toISOString().replace(/[:.]/g, '-')}.bak`;
}
/** Copies the file to a timestamped backup and deletes all but the newest {@link BACKUPS_KEPT}. */
function backupConfig(configPath, now = new Date()) {
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
        }
        catch (_a) {
            // A backup that cannot be removed is not worth failing the sync.
        }
    }
    return backupPath;
}
