import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { NodeContext } from "node-red";
import { GlobalContextHelper } from "../ultils/global-context-helper";

class HttpService {
    private axiosInstance: AxiosInstance;
    private nodeContext?: NodeContext;

    constructor(nodeContext?: NodeContext) {
        this.nodeContext = nodeContext;
        
        // Use GlobalContextHelper if nodeContext is available
        const helper = nodeContext ? new GlobalContextHelper(nodeContext) : null;
        const baseURL = helper ? 
            helper.getEnvVar('API_BASE_URL', '') : 
            (process.env.API_BASE_URL || '');
        
        // Tạo instance của axios với các cấu hình mặc định
        this.axiosInstance = axios.create({
            baseURL: baseURL, // Có thể cấu hình từ global context hoặc biến môi trường
            timeout: 10000, // timeout 10 giây
            headers: {
                'Content-Type': 'application/json',
            },
        });

        // Có thể cấu hình interceptor nếu cần
        this.axiosInstance.interceptors.response.use(
            (response) => response,
            (error) => {
                console.error(`HTTP Error: ${error.message}`);
                return Promise.reject(error);
            }
        );
    }

    async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
        try {
            return await this.axiosInstance.get<T>(url, config);
        } catch (error) {
            throw error;
        }
    }

    async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
        try {
            return await this.axiosInstance.post<T>(url, data, config);
        } catch (error) {
            throw error;
        }
    }

    async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
        try {
            return await this.axiosInstance.put<T>(url, data, config);
        } catch (error) {
            throw error;
        }
    }

    async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
        try {
            return await this.axiosInstance.delete<T>(url, config);
        } catch (error) {
            throw error;
        }
    }
}
