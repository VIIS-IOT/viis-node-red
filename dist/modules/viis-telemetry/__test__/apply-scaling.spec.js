"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viis_telemetry_utils_1 = require("../viis-telemetry-utils");
/**
 * Unit test for applyScaling function.
 */
describe('applyScaling', () => {
    const scaleConfigs = [
        { key: 'temp', operation: 'multiply', factor: 2, direction: 'read' },
        { key: 'pressure', operation: 'divide', factor: 10, direction: 'read' },
    ];
    it('should multiply value correctly', () => {
        expect((0, viis_telemetry_utils_1.applyScaling)('temp', 10, 'read', scaleConfigs)).toBe(20);
    });
    it('should divide value correctly', () => {
        expect((0, viis_telemetry_utils_1.applyScaling)('pressure', 100, 'read', scaleConfigs)).toBe(10);
    });
    it('should return value unchanged if no config found', () => {
        expect((0, viis_telemetry_utils_1.applyScaling)('humidity', 50, 'read', scaleConfigs)).toBe(50);
    });
});
