"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const path_1 = require("path");
const rpcHandler_1 = require("../../viis-rpc-control/handlers/rpcHandler");
const fertigation_start_sequence_1 = require("../fertigation-start-sequence");
const water_hammer_editor_1 = require("../water-hammer-editor");
const EXISTING_RPC_NODE = {
    id: '84f975fdaf26a352',
    type: 'viis-rpc-control',
    mqttBroker: 'thingsboard',
    configKeys: '{"max_temp": "number", "max_humid": "number"}',
    scaleConfigs: '[]',
};
const EXISTING_SCHEDULE_NODE = {
    id: 'schedule-1',
    type: 'viis-schedule-executor',
    name: 'Schedule Executor',
};
function currentEditorDef() {
    return { required: false, validate: water_hammer_editor_1.isWaterHammerDelayEditorValid };
}
function legacyEditorDef() {
    return { required: true, validate: water_hammer_editor_1.legacyWaterHammerDelayValidate };
}
test('legacy required+Number(v) blocks Deploy on existing nodes missing waterHammerDelay', () => {
    expect((0, water_hammer_editor_1.isNodeRedPropertyDeployable)(undefined, legacyEditorDef())).toBe(false);
    expect((0, water_hammer_editor_1.isNodeRedPropertyDeployable)(EXISTING_RPC_NODE.waterHammerDelay, legacyEditorDef())).toBe(false);
    expect((0, water_hammer_editor_1.isNodeRedPropertyDeployable)(EXISTING_SCHEDULE_NODE.waterHammerDelay, legacyEditorDef())).toBe(false);
});
test('current editor accepts missing/blank delay and still rejects negatives', () => {
    const def = currentEditorDef();
    expect((0, water_hammer_editor_1.isNodeRedPropertyDeployable)(undefined, def)).toBe(true);
    expect((0, water_hammer_editor_1.isNodeRedPropertyDeployable)(null, def)).toBe(true);
    expect((0, water_hammer_editor_1.isNodeRedPropertyDeployable)('', def)).toBe(true);
    expect((0, water_hammer_editor_1.isNodeRedPropertyDeployable)('   ', def)).toBe(true);
    expect((0, water_hammer_editor_1.isNodeRedPropertyDeployable)(7, def)).toBe(true);
    expect((0, water_hammer_editor_1.isNodeRedPropertyDeployable)('20', def)).toBe(true);
    expect((0, water_hammer_editor_1.isNodeRedPropertyDeployable)(0, def)).toBe(true);
    expect((0, water_hammer_editor_1.isNodeRedPropertyDeployable)(-1, def)).toBe(false);
    expect((0, water_hammer_editor_1.isNodeRedPropertyDeployable)('abc', def)).toBe(false);
});
test('runtime still uses 7s when existing flow omits waterHammerDelay', () => {
    expect((0, fertigation_start_sequence_1.resolveWaterHammerDelayMs)(EXISTING_RPC_NODE.waterHammerDelay)).toBe(7000);
    expect((0, fertigation_start_sequence_1.resolveWaterHammerDelayMs)(EXISTING_SCHEDULE_NODE.waterHammerDelay)).toBe(7000);
});
test('rpc HTML and schedule HTML keep optional delay plus empty-as-valid', () => {
    const files = [
        (0, path_1.join)(__dirname, '../../viis-rpc-control/viis-rpc-control.html'),
        (0, path_1.join)(__dirname, '../../viis-schedule-executor/viis-schedule-executor.html'),
    ];
    for (const file of files) {
        const html = (0, fs_1.readFileSync)(file, 'utf8');
        const block = html.match(/waterHammerDelay:\s*\{[\s\S]*?\n\s{12}\}/);
        expect(block).toBeTruthy();
        expect(block[0]).toContain('required: false');
        expect(block[0]).toContain("String(v).trim() === ''");
        expect(block[0]).not.toMatch(/required:\s*true/);
    }
});
test('prefixed fertigation batch on a node without waterHammerDelay still hammers 7s', async () => {
    const handler = new rpcHandler_1.RpcHandler({
        node: { status: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn(), context: () => ({ get: jest.fn(), set: jest.fn() }) },
        flowContext: {},
        globalContext: {},
    }, {}, {}, {
        getModbusHoldingRegisters: () => ({
            fertigation_control_set_ec: 16,
            fertigation_control_valve_program_index: 19,
        }),
        getModbusCoils: () => ({
            fertigation_control_valve_0: 39,
            fertigation_control_main_pump: 31,
            fertigation_control_power: 30,
        }),
    }, {
        publishConfigUpdate: jest.fn().mockResolvedValue(undefined),
        publishError: jest.fn().mockResolvedValue(undefined),
        isConnected: () => true,
    }, {});
    handler.setWaterHammerDelayMs((0, fertigation_start_sequence_1.resolveWaterHammerDelayMs)(EXISTING_RPC_NODE.waterHammerDelay));
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
                { key: 'fertigation_control_valve_0', value: true },
                { key: 'fertigation_control_set_ec', value: 1.2 },
            ],
        },
    });
    expect(writes.map((w) => Object.keys(w)[0])).toEqual([
        'fertigation_control_valve_program_index',
        'fertigation_control_set_ec',
        'fertigation_control_valve_0',
        'fertigation_control_main_pump',
        'fertigation_control_power',
    ]);
    expect(delays).toContain(7000);
    expect(writes.findIndex((w) => 'fertigation_control_valve_0' in w))
        .toBeLessThan(writes.findIndex((w) => 'fertigation_control_main_pump' in w));
});
