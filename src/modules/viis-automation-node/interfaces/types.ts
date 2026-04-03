import { NodeDef } from "node-red";
import {
    DeviceIntent,
    DeviceLatestData,
    DeviceAction,
    SchedulePlanAction
} from "../../../core/type";

/**
 * Node configuration definition
 */
export interface ViisAutomationNodeDef extends NodeDef {
    configNode: string;
}

/**
 * Service initialization options
 */
export interface ServiceOptions {
    node: any;
    flowContext: any;
    globalContext: any;
}

/**
 * Intent processing result
 */
export interface IntentProcessingResult {
    id: string;
    schedule_plan_actions: SchedulePlanAction[];
    device_actions: Array<{
        device_id: string;
        key: string;
        value: any;
    }>;
}

/**
 * Automation processing payload
 */
export interface AutomationPayload {
    intents: DeviceIntent[];
    devices_data: DeviceLatestData[];
    results?: IntentProcessingResult[];
}

/**
 * Input message structure
 */
export interface InputMessage {
    payload?: AutomationPayload;
}

/**
 * Output message structure
 */
export interface OutputMessage {
    payload: any;
}

/**
 * MQTT message for intent updates
 */
export interface IntentUpdateMessage {
    method: string;
    params?: any;
}

/**
 * Device credentials from config node
 */
export interface DeviceCredentials {
    id: string;
    accessToken: string;
}
