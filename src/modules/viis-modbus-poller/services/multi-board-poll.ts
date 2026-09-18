import type { BoardMappings, ResolvedBoardPollConfig, ResolvedPollerConfig } from "../types";
import type { PollTickResult } from "./poll-runner";
import {
  addDiagnosticError,
  addDiagnosticRequest,
  addDiagnosticWarning,
  createPollerDiagnostics,
  finalizePollerDiagnostics,
  type PollerDiagnostics,
} from "./diagnostics";

export function getPollTargets(config: ResolvedPollerConfig): ResolvedBoardPollConfig[] {
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

export function mergeBoardMappings(mappingsList: BoardMappings[]): BoardMappings {
  return mappingsList.reduce<BoardMappings>(
    (merged, mappings) => ({
      coils: { ...merged.coils, ...mappings.coils },
      input: { ...merged.input, ...mappings.input },
      holding: { ...merged.holding, ...mappings.holding },
    }),
    { coils: {}, input: {}, holding: {} },
  );
}

export function mergePollTickResults(results: PollTickResult[]): PollTickResult {
  const latestData = {};
  const changedData = {};
  const boardIds = results.map((result) => result.diagnostics.boardId);
  const dueGroups = Array.from(new Set(results.flatMap((result) => result.diagnostics.dueGroups)));
  const diagnostics: PollerDiagnostics = createPollerDiagnostics(boardIds.join(",") || "unknown", dueGroups);

  for (const result of results) {
    Object.assign(latestData, result.latestData);
    Object.assign(changedData, result.changedData);

    diagnostics.readCount += result.diagnostics.readCount;
    diagnostics.startedAt = Math.min(diagnostics.startedAt, result.diagnostics.startedAt);

    for (const request of result.diagnostics.requests) {
      addDiagnosticRequest(diagnostics, request);
    }

    for (const warning of result.diagnostics.warnings) {
      addDiagnosticWarning(diagnostics, `${result.diagnostics.boardId}: ${warning}`);
    }

    for (const error of result.diagnostics.errors) {
      addDiagnosticError(diagnostics, `${result.diagnostics.boardId}: ${error}`);
    }
  }

  return {
    latestData,
    changedData,
    diagnostics: finalizePollerDiagnostics(diagnostics),
  };
}
