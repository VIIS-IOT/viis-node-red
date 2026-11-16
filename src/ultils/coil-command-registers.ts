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

import * as fs from 'fs';

const DEFAULT_DEVICE_CONFIG_PATH = '/usr/src/app/env/configs/device1.json';
const STAT_INTERVAL_MS = 1000;

type BoardRegisters = Record<string, Record<string, number>>;

let cache: { checkedAt: number; signature: string; boards: BoardRegisters } | null = null;

function devicePath(): string {
    return (process.env.ENV_LOADER_JSON_CONFIG_PATH || '').trim() || DEFAULT_DEVICE_CONFIG_PATH;
}

function signatureOf(file: string): string {
    try {
        const st = fs.statSync(file);
        return `${st.mtimeMs}:${st.size}`;
    } catch {
        return 'missing';
    }
}

function readBoards(file: string): BoardRegisters {
    const boards: BoardRegisters = {};
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        const config = raw && raw.result && typeof raw.result === 'object' ? raw.result : raw;
        for (const [boardId, mapping] of Object.entries<any>(config?.modbusMappings || {})) {
            const registers: Record<string, number> = {};
            for (const [key, value] of Object.entries(mapping?.coilCommandRegisters || {})) {
                if (typeof value === 'number' && Number.isInteger(value) && value >= 0) registers[key] = value;
            }
            if (Object.keys(registers).length > 0) boards[boardId] = registers;
        }
    } catch {
        // Missing or invalid file: no command registers, coils are written as before.
    }
    return boards;
}

function currentBoards(): BoardRegisters {
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
export function coilCommandRegister(key: string, boardId?: string): number | undefined {
    const boards = currentBoards();
    if (boardId) return boards[boardId]?.[key];
    for (const registers of Object.values(boards)) {
        if (registers[key] !== undefined) return registers[key];
    }
    return undefined;
}

/** Test hook. */
export function resetCoilCommandRegistersCache(): void {
    cache = null;
}
