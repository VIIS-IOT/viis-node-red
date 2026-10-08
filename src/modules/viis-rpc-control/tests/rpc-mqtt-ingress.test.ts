import { EventEmitter } from "events";
import { attachRpcMqttMessageHandler } from "../rpc-mqtt-ingress";

describe("RPC MQTT ingress lifecycle", () => {
    test("keeps one listener through subscription failure and recovery, then processes a message once", async () => {
        const client = new EventEmitter();
        const processMessage = jest.fn().mockResolvedValue(undefined);
        const onError = jest.fn();
        const detach = attachRpcMqttMessageHandler(client as any, processMessage, onError);
        const subscribe = jest.fn()
            .mockRejectedValueOnce(new Error("broker unavailable"))
            .mockResolvedValueOnce(undefined);

        await expect(subscribe()).rejects.toThrow("broker unavailable");
        expect(client.listenerCount("mqtt-message")).toBe(1);
        await subscribe();
        expect(client.listenerCount("mqtt-message")).toBe(1);

        client.emit("mqtt-message", { message: { topic: "rpc/request/1" } });
        await new Promise(resolve => setImmediate(resolve));
        expect(processMessage).toHaveBeenCalledTimes(1);
        expect(onError).not.toHaveBeenCalled();

        detach();
        detach();
        expect(client.listenerCount("mqtt-message")).toBe(0);
    });

    test("catches asynchronous ingress failures without an unhandled rejection", async () => {
        const client = new EventEmitter();
        const failure = new Error("processor rejected");
        const onError = jest.fn();
        attachRpcMqttMessageHandler(client as any, async () => { throw failure; }, onError);

        client.emit("mqtt-message", { message: {} });
        await new Promise(resolve => setImmediate(resolve));
        expect(onError).toHaveBeenCalledWith(failure, { message: {} });
    });
});
