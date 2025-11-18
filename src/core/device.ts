import axios, { AxiosResponse } from "axios";
import { httpServerUrl } from "../const";
import { DeviceIntent } from "./type";

export async function sendTelemetryByHttp(
  token: string,
  telemetryData: any
): Promise<boolean> {
  try {
    const response = await axios.post(
      `${httpServerUrl}/api/v1/${token}/telemetry`,
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
  token: string
): Promise<DeviceIntent[]> {
  try {
    const response = await axios.get(
      `${httpServerUrl}/api/v2/device-intent/by-device-token/${token}`,
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
