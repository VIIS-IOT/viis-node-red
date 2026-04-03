"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viis_telemetry_utils_1 = require("../viis-telemetry-utils");
describe('publishTelemetry', () => {
    it('should publish to both EMQX and Thingsboard with correct topic and payload', () => {
        const emqxClient = { publish: jest.fn() };
        const tbClient = { publish: jest.fn() };
        const data = { temp: 25, status: 'ok' };
        (0, viis_telemetry_utils_1.publishTelemetry)({
            data,
            emqxClient,
            thingsboardClient: tbClient,
            emqxTopic: 'emqx/topic',
            thingsboardTopic: 'tb/topic'
        });
        const payload = JSON.stringify(data);
        expect(emqxClient.publish).toHaveBeenCalledWith('emqx/topic', payload);
        expect(tbClient.publish).toHaveBeenCalledWith('tb/topic', payload);
    });
});
