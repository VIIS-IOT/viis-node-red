jest.mock('axios');
jest.mock('../../../ultils/resolve-backend-url', () => ({
    resolveViisBackendUrl: () => 'http://backend.test',
}));

import axios from 'axios';
import { ApiService } from '../services/apiService';

describe('viis-sync-production-function ApiService', () => {
    const mockedPost = axios.post as jest.Mock;

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
        const service = new ApiService('mqtt-token-abc', 1, null, false);
        await service.syncProductionFunctions(true);

        expect(mockedPost).toHaveBeenCalledTimes(1);
        const [url, body] = mockedPost.mock.calls[0];
        expect(url).toBe('http://backend.test/api/v2/device/sync-production-functions');
        expect(body).toEqual({ access_token: 'mqtt-token-abc' });
        expect(body).not.toHaveProperty('thingsboard_access_token');
    });
});
