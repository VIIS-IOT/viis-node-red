"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendTelemetryByHttp = sendTelemetryByHttp;
exports.getDeviceIntentsByToken = getDeviceIntentsByToken;
const axios_1 = __importDefault(require("axios"));
const const_1 = require("../const");
async function sendTelemetryByHttp(token, telemetryData) {
    try {
        const response = await axios_1.default.post(`${const_1.httpServerUrl}/api/v1/${token}/telemetry`, telemetryData, { headers: { "Content-Type": "application/json" } });
        return true;
    }
    catch (error) {
        if (axios_1.default.isAxiosError(error) && error.response) {
            console.error("Error sending telemetry:", error.response.data);
        }
        else {
            console.error("Error sending telemetry:", error);
        }
        return false;
    }
}
async function getDeviceIntentsByToken(token) {
    try {
        const response = await axios_1.default.get(`${const_1.httpServerUrl}/api/v2/device-intent/by-device-token/${token}`, { headers: { "Content-Type": "application/json" } });
        return response.data.result;
    }
    catch (error) {
        throw error;
    }
}
