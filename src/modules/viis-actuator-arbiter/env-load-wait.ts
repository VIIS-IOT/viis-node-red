/**
 * env-loader fills the global context asynchronously after the flows start, and the context store is
 * persistent, so a node that reads its config once at start sees either nothing (first boot) or what a
 * previous run left (later boots). env-loader stamps `env_loader_loaded_at` after every completed load;
 * waitForEnvLoad resolves once a stamp from this run is there.
 */
export interface EnvLoadWaitOptions {
    /** A stamp at most this old when the node starts counts as this run's load (env-loader may finish first). */
    toleranceMs?: number;
    timeoutMs?: number;
    pollMs?: number;
    isCancelled?: () => boolean;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
}

/** Resolves true when this run's load stamp is seen, false on timeout or cancel. */
export async function waitForEnvLoad(
    readStamp: () => unknown,
    startedAt: number,
    options: EnvLoadWaitOptions = {}
): Promise<boolean> {
    const {
        toleranceMs = 30000,
        timeoutMs = 60000,
        pollMs = 500,
        isCancelled = () => false,
        sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
        now = () => Date.now(),
    } = options;
    while (!isCancelled()) {
        const stamp = Number(readStamp());
        if (Number.isFinite(stamp) && stamp >= startedAt - toleranceMs) return true;
        if (now() - startedAt >= timeoutMs) return false;
        await sleep(pollMs);
    }
    return false;
}
