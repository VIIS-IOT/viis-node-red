import type { RegisterType } from "../types";

export type PollerDiagnosticsStatus = "ok" | "skipped" | "warning" | "error";

export interface PollerDiagnosticsRequest {
  registerType: RegisterType;
  start: number;
  quantity: number;
}

export interface PollerDiagnostics {
  status: PollerDiagnosticsStatus;
  boardId: string;
  dueGroups: string[];
  readCount: number;
  errorCount: number;
  errors: string[];
  warnings: string[];
  requests: PollerDiagnosticsRequest[];
  startedAt: number;
  endedAt: number;
  durationMs: number;
  timestamp: number;
}

export function createPollerDiagnostics(boardId: string, dueGroups: string[]): PollerDiagnostics {
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

export function addDiagnosticRequest(
  diagnostics: PollerDiagnostics,
  request: PollerDiagnosticsRequest,
): void {
  diagnostics.requests.push(request);
}

export function addDiagnosticWarning(diagnostics: PollerDiagnostics, warning: string): void {
  diagnostics.warnings.push(warning);
}

export function addDiagnosticError(diagnostics: PollerDiagnostics, error: string): void {
  diagnostics.errors.push(error);
  diagnostics.errorCount = diagnostics.errors.length;
}

export function markDiagnosticRead(diagnostics: PollerDiagnostics): void {
  diagnostics.readCount += 1;
}

export function finalizePollerDiagnostics(diagnostics: PollerDiagnostics): PollerDiagnostics {
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
