"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiagnosticLogger = void 0;
const runtime_1 = require("./runtime");
class DiagnosticLogger {
    constructor(node, component) {
        this.node = node;
        this.component = component;
    }
    emit(level, event, fields = {}) {
        (0, runtime_1.getDiagnosticRuntime)().emit(this.node, this.component, level, event, fields);
    }
}
exports.DiagnosticLogger = DiagnosticLogger;
