import { Node } from 'node-red';
import axios, { AxiosInstance } from 'axios';
import {
    IrrigationRun,
    LookupPoint,
    IrrigationFinishedPayload,
    TbLookupTableEntry
} from '../interfaces/types';
import { API_ENDPOINTS, TELEMETRY_KEY_MAP } from '../constants';
import { GlobalContextHelper } from '../../../ultils/global-context-helper';

/**
 * BackendSyncService
 *
 * Handles synchronization with the backend server and ThingsBoard.
 * Provides:
 * - POST irrigation completion to backend
 * - Fetch lookup table from backend
 * - Read/write ThingsBoard shared attributes
 */
export class BackendSyncService {
    private node: Node;
    private deviceId: string;
    private globalHelper: GlobalContextHelper;
    private httpClient: AxiosInstance;
    private backendUrl: string;

    constructor(node: Node, deviceId: string, globalHelper: GlobalContextHelper) {
        this.node = node;
        this.deviceId = deviceId;
        this.globalHelper = globalHelper;

        // Get backend URL from environment
        this.backendUrl = globalHelper.getEnvVar('VIIS_BACKEND', 'https://iot.viis.tech');

        this.httpClient = axios.create({
            baseURL: this.backendUrl,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }

    /**
     * Report irrigation completion to backend
     * This triggers the learning algorithm on the server
     */
    async reportIrrigationFinished(run: IrrigationRun): Promise<boolean> {
        if (!run.end_time) {
            this.error('Cannot report incomplete run');
            return false;
        }

        const payload: IrrigationFinishedPayload = {
            device_id: this.deviceId,
            start_time: run.start_time.toISOString(),
            end_time: run.end_time.toISOString(),
            ec_setpoint: run.ec_setpoint,
            ec_achieved_avg: run.ec_achieved_avg,
            flow_achieved_01_avg: run.flow_achieved_01_avg,
            flow_achieved_02_avg: run.flow_achieved_02_avg,
            flow_achieved_03_avg: run.flow_achieved_03_avg,
            flow_achieved_04_avg: run.flow_achieved_04_avg,
            flow_achieved_05_avg: run.flow_achieved_05_avg,
            time_on_valve_01: run.time_on_valve_01,
            time_on_valve_02: run.time_on_valve_02,
            time_on_valve_03: run.time_on_valve_03,
            time_on_valve_04: run.time_on_valve_04,
            time_on_valve_05: run.time_on_valve_05,
        };

        try {
            const response = await this.httpClient.post(
                API_ENDPOINTS.IRRIGATION_FINISHED,
                payload
            );

            if (response.data?.success) {
                this.log(`Reported irrigation run #${run.id} to backend`);
                return true;
            } else {
                this.warn(`Backend returned unsuccessful response: ${JSON.stringify(response.data)}`);
                return false;
            }
        } catch (error) {
            this.error(`Failed to report irrigation: ${(error as Error).message}`);
            return false;
        }
    }

    /**
     * Fetch lookup table from backend
     */
    async fetchLookupTable(): Promise<LookupPoint[]> {
        const endpoint = API_ENDPOINTS.GET_LOOKUP_TABLE.replace(':deviceId', this.deviceId);

        try {
            const response = await this.httpClient.get(endpoint);

            if (Array.isArray(response.data)) {
                this.log(`Fetched ${response.data.length} lookup points from backend`);
                return response.data.map(this.serverToLookupPoint);
            }

            return [];
        } catch (error) {
            this.error(`Failed to fetch lookup table: ${(error as Error).message}`);
            return [];
        }
    }

    /**
     * Sync multiple unsent runs to backend
     * Returns array of successfully synced run IDs
     */
    async syncPendingRuns(runs: IrrigationRun[]): Promise<number[]> {
        const syncedIds: number[] = [];

        for (const run of runs) {
            if (run.status !== 'Completed') continue;
            if (!run.end_time) continue;

            const success = await this.reportIrrigationFinished(run);
            if (success && run.id) {
                syncedIds.push(run.id);
            }

            // Small delay between requests
            await this.delay(500);
        }

        this.log(`Synced ${syncedIds.length}/${runs.length} pending runs`);
        return syncedIds;
    }

    /**
     * Check if backend is reachable
     */
    async isBackendReachable(): Promise<boolean> {
        try {
            const response = await this.httpClient.get('/health', { timeout: 5000 });
            return response.status === 200;
        } catch {
            return false;
        }
    }

    // ========================================
    // Helper Methods
    // ========================================

    private serverToLookupPoint(data: any): LookupPoint {
        return {
            device_id: data.device_id,
            ec_setpoint: Number(data.ec_setpoint),
            time_on_valve_01: data.time_on_valve_01 || 0,
            time_on_valve_02: data.time_on_valve_02 || 0,
            time_on_valve_03: data.time_on_valve_03 || 0,
            time_on_valve_04: data.time_on_valve_04 || 0,
            time_on_valve_05: data.time_on_valve_05 || 0,
            actual_ec_avg: data.actual_ec_avg ? Number(data.actual_ec_avg) : undefined,
            actual_flow_01: data.actual_flow_01 ? Number(data.actual_flow_01) : undefined,
            actual_flow_02: data.actual_flow_02 ? Number(data.actual_flow_02) : undefined,
            actual_flow_03: data.actual_flow_03 ? Number(data.actual_flow_03) : undefined,
            actual_flow_04: data.actual_flow_04 ? Number(data.actual_flow_04) : undefined,
            actual_flow_05: data.actual_flow_05 ? Number(data.actual_flow_05) : undefined,
            sample_count: data.sample_count || 0,
            data_type: data.data_type || 'Actual',
            last_updated: data.last_updated ? new Date(data.last_updated) : new Date(),
        };
    }

    private tbToLookupPoint(entry: TbLookupTableEntry): LookupPoint {
        return {
            device_id: '', // Will be set by caller
            ec_setpoint: entry.ec_setpoint,
            time_on_valve_01: entry.time_on_valve_01 || 0,
            time_on_valve_02: entry.time_on_valve_02 || 0,
            time_on_valve_03: entry.time_on_valve_03 || 0,
            time_on_valve_04: entry.time_on_valve_04 || 0,
            time_on_valve_05: entry.time_on_valve_05 || 0,
            actual_ec_avg: entry.actual_ec_avg,
            sample_count: entry.sample_count || 0,
            data_type: (entry.data_type as 'Actual' | 'Interpolated') || 'Actual',
            last_updated: new Date(),
        };
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ========================================
    // Logging Helpers
    // ========================================

    private log(message: string): void {
        this.node.log(`[BackendSync] ${message}`);
    }

    private warn(message: string): void {
        this.node.warn(`[BackendSync] ${message}`);
    }

    private error(message: string): void {
        this.node.error(`[BackendSync] ${message}`);
    }
}
