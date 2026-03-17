import axios, { AxiosResponse } from "axios";
import { GlobalContextHelper } from "../ultils/global-context-helper";
import { DEFAULT_HTTP_SERVER_URL } from "../const";
import { DeviceIntent } from "./type";

export async function sendTelemetryByHttp(
  token: string,
  telemetryData: any,
  context?: any
): Promise<boolean> {
  try {
    // Use GlobalContextHelper to get server URL (hot-reload support)
    const globalHelper = context ? new GlobalContextHelper(context) : null;
    const serverUrl = globalHelper
      ? globalHelper.getEnvVar('VIIS_BACKEND', DEFAULT_HTTP_SERVER_URL)
      : DEFAULT_HTTP_SERVER_URL;

    const response = await axios.post(
      `${serverUrl}/api/v1/${token}/telemetry`,
      telemetryData,
      { headers: { "Content-Type": "application/json" } }
    );
    return true;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      console.error("Error sending telemetry:", error.response.data);
    } else {
      console.error("Error sending telemetry:", error);
    }
    return false;
  }
}

export async function getDeviceIntentsByToken(
  token: string,
  context?: any
): Promise<DeviceIntent[]> {
  try {
    // Use GlobalContextHelper to get server URL (hot-reload support)
    const globalHelper = context ? new GlobalContextHelper(context) : null;
    const serverUrl = globalHelper
      ? globalHelper.getEnvVar('VIIS_BACKEND', DEFAULT_HTTP_SERVER_URL)
      : DEFAULT_HTTP_SERVER_URL;
    console.log(`${serverUrl}/api/v2/device-intent/by-device-token/${token}`)
    const response = await axios.get(
      `${serverUrl}/api/v2/device-intent/by-device-token/${token}`,
      {
        headers: { "Content-Type": "application/json" },
        timeout: 10000 // 10 second timeout
      }
    );
    return response.data.result;
  } catch (error) {
    // Log error but return empty array instead of throwing to prevent crash
    if (axios.isAxiosError(error)) {
      console.error(`Failed to fetch device intents: ${error.message} (network may be down)`);
    } else {
      console.error("Failed to fetch device intents:", error);
    }
    return []; // Return empty array to allow node to continue
  }
}
