"use strict";
/**
 * @fileoverview Coil command registers (gateway `tyanh-tyem-82`, Delta PLCs).
 *
 * On these PLCs the ladder drives Y0..Y7 (coils 1280..1287) from D220..D227
 * (holding 4316..4323). A direct coil write is overwritten on the next scan, so
 * an output is switched by writing 1/0 to its D register and confirmed by
 * reading the coil.
 *
 * device1.json, per board:
 *   "modbusMappings": { "board1": { "coils": { "pump_tank_a": 1280 },
 *                                   "coilCommandRegisters": { "pump_tank_a": 4316 } } }
 *
 * Read straight from the file env-loader reads (env-loader does not pass unknown
 * mapping sections on). Keys without an entry keep writing the coil.
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
exports.coilCommandRegister = coilCommandRegister;
exports.resetCoilCommandRegistersCache = resetCoilCommandRegistersCache;
const fs = __importStar(require("fs"));
const DEFAULT_DEVICE_CONFIG_PATH = '/usr/src/app/env/configs/device1.json';
const STAT_INTERVAL_MS = 1000;
let cache = null;
function devicePath() {
    return (process.env.ENV_LOADER_JSON_CONFIG_PATH || '').trim() || DEFAULT_DEVICE_CONFIG_PATH;
}
function signatureOf(file) {
    try {
        const st = fs.statSync(file);
        return `${st.mtimeMs}:${st.size}`;
    }
    catch (_a) {
        return 'missing';
    }
}
function readBoards(file) {
    const boards = {};
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        const config = raw && raw.result && typeof raw.result === 'object' ? raw.result : raw;
        for (const [boardId, mapping] of Object.entries((config === null || config === void 0 ? void 0 : config.modbusMappings) || {})) {
            const registers = {};
            for (const [key, value] of Object.entries((mapping === null || mapping === void 0 ? void 0 : mapping.coilCommandRegisters) || {})) {
                if (typeof value === 'number' && Number.isInteger(value) && value >= 0)
                    registers[key] = value;
            }
            if (Object.keys(registers).length > 0)
                boards[boardId] = registers;
        }
    }
    catch (_a) {
        // Missing or invalid file: no command registers, coils are written as before.
    }
    return boards;
}
function currentBoards() {
    const now = Date.now();
    if (!cache || now - cache.checkedAt >= STAT_INTERVAL_MS) {
        const file = devicePath();
        const signature = `${file}:${signatureOf(file)}`;
        const boards = cache && cache.signature === signature ? cache.boards : readBoards(file);
        cache = { checkedAt: now, signature, boards };
    }
    return cache.boards;
}
/**
 * Holding register that commands coil `key`, or undefined to write the coil itself.
 * With `boardId`, only that board is searched; without it, the first board listing the key.
 */
function coilCommandRegister(key, boardId) {
    var _a;
    const boards = currentBoards();
    if (boardId)
        return (_a = boards[boardId]) === null || _a === void 0 ? void 0 : _a[key];
    for (const registers of Object.values(boards)) {
        if (registers[key] !== undefined)
            return registers[key];
    }
    return undefined;
}
/** Test hook. */
function resetCoilCommandRegistersCache() {
    cache = null;
}
