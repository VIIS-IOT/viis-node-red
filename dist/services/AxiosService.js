"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AxiosService = void 0;
const axios_1 = __importDefault(require("axios"));
class AxiosService {
    constructor(config) {
        this.instance = axios_1.default.create(Object.assign({ timeout: 60000, maxContentLength: 100000000, maxBodyLength: 1000000000 }, config));
    }
}
exports.AxiosService = AxiosService;
