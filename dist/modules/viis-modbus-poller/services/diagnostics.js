"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPollerDiagnostics = createPollerDiagnostics;
exports.addDiagnosticRequest = addDiagnosticRequest;
exports.addDiagnosticWarning = addDiagnosticWarning;
exports.addDiagnosticError = addDiagnosticError;
exports.markDiagnosticRead = markDiagnosticRead;
exports.finalizePollerDiagnostics = finalizePollerDiagnostics;
function createPollerDiagnostics(boardId, dueGroups) {
    const startedAt = Date.now();
    return {
        status: dueGroups.length === 0 ? "skipped" : "ok",
        boardId,
        dueGroups: [...dueGroups],
        readCount: 0,
        errorCount: 0,
        errors: [],
        warnings: [],
        requests: [],
        startedAt,
        endedAt: startedAt,
        durationMs: 0,
        timestamp: startedAt,
    };
}
function addDiagnosticRequest(diagnostics, request) {
    diagnostics.requests.push(request);
}
function addDiagnosticWarning(diagnostics, warning) {
    diagnostics.warnings.push(warning);
}
function addDiagnosticError(diagnostics, error) {
    diagnostics.errors.push(error);
    diagnostics.errorCount = diagnostics.errors.length;
}
function markDiagnosticRead(diagnostics) {
    diagnostics.readCount += 1;
}
function finalizePollerDiagnostics(diagnostics) {
    const endedAt = Date.now();
    diagnostics.endedAt = endedAt;
    diagnostics.durationMs = endedAt - diagnostics.startedAt;
    diagnostics.timestamp = endedAt;
    if (diagnostics.errors.length > 0) {
        diagnostics.status = "error";
        return diagnostics;
    }
    if (diagnostics.warnings.length > 0) {
        diagnostics.status = "warning";
        return diagnostics;
    }
    diagnostics.status = diagnostics.dueGroups.length === 0 ? "skipped" : "ok";
    return diagnostics;
}
