import { readFileSync } from 'fs';
import { join } from 'path';
import { RpcHandler } from '../../viis-rpc-control/handlers/rpcHandler';
import { resolveWaterHammerDelayMs } from '../fertigation-start-sequence';
import {
    isNodeRedPropertyDeployable,
    isWaterHammerDelayEditorValid,
    legacyWaterHammerDelayValidate,
} from '../water-hammer-editor';

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
    return { required: false, validate: isWaterHammerDelayEditorValid };
}

function legacyEditorDef() {
    return { required: true, validate: legacyWaterHammerDelayValidate };
}

test('legacy required+Number(v) blocks Deploy on existing nodes missing waterHammerDelay', () => {
    expect(isNodeRedPropertyDeployable(undefined, legacyEditorDef())).toBe(false);
    expect(isNodeRedPropertyDeployable((EXISTING_RPC_NODE as any).waterHammerDelay, legacyEditorDef())).toBe(false);
    expect(isNodeRedPropertyDeployable((EXISTING_SCHEDULE_NODE as any).waterHammerDelay, legacyEditorDef())).toBe(false);
});

test('current editor accepts missing/blank delay and still rejects negatives', () => {
    const def = currentEditorDef();
    expect(isNodeRedPropertyDeployable(undefined, def)).toBe(true);
    expect(isNodeRedPropertyDeployable(null, def)).toBe(true);
    expect(isNodeRedPropertyDeployable('', def)).toBe(true);
    expect(isNodeRedPropertyDeployable('   ', def)).toBe(true);
    expect(isNodeRedPropertyDeployable(7, def)).toBe(true);
    expect(isNodeRedPropertyDeployable('20', def)).toBe(true);
    expect(isNodeRedPropertyDeployable(0, def)).toBe(true);
    expect(isNodeRedPropertyDeployable(-1, def)).toBe(false);
    expect(isNodeRedPropertyDeployable('abc', def)).toBe(false);
});

test('runtime still uses 7s when existing flow omits waterHammerDelay', () => {
    expect(resolveWaterHammerDelayMs((EXISTING_RPC_NODE as any).waterHammerDelay)).toBe(7000);
    expect(resolveWaterHammerDelayMs((EXISTING_SCHEDULE_NODE as any).waterHammerDelay)).toBe(7000);
});

test('rpc HTML and schedule HTML keep optional delay plus empty-as-valid', () => {
    const files = [
        join(__dirname, '../../viis-rpc-control/viis-rpc-control.html'),
        join(__dirname, '../../viis-schedule-executor/viis-schedule-executor.html'),
    ];
    for (const file of files) {
        const html = readFileSync(file, 'utf8');
        const block = html.match(/waterHammerDelay:\s*\{[\s\S]*?\n\s{12}\}/);
        expect(block).toBeTruthy();
        expect(block![0]).toContain('required: false');
        expect(block![0]).toContain("String(v).trim() === ''");
        expect(block![0]).not.toMatch(/required:\s*true/);
    }
});

test('prefixed fertigation batch on a node without waterHammerDelay still hammers 7s', async () => {
    const handler = new RpcHandler(
        {
            node: { status: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn(), context: () => ({ get: jest.fn(), set: jest.fn() }) },
            flowContext: {},
            globalContext: {},
        },
        {} as any,
        {} as any,
        {
            getModbusHoldingRegisters: () => ({
                fertigation_control_set_ec: 16,
                fertigation_control_valve_program_index: 19,
            }),
            getModbusCoils: () => ({
                fertigation_control_valve_0: 39,
                fertigation_control_main_pump: 31,
                fertigation_control_power: 30,
            }),
        } as any,
        {
            publishConfigUpdate: jest.fn().mockResolvedValue(undefined),
            publishError: jest.fn().mockResolvedValue(undefined),
            isConnected: () => true,
        } as any,
        {} as any
    );
    handler.setWaterHammerDelayMs(resolveWaterHammerDelayMs((EXISTING_RPC_NODE as any).waterHammerDelay));

    const writes: Array<Record<string, unknown>> = [];
    const delays: number[] = [];
    jest.spyOn(handler as any, 'handleSetStateRequest').mockImplementation(async (params: Record<string, unknown>) => {
        writes.push(params);
    });
    (handler as any).sleep = async (ms: number) => {
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
