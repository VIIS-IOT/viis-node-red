import { DiagnosticLogger } from "../../../../core/observability/diagnostic-logger";
import { RpcHandler } from "../rpcHandler";

describe("RpcHandler control and delivery outcomes", () => {
    const events: string[] = [];
    let diagnosticSpy: jest.SpyInstance;

    beforeEach(() => {
        events.length = 0;
        diagnosticSpy = jest.spyOn(DiagnosticLogger.prototype, "emit").mockImplementation(function (_level: any, event: string) {
            events.push(event);
        });
    });

    afterEach(() => diagnosticSpy.mockRestore());

    function createHandler(readFromModbus: jest.Mock) {
        const node = { id: "rpc-handler-test", log: jest.fn(), warn: jest.fn(), error: jest.fn(), status: jest.fn(), context: () => ({ get: jest.fn(), set: jest.fn() }) };
        const writes = jest.fn().mockResolvedValue(undefined);
        const trackedPublish = jest.fn().mockReturnValue({
            operationId: "publish-op",
            completion: Promise.resolve({ operationId: "publish-op", status: "failed", acknowledgement: "none" }),
        });
        const modbusService = {
            findModbusMapping: () => ({ address: 4, fc: 5, value: false, boardId: "board-a" }),
            getModbusHoldingRegisters: () => ({}),
            getModbusCoils: () => ({ valve: 4 }),
            writeToModbus: writes,
            readFromModbus,
            updateGlobalContextCacheAfterVerification: jest.fn(),
            checkConnection: jest.fn(),
            isHoldingSetmlBomOffsetEnabled: () => false,
            getHoldingSetmlBomOffset: () => null,
            getHoldingSetmlBomOffsetConfig: () => ({}),
        };
        const mqttService = {
            scheduleResultTracked: trackedPublish,
            publishResult: jest.fn(),
            publishResultImmediate: jest.fn(),
            publishConfigUpdate: jest.fn().mockResolvedValue(undefined),
            publishConfigUpdateTracked: jest.fn().mockResolvedValue({ operationId: "cfg", status: "acknowledged", acknowledgement: "mqtt_puback" }),
            publishError: jest.fn().mockResolvedValue(undefined),
            publishErrorTracked: jest.fn().mockResolvedValue({ operationId: "err", status: "acknowledged", acknowledgement: "mqtt_puback" }),
            isConnected: () => true,
        };
        const handler = new RpcHandler(
            { node, flowContext: {}, globalContext: {} } as any,
            { getConfigKeyValues: () => ({}), setConfigKeyValues: jest.fn() } as any,
            { validateAndConvertValue: (_key: string, value: unknown) => value } as any,
            modbusService as any,
            mqttService as any,
            { processRpcBody: jest.fn().mockResolvedValue(false) } as any,
        );
        return { handler, writes, trackedPublish };
    }

    test("telemetry delivery failure after successful readback does not repeat Modbus write", async () => {
        const read = jest.fn().mockResolvedValue(true);
        const { handler, writes, trackedPublish } = createHandler(read);

        await handler.handleRpcRequest({ method: "set_state", params: { valve: true } });
        await new Promise(resolve => setImmediate(resolve));

        expect(writes).toHaveBeenCalledTimes(1);
        expect(read).toHaveBeenCalledTimes(1);
        expect(trackedPublish).toHaveBeenCalledTimes(1);
        expect(events).toContain("rpc.execution_finished");
        expect(events).toContain("rpc.delivery_finished");
    });

    test("readback failure uses fallback result and does not repeat the successful write", async () => {
        const read = jest.fn().mockRejectedValue(new Error("invalid response payload"));
        const { handler, writes, trackedPublish } = createHandler(read);

        await handler.handleRpcRequest({ method: "set_state", params: { valve: true } });

        expect(writes).toHaveBeenCalledTimes(1);
        expect(trackedPublish).toHaveBeenCalledTimes(1);
        expect(events).toContain("modbus.readback_unavailable");
    });

    test("overall timeout emits one execution terminal and records late settlement and delivery", async () => {
        let resolveWrite!: () => void;
        const writeGate = new Promise<void>(resolve => { resolveWrite = resolve; });
        const read = jest.fn().mockResolvedValue(true);
        const { handler, writes } = createHandler(read);
        writes.mockImplementation(() => writeGate);
        (handler as any).RPC_REQUEST_TIMEOUT = 10;

        await expect(handler.handleRpcRequest({ method: "set_state", params: { valve: true } })).rejects.toThrow("timeout");
        expect(events.filter(event => event === "rpc.execution_finished")).toHaveLength(1);
        expect(events).not.toContain("rpc.delivery_finished");

        resolveWrite();
        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => setImmediate(resolve));
        expect(writes).toHaveBeenCalledTimes(1);
        expect(read).toHaveBeenCalledTimes(1);
        expect(events.filter(event => event === "rpc.execution_finished")).toHaveLength(1);
        expect(events).toContain("rpc.late_settlement");
        expect(events).toContain("rpc.delivery_finished");
    });

    test("mixed acknowledged and unknown publish tickets are reported as partial", async () => {
        const { handler } = createHandler(jest.fn().mockResolvedValue(true));
        expect((handler as any).summarizeOutcomes([
            { operationId: "a", status: "acknowledged", acknowledgement: "mqtt_puback" },
            { operationId: "b", status: "unknown", acknowledgement: "none" },
        ])).toBe("partial");
    });

    test("batch command timeout remains pending until the underlying command settles", async () => {
        let resolveCommand!: (value: string) => void;
        const commandOperation = new Promise<string>(resolve => { resolveCommand = resolve; });
        const { handler } = createHandler(jest.fn().mockResolvedValue(true));
        (handler as any).handleSetStateRequest = jest.fn(() => commandOperation);

        await handler.handleRpcRequest({
            method: "set_state_batch",
            params: { commands: [{ key: "valve", value: true }], options: { timeout_per_cmd: 10, modbus_delay_ms: 0 } },
        });
        expect(events).toContain("rpc.batch_command_timeout");
        expect(events).not.toContain("rpc.delivery_finished");
        expect((handler as any).getDiagnosticStatus().pendingLateOperations).toBe(1);

        resolveCommand("success");
        await new Promise(resolve => setImmediate(resolve));
        expect(events).toContain("rpc.late_settlement");
        expect(events).toContain("rpc.delivery_finished");
        expect((handler as any).getDiagnosticStatus().pendingLateOperations).toBe(0);
    });
});
