"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeAndVerifyKey = writeAndVerifyKey;
async function writeAndVerifyKey(cmd, deps, opts) {
    var _a, _b;
    const maxAttempts = (_a = opts.maxAttempts) !== null && _a !== void 0 ? _a : 3;
    const retryDelayMs = (_b = opts.retryDelayMs) !== null && _b !== void 0 ? _b : 100;
    let lastError;
    let lastRead;
    let rawWritten;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            if (cmd.fc === 5) {
                const gate = await deps.writeCoil(cmd);
                rawWritten = Boolean(cmd.value);
                if (gate === 'blocked') {
                    return {
                        key: cmd.key, phase: opts.phase, fc: cmd.fc, address: cmd.address,
                        expected: cmd.value, rawWritten, status: 'blocked', attempts: attempt,
                        error: 'protection_gate_blocked',
                    };
                }
            }
            else if (cmd.fc === 6) {
                rawWritten = deps.scaleWrite(cmd.key, Number(cmd.value));
                await deps.writeRegister(cmd.address, Number(rawWritten));
            }
            else {
                return {
                    key: cmd.key, phase: opts.phase, fc: cmd.fc, address: cmd.address,
                    expected: cmd.value, status: 'fail', attempts: attempt, error: `unsupported_fc_${cmd.fc}`,
                };
            }
            if (!opts.verifyEnabled) {
                return {
                    key: cmd.key, phase: opts.phase, fc: cmd.fc, address: cmd.address,
                    expected: cmd.value, rawWritten, status: 'pass', attempts: attempt, verifySkipped: true,
                };
            }
            if (cmd.fc === 5) {
                lastRead = await deps.readCoil(cmd.address);
            }
            else {
                const raw = await deps.readHolding(cmd.address);
                lastRead = deps.scaleRead(cmd.key, raw);
            }
            if (lastRead === cmd.value) {
                return {
                    key: cmd.key, phase: opts.phase, fc: cmd.fc, address: cmd.address,
                    expected: cmd.value, rawWritten, read: lastRead, status: 'pass', attempts: attempt,
                };
            }
            lastError = `verify_mismatch expected=${cmd.value} read=${lastRead}`;
        }
        catch (error) {
            lastError = error.message;
        }
        if (attempt < maxAttempts) {
            await deps.delay(retryDelayMs);
        }
        else {
            return {
                key: cmd.key, phase: opts.phase, fc: cmd.fc, address: cmd.address,
                expected: cmd.value, rawWritten, read: lastRead, status: 'fail',
                attempts: attempt, error: lastError,
            };
        }
    }
    return {
        key: cmd.key, phase: opts.phase, fc: cmd.fc, address: cmd.address,
        expected: cmd.value, rawWritten, read: lastRead, status: 'fail',
        attempts: maxAttempts, error: lastError,
    };
}
