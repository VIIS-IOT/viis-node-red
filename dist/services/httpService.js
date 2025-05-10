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
exports.HttpService = void 0;
const axios_1 = __importDefault(require("axios"));
const typedi_1 = require("typedi");
let HttpService = class HttpService {
    constructor() {
        // Tạo instance của axios với các cấu hình mặc định
        this.axiosInstance = axios_1.default.create({
            baseURL: process.env.API_BASE_URL || '', // Có thể cấu hình từ biến môi trường
            timeout: 10000, // timeout 10 giây
            headers: {
                'Content-Type': 'application/json',
            },
        });
        // Có thể cấu hình interceptor nếu cần
        this.axiosInstance.interceptors.response.use((response) => response, (error) => {
            console.error(`HTTP Error: ${error.message}`);
            return Promise.reject(error);
        });
    }
    get(url, config) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                return yield this.axiosInstance.get(url, config);
            }
            catch (error) {
                throw error;
            }
        });
    }
    post(url, data, config) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                return yield this.axiosInstance.post(url, data, config);
            }
            catch (error) {
                throw error;
            }
        });
    }
    put(url, data, config) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                return yield this.axiosInstance.put(url, data, config);
            }
            catch (error) {
                throw error;
            }
        });
    }
    delete(url, config) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                return yield this.axiosInstance.delete(url, config);
            }
            catch (error) {
                throw error;
            }
        });
    }
};
exports.HttpService = HttpService;
exports.HttpService = HttpService = __decorate([
    (0, typedi_1.Service)(),
    __metadata("design:paramtypes", [])
], HttpService);
