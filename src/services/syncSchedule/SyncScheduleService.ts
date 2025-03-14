import { AxiosService } from '../AxiosService';
import configs from '../../configs';
import { TabiotSchedule } from '../../orm/entities/schedule/TabiotSchedule';
import { Service } from 'typedi';


@Service()
export class SyncScheduleService extends AxiosService {
    private accessToken: string;

    constructor() {
        super({
            baseURL: configs.serverUrl || "http://localhost:8080", // Default fallback
            withCredentials: true,
        });
        this.accessToken = process.env.DEVICE_ACCESS_TOKEN || "NA";
        console.log("SyncScheduleService constructor called with baseURL:", configs.serverUrl);
    }

    async logSchedule(body: any) {
        try {
            const response: any = await this.instance.post(`/api/v2/scheduleLog`, body, {
                withCredentials: true,
            });
            return { status: response.status, data: response.data };
        } catch (error) {
            console.error(`Error in logSchedule: ${(error as Error).message}`);
            throw error;
        }
    }

    async syncLocalToServer(body: Partial<TabiotSchedule>) {
        try {
            const response: any = await this.instance.post(`/api/v2/scheduleSync/syncLocalToServer`, body, {
                withCredentials: true,
            });
            return { status: response.status, data: response.data };
        } catch (error) {
            console.error(`Error in syncLocalToServer: ${(error as Error).message}`);
            throw error;
        }
    }
}
