import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { Service } from 'typedi';

@Service()
export class HttpService {
    private axiosInstance: AxiosInstance;

    constructor() {
        // Tạo instance của axios với các cấu hình mặc định
        this.axiosInstance = axios.create({
            baseURL: process.env.API_BASE_URL || '', // Có thể cấu hình từ biến môi trường
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
