import axios, { AxiosResponse } from "axios";
import { GlobalContextHelper } from "../ultils/global-context-helper";
import { DEFAULT_HTTP_SERVER_URL } from "../const";
import { DeviceIntent } from "./type";

/** Masks the device token in an error message that may quote the request URL. */
function maskToken(text: string, token: string): string {
  return token ? text.split(token).join("***") : text;
}

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
      // With no response, the error object carries the request URL (config.url, request.path, input),
      // and that URL contains the device token. Log the message only.
      console.error("Error sending telemetry:", error instanceof Error ? error.message : String(error));
    }
    return false;
  }
}

/**
 * The device's intents as the backend lists them. An array (possibly empty) is the server's authoritative
 * answer; `null` means the fetch failed and callers must keep their cached intents (the gateway clears its
 * local OFFLINE intents when the list holds none, so a failure must never look like an empty list).
 */
export async function getDeviceIntentsByToken(
  token: string,
  context?: any
): Promise<DeviceIntent[] | null> {
  try {
    // Use GlobalContextHelper to get server URL (hot-reload support)
    const globalHelper = context ? new GlobalContextHelper(context) : null;
    const serverUrl = globalHelper
      ? globalHelper.getEnvVar('VIIS_BACKEND', DEFAULT_HTTP_SERVER_URL)
      : DEFAULT_HTTP_SERVER_URL;
    const intentsPath = `${serverUrl}/api/v2/device-intent/by-device-token`;
    // The token is the device's credential: request with it, log without it.
    console.log(`${intentsPath}/***`);
    const response = await axios.get(
      `${intentsPath}/${token}`,
      {
        headers: { "Content-Type": "application/json" },
        timeout: 10000 // 10 second timeout
      }
    );
    const body = response.data;
    if (body && typeof body === "object" && Array.isArray(body.result)) return body.result;
    // A device without intents gets the empty envelope `{}` (the controller returns nothing).
    if (body && typeof body === "object" && (body.result === undefined || body.result === null)) return [];
    console.error("Failed to fetch device intents: the response is not an intent list");
    return null;
  } catch (error) {
    // Log the failure and return null (not []) so callers keep their cached intents
    if (axios.isAxiosError(error)) {
      console.error(`Failed to fetch device intents: ${maskToken(error.message, token)} (network may be down)`);
    } else {
      // Not an AxiosError (e.g. Node's "Invalid URL" TypeError for a malformed VIIS_BACKEND): the error
      // object carries the request URL in `input`, and that URL contains the device token. Message only.
      console.error("Failed to fetch device intents:", maskToken(error instanceof Error ? error.message : String(error), token));
    }
    return null;
  }
}
