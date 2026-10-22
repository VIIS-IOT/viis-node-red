export interface MqttInitRetryOptions {
    /** One full start-up attempt (connect + subscribe); rejects to schedule another. */
    attempt: () => Promise<void>;
    onSuccess: () => void;
    onFailure: (error: Error, retryInMs: number, attemptNumber: number) => void;
    initialDelayMs?: number;
    maxDelayMs?: number;
}

/**
 * Keeps retrying the MQTT start-up of the automation node with a capped, doubling backoff.
 * Without it a gateway that boots while DNS or the uplink is down stays unsubscribed until the next deploy.
 */
export class MqttInitRetry {
    private timer: NodeJS.Timeout | null = null;
    private stopped = false;
    private attemptNumber = 0;
    private readonly initialDelayMs: number;
    private readonly maxDelayMs: number;

    constructor(private readonly options: MqttInitRetryOptions) {
        this.initialDelayMs = options.initialDelayMs ?? 5000;
        this.maxDelayMs = options.maxDelayMs ?? 60000;
    }

    start(): void {
        void this.run();
    }

    stop(): void {
        this.stopped = true;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private async run(): Promise<void> {
        if (this.stopped) return;
        this.timer = null;
        this.attemptNumber++;

        try {
            await this.options.attempt();
        } catch (error) {
            if (this.stopped) return;
            const delay = Math.min(this.initialDelayMs * 2 ** (this.attemptNumber - 1), this.maxDelayMs);
            this.options.onFailure(error as Error, delay, this.attemptNumber);
            this.timer = setTimeout(() => void this.run(), delay);
            return;
        }

        if (!this.stopped) this.options.onSuccess();
    }
}
