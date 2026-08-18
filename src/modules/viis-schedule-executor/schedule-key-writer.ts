import { ModbusCmd } from './type';
import { KeyOutcome, SchedulePhase } from './schedule-execution-types';

export interface KeyWriterDeps {
    writeCoil: (cmd: ModbusCmd) => Promise<'written' | 'blocked'>;
    writeRegister: (address: number, raw: number) => Promise<void>;
    readCoil: (address: number) => Promise<boolean>;
    readHolding: (address: number) => Promise<number>;
    scaleWrite: (key: string, value: number) => number;
    scaleRead: (key: string, value: number) => number;
    delay: (ms: number) => Promise<void>;
}

export interface KeyWriterOpts {
    phase: SchedulePhase;
    maxAttempts?: number;
    verifyEnabled: boolean;
    retryDelayMs?: number;
}

export async function writeAndVerifyKey(
    cmd: ModbusCmd,
    deps: KeyWriterDeps,
    opts: KeyWriterOpts
): Promise<KeyOutcome> {
    const maxAttempts = opts.maxAttempts ?? 3;
    const retryDelayMs = opts.retryDelayMs ?? 100;
    let lastError: string | undefined;
    let lastRead: number | boolean | undefined;
    let rawWritten: number | boolean | undefined;

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
            } else if (cmd.fc === 6) {
                rawWritten = deps.scaleWrite(cmd.key, Number(cmd.value));
                await deps.writeRegister(cmd.address, Number(rawWritten));
            } else {
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
            } else {
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
        } catch (error) {
            lastError = (error as Error).message;
        }
        if (attempt < maxAttempts) {
            await deps.delay(retryDelayMs);
        } else {
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
