"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const rpcHandler_1 = require("../rpcHandler");
const CUSTOMER_HOLDINGS = {
    time_valve_0: 10,
    set_ec: 11,
    set_flow: 12,
    valve_program: 20,
};
const CUSTOMER_COILS = {
    valve_0: 0,
    valve_1: 1,
    main_pump: 8,
    power: 9,
};
function createHandler() {
    const node = {
        status: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        log: jest.fn(),
        context: () => ({ get: jest.fn(), set: jest.fn() }),
    };
    const handler = new rpcHandler_1.RpcHandler({ node, flowContext: {}, globalContext: {} }, {}, {}, {
        getModbusHoldingRegisters: () => CUSTOMER_HOLDINGS,
        getModbusCoils: () => CUSTOMER_COILS,
    }, {
        publishConfigUpdate: jest.fn().mockResolvedValue(undefined),
        publishError: jest.fn().mockResolvedValue(undefined),
        isConnected: () => true,
    }, {});
    return handler;
}
test('fertigation batch writes unused set_flow, derived valve_program, holdings, valves, hammer, pump, power, then iri_time', async () => {
    const handler = createHandler();
    const writes = [];
    const delays = [];
    jest.spyOn(handler, 'handleSetStateRequest').mockImplementation(async (params) => {
        writes.push(params);
    });
    handler.sleep = async (ms) => {
        delays.push(ms);
    };
    await handler.handleRpcRequest({
        method: 'set_state_batch',
        params: {
            commands: [
                { key: 'valve_0', value: true, order: 0 },
                { key: 'valve_1', value: true, order: 1 },
                { key: 'main_pump', value: true, order: 2 },
                { key: 'power', value: true, order: 3 },
                { key: 'set_ec', value: 1.2, order: 4 },
                { key: 'time_valve_0', value: 30, order: 5 },
                { key: 'iri_time', value: 600, order: 6 },
            ],
            options: { sequential: true, modbus_delay_ms: 500, timeout_per_cmd: 5000 },
        },
    });
    expect(writes).toEqual([
        { set_flow: 0 },
        { valve_program: 3 },
        { set_ec: 1.2 },
        { time_valve_0: 30 },
        { valve_0: true },
        { valve_1: true },
        { main_pump: true },
        { power: true },
        { iri_time: 600 },
    ]);
    const valve1Index = writes.findIndex((w) => Object.prototype.hasOwnProperty.call(w, 'valve_1'));
    const pumpIndex = writes.findIndex((w) => Object.prototype.hasOwnProperty.call(w, 'main_pump'));
    expect(delays).toContain(7000);
    const hammerAt = delays.indexOf(7000);
    expect(hammerAt).toBeGreaterThanOrEqual(0);
    expect(valve1Index).toBeLessThan(pumpIndex);
});
test('holdings-only batch keeps generic sequential order and does not inject valve_program', async () => {
    const handler = createHandler();
    const writes = [];
    jest.spyOn(handler, 'handleSetStateRequest').mockImplementation(async (params) => {
        writes.push(params);
    });
    handler.sleep = async () => undefined;
    await handler.handleRpcRequest({
        method: 'set_state_batch',
        params: {
            commands: [
                { key: 'set_ec', value: 1.2, order: 0 },
                { key: 'iri_time', value: 600, order: 1 },
            ],
            options: { sequential: true, modbus_delay_ms: 0, timeout_per_cmd: 5000 },
        },
    });
    expect(writes).toEqual([{ set_ec: 1.2 }, { iri_time: 600 }]);
});
test('time_valve_* is not ranked as a valve coil', () => {
    expect(rpcHandler_1.RpcHandler.getCommandPriority('time_valve_0')).toBe(3);
    expect(rpcHandler_1.RpcHandler.getCommandPriority('valve_0')).toBe(0);
});
