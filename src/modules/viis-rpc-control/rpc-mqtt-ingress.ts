type MqttMessageListener = (event: any) => void;

export interface MqttMessageSource {
    on(event: "mqtt-message", listener: MqttMessageListener): unknown;
    removeListener?(event: "mqtt-message", listener: MqttMessageListener): unknown;
    off?(event: "mqtt-message", listener: MqttMessageListener): unknown;
}

/** Keep the ingress listener independent of subscription attempts and absorb async handler rejection. */
export function attachRpcMqttMessageHandler(
    source: MqttMessageSource,
    handler: (event: any) => Promise<void> | void,
    onError: (error: unknown, event: any) => void,
): () => void {
    let attached = true;
    const listener: MqttMessageListener = event => {
        void Promise.resolve()
            .then(() => handler(event))
            .catch(error => {
                try { onError(error, event); } catch { /* error reporting must not create an unhandled rejection */ }
            });
    };
    source.on("mqtt-message", listener);
    return () => {
        if (!attached) return;
        attached = false;
        if (typeof source.removeListener === "function") source.removeListener("mqtt-message", listener);
        else source.off?.("mqtt-message", listener);
    };
}
