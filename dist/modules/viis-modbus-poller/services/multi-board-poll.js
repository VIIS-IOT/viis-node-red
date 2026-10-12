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
    var _a;
    const merged = mappingsList.reduce((acc, mappings) => ({
        coils: Object.assign(Object.assign({}, acc.coils), mappings.coils),
        discreteInputs: Object.assign(Object.assign({}, acc.discreteInputs), mappings.discreteInputs),
        input: Object.assign(Object.assign({}, acc.input), mappings.input),
        holding: Object.assign(Object.assign({}, acc.holding), mappings.holding),
    }), { coils: {}, discreteInputs: {}, input: {}, holding: {} });
    if (Object.keys((_a = merged.discreteInputs) !== null && _a !== void 0 ? _a : {}).length === 0) {
        delete merged.discreteInputs;
    }
    return merged;
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
