"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPollTargets = getPollTargets;
exports.mergeBoardMappings = mergeBoardMappings;
exports.mergePollTickResults = mergePollTickResults;
const diagnostics_1 = require("./diagnostics");
function getPollTargets(config) {
    if (config.boards && config.boards.length > 0) {
        return config.boards;
    }
    return [
        {
            boardId: config.boardId,
            unitId: 1,
            mappings: config.mappings,
            pollingConfig: config.pollingConfig,
        },
    ];
}
function mergeBoardMappings(mappingsList) {
    return mappingsList.reduce((merged, mappings) => ({
        coils: Object.assign(Object.assign({}, merged.coils), mappings.coils),
        input: Object.assign(Object.assign({}, merged.input), mappings.input),
        holding: Object.assign(Object.assign({}, merged.holding), mappings.holding),
    }), { coils: {}, input: {}, holding: {} });
}
function mergePollTickResults(results) {
    const latestData = {};
    const changedData = {};
    const boardIds = results.map((result) => result.diagnostics.boardId);
    const dueGroups = Array.from(new Set(results.flatMap((result) => result.diagnostics.dueGroups)));
    const diagnostics = (0, diagnostics_1.createPollerDiagnostics)(boardIds.join(",") || "unknown", dueGroups);
    for (const result of results) {
        Object.assign(latestData, result.latestData);
        Object.assign(changedData, result.changedData);
        diagnostics.readCount += result.diagnostics.readCount;
        diagnostics.startedAt = Math.min(diagnostics.startedAt, result.diagnostics.startedAt);
        for (const request of result.diagnostics.requests) {
            (0, diagnostics_1.addDiagnosticRequest)(diagnostics, request);
        }
        for (const warning of result.diagnostics.warnings) {
            (0, diagnostics_1.addDiagnosticWarning)(diagnostics, `${result.diagnostics.boardId}: ${warning}`);
        }
        for (const error of result.diagnostics.errors) {
            (0, diagnostics_1.addDiagnosticError)(diagnostics, `${result.diagnostics.boardId}: ${error}`);
        }
    }
    return {
        latestData,
        changedData,
        diagnostics: (0, diagnostics_1.finalizePollerDiagnostics)(diagnostics),
    };
}
