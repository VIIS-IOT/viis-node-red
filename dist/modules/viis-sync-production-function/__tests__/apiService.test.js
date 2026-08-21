"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
jest.mock('axios');
jest.mock('../../../ultils/resolve-backend-url', () => ({
    resolveViisBackendUrl: () => 'http://backend.test',
}));
const axios_1 = __importDefault(require("axios"));
const apiService_1 = require("../services/apiService");
describe('viis-sync-production-function ApiService', () => {
    const mockedPost = axios_1.default.post;
    beforeEach(() => {
        mockedPost.mockReset();
        mockedPost.mockResolvedValue({
            data: {
                result: {
                    success: true,
                    production_functions: [],
                    total: 0,
                },
            },
        });
    });
    it('POSTs Demeter access_token, not the legacy thingsboard_access_token field', async () => {
        const service = new apiService_1.ApiService('mqtt-token-abc', 1, null, false);
        await service.syncProductionFunctions(true);
        expect(mockedPost).toHaveBeenCalledTimes(1);
        const [url, body] = mockedPost.mock.calls[0];
        expect(url).toBe('http://backend.test/api/v2/device/sync-production-functions');
        expect(body).toEqual({ access_token: 'mqtt-token-abc' });
        expect(body).not.toHaveProperty('thingsboard_access_token');
    });
});
