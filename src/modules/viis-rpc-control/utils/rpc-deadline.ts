/**
 * Per-request deadline for RPC control commands.
 *
 * An RPC that is not finished by its deadline is answered FAILED and must not
 * write to Modbus afterwards: a valve/pump command applied long after the client
 * gave up is outdated and unsafe. The context is carried with AsyncLocalStorage so
 * every Modbus write made on behalf of the request (rpcHandler, luoi mapping,
 * ModbusService) can check it without threading a parameter through every call.
 */
import { AsyncLocalStorage } from "async_hooks";

export interface RpcDeadlineContext {
    commandId: string | null;
    receivedAt: number;
    deadline: number;
    ttlMs: number;
    /** Set once the deadline passed; no further Modbus writes are allowed. */
    expired: boolean;
    /** Set once a terminal response (ACK/FAILED) was published for this request. */
    responded: boolean;
}

const storage = new AsyncLocalStorage<RpcDeadlineContext>();

export class RpcExpiredError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "RpcExpiredError";
    }
}

export function createRpcDeadline(commandId: string | null, ttlMs: number, now: number = Date.now()): RpcDeadlineContext {
    return { commandId, receivedAt: now, deadline: now + ttlMs, ttlMs, expired: false, responded: false };
}

export function runWithRpcDeadline<T>(ctx: RpcDeadlineContext, fn: () => T): T {
    return storage.run(ctx, fn);
}

export function currentRpcDeadline(): RpcDeadlineContext | undefined {
    return storage.getStore();
}

export function isRpcExpired(ctx: RpcDeadlineContext | undefined, now: number = Date.now()): boolean {
    if (!ctx) return false;
    if (!ctx.expired && now >= ctx.deadline) {
        ctx.expired = true;
    }
    return ctx.expired;
}

/**
 * Throw if the current request (if any) is past its deadline.
 * The message deliberately avoids "timeout"/"timed out" so retry loops that
 * match those words do not retry an expired request.
 */
export function assertRpcNotExpired(what: string, ctx: RpcDeadlineContext | undefined = currentRpcDeadline()): void {
    if (ctx && isRpcExpired(ctx)) {
        throw new RpcExpiredError(
            `[RPC-EXPIRED] ${what} skipped: request deadline passed (age ${Date.now() - ctx.receivedAt}ms, ttl ${ctx.ttlMs}ms)`
        );
    }
}
