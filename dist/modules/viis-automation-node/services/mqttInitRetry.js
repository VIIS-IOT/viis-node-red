"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MqttInitRetry = void 0;
/**
 * Keeps retrying the MQTT start-up of the automation node with a capped, doubling backoff.
 * Without it a gateway that boots while DNS or the uplink is down stays unsubscribed until the next deploy.
 */
class MqttInitRetry {
    constructor(options) {
        var _a, _b;
        this.options = options;
        this.timer = null;
        this.stopped = false;
        this.attemptNumber = 0;
        this.initialDelayMs = (_a = options.initialDelayMs) !== null && _a !== void 0 ? _a : 5000;
        this.maxDelayMs = (_b = options.maxDelayMs) !== null && _b !== void 0 ? _b : 60000;
    }
    start() {
        void this.run();
    }
    stop() {
        this.stopped = true;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
    async run() {
        if (this.stopped)
            return;
        this.timer = null;
        this.attemptNumber++;
        try {
            await this.options.attempt();
        }
        catch (error) {
            if (this.stopped)
                return;
            const delay = Math.min(this.initialDelayMs * 2 ** (this.attemptNumber - 1), this.maxDelayMs);
            this.options.onFailure(error, delay, this.attemptNumber);
            this.timer = setTimeout(() => void this.run(), delay);
            return;
        }
        if (!this.stopped)
            this.options.onSuccess();
    }
}
exports.MqttInitRetry = MqttInitRetry;
