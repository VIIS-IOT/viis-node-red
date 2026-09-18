"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const multi_board_poll_1 = require("../services/multi-board-poll");
function makeConfig(overrides = {}) {
    return Object.assign({ deviceId: "device-1", boardId: "board1", pollingConfig: { realtime: { interval: 2000, coils: ["power", "aux_pump"] } }, mappings: { coils: { power: 30 }, input: {}, holding: {} }, thresholds: { power: 0, aux_pump: 0 }, scaleConfigs: [] }, overrides);
}
describe("multi-board poll helpers", () => {
    it("polls every resolved board instead of the node boardId filter", () => {
        const targets = (0, multi_board_poll_1.getPollTargets)(makeConfig({
            boardId: "board1",
            boards: [
                {
                    boardId: "board1",
                    unitId: 3,
                    mappings: { coils: { power: 30 }, input: {}, holding: {} },
                    pollingConfig: { realtime: { interval: 2000, coils: ["power"] } },
                },
                {
                    boardId: "board2",
                    unitId: 1,
                    mappings: { coils: { aux_pump: 0 }, input: {}, holding: {} },
                    pollingConfig: { realtime: { interval: 2000, coils: ["aux_pump"] } },
                },
            ],
        }));
        expect(targets.map((board) => board.boardId)).toEqual(["board1", "board2"]);
    });
    it("merges telemetry and keeps the other board when one read fails", () => {
        const merged = (0, multi_board_poll_1.mergePollTickResults)([
            {
                latestData: { power: true },
                changedData: { power: true },
                diagnostics: {
                    status: "ok",
                    boardId: "board1",
                    dueGroups: ["realtime"],
                    readCount: 1,
                    errorCount: 0,
                    errors: [],
                    warnings: [],
                    requests: [{ registerType: "coils", start: 30, quantity: 1 }],
                    startedAt: 1,
                    endedAt: 2,
                    durationMs: 1,
                    timestamp: 2,
                },
            },
            {
                latestData: {},
                changedData: {},
                diagnostics: {
                    status: "error",
                    boardId: "board2",
                    dueGroups: ["realtime"],
                    readCount: 0,
                    errorCount: 1,
                    errors: ["coils read failed at 0 qty 1: timeout"],
                    warnings: [],
                    requests: [{ registerType: "coils", start: 0, quantity: 1 }],
                    startedAt: 1,
                    endedAt: 3,
                    durationMs: 2,
                    timestamp: 3,
                },
            },
        ]);
        expect(merged.latestData).toEqual({ power: true });
        expect(merged.changedData).toEqual({ power: true });
        expect(merged.diagnostics.boardId).toBe("board1,board2");
        expect(merged.diagnostics.errorCount).toBe(1);
        expect(merged.diagnostics.errors).toEqual(["board2: coils read failed at 0 qty 1: timeout"]);
        expect(merged.diagnostics.readCount).toBe(1);
        expect((0, multi_board_poll_1.mergeBoardMappings)([
            { coils: { power: 30 }, input: {}, holding: {} },
            { coils: { aux_pump: 0 }, input: {}, holding: { soil_temp: 1 } },
        ])).toEqual({
            coils: { power: 30, aux_pump: 0 },
            input: {},
            holding: { soil_temp: 1 },
        });
    });
});
