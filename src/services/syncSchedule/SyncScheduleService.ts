import Container, { Service } from 'typedi';
import moment from 'moment';
import { AxiosService } from '../AxiosService';
import configs from '../../configs';
import { TabiotSchedule } from '../../orm/entities/schedule/TabiotSchedule';

@Service()
export class SyncScheduleService extends AxiosService {
    private accessToken: string;
    constructor() {
        super({
            baseURL: configs.serverUrl,
            withCredentials: true,
        });
        this.accessToken = process.env.DEVICE_ACCESS_TOKEN || 'NA'
    }

    async logSchedule(body: any) {
        const response: any = await this.instance.post(`/api/v2/scheduleLog`, body, {
            // headers: this.getAuthorizationToken(),
            withCredentials: true,
        });
        return { status: response.status, data: response.data } as unknown as Array<string>;
    }

    async syncLocalToServer(body: Partial<TabiotSchedule>) {
        const response: any = await this.instance.post(`/api/v2/scheduleSync/syncLocalToServer`, body, {
            // headers: this.getAuthorizationToken(),
            withCredentials: true,
        });
        return { status: response.status, data: response.data } as unknown as Array<string>;
    }

    // getAuthorizationToken() {
    //     try {
    //         return {
    //             Authorization: `Bearer ${configs.bearerAuthThingsboard}`,
    //         };
    //     } catch (error) {
    //         throw error;
    //     }
    // }

}
