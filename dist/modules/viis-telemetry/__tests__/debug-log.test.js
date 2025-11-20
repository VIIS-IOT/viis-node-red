"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viis_telemetry_utils_1 = require("../viis-telemetry-utils");
describe('debugLog', () => {
    it('should call node.warn if enabled', () => {
        const node = { warn: jest.fn() };
        (0, viis_telemetry_utils_1.debugLog)({ enable: true, node, message: 'debug' });
        expect(node.warn).toHaveBeenCalledWith('debug');
    });
    it('should NOT call node.warn if disabled', () => {
        const node = { warn: jest.fn() };
        (0, viis_telemetry_utils_1.debugLog)({ enable: false, node, message: 'debug' });
        expect(node.warn).not.toHaveBeenCalled();
    });
});
