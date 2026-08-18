"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const schedule_key_writer_1 = require("../schedule-key-writer");
const baseDeps = () => ({
    writeCoil: jest.fn().mockResolvedValue('written'),
    writeRegister: jest.fn().mockResolvedValue(undefined),
    readCoil: jest.fn(),
    readHolding: jest.fn(),
    scaleWrite: (_k, v) => v,
    scaleRead: (_k, v) => v,
    delay: jest.fn().mockResolvedValue(undefined),
});
test('holding verify pass uses one write', async () => {
    const deps = baseDeps();
    deps.readHolding.mockResolvedValue(100);
    const outcome = await (0, schedule_key_writer_1.writeAndVerifyKey)({ key: 'setpoint', value: 100, fc: 6, unitid: 1, address: 20, quantity: 1 }, deps, { phase: 'set_holding', verifyEnabled: true, maxAttempts: 3 });
    expect(deps.writeRegister).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe('pass');
    expect(outcome.attempts).toBe(1);
});
test('retries only the failed holding key up to 3 times', async () => {
    const writeRegister = jest.fn().mockResolvedValue(undefined);
    const readHolding = jest.fn().mockResolvedValue(0);
    const outcome = await (0, schedule_key_writer_1.writeAndVerifyKey)({ key: 'set_ec', value: 2.5, fc: 6, unitid: 1, address: 17, quantity: 1 }, {
        writeCoil: jest.fn(),
        writeRegister,
        readCoil: jest.fn(),
        readHolding,
        scaleWrite: (_k, v) => v * 1000,
        scaleRead: (_k, v) => v / 1000,
        delay: jest.fn().mockResolvedValue(undefined),
    }, { phase: 'set_holding', verifyEnabled: true, maxAttempts: 3 });
    expect(writeRegister).toHaveBeenCalledTimes(3);
    expect(writeRegister).toHaveBeenCalledWith(17, 2500);
    expect(readHolding).toHaveBeenCalledTimes(3);
    expect(outcome.status).toBe('fail');
    expect(outcome.attempts).toBe(3);
    expect(outcome.expected).toBe(2.5);
    expect(outcome.read).toBe(0);
});
test('verifyEnabled=false never reads', async () => {
    const deps = baseDeps();
    const outcome = await (0, schedule_key_writer_1.writeAndVerifyKey)({ key: 'set_ec', value: 2.5, fc: 6, unitid: 1, address: 17, quantity: 1 }, Object.assign(Object.assign({}, deps), { scaleWrite: (_k, v) => v * 1000 }), { phase: 'set_holding', verifyEnabled: false });
    expect(deps.readHolding).not.toHaveBeenCalled();
    expect(outcome.status).toBe('pass');
    expect(outcome.verifySkipped).toBe(true);
});
test('coil blocked, no retry', async () => {
    const deps = baseDeps();
    deps.writeCoil.mockResolvedValue('blocked');
    const outcome = await (0, schedule_key_writer_1.writeAndVerifyKey)({ key: 'main_pump', value: true, fc: 5, unitid: 1, address: 0, quantity: 1 }, deps, { phase: 'start_pumps', verifyEnabled: true });
    expect(deps.writeCoil).toHaveBeenCalledTimes(1);
    expect(deps.readCoil).not.toHaveBeenCalled();
    expect(outcome.status).toBe('blocked');
    expect(outcome.attempts).toBe(1);
});
test('write throws 3 times → fail', async () => {
    const deps = baseDeps();
    deps.writeRegister.mockRejectedValue(new Error('timeout'));
    const outcome = await (0, schedule_key_writer_1.writeAndVerifyKey)({ key: 'set_ec', value: 2.5, fc: 6, unitid: 1, address: 17, quantity: 1 }, deps, { phase: 'set_holding', verifyEnabled: true, maxAttempts: 3 });
    expect(deps.writeRegister).toHaveBeenCalledTimes(3);
    expect(outcome.status).toBe('fail');
    expect(outcome.error).toBe('timeout');
});
test('scale write 2.5 → 2500', async () => {
    const deps = baseDeps();
    deps.readHolding.mockResolvedValue(2500);
    await (0, schedule_key_writer_1.writeAndVerifyKey)({ key: 'set_ec', value: 2.5, fc: 6, unitid: 1, address: 17, quantity: 1 }, Object.assign(Object.assign({}, deps), { scaleWrite: (_k, v) => v * 1000, scaleRead: (_k, v) => v / 1000 }), { phase: 'set_holding', verifyEnabled: true });
    expect(deps.writeRegister).toHaveBeenCalledWith(17, 2500);
});
