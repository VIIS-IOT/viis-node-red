import Container, { Service } from 'typedi';
import moment from 'moment';
import { AxiosService } from '../AxiosService';
import configs from '../../configs';
import { TabiotSchedule } from '../../orm/entities/schedule/TabiotSchedule';

@Service()
export class SyncScheduleService extends AxiosService {
    constructor() {
        super({
            baseURL: configs.serverUrl,
            withCredentials: true,
        });
    }

    async logSchedule(body: any) {
        const response: any = await this.instance.post(`/api/v2/scheduleLog`, body, {
            headers: this.getAuthorizationAdminToken(),
            withCredentials: true,
        });
        return { status: response.status, data: response.data } as unknown as Array<string>;
    }

    async syncLocalToServer(body: Partial<TabiotSchedule>) {
        const response: any = await this.instance.post(`/api/v2/scheduleSync/syncLocalToServer`, body, {
            headers: this.getAuthorizationAdminToken(),
            withCredentials: true,
        });
        return { status: response.status, data: response.data } as unknown as Array<string>;
    }

    getAuthorizationAdminToken(tenantId?: string) {
        try {
            if (!tenantId)
                return {
                    Authorization: `Bearer ${configs.bearerAuthThingsboard}`,
                };
            else {
                return {
                    Authorization: `Bearer ${configs.bearerAuthThingsboard}`,
                };
            }
        } catch (error) {
            throw error;
        }
    }

}
