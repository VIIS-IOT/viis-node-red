/**
 * Coil targets of the arbiter, from the same env-loader values the RPC node reads: MODBUS_BOARDS and each
 * board's MODBUS_<BOARD>_COILS. A key found in a board's coils belongs to the first such board (as in
 * viis-rpc-control `findBoardIdForKey`); a key only in the legacy MODBUS_COILS goes to the default board.
 */
import { CoilTarget } from './reconciler';

export interface BoardDef {
    id: string;
    unitId?: number;
    [key: string]: unknown;
}

/** MODBUS_BOARDS as an array (it arrives as a JSON string or already parsed); [] when missing/invalid. */
export function parseBoards(raw: unknown): BoardDef[] {
    let value = raw;
    if (typeof raw === 'string') {
        try {
            value = JSON.parse(raw);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(value)) return [];
    return value.filter((b): b is BoardDef => !!b && typeof b === 'object' && typeof (b as BoardDef).id === 'string');
}

function unitIdOf(board: BoardDef | undefined): number | undefined {
    const unitId = Number(board?.unitId);
    return Number.isFinite(unitId) ? unitId : undefined;
}

export function buildCoilTargets(
    boards: BoardDef[],
    coilsFor: (boardId: string) => Record<string, number> | null | undefined,
    legacyCoils: Record<string, number> | null | undefined,
    defaultBoardId: string,
): CoilTarget[] {
    const targets = new Map<string, CoilTarget>();
    for (const board of boards) {
        for (const [key, address] of Object.entries(coilsFor(board.id) || {})) {
            if (targets.has(key) || !Number.isFinite(Number(address))) continue;
            targets.set(key, { key, boardId: board.id, address: Number(address), unitId: unitIdOf(board) });
        }
    }
    const defaultBoard = boards.find(b => b.id === defaultBoardId);
    for (const [key, address] of Object.entries(legacyCoils || {})) {
        if (targets.has(key) || !Number.isFinite(Number(address))) continue;
        targets.set(key, { key, boardId: defaultBoardId, address: Number(address), unitId: unitIdOf(defaultBoard) });
    }
    return Array.from(targets.values());
}
