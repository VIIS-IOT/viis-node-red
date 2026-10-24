"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseBoards = parseBoards;
exports.buildCoilTargets = buildCoilTargets;
/** MODBUS_BOARDS as an array (it arrives as a JSON string or already parsed); [] when missing/invalid. */
function parseBoards(raw) {
    let value = raw;
    if (typeof raw === 'string') {
        try {
            value = JSON.parse(raw);
        }
        catch (_a) {
            return [];
        }
    }
    if (!Array.isArray(value))
        return [];
    return value.filter((b) => !!b && typeof b === 'object' && typeof b.id === 'string');
}
function unitIdOf(board) {
    const unitId = Number(board === null || board === void 0 ? void 0 : board.unitId);
    return Number.isFinite(unitId) ? unitId : undefined;
}
function buildCoilTargets(boards, coilsFor, legacyCoils, defaultBoardId) {
    const targets = new Map();
    for (const board of boards) {
        for (const [key, address] of Object.entries(coilsFor(board.id) || {})) {
            if (targets.has(key) || !Number.isFinite(Number(address)))
                continue;
            targets.set(key, { key, boardId: board.id, address: Number(address), unitId: unitIdOf(board) });
        }
    }
    const defaultBoard = boards.find(b => b.id === defaultBoardId);
    for (const [key, address] of Object.entries(legacyCoils || {})) {
        if (targets.has(key) || !Number.isFinite(Number(address)))
            continue;
        targets.set(key, { key, boardId: defaultBoardId, address: Number(address), unitId: unitIdOf(defaultBoard) });
    }
    return Array.from(targets.values());
}
