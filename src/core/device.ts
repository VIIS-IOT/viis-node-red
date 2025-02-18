import axios, { AxiosResponse } from "axios";
import { httpServerUrl } from "../const";

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
