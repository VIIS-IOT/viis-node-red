import { randomUUID } from "crypto";
import { BrokerRole, OperationContext, RpcIngress, TraceContext } from "./types";

export const createId = (): string => randomUUID();

export function extractBusinessRequestId(payload: any): { id?: string; source?: string; invalid?: string } {
    const candidates: Array<[string, unknown]> = [
        ["params.requestId", payload?.params?.requestId],
        ["params.request_id", payload?.params?.request_id],
        ["request_id", payload?.request_id],
        ["requestId", payload?.requestId],
    ];
    for (const [source, value] of candidates) {
        if (value === undefined || value === null || value === "") continue;
        if (typeof value !== "string" || value.length > 128 || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) {
            return { invalid: source };
        }
        return { id: value, source };
    }
    return {};
}

export function createTraceContext(args: {
    runtimeBootId: string;
    nodeId: string;
    nodeInstanceId: string;
    deviceId?: string;
    ingress: RpcIngress;
    brokerRole: BrokerRole;
    payload?: unknown;
    topic?: string;
    nodeRedMessageId?: string;
    duplicateOfTraceId?: string;
    traceId?: string;
}): TraceContext {
    const requestMatch = args.topic?.match(/^v1\/devices\/me\/rpc\/request\/([^/]+)$/);
    const businessId = extractBusinessRequestId(args.payload);
    return {
        runtimeBootId: args.runtimeBootId,
        nodeId: args.nodeId,
        nodeInstanceId: args.nodeInstanceId,
        ...(args.deviceId ? { deviceId: args.deviceId.slice(0, 128) } : {}),
        traceId: args.traceId || createId(),
        ingress: args.ingress,
        brokerRole: args.brokerRole,
        ...(requestMatch ? { mqttRequestId: requestMatch[1].slice(0, 128) } : {}),
        ...(args.nodeRedMessageId ? { nodeRedMessageId: args.nodeRedMessageId.slice(0, 128) } : {}),
        ...(businessId.id ? { businessRequestId: businessId.id, businessRequestIdSource: businessId.source } : {}),
        ...(args.duplicateOfTraceId ? { duplicateOfTraceId: args.duplicateOfTraceId } : {}),
    };
}

export function attachBusinessRequestId(context: TraceContext, payload: unknown): { context: TraceContext; invalidSource?: string } {
    const businessId = extractBusinessRequestId(payload);
    if (businessId.id) {
        return { context: { ...context, businessRequestId: businessId.id, businessRequestIdSource: businessId.source } };
    }
    return { context, ...(businessId.invalid ? { invalidSource: businessId.invalid } : {}) };
}

export function createOperationContext(context: TraceContext, values: Partial<OperationContext> = {}): OperationContext {
    return { ...context, ...values, operationId: values.operationId || createId() };
}
