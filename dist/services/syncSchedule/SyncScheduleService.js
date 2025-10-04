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
let SyncScheduleService = class SyncScheduleService extends AxiosService_1.AxiosService {
    constructor(nodeContext) {
        const configs = (0, configs_1.createConfig)(nodeContext);
        super({
            baseURL: configs.serverUrl || "http://localhost:8080", // Default fallback
            withCredentials: true,
        });
        this.configs = configs;
        this.accessToken = configs.deviceAccessToken || "NA";
        console.log("SyncScheduleService constructor called with baseURL:", configs.serverUrl);
    }
    async logSchedule(body) {
        try {
            const fullPath = `${this.instance.defaults.baseURL}/api/v2/scheduleLog/v2?access_token=${this.accessToken}`;
            console.debug("Calling API logSchedule:", fullPath, "with body:", body);
            const response = await this.instance.post(`/api/v2/scheduleLog`, body, {
                withCredentials: true,
            });
            return { status: response.status, data: response.data };
        }
        catch (error) {
            console.error(`Error in logSchedule: ${error.message}`);
            // console.log(error)
            throw error;
        }
    }
    async syncScheduleFromLocalToServer(body) {
        try {
            const fullPath = `${this.instance.defaults.baseURL}/api/v2/scheduleSync/syncLocalToServer/v2?access_token=${this.accessToken}`;
            console.debug("Calling API syncLocalToServer:", fullPath, "with body:", body);
            const response = await this.instance.post(`/api/v2/scheduleSync/syncLocalToServer/v2?access_token=${this.accessToken}`, body, {
                withCredentials: true,
            });
            return { status: response.status, data: response.data };
        }
        catch (error) {
            console.error(`Error in syncLocalToServer: ${error.message}`);
            console.log(error);
            throw error;
        }
    }
    async syncSchedulePlanFromLocalToServer(body) {
        try {
            const fullPath = `${this.instance.defaults.baseURL}/api/v2/schedulePlanSync/syncLocalToServer/v2?access_token=${this.accessToken}`;
            console.debug("Calling API syncLocalToServer:", fullPath, "with body:", body);
            const response = await this.instance.post(`/api/v2/schedulePlanSync/syncLocalToServer/v2?access_token=${this.accessToken}`, body, {
                withCredentials: true,
            });
            return { status: response.status, data: response.data };
        }
        catch (error) {
            console.error(`Error in syncLocalToServer: ${error.message}`);
            console.log(error);
            throw error;
        }
    }
};
exports.SyncScheduleService = SyncScheduleService;
exports.SyncScheduleService = SyncScheduleService = __decorate([
    (0, typedi_1.Service)(),
    __metadata("design:paramtypes", [Object])
], SyncScheduleService);
