"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachRpcMqttMessageHandler = attachRpcMqttMessageHandler;
/** Keep the ingress listener independent of subscription attempts and absorb async handler rejection. */
function attachRpcMqttMessageHandler(source, handler, onError) {
    let attached = true;
    const listener = event => {
        void Promise.resolve()
            .then(() => handler(event))
            .catch(error => {
            try {
                onError(error, event);
            }
            catch ( /* error reporting must not create an unhandled rejection */_a) { /* error reporting must not create an unhandled rejection */ }
        });
    };
    source.on("mqtt-message", listener);
    return () => {
        var _a;
        if (!attached)
            return;
        attached = false;
        if (typeof source.removeListener === "function")
            source.removeListener("mqtt-message", listener);
        else
            (_a = source.off) === null || _a === void 0 ? void 0 : _a.call(source, "mqtt-message", listener);
    };
}
