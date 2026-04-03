"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viis_telemetry_utils_1 = require("../viis-telemetry-utils");
describe('Update scale config', () => {
    it('should use only the new scale config after update', () => {
        let scaleConfigs = [
            { key: 'temp', operation: 'multiply', factor: 2, direction: 'read' },
        ];
        // Lần đầu scale
        expect((0, viis_telemetry_utils_1.applyScaling)('temp', 10, 'read', scaleConfigs)).toBe(20);
        // Update config
        scaleConfigs = [
            { key: 'temp', operation: 'multiply', factor: 3, direction: 'read' },
        ];
        // Scale lại phải ra kết quả mới (không xen kẽ)
        expect((0, viis_telemetry_utils_1.applyScaling)('temp', 10, 'read', scaleConfigs)).toBe(30);
    });
});
