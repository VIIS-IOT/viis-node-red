import { DiagnosticRuntime, makeDiagnosticEvent } from "../runtime";

describe("diagnostic event safety", () => {
    test("emits one process boot event before the first application event", () => {
        const runtime = new DiagnosticRuntime({ VIIS_DIAGNOSTICS_ENABLED: "false" });
        (runtime as any).enabled = true;
        const logger = jest.fn();
        const node = { id: "node-1", log: logger };
        runtime.emit(node, "rpc", "info", "rpc.received", { traceId: "trace-1" });
        runtime.emit(node, "rpc", "info", "rpc.accepted", { traceId: "trace-1" });
        const events = logger.mock.calls.map(([line]) => JSON.parse(line.replace("[VIIS-DIAG] ", "")).event);
        expect(events).toEqual(["runtime.started", "rpc.received", "rpc.accepted"]);
    });

    test("redacts secret fields and credential-bearing MQTT URLs", () => {
        const event = makeDiagnosticEvent({
            level: "error",
            event: "mqtt.publish_failed",
            component: "mqtt",
            fields: {
                token: "device-secret",
                broker: "mqtt://user:password@host:1883?token=abc",
                error: { message: "failed" },
            },
        });
        const json = JSON.stringify(event);
        expect(json).not.toContain("device-secret");
        expect(json).not.toContain("user:password");
        expect(json).not.toContain("token=abc");
        expect(event.token).toBe("[redacted]");
    });

    test("redacts credentials embedded in nested error messages", () => {
        const event = makeDiagnosticEvent({
            level: "error",
            event: "mqtt.connection_error",
            component: "mqtt",
            fields: {
                error: {
                    message: "Authorization: Bearer abc.def password=hunter2 apiKey: key-value",
                    cause: { message: "token=child-secret" },
                },
            },
        });
        const json = JSON.stringify(event);
        for (const secret of ["abc.def", "hunter2", "key-value", "child-secret"]) expect(json).not.toContain(secret);
    });

    test("keeps oversized input valid JSON and below the event limit", () => {
        const event = makeDiagnosticEvent({
            level: "info",
            event: "rpc.received",
            component: "rpc",
            fields: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`safeSummary${index}`, "x".repeat(512)])),
        });
        expect(event.truncated).toBe(true);
        expect(Buffer.byteLength(JSON.stringify(event), "utf8")).toBeLessThanOrEqual(4096);
        expect(() => JSON.parse(JSON.stringify(event))).not.toThrow();
    });
});
