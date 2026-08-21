import { AxiosService } from '../AxiosService';
import { createConfig } from '../../configs';
import { TabiotSchedule } from '../../orm/entities/schedule/TabiotSchedule';
import { Service } from 'typedi';
import { TabiotSchedulePlan } from '../../orm/entities/schedulePlan/TabiotSchedulePlan';
import { NodeContext } from 'node-red';
import {
    toDeviceSchedule,
    toDeviceScheduleLog,
    toDeviceSchedulePlan,
} from '../../core/demeter-schedule-protocol';
import { resolveViisBackendUrl } from '../../ultils/resolve-backend-url';


@Service()
export class SyncScheduleService extends AxiosService {
    private accessToken: string;
    private configs: any;
    private nodeContext?: NodeContext;

    constructor(nodeContext?: NodeContext) {
        const configs = createConfig(nodeContext);
        super({
            baseURL: configs.serverUrl || "http://localhost:8080", // Default fallback
            withCredentials: true,
        });
        this.configs = configs;
        this.nodeContext = nodeContext;
        this.accessToken = configs.deviceAccessToken || "NA";
        
        // Only warn if token is missing
        if (this.accessToken === "NA") {
            console.warn("⚠️ SyncScheduleService: Access token is 'NA' - check if env-loader is running and nodeContext is passed!");
        }
    }

    private tokenQuery(): string {
        return `access_token=${encodeURIComponent(this.accessToken)}`;
    }

    private applyBaseUrl(): void {
        this.instance.defaults.baseURL = resolveViisBackendUrl(this.nodeContext, undefined, this.configs.serverUrl || 'http://localhost:8080');
    }

    async logSchedule(body: any) {
        try {
            this.applyBaseUrl();
            const response: any = await this.instance.post(
                `/api/v2/scheduleLog/device?${this.tokenQuery()}`,
                toDeviceScheduleLog(body),
                { withCredentials: true },
            );
            return { status: response.status, data: response.data };
        } catch (error) {
            console.error(`Error in logSchedule: ${(error as Error).message}`);
            throw error;
        }
    }

    async syncScheduleFromLocalToServer(body: Partial<TabiotSchedule>[]) {
        try {
            this.applyBaseUrl();
            const payload = (body || []).map((row) => toDeviceSchedule(row));
            const response: any = await this.instance.post(
                `/api/v2/scheduleSync/device?${this.tokenQuery()}`,
                payload,
                { withCredentials: true },
            );
            return { status: response.status, data: response.data };
        } catch (error) {
            console.error(`Error in syncLocalToServer: ${(error as Error).message}`);
            throw error;
        }
    }


    async syncSchedulePlanFromLocalToServer(body: Partial<TabiotSchedulePlan>[]) {
        try {
            this.applyBaseUrl();
            const payload = (body || []).map((row) => toDeviceSchedulePlan(row));
            const response: any = await this.instance.post(
                `/api/v2/schedulePlanSync/device?${this.tokenQuery()}`,
                payload,
                { withCredentials: true },
            );
            return { status: response.status, data: response.data };
        } catch (error) {
            console.error(`Error in syncLocalToServer: ${(error as Error).message}`);
            throw error;
        }
    }
}
