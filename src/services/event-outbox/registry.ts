/**
 * One event outbox and one sender per Node-RED process. Kept in this module rather than in Node-RED global
 * context: the `localfilesystem` context store serialises values and strips their methods.
 *
 * Flag `EVENT_OUTBOX_ENABLED` (default false): while it is off `initEventOutbox` creates nothing (no table,
 * no timer) and `getEventOutbox()` is null, so every sender keeps today's direct POST.
 */
import { DataSource } from "typeorm";
import { EventOutbox } from "./event-outbox";
import { EnvReader, OutboxSender, OutboxSenderOptions } from "./outbox-sender";

let outbox: EventOutbox | null = null;
let sender: OutboxSender | null = null;
let outboxDs: DataSource | null = null;
let outboxEnv: EnvReader | null = null;
let initializing: Promise<EventOutbox> | null = null;

export function isEventOutboxEnabled(env: EnvReader): boolean {
    const value = env.getEnvVar("EVENT_OUTBOX_ENABLED", false);
    return value === true || value === 1 || ["true", "1", "yes", "on"].includes(String(value).trim().toLowerCase());
}

/** The outbox, or null when `EVENT_OUTBOX_ENABLED` is off or `initEventOutbox` has not run yet. */
export function getEventOutbox(): EventOutbox | null {
    if (!outbox || !outboxEnv || !isEventOutboxEnabled(outboxEnv)) return null;
    return outbox;
}

/**
 * Creates the tables and starts the sender once per process; later calls return the same outbox. A new
 * DataSource replaces one that was destroyed (node redeploy released the last reference). Null when the
 * flag is off.
 */
export async function initEventOutbox(
    ds: DataSource,
    env: EnvReader,
    opts: OutboxSenderOptions = {}
): Promise<EventOutbox | null> {
    outboxEnv = env;
    if (!isEventOutboxEnabled(env)) return null;
    if (outbox && outboxDs?.isInitialized) return outbox;
    if (initializing) return initializing;

    initializing = (async () => {
        sender?.stop();
        const next = new EventOutbox(ds);
        await next.ensureTables();
        outbox = next;
        outboxDs = ds;
        sender = new OutboxSender(next, env, opts);
        sender.start();
        return next;
    })().finally(() => {
        initializing = null;
    });
    return initializing;
}

/** Stops the sender and forgets the outbox (tests, process shutdown). */
export function resetEventOutbox(): void {
    sender?.stop();
    sender = null;
    outbox = null;
    outboxDs = null;
    outboxEnv = null;
    initializing = null;
}
