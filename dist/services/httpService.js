"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const global_context_helper_1 = require("../ultils/global-context-helper");
class HttpService {
    constructor(nodeContext) {
        this.nodeContext = nodeContext;
        // Use GlobalContextHelper if nodeContext is available
        const helper = nodeContext ? new global_context_helper_1.GlobalContextHelper(nodeContext) : null;
        const baseURL = helper ?
            helper.getEnvVar('API_BASE_URL', '') :
            (process.env.API_BASE_URL || '');
        // Tạo instance của axios với các cấu hình mặc định
        this.axiosInstance = axios_1.default.create({
            baseURL: baseURL, // Có thể cấu hình từ global context hoặc biến môi trường
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
    async get(url, config) {
        try {
            return await this.axiosInstance.get(url, config);
        }
        catch (error) {
            throw error;
        }
    }
    async post(url, data, config) {
        try {
            return await this.axiosInstance.post(url, data, config);
        }
        catch (error) {
            throw error;
        }
    }
    async put(url, data, config) {
        try {
            return await this.axiosInstance.put(url, data, config);
        }
        catch (error) {
            throw error;
        }
    }
    async delete(url, config) {
        try {
            return await this.axiosInstance.delete(url, config);
        }
        catch (error) {
            throw error;
        }
    }
}
