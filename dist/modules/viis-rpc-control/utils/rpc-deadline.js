"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RpcExpiredError = void 0;
exports.createRpcDeadline = createRpcDeadline;
exports.runWithRpcDeadline = runWithRpcDeadline;
exports.currentRpcDeadline = currentRpcDeadline;
exports.isRpcExpired = isRpcExpired;
exports.assertRpcNotExpired = assertRpcNotExpired;
/**
 * Per-request deadline for RPC control commands.
 *
 * An RPC that is not finished by its deadline is answered FAILED and must not
 * write to Modbus afterwards: a valve/pump command applied long after the client
 * gave up is outdated and unsafe. The context is carried with AsyncLocalStorage so
 * every Modbus write made on behalf of the request (rpcHandler, luoi mapping,
 * ModbusService) can check it without threading a parameter through every call.
 */
const async_hooks_1 = require("async_hooks");
const storage = new async_hooks_1.AsyncLocalStorage();
class RpcExpiredError extends Error {
    constructor(message) {
        super(message);
        this.name = "RpcExpiredError";
    }
}
exports.RpcExpiredError = RpcExpiredError;
function createRpcDeadline(commandId, ttlMs, now = Date.now()) {
    return { commandId, receivedAt: now, deadline: now + ttlMs, ttlMs, expired: false, responded: false };
}
function runWithRpcDeadline(ctx, fn) {
    return storage.run(ctx, fn);
}
function currentRpcDeadline() {
    return storage.getStore();
}
function isRpcExpired(ctx, now = Date.now()) {
    if (!ctx)
        return false;
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
function assertRpcNotExpired(what, ctx = currentRpcDeadline()) {
    if (ctx && isRpcExpired(ctx)) {
        throw new RpcExpiredError(`[RPC-EXPIRED] ${what} skipped: request deadline passed (age ${Date.now() - ctx.receivedAt}ms, ttl ${ctx.ttlMs}ms)`);
    }
}
