"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.failedOutcomes = failedOutcomes;
function failedOutcomes(report) {
    return report.steps.flatMap(step => step.keys.filter(k => k.status === 'fail'));
}
