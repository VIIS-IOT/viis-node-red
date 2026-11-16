"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseBoards = parseBoards;
exports.buildKeyBoardIndex = buildKeyBoardIndex;
exports.ownerOf = ownerOf;
exports.withBoard = withBoard;
exports.commandTargetKey = commandTargetKey;
function parseBoards(raw) {
    let boards = raw;
    if (typeof raw === 'string') {
        try {
            boards = JSON.parse(raw);
        }
        catch (_a) {
            return [];
        }
    }
    if (!Array.isArray(boards))
        return [];
    return boards
        .filter((b) => b && typeof b.id === 'string' && b.id)
        .map((b) => ({ id: b.id, unitId: Number(b.unitId) || 1 }));
}
function buildKeyBoardIndex(boards, getJson) {
    const index = { coils: {}, holdings: {}, holdingMaps: {} };
    for (const board of boards) {
        const prefix = `MODBUS_${board.id.toUpperCase()}`;
        const owner = { boardId: board.id, unitId: board.unitId };
        const coils = getJson(`${prefix}_COILS`, {}) || {};
        const holdings = getJson(`${prefix}_HOLDING_REGISTERS`, {}) || {};
        index.holdingMaps[board.id] = holdings;
        for (const key of Object.keys(coils)) {
            if (!index.coils[key])
                index.coils[key] = owner;
        }
        for (const key of Object.keys(holdings)) {
            if (!index.holdings[key])
                index.holdings[key] = owner;
        }
    }
    return index;
}
function ownerOf(index, key, fc) {
    const isCoil = fc === 1 || fc === 5 || fc === 15;
    return isCoil ? index.coils[key] : index.holdings[key];
}
/** Returns the command with `boardId`/`unitid` of its owning board; unchanged if no board owns it. */
function withBoard(cmd, index) {
    const owner = ownerOf(index, cmd.key, cmd.fc);
    if (!owner)
        return cmd;
    if (cmd.boardId === owner.boardId && cmd.unitid === owner.unitId)
        return cmd;
    return Object.assign(Object.assign({}, cmd), { boardId: owner.boardId, unitid: owner.unitId });
}
/** Identity of a command target: board + function family + address. */
function commandTargetKey(cmd) {
    var _a;
    return `${(_a = cmd.boardId) !== null && _a !== void 0 ? _a : ''}_${cmd.fc}_${cmd.address}`;
}
