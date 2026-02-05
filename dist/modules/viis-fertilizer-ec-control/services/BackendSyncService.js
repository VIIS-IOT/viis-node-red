"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BackendSyncService = void 0;
const axios_1 = __importDefault(require("axios"));
const constants_1 = require("../constants");
/**
 * BackendSyncService
 *
 * Handles synchronization with the backend server and ThingsBoard.
 * Provides:
 * - POST irrigation completion to backend
 * - Fetch lookup table from backend
 * - Read/write ThingsBoard shared attributes
 */
class BackendSyncService {
    constructor(node, deviceId, globalHelper) {
        this.node = node;
        this.deviceId = deviceId;
        this.globalHelper = globalHelper;
        // Get backend URL from environment
        this.backendUrl = globalHelper.getEnvVar('VIIS_BACKEND', 'https://iot.viis.tech');
        this.httpClient = axios_1.default.create({
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
    async reportIrrigationFinished(run) {
        var _a;
        if (!run.end_time) {
            this.error('Cannot report incomplete run');
            return false;
        }
        const payload = {
            device_id: this.deviceId,
            start_time: run.start_time.toISOString(),
            end_time: run.end_time.toISOString(),
            ec_setpoint: run.ec_setpoint,
            time_on_valve_01: run.time_on_valve_01,
            time_on_valve_02: run.time_on_valve_02,
            time_on_valve_03: run.time_on_valve_03,
            time_on_valve_04: run.time_on_valve_04,
            time_on_valve_05: run.time_on_valve_05,
        };
        try {
            const response = await this.httpClient.post(constants_1.API_ENDPOINTS.IRRIGATION_FINISHED, payload);
            if ((_a = response.data) === null || _a === void 0 ? void 0 : _a.success) {
                this.log(`Reported irrigation run #${run.id} to backend`);
                return true;
            }
            else {
                this.warn(`Backend returned unsuccessful response: ${JSON.stringify(response.data)}`);
                return false;
            }
        }
        catch (error) {
            this.error(`Failed to report irrigation: ${error.message}`);
            return false;
        }
    }
    /**
     * Fetch lookup table from backend
     */
    async fetchLookupTable() {
        const endpoint = constants_1.API_ENDPOINTS.GET_LOOKUP_TABLE.replace(':deviceId', this.deviceId);
        try {
            const response = await this.httpClient.get(endpoint);
            if (Array.isArray(response.data)) {
                this.log(`Fetched ${response.data.length} lookup points from backend`);
                return response.data.map(this.serverToLookupPoint);
            }
            return [];
        }
        catch (error) {
            this.error(`Failed to fetch lookup table: ${error.message}`);
            return [];
        }
    }
    /**
     * Sync multiple unsent runs to backend
     * Returns array of successfully synced run IDs
     */
    async syncPendingRuns(runs) {
        const syncedIds = [];
        for (const run of runs) {
            if (run.status !== 'Completed')
                continue;
            if (!run.end_time)
                continue;
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
    async isBackendReachable() {
        try {
            const response = await this.httpClient.get('/health', { timeout: 5000 });
            return response.status === 200;
        }
        catch (_a) {
            return false;
        }
    }
    // ========================================
    // Helper Methods
    // ========================================
    serverToLookupPoint(data) {
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
    tbToLookupPoint(entry) {
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
            data_type: entry.data_type || 'Actual',
            last_updated: new Date(),
        };
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    // ========================================
    // Logging Helpers
    // ========================================
    log(message) {
        this.node.log(`[BackendSync] ${message}`);
    }
    warn(message) {
        this.node.warn(`[BackendSync] ${message}`);
    }
    error(message) {
        this.node.error(`[BackendSync] ${message}`);
    }
}
exports.BackendSyncService = BackendSyncService;
