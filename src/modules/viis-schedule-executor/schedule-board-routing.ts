import { ModbusCmd } from './type';

/**
 * Multi-board routing for the schedule executor.
 *
 * Boards can reuse the same addresses (two Delta PLCs both have Y0..Y7 at
 * coils 1280..1287), so a command is identified by key + board, never by
 * address alone. Each key is owned by the board whose map lists it.
 */

export interface BoardRef {
    id: string;
    unitId: number;
}

export interface BoardOwner {
    boardId: string;
    unitId: number;
}

export interface KeyBoardIndex {
    coils: Record<string, BoardOwner>;
    holdings: Record<string, BoardOwner>;
    /** Per-board holding maps, for keys like valve_program that must stay on one board. */
    holdingMaps: Record<string, Record<string, number>>;
}

type EnvGetter = (name: string, def?: any) => any;

export function parseBoards(raw: unknown): BoardRef[] {
    let boards: unknown = raw;
    if (typeof raw === 'string') {
        try {
            boards = JSON.parse(raw);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(boards)) return [];
    return boards
        .filter((b: any) => b && typeof b.id === 'string' && b.id)
        .map((b: any) => ({ id: b.id, unitId: Number(b.unitId) || 1 }));
}

export function buildKeyBoardIndex(boards: BoardRef[], getJson: EnvGetter): KeyBoardIndex {
    const index: KeyBoardIndex = { coils: {}, holdings: {}, holdingMaps: {} };
    for (const board of boards) {
        const prefix = `MODBUS_${board.id.toUpperCase()}`;
        const owner = { boardId: board.id, unitId: board.unitId };
        const coils = getJson(`${prefix}_COILS`, {}) || {};
        const holdings = getJson(`${prefix}_HOLDING_REGISTERS`, {}) || {};
        index.holdingMaps[board.id] = holdings;
        for (const key of Object.keys(coils)) {
            if (!index.coils[key]) index.coils[key] = owner;
        }
        for (const key of Object.keys(holdings)) {
            if (!index.holdings[key]) index.holdings[key] = owner;
        }
    }
    return index;
}

export function ownerOf(index: KeyBoardIndex, key: string, fc: number): BoardOwner | undefined {
    const isCoil = fc === 1 || fc === 5 || fc === 15;
    return isCoil ? index.coils[key] : index.holdings[key];
}

/** Returns the command with `boardId`/`unitid` of its owning board; unchanged if no board owns it. */
export function withBoard<T extends ModbusCmd>(cmd: T, index: KeyBoardIndex): T {
    const owner = ownerOf(index, cmd.key, cmd.fc);
    if (!owner) return cmd;
    if (cmd.boardId === owner.boardId && cmd.unitid === owner.unitId) return cmd;
    return { ...cmd, boardId: owner.boardId, unitid: owner.unitId };
}

/** Identity of a command target: board + function family + address. */
export function commandTargetKey(cmd: { fc: number; address: number; boardId?: string }): string {
    return `${cmd.boardId ?? ''}_${cmd.fc}_${cmd.address}`;
}
