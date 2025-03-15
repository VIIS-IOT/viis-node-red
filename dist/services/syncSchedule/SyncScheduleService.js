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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncScheduleService = void 0;
const AxiosService_1 = require("../AxiosService");
const configs_1 = __importDefault(require("../../configs"));
const typedi_1 = require("typedi");
let SyncScheduleService = class SyncScheduleService extends AxiosService_1.AxiosService {
    constructor() {
        super({
            baseURL: configs_1.default.serverUrl || "http://localhost:8080", // Default fallback
            withCredentials: true,
        });
        this.accessToken = process.env.DEVICE_ACCESS_TOKEN || "NA";
        console.log("SyncScheduleService constructor called with baseURL:", configs_1.default.serverUrl);
    }
    logSchedule(body) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const fullPath = `${this.instance.defaults.baseURL}/api/v2/scheduleLog`;
                console.debug("Calling API logSchedule:", fullPath, "with body:", body);
                const response = yield this.instance.post(`/api/v2/scheduleLog`, body, {
                    withCredentials: true,
                });
                return { status: response.status, data: response.data };
            }
            catch (error) {
                console.error(`Error in logSchedule: ${error.message}`);
                // console.log(error)
                throw error;
            }
        });
    }
    syncLocalToServer(body) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const fullPath = `${this.instance.defaults.baseURL}/api/v2/scheduleSync/syncLocalToServer`;
                console.debug("Calling API syncLocalToServer:", fullPath, "with body:", body);
                const response = yield this.instance.post(`/api/v2/scheduleSync/syncLocalToServer`, body, {
                    withCredentials: true,
                });
                return { status: response.status, data: response.data };
            }
            catch (error) {
                console.error(`Error in syncLocalToServer: ${error.message}`);
                console.log(error);
                throw error;
            }
        });
    }
};
exports.SyncScheduleService = SyncScheduleService;
exports.SyncScheduleService = SyncScheduleService = __decorate([
    (0, typedi_1.Service)(),
    __metadata("design:paramtypes", [])
], SyncScheduleService);
