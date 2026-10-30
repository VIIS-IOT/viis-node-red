"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.readBoardCoils = readBoardCoils;
exports.resolveCoilMapping = resolveCoilMapping;
const constants_1 = require("../constants");
function parseObject(value) {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === "object" ? parsed : undefined;
        }
        catch (_a) {
            return undefined;
        }
    }
    return typeof value === "object" ? value : undefined;
}
function resolveBoardId(globalContext, boardId) {
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
function readBoardCoils(globalContext, boardId) {
    var _a, _b;
    const board = resolveBoardId(globalContext, boardId);
    const mappings = parseObject(globalContext.get("modbusMappings"));
    const coils = (_b = parseObject((_a = mappings === null || mappings === void 0 ? void 0 : mappings[board]) === null || _a === void 0 ? void 0 : _a.coils)) !== null && _b !== void 0 ? _b : parseObject(globalContext.get(`modbus_${board}_coils`));
    return coils && Object.keys(coils).length > 0 ? coils : undefined;
}
function resolveCoilMapping(globalContext, managedDefaults, boardId) {
    var _a;
    const legacy = (_a = parseObject(globalContext.get(constants_1.CONTEXT_KEYS.GLOBAL_MODBUS_COILS))) !== null && _a !== void 0 ? _a : {};
    const boardCoils = readBoardCoils(globalContext, boardId);
    if (!boardCoils) {
        return Object.assign(Object.assign({}, managedDefaults), legacy);
    }
    const managed = {};
    for (const key of Object.keys(managedDefaults)) {
        const address = Number(boardCoils[key]);
        if (boardCoils[key] !== undefined && boardCoils[key] !== null && Number.isInteger(address) && address >= 0) {
            managed[key] = address;
        }
    }
    return Object.assign(Object.assign({}, managed), legacy);
}
