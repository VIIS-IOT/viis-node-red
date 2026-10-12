"use strict";
/**
 * @fileoverview Read device identity and broker settings straight from the env-loader JSON files.
 *
 * Why: Node-RED persists global context to disk (`contextStorage: localfilesystem`). When
 * device1.json is swapped to another device and Node-RED restarts, nodes start BEFORE
 * env-loader re-populates global context, so they read the PREVIOUS device id/token from the
 * persisted store. The shared TBMQ client is a singleton, so it then stays logged in as the
 * old device: telemetry goes to the wrong device and `v1/device/{newId}/rpc/+` gets SUBACK 0x80.
 *
 * The file env-loader reads is the source of truth, so identity and broker keys are resolved
 * from it first. Paths match env-loader's config-manager:
 *   ENV_LOADER_JSON_CONFIG_PATH        → /usr/src/app/env/configs/device1.json
 *   ENV_LOADER_COMMON_JSON_CONFIG_PATH → /usr/src/app/env/configs/common.json
 * Flattening matches env-loader's json-config-parser: optional `result` wrapper,
 * `deviceIdentity` spread directly, other object sections spread one level, device file wins.
 *
 * Set VIIS_CONFIG_FILE_FIRST=false to go back to global-context-first.
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
exports.isConfigFileFirstEnabled = isConfigFileFirstEnabled;
exports.getDeviceConfigFileValue = getDeviceConfigFileValue;
exports.resetDeviceConfigFileCache = resetDeviceConfigFileCache;
const fs = __importStar(require("fs"));
const DEFAULT_DEVICE_CONFIG_PATH = '/usr/src/app/env/configs/device1.json';
const DEFAULT_COMMON_CONFIG_PATH = '/usr/src/app/env/configs/common.json';
/** Re-check file mtimes at most this often; getEnvVar can sit on hot paths. */
const STAT_INTERVAL_MS = 1000;
/**
 * Only scalar identity/broker keys are served from the file. Everything else (Modbus maps,
 * thresholds, credentials for local services) keeps going through env-loader's global context,
 * whose shapes differ from the raw file.
 */
const FILE_FIRST_KEYS = new Set([
    'DEVICE_ID',
    'DEVICE_ACCESS_TOKEN',
    'DEVICE_LABEL',
    'DEVICE_SERIAL',
    'DEVICE_PROFILE_ID',
    'DEVICE_PROFILE_LABEL',
    'THINGSBOARD_HOST',
    'THINGSBOARD_PORT',
    'THINGSBOARD_MQTT_BROKER',
    'THINGSBOARD_PASSWORD',
    'IOT_DEVICE_TOPIC_BASE',
    'MQTT_SERVER_URL',
    'BACKEND_URL',
    'VIIS_BACKEND',
]);
let cache = null;
function configPaths() {
    const common = (process.env.ENV_LOADER_COMMON_JSON_CONFIG_PATH || '').trim() || DEFAULT_COMMON_CONFIG_PATH;
    const device = (process.env.ENV_LOADER_JSON_CONFIG_PATH || '').trim() || DEFAULT_DEVICE_CONFIG_PATH;
    // Order matters: later files override earlier ones (same as env-loader).
    return [common, device];
}
function fileSignature(paths) {
    return paths
        .map((p) => {
        try {
            const st = fs.statSync(p);
            return `${p}:${st.mtimeMs}:${st.size}`;
        }
        catch (_a) {
            return `${p}:missing`;
        }
    })
        .join('|');
}
function isScalar(value) {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}
function flatten(config) {
    const out = {};
    const effective = config && typeof config === 'object' && config.result && typeof config.result === 'object'
        ? config.result
        : config;
    if (!effective || typeof effective !== 'object')
        return out;
    const take = (section) => {
        if (!section || typeof section !== 'object' || Array.isArray(section))
            return;
        for (const [key, inner] of Object.entries(section)) {
            if (FILE_FIRST_KEYS.has(key) && isScalar(inner) && String(inner).trim() !== '') {
                out[key] = String(inner);
            }
        }
    };
    for (const [name, section] of Object.entries(effective)) {
        if (name !== 'deviceIdentity')
            take(section);
    }
    // deviceIdentity last, so identity always beats a stray key in another section.
    take(effective.deviceIdentity);
    return out;
}
function readSnapshot(paths, signature) {
    const values = {};
    for (const p of paths) {
        try {
            Object.assign(values, flatten(JSON.parse(fs.readFileSync(p, 'utf8'))));
        }
        catch (_a) {
            // Missing or invalid file: fall through to global context / process.env.
        }
    }
    return { signature, values };
}
function isConfigFileFirstEnabled() {
    var _a;
    return String((_a = process.env.VIIS_CONFIG_FILE_FIRST) !== null && _a !== void 0 ? _a : 'true').trim().toLowerCase() !== 'false';
}
/**
 * Value for an identity/broker key from device1.json/common.json, or undefined when the key is
 * not file-managed, the files are absent, or the feature is turned off.
 */
function getDeviceConfigFileValue(envVarName) {
    if (!FILE_FIRST_KEYS.has(envVarName) || !isConfigFileFirstEnabled())
        return undefined;
    const now = Date.now();
    if (!cache || now - cache.checkedAt >= STAT_INTERVAL_MS) {
        const paths = configPaths();
        const signature = fileSignature(paths);
        const snapshot = cache && cache.snapshot.signature === signature
            ? cache.snapshot
            : readSnapshot(paths, signature);
        cache = { checkedAt: now, snapshot };
    }
    return cache.snapshot.values[envVarName];
}
/** Test hook. `keepParsed` keeps the parsed snapshot but forces a fresh mtime check. */
function resetDeviceConfigFileCache(options = {}) {
    if (options.keepParsed && cache) {
        cache = Object.assign(Object.assign({}, cache), { checkedAt: 0 });
        return;
    }
    cache = null;
}
