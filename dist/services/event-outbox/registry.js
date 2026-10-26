"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEventOutboxEnabled = isEventOutboxEnabled;
exports.getEventOutbox = getEventOutbox;
exports.initEventOutbox = initEventOutbox;
exports.resetEventOutbox = resetEventOutbox;
const event_outbox_1 = require("./event-outbox");
const outbox_sender_1 = require("./outbox-sender");
let outbox = null;
let sender = null;
let outboxDs = null;
let outboxEnv = null;
let initializing = null;
function isEventOutboxEnabled(env) {
    const value = env.getEnvVar("EVENT_OUTBOX_ENABLED", false);
    return value === true || value === 1 || ["true", "1", "yes", "on"].includes(String(value).trim().toLowerCase());
}
/** The outbox, or null when `EVENT_OUTBOX_ENABLED` is off or `initEventOutbox` has not run yet. */
function getEventOutbox() {
    if (!outbox || !outboxEnv || !isEventOutboxEnabled(outboxEnv))
        return null;
    return outbox;
}
/**
 * Creates the tables and starts the sender once per process; later calls return the same outbox. A new
 * DataSource replaces one that was destroyed (node redeploy released the last reference). Null when the
 * flag is off.
 */
async function initEventOutbox(ds, env, opts = {}) {
    outboxEnv = env;
    if (!isEventOutboxEnabled(env))
        return null;
    if (outbox && (outboxDs === null || outboxDs === void 0 ? void 0 : outboxDs.isInitialized))
        return outbox;
    if (initializing)
        return initializing;
    initializing = (async () => {
        sender === null || sender === void 0 ? void 0 : sender.stop();
        const next = new event_outbox_1.EventOutbox(ds);
        await next.ensureTables();
        outbox = next;
        outboxDs = ds;
        sender = new outbox_sender_1.OutboxSender(next, env, opts);
        sender.start();
        return next;
    })().finally(() => {
        initializing = null;
    });
    return initializing;
}
/** Stops the sender and forgets the outbox (tests, process shutdown). */
function resetEventOutbox() {
    sender === null || sender === void 0 ? void 0 : sender.stop();
    sender = null;
    outbox = null;
    outboxDs = null;
    outboxEnv = null;
    initializing = null;
}
