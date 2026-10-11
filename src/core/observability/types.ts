export type DiagnosticLevel = "debug" | "info" | "warn" | "error";

export type BrokerRole = "thingsboard" | "local" | "none";
export type RpcIngress = "mqtt" | "node_input";

export interface TraceContext {
    runtimeBootId: string;
    nodeId: string;
    nodeInstanceId: string;
    deviceId?: string;
    traceId: string;
    ingress: RpcIngress;
    brokerRole: BrokerRole;
    mqttRequestId?: string;
    nodeRedMessageId?: string;
    businessRequestId?: string;
    businessRequestIdSource?: string;
    duplicateOfTraceId?: string;
}

export interface OperationContext extends TraceContext {
    operationId: string;
    parentOperationId?: string;
    commandIndex?: number;
    executionIndex?: number;
    batchId?: string;
    boardId?: string;
    unitId?: number;
    functionCode?: number;
    address?: number;
    /**
     * Epoch ms after which a Modbus write made for this operation must not be sent
     * anymore (still queued or between retries). Set from the RPC deadline so an
     * expired RPC never writes to the device late.
     */
    deadline?: number;
}

export interface DiagnosticEvent {
    schemaVersion: 1;
    ts: string;
    level: DiagnosticLevel;
    event: string;
    component: string;
    [field: string]: unknown;
}

export interface DiagnosticSinkStatus {
    status: "healthy" | "degraded" | "disabled";
    droppedEvents: number;
    queuedBytes: number;
    lastErrorAt?: string;
}
