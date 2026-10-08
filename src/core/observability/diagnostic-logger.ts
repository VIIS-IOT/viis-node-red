import { DiagnosticLevel } from "./types";
import { getDiagnosticRuntime } from "./runtime";

export class DiagnosticLogger {
    constructor(private readonly node: any, private readonly component: string) {}

    emit(level: DiagnosticLevel, event: string, fields: Record<string, unknown> = {}): void {
        getDiagnosticRuntime().emit(this.node, this.component, level, event, fields);
    }
}
