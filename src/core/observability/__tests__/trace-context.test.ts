import { attachBusinessRequestId, createTraceContext, extractBusinessRequestId } from "../trace-context";

describe("RPC trace context", () => {
    const base = {
        runtimeBootId: "boot",
        nodeId: "node",
        nodeInstanceId: "instance",
        ingress: "mqtt" as const,
        brokerRole: "thingsboard" as const,
    };

    test("uses existing request IDs without mutating RPC payload", () => {
        const payload = { method: "set_state", params: { requestId: "mobile-42", valve: true } };
        const before = JSON.stringify(payload);
        const context = createTraceContext({ ...base, payload, topic: "v1/devices/me/rpc/request/18" });
        expect(context.businessRequestId).toBe("mobile-42");
        expect(context.businessRequestIdSource).toBe("params.requestId");
        expect(context.mqttRequestId).toBe("18");
        expect(context.traceId).not.toBe("18");
        expect(JSON.stringify(payload)).toBe(before);
    });

    test("supports backend batch ID spelling and rejects unsafe IDs", () => {
        expect(extractBusinessRequestId({ params: { request_id: "batch:7" } }).id).toBe("batch:7");
        expect(extractBusinessRequestId({ params: { requestId: "id\nsecret" } }).invalid).toBe("params.requestId");
    });

    test("keeps an ingress trace ID while adding request metadata after parsing", () => {
        const context = createTraceContext({ ...base, ingress: "node_input", brokerRole: "none" });
        const attached = attachBusinessRequestId(context, { requestId: "input-9" });
        expect(attached.context.traceId).toBe(context.traceId);
        expect(attached.context.businessRequestId).toBe("input-9");
    });
});
