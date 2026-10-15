import { readGlobalScaleConfigs } from '../global-scale-configs';
import { ConfigService } from '../../modules/viis-rpc-control/services/configService';

/**
 * Regression (PhuTho 2026-10-15): the device JSON's scaleConfigs reach the global context only as
 * env-loader's `scale_configs` JSON string, while `scaleConfigs` stayed []. The schedule executor
 * and RPC control read only `scaleConfigs`, so set_ec 1.8 was written as 1.8 instead of 180.
 */
const ENV_LOADER = JSON.stringify([
    { key: 'fertigation_control_set_ec', operation: 'multiply', factor: 100, direction: 'write' },
    { key: 'fertigation_control_set_ec', operation: 'divide', factor: 100, direction: 'read' },
]);

const contextOf = (values: Record<string, unknown>) => ({ get: (key: string) => values[key] });

describe('readGlobalScaleConfigs', () => {
    it('reads env-loader scale_configs when scaleConfigs is empty', () => {
        const configs = readGlobalScaleConfigs(contextOf({ scaleConfigs: [], scale_configs: ENV_LOADER }));
        expect(configs).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: 'fertigation_control_set_ec', direction: 'write', factor: 100 }),
            expect.objectContaining({ key: 'fertigation_control_set_ec', direction: 'read', factor: 100 }),
        ]));
        expect(configs).toHaveLength(2);
    });

    it('merges node configs; env-loader wins for the same key and direction', () => {
        const configs = readGlobalScaleConfigs(contextOf({
            scaleConfigs: [
                { key: 'fertigation_control_set_ec', operation: 'multiply', factor: 10, direction: 'write' },
                { key: 'HOLDING_PH', operation: 'multiply', factor: 10, direction: 'write' },
            ],
            scale_configs: ENV_LOADER,
        }));
        expect(configs.find((c) => c.key === 'fertigation_control_set_ec' && c.direction === 'write')?.factor).toBe(100);
        expect(configs.find((c) => c.key === 'HOLDING_PH')?.factor).toBe(10);
    });

    it('ignores invalid JSON and malformed entries', () => {
        expect(readGlobalScaleConfigs(contextOf({ scale_configs: '{not json' }))).toEqual([]);
        expect(readGlobalScaleConfigs(contextOf({ scale_configs: JSON.stringify([{ key: 'a', factor: 0, operation: 'multiply', direction: 'write' }, { key: 'b' }]) }))).toEqual([]);
        expect(readGlobalScaleConfigs(undefined)).toEqual([]);
    });
});

describe('RPC control ConfigService', () => {
    it('uses env-loader scale configs for writes', () => {
        const values: Record<string, unknown> = { scaleConfigs: [], scale_configs: ENV_LOADER };
        const service = new ConfigService({
            globalContext: { get: (key: string) => values[key], set: (key: string, value: unknown) => { values[key] = value; } },
            flowContext: { get: jest.fn(), set: jest.fn() },
            node: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        } as any);
        const write = service.getScaleConfigs().find((c) => c.key === 'fertigation_control_set_ec' && c.direction === 'write');
        expect(write).toEqual(expect.objectContaining({ operation: 'multiply', factor: 100 }));
    });
});
