import { DiagnosticLogger } from "../../../../core/observability/diagnostic-logger";
import { MessageHandler } from "../messageHandler";

describe("MessageHandler RPC ingress diagnostics", () => {
    const events: Array<{ event: string; fields: Record<string, unknown> }> = [];
    let diagnosticSpy: jest.SpyInstance;
    let handler: MessageHandler;

    beforeEach(() => {
        events.length = 0;
        diagnosticSpy = jest.spyOn(DiagnosticLogger.prototype, "emit").mockImplementation(function (level: any, event: string, fields: any = {}) {
            events.push({ event, fields });
        });
        const node = { id: "rpc-test-node", log: jest.fn(), warn: jest.fn(), error: jest.fn() };
        handler = new MessageHandler({ node, flowContext: {}, globalContext: {} });
    });

    afterEach(() => {
        handler.clearProcessedMessages();
        diagnosticSpy.mockRestore();
    });

    test("correlates receipt and acceptance and reports duplicate lineage", async () => {
        const payload = { method: "set_state", params: { requestId: "mobile-77", valve: true } };
        const process = jest.fn().mockResolvedValue(undefined);
        const message = { topic: "v1/devices/me/rpc/request/9", message: JSON.stringify(payload), qos: 1, retain: false };

        await handler.processMqttMessage(message, "v1/devices/me/rpc/request/+", process);
        await handler.processMqttMessage(message, "v1/devices/me/rpc/request/+", process);

        expect(process).toHaveBeenCalledTimes(1);
        const received = events.find(item => item.event === "rpc.received")!;
        const accepted = events.find(item => item.event === "rpc.accepted")!;
        const duplicate = events.find(item => item.event === "rpc.duplicate")!;
        expect(received.fields.traceId).toBe(accepted.fields.traceId);
        expect(accepted.fields.businessRequestId).toBe("mobile-77");
        expect(duplicate.fields.duplicateOfTraceId).toBe(received.fields.traceId);
    });

    test("rejects malformed JSON and mismatched topics with explicit disposition", () => {
        expect(() => handler.processMqttMessage(
            { topic: "v1/devices/me/rpc/request/10", message: "{broken" },
            "v1/devices/me/rpc/request/+",
            jest.fn(),
        )).toThrow("Invalid MQTT JSON payload");

        handler.processMqttMessage(
            { topic: "v1/devices/me/telemetry", message: "{}" },
            "v1/devices/me/rpc/request/+",
            jest.fn(),
        );
        expect(events.filter(item => item.event === "rpc.rejected").length).toBe(1);
        expect(events.filter(item => item.event === "rpc.parse_failed").length).toBe(1);
    });
});
