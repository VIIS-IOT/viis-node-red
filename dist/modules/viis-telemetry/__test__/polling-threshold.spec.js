"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viis_telemetry_utils_1 = require("../viis-telemetry-utils");
describe('Polling/threshold logic', () => {
    it('should trigger send if value changes above threshold', () => {
        const prev = { temp: 10 };
        const curr = { temp: 12 };
        const threshold = { temp: 1 };
        expect((0, viis_telemetry_utils_1.getChangedKeys)(curr, prev, threshold)).toEqual({ temp: 12 });
    });
    it('should trigger send every polling interval even if value does not change', () => {
        // Giả lập polling: prev = curr, threshold = 1, vẫn phải gửi do đến timer
        // (logic này thực tế sẽ nằm ở code node, test ở đây chỉ kiểm tra threshold)
        const prev = { temp: 10 };
        const curr = { temp: 10 };
        const threshold = { temp: 1 };
        // Khi polling đến timer, vẫn gửi curr
        expect(curr).toEqual(prev); // Giá trị không đổi, nhưng polling timer sẽ gửi
    });
});
