import axios, { AxiosInstance, CreateAxiosDefaults } from 'axios';

export class AxiosService {
    instance: AxiosInstance;
    constructor(config?: CreateAxiosDefaults) {
        this.instance = axios.create({
            timeout: 60000,
            maxContentLength: 100000000,
            maxBodyLength: 1000000000,
            ...config,
        });
    }
}
