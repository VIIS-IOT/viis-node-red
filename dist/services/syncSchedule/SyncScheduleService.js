"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncScheduleService = void 0;
const AxiosService_1 = require("../AxiosService");
const configs_1 = require("../../configs");
const typedi_1 = require("typedi");
const demeter_schedule_protocol_1 = require("../../core/demeter-schedule-protocol");
const resolve_backend_url_1 = require("../../ultils/resolve-backend-url");
let SyncScheduleService = class SyncScheduleService extends AxiosService_1.AxiosService {
    constructor(nodeContext) {
        const configs = (0, configs_1.createConfig)(nodeContext);
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
    tokenQuery() {
        return `access_token=${encodeURIComponent(this.accessToken)}`;
    }
    applyBaseUrl() {
        this.instance.defaults.baseURL = (0, resolve_backend_url_1.resolveViisBackendUrl)(this.nodeContext, undefined, this.configs.serverUrl || 'http://localhost:8080');
    }
    async logSchedule(body) {
        try {
            this.applyBaseUrl();
            const response = await this.instance.post(`/api/v2/scheduleLog/device?${this.tokenQuery()}`, (0, demeter_schedule_protocol_1.toDeviceScheduleLog)(body), { withCredentials: true });
            return { status: response.status, data: response.data };
        }
        catch (error) {
            console.error(`Error in logSchedule: ${error.message}`);
            throw error;
        }
    }
    async syncScheduleFromLocalToServer(body) {
        try {
            this.applyBaseUrl();
            const payload = (body || []).map((row) => (0, demeter_schedule_protocol_1.toDeviceSchedule)(row));
            const response = await this.instance.post(`/api/v2/scheduleSync/device?${this.tokenQuery()}`, payload, { withCredentials: true });
            return { status: response.status, data: response.data };
        }
        catch (error) {
            console.error(`Error in syncLocalToServer: ${error.message}`);
            throw error;
        }
    }
    async syncSchedulePlanFromLocalToServer(body) {
        try {
            this.applyBaseUrl();
            const payload = (body || []).map((row) => (0, demeter_schedule_protocol_1.toDeviceSchedulePlan)(row));
            const response = await this.instance.post(`/api/v2/schedulePlanSync/device?${this.tokenQuery()}`, payload, { withCredentials: true });
            return { status: response.status, data: response.data };
        }
        catch (error) {
            console.error(`Error in syncLocalToServer: ${error.message}`);
            throw error;
        }
    }
};
exports.SyncScheduleService = SyncScheduleService;
exports.SyncScheduleService = SyncScheduleService = __decorate([
    (0, typedi_1.Service)(),
    __metadata("design:paramtypes", [Object])
], SyncScheduleService);
