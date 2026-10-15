/**
 * HTTP transport of scenario trigger events: the same endpoint, retry/backoff and circuit breaker as the
 * schedule executor's event senders (`viis-schedule-executor-service.ts` `sendNotificationToBackend`).
 */
import axios, { AxiosError } from "axios";
import { executeWithResilience } from "../../viis-schedule-executor/resilience-utils";
import { ScenarioTriggeredEvent } from "./scenarioTriggerEvents";
import { ScenarioTriggerLogger } from "./scenarioTriggerTracker";

export interface EnvReader {
    getEnvVar(name: string, defaultValue?: any): any;
}

export interface ScenarioSenderOptions {
    maxRetries?: number;
    baseDelay?: number;
    timeout?: number;
}

/** Returns true when the backend accepted the event; never throws. */
export function createScenarioTriggerSender(
    env: EnvReader,
    logger: ScenarioTriggerLogger,
    options: ScenarioSenderOptions = {}
): (event: ScenarioTriggeredEvent) => Promise<boolean> {
    const { maxRetries = 3, baseDelay = 1000, timeout = 10000 } = options;

    return async (event: ScenarioTriggeredEvent): Promise<boolean> => {
        const backendUrl = env.getEnvVar("VIIS_BACKEND", "");
        const deviceAccessToken = env.getEnvVar("DEVICE_ACCESS_TOKEN", "");
        if (!backendUrl || !deviceAccessToken) {
            logger.warn("[SCENARIO-EVENT] skipped: missing VIIS_BACKEND or DEVICE_ACCESS_TOKEN");
            return false;
        }
        const url = `${backendUrl}/api/v2/alarm/notification-by-token`;
        try {
            await executeWithResilience(
                async () => {
                    const response = await axios.post(url, event, {
                        params: { device_access_token: deviceAccessToken },
                        headers: { "Content-Type": "application/json" },
                        timeout,
                    });
                    if (response.status !== 200 && response.status !== 201) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    return response.data;
                },
                {
                    maxRetries,
                    baseDelay,
                    maxDelay: 10000,
                    timeout,
                    circuitBreakerKey: "backend-notification",
                    circuitBreakerThreshold: 5,
                    circuitBreakerTimeout: 30000,
                }
            );
            logger.log(
                `[SCENARIO-EVENT] sent ${event.message_params.scenarioId} trigger ${event.message_params.triggerId} (${event.message_params.result})`
            );
            return true;
        } catch (error) {
            const message = error instanceof AxiosError
                ? `${error.message} (${error.response?.status || "N/A"})`
                : (error as Error)?.message ?? String(error);
            logger.warn(`[SCENARIO-EVENT] send failed ${event.message_params.scenarioId}: ${message}`);
            return false;
        }
    };
}
