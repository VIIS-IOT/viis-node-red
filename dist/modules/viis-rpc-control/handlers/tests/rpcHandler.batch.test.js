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
    expect(rpcHandler_1.RpcHandler.getCommandPriority('fertigation_control_valve_0')).toBe(0);
    expect(rpcHandler_1.RpcHandler.getCommandPriority('fertigation_control_time_valve_1')).toBe(3);
});
const PREFIXED_HOLDINGS = {
    fertigation_control_set_ec: 16,
    fertigation_control_set_flow: 999,
    fertigation_control_valve_program_index: 19,
    fertigation_control_water_only_time: 20,
};
const PREFIXED_COILS = {
    fertigation_control_valve_0: 39,
    fertigation_control_main_pump: 31,
    fertigation_control_power_1: 34,
    fertigation_control_power: 30,
};
test('prefixed fertigation batch uses mapped valve_program_index and node water-hammer delay', async () => {
    const handler = createHandler();
    handler.modbusService = {
        getModbusHoldingRegisters: () => PREFIXED_HOLDINGS,
        getModbusCoils: () => PREFIXED_COILS,
    };
    handler.setWaterHammerDelayMs(20000);
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
                { key: 'fertigation_control_power', value: true },
                { key: 'fertigation_control_main_pump', value: true },
                { key: 'fertigation_control_power_1', value: true },
                { key: 'fertigation_control_valve_0', value: true },
                { key: 'fertigation_control_set_ec', value: 1.2 },
            ],
        },
    });
    expect(writes).toEqual([
        { fertigation_control_set_flow: 0 },
        { fertigation_control_valve_program_index: 1 },
        { fertigation_control_set_ec: 1.2 },
        { fertigation_control_valve_0: true },
        { fertigation_control_main_pump: true },
        { fertigation_control_power_1: true },
        { fertigation_control_power: true },
    ]);
    expect(delays).toContain(20000);
    expect(writes.findIndex((w) => 'fertigation_control_valve_0' in w))
        .toBeLessThan(writes.findIndex((w) => 'fertigation_control_main_pump' in w));
    expect(writes.findIndex((w) => 'fertigation_control_power_1' in w))
        .toBeLessThan(writes.findIndex((w) => 'fertigation_control_power' in w));
});
