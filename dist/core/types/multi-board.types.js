"use strict";
/**
 * Shared Type Definitions for Multi-Board Modbus Support
 * Used by all VIIS nodes that support multi-board functionality
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BoardSelectionPriority = void 0;
/**
 * Board selection priority (highest to lowest):
 * 1. msg.payload.boardId (dynamic)
 * 2. node.config.boardId (static)
 * 3. MODBUS_DEFAULT_BOARD (env)
 * 4. First board in MODBUS_BOARDS
 * 5. Single-board fallback
 */
var BoardSelectionPriority;
(function (BoardSelectionPriority) {
    BoardSelectionPriority[BoardSelectionPriority["DYNAMIC_PAYLOAD"] = 1] = "DYNAMIC_PAYLOAD";
    BoardSelectionPriority[BoardSelectionPriority["STATIC_CONFIG"] = 2] = "STATIC_CONFIG";
    BoardSelectionPriority[BoardSelectionPriority["DEFAULT_ENV"] = 3] = "DEFAULT_ENV";
    BoardSelectionPriority[BoardSelectionPriority["FIRST_BOARD"] = 4] = "FIRST_BOARD";
    BoardSelectionPriority[BoardSelectionPriority["SINGLE_FALLBACK"] = 5] = "SINGLE_FALLBACK";
})(BoardSelectionPriority || (exports.BoardSelectionPriority = BoardSelectionPriority = {}));
