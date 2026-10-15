"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createScenarioTriggerSender = createScenarioTriggerSender;
/**
 * HTTP transport of scenario trigger events: the same endpoint, retry/backoff and circuit breaker as the
 * schedule executor's event senders (`viis-schedule-executor-service.ts` `sendNotificationToBackend`).
 */
const axios_1 = __importStar(require("axios"));
const resilience_utils_1 = require("../../viis-schedule-executor/resilience-utils");
/** Returns true when the backend accepted the event; never throws. */
function createScenarioTriggerSender(env, logger, options = {}) {
    const { maxRetries = 3, baseDelay = 1000, timeout = 10000 } = options;
    return async (event) => {
        var _a, _b;
        const backendUrl = env.getEnvVar("VIIS_BACKEND", "");
        const deviceAccessToken = env.getEnvVar("DEVICE_ACCESS_TOKEN", "");
        if (!backendUrl || !deviceAccessToken) {
            logger.warn("[SCENARIO-EVENT] skipped: missing VIIS_BACKEND or DEVICE_ACCESS_TOKEN");
            return false;
        }
        const url = `${backendUrl}/api/v2/alarm/notification-by-token`;
        try {
            await (0, resilience_utils_1.executeWithResilience)(async () => {
                const response = await axios_1.default.post(url, event, {
                    params: { device_access_token: deviceAccessToken },
                    headers: { "Content-Type": "application/json" },
                    timeout,
                });
                if (response.status !== 200 && response.status !== 201) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                return response.data;
            }, {
                maxRetries,
                baseDelay,
                maxDelay: 10000,
                timeout,
                circuitBreakerKey: "backend-notification",
                circuitBreakerThreshold: 5,
                circuitBreakerTimeout: 30000,
            });
            logger.log(`[SCENARIO-EVENT] sent ${event.message_params.scenarioId} trigger ${event.message_params.triggerId} (${event.message_params.result})`);
            return true;
        }
        catch (error) {
            const message = error instanceof axios_1.AxiosError
                ? `${error.message} (${((_a = error.response) === null || _a === void 0 ? void 0 : _a.status) || "N/A"})`
                : (_b = error === null || error === void 0 ? void 0 : error.message) !== null && _b !== void 0 ? _b : String(error);
            logger.warn(`[SCENARIO-EVENT] send failed ${event.message_params.scenarioId}: ${message}`);
            return false;
        }
    };
}
