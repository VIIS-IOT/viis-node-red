import { AxiosService } from '../AxiosService';
import { createConfig } from '../../configs';
import { TabiotSchedule } from '../../orm/entities/schedule/TabiotSchedule';
import { Service } from 'typedi';
import { TabiotSchedulePlan } from '../../orm/entities/schedulePlan/TabiotSchedulePlan';
import { NodeContext } from 'node-red';


@Service()
export class SyncScheduleService extends AxiosService {
    private accessToken: string;
    private configs: any;

    constructor(nodeContext?: NodeContext) {
        const configs = createConfig(nodeContext);
        super({
            baseURL: configs.serverUrl || "http://localhost:8080", // Default fallback
            withCredentials: true,
        });
        this.configs = configs;
        this.accessToken = configs.deviceAccessToken || "NA";
        
        // Only warn if token is missing
        if (this.accessToken === "NA") {
            console.warn("⚠️ SyncScheduleService: Access token is 'NA' - check if env-loader is running and nodeContext is passed!");
        }
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

    async syncScheduleFromLocalToServer(body: Partial<TabiotSchedule>[]) {
        try {
            const response: any = await this.instance.post(`/api/v2/scheduleSync/syncLocalToServer/v2?access_token=${this.accessToken}`, body, {
                withCredentials: true,
            });
            return { status: response.status, data: response.data };
        } catch (error) {
            console.error(`Error in syncLocalToServer: ${(error as Error).message}`);
            throw error;
        }
    }


    async syncSchedulePlanFromLocalToServer(body: Partial<TabiotSchedulePlan>[]) {
        try {
            const response: any = await this.instance.post(`/api/v2/schedulePlanSync/syncLocalToServer/v2?access_token=${this.accessToken}`, body, {
                withCredentials: true,
            });
            return { status: response.status, data: response.data };
        } catch (error) {
            console.error(`Error in syncLocalToServer: ${(error as Error).message}`);
            throw error;
        }
    }
}
