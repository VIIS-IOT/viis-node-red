"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendTelemetryByHttp = sendTelemetryByHttp;
exports.getDeviceIntentsByToken = getDeviceIntentsByToken;
const axios_1 = __importDefault(require("axios"));
const global_context_helper_1 = require("../ultils/global-context-helper");
const const_1 = require("../const");
async function sendTelemetryByHttp(token, telemetryData, context) {
    try {
        // Use GlobalContextHelper to get server URL (hot-reload support)
        const globalHelper = context ? new global_context_helper_1.GlobalContextHelper(context) : null;
        const serverUrl = globalHelper
            ? globalHelper.getEnvVar('VIIS_BACKEND', const_1.DEFAULT_HTTP_SERVER_URL)
            : const_1.DEFAULT_HTTP_SERVER_URL;
        const response = await axios_1.default.post(`${serverUrl}/api/v1/${token}/telemetry`, telemetryData, { headers: { "Content-Type": "application/json" } });
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
async function getDeviceIntentsByToken(token, context) {
    try {
        // Use GlobalContextHelper to get server URL (hot-reload support)
        const globalHelper = context ? new global_context_helper_1.GlobalContextHelper(context) : null;
        const serverUrl = globalHelper
            ? globalHelper.getEnvVar('VIIS_BACKEND', const_1.DEFAULT_HTTP_SERVER_URL)
            : const_1.DEFAULT_HTTP_SERVER_URL;
        console.log(`${serverUrl}/api/v2/device-intent/by-device-token/${token}`);
        const response = await axios_1.default.get(`${serverUrl}/api/v2/device-intent/by-device-token/${token}`, {
            headers: { "Content-Type": "application/json" },
            timeout: 10000 // 10 second timeout
        });
        return response.data.result;
    }
    catch (error) {
        // Log error but return empty array instead of throwing to prevent crash
        if (axios_1.default.isAxiosError(error)) {
            console.error(`Failed to fetch device intents: ${error.message} (network may be down)`);
        }
        else {
            console.error("Failed to fetch device intents:", error);
        }
        return []; // Return empty array to allow node to continue
    }
}
