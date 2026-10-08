import { DiagnosticLogger } from "../../../../core/observability/diagnostic-logger";
import { createTraceContext } from "../../../../core/observability/trace-context";
import { OperationContext } from "../../../../core/observability/types";
import { runtimeBootId } from "../../../../core/observability/runtime";
import { MqttService } from "../mqttService";

describe("MqttService tracked publish", () => {
    let events: Array<{ event: string; fields: Record<string, unknown> }>;
    let diagnosticSpy: jest.SpyInstance;
    let node: any;
    let context: OperationContext;

    beforeEach(() => {
        jest.useFakeTimers();
        events = [];
        diagnosticSpy = jest.spyOn(DiagnosticLogger.prototype, "emit").mockImplementation(function (level: any, event: string, fields: any = {}) {
            events.push({ event, fields });
        });
        node = { id: "mqtt-test-node", send: jest.fn(), status: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
        context = {
            ...createTraceContext({
                runtimeBootId,
                nodeId: node.id,
                nodeInstanceId: "instance",
                ingress: "mqtt",
                brokerRole: "thingsboard",
            }),
            operationId: "write-operation",
        };
    });

    afterEach(() => {
        diagnosticSpy.mockRestore();
        jest.useRealTimers();
    });

    test("publish rejection is returned once and never sends node output", async () => {
        const publish = jest.fn().mockRejectedValue(Object.assign(new Error("offline"), { code: "ECONNRESET" }));
        const service = new MqttService({ node } as any, { publish, getPublishAcknowledgement: () => "mqtt_puback" }, "telemetry/topic");

        const result = await service.publishResultImmediateTracked("valve", true, context);

        expect(result.status).toBe("failed");
        expect(publish).toHaveBeenCalledTimes(1);
        expect(node.send).not.toHaveBeenCalled();
        expect(events.some(item => item.event === "mqtt.publish_failed")).toBe(true);
    });

    test("debounce replacement settles the older ticket as superseded", async () => {
        const publish = jest.fn().mockResolvedValue(undefined);
        const service = new MqttService({ node } as any, { publish, getPublishAcknowledgement: () => "mqtt_puback" }, "telemetry/topic");
        const first = service.scheduleResultTracked("valve", false, context);
        const second = service.scheduleResultTracked("valve", true, context);

        await expect(first.completion).resolves.toMatchObject({ status: "superseded" });
        await jest.advanceTimersByTimeAsync(200);
        await expect(second.completion).resolves.toMatchObject({ status: "acknowledged", acknowledgement: "mqtt_puback" });
        expect(publish).toHaveBeenCalledTimes(1);
        expect(node.send).toHaveBeenCalledTimes(1);
    });

    test("deadline reports unknown; late acknowledgement is observed without another publish", async () => {
        let settle!: () => void;
        const publish = jest.fn(() => new Promise<void>(resolve => { settle = resolve; }));
        const service = new MqttService({ node } as any, { publish, getPublishAcknowledgement: () => "mqtt_puback" }, "telemetry/topic");
        const completion = service.publishResultImmediateTracked("valve", true, context);
        await jest.advanceTimersByTimeAsync(10000);
        await expect(completion).resolves.toMatchObject({ status: "unknown" });
        settle();
        await Promise.resolve();
        await Promise.resolve();
        expect(publish).toHaveBeenCalledTimes(1);
        expect(node.send).toHaveBeenCalledTimes(1);
        expect(events.some(item => item.event === "mqtt.publish_wait_timed_out")).toBe(true);
        expect(events.some(item => item.event === "mqtt.publish_late_settlement")).toBe(true);
    });
});
