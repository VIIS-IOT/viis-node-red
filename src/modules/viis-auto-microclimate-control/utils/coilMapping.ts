/**
 * Coil address resolution for the auto microclimate node.
 *
 * Priority (lowest → highest):
 *   1. Hardcoded VIIS addresses (constants.ts) — only when the board has no mapping
 *   2. modbusMappings[boardId].coils (or modbus_<boardId>_coils) from the device JSON
 *   3. Legacy global `modbusCoils` set by older flows
 *
 * When the board mapping exists it is authoritative: a managed key it does not list
 * gets no address (and is skipped), instead of falling back to a VIIS address that may
 * drive another output. Only the keys passed in `managedDefaults` are taken from the
 * board mapping, so extra coils (quat_7.., quat_tren_..) are never touched by this node.
 */

import { CONTEXT_KEYS } from "../constants";

interface GlobalContextLike {
    get(key: string): unknown;
}

function parseObject(value: unknown): Record<string, any> | undefined {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === "object" ? parsed : undefined;
        } catch {
            return undefined;
        }
    }
    return typeof value === "object" ? (value as Record<string, any>) : undefined;
}

function resolveBoardId(globalContext: GlobalContextLike, boardId?: string): string {
    if (boardId && boardId.trim()) {
        return boardId.trim();
    }
    for (const key of ["modbusDefaultBoard", "modbus_default_board", "MODBUS_DEFAULT_BOARD"]) {
        const value = globalContext.get(key);
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }
    return "board1";
}

/** Coils of one board from the device JSON, or undefined when the gateway has no board mapping. */
export function readBoardCoils(globalContext: GlobalContextLike, boardId?: string): Record<string, number> | undefined {
    const board = resolveBoardId(globalContext, boardId);
    const mappings = parseObject(globalContext.get("modbusMappings"));
    const coils = parseObject(mappings?.[board]?.coils) ?? parseObject(globalContext.get(`modbus_${board}_coils`));
    return coils && Object.keys(coils).length > 0 ? coils : undefined;
}

export function resolveCoilMapping(
    globalContext: GlobalContextLike,
    managedDefaults: Record<string, number>,
    boardId?: string
): Record<string, number> {
    const legacy = parseObject(globalContext.get(CONTEXT_KEYS.GLOBAL_MODBUS_COILS)) ?? {};
    const boardCoils = readBoardCoils(globalContext, boardId);

    if (!boardCoils) {
        return { ...managedDefaults, ...legacy };
    }

    const managed: Record<string, number> = {};
    for (const key of Object.keys(managedDefaults)) {
        const address = Number(boardCoils[key]);
        if (boardCoils[key] !== undefined && boardCoils[key] !== null && Number.isInteger(address) && address >= 0) {
            managed[key] = address;
        }
    }
    return { ...managed, ...legacy };
}
