/**
 * Unit tests for ConfigService - specifically testing scale config merging
 */

import { ConfigService } from '../configService';
import { ScaleConfig } from '../../interfaces/types';

describe('ConfigService', () => {
    let configService: ConfigService;
    let mockGlobalContext: Map<string, any>;
    let mockNode: any;

    beforeEach(() => {
        mockGlobalContext = new Map();
        mockNode = {
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };

        const mockServiceOptions = {
            globalContext: {
                get: (key: string) => mockGlobalContext.get(key),
                set: (key: string, value: any) => mockGlobalContext.set(key, value),
            },
            flowContext: {
                get: jest.fn(),
                set: jest.fn(),
            },
            node: mockNode,
        };

        configService = new ConfigService(mockServiceOptions);
    });

    describe('mergeAndSetScaleConfigs', () => {
        it('should set scale configs when none exist', () => {
            const newConfigs: ScaleConfig[] = [
                { key: 'set_ec', operation: 'multiply', factor: 1000, direction: 'write' },
                { key: 'set_ec', operation: 'divide', factor: 1000, direction: 'read' },
            ];

            configService.initializeConfig('{}', JSON.stringify(newConfigs));

            const result = mockGlobalContext.get('scaleConfigs') as ScaleConfig[];
            expect(result).toHaveLength(2);
            expect(result).toEqual(expect.arrayContaining(newConfigs));
        });

        it('should merge scale configs without duplicates by key+direction', () => {
            // Pre-existing configs (simulating viis-telemetry or another node)
            const existingConfigs: ScaleConfig[] = [
                { key: 'fs01', operation: 'divide', factor: 10, direction: 'read' },
                { key: 'fs02', operation: 'divide', factor: 10, direction: 'read' },
            ];
            mockGlobalContext.set('scaleConfigs', existingConfigs);

            // New configs from viis-rpc-control
            const newConfigs: ScaleConfig[] = [
                { key: 'set_ec', operation: 'multiply', factor: 1000, direction: 'write' },
                { key: 'set_ec', operation: 'divide', factor: 1000, direction: 'read' },
            ];

            configService.initializeConfig('{}', JSON.stringify(newConfigs));

            const result = mockGlobalContext.get('scaleConfigs') as ScaleConfig[];
            expect(result).toHaveLength(4);
            expect(result.find(c => c.key === 'fs01')).toBeDefined();
            expect(result.find(c => c.key === 'fs02')).toBeDefined();
            expect(result.find(c => c.key === 'set_ec' && c.direction === 'write')).toBeDefined();
            expect(result.find(c => c.key === 'set_ec' && c.direction === 'read')).toBeDefined();
        });

        it('should override existing config with same key+direction', () => {
            // Pre-existing configs
            const existingConfigs: ScaleConfig[] = [
                { key: 'set_ec', operation: 'multiply', factor: 500, direction: 'write' },
            ];
            mockGlobalContext.set('scaleConfigs', existingConfigs);

            // New config with same key+direction but different factor
            const newConfigs: ScaleConfig[] = [
                { key: 'set_ec', operation: 'multiply', factor: 1000, direction: 'write' },
            ];

            configService.initializeConfig('{}', JSON.stringify(newConfigs));

            const result = mockGlobalContext.get('scaleConfigs') as ScaleConfig[];
            expect(result).toHaveLength(1);
            expect(result[0].factor).toBe(1000); // Should be updated to new value
        });

        it('should not modify existing configs when initializing with empty configs', () => {
            const existingConfigs: ScaleConfig[] = [
                { key: 'fs01', operation: 'divide', factor: 10, direction: 'read' },
            ];
            mockGlobalContext.set('scaleConfigs', existingConfigs);

            configService.initializeConfig('{}', '[]');

            const result = mockGlobalContext.get('scaleConfigs') as ScaleConfig[];
            expect(result).toHaveLength(1);
            expect(result[0].key).toBe('fs01');
        });

        it('should handle multiple nodes initializing with different configs', () => {
            // First node initializes
            const firstNodeConfigs: ScaleConfig[] = [
                { key: 'set_ec', operation: 'multiply', factor: 1000, direction: 'write' },
            ];
            configService.initializeConfig('{}', JSON.stringify(firstNodeConfigs));

            // Second node initializes with different configs
            const secondNodeConfigs: ScaleConfig[] = [
                { key: 'temp', operation: 'divide', factor: 10, direction: 'read' },
            ];
            configService.initializeConfig('{}', JSON.stringify(secondNodeConfigs));

            const result = mockGlobalContext.get('scaleConfigs') as ScaleConfig[];
            expect(result).toHaveLength(2);
            expect(result.find(c => c.key === 'set_ec')).toBeDefined();
            expect(result.find(c => c.key === 'temp')).toBeDefined();
        });
    });

    describe('updateScaleConfigs', () => {
        it('should merge updated configs with existing ones', () => {
            const existingConfigs: ScaleConfig[] = [
                { key: 'fs01', operation: 'divide', factor: 10, direction: 'read' },
            ];
            mockGlobalContext.set('scaleConfigs', existingConfigs);

            const newConfigs: ScaleConfig[] = [
                { key: 'set_ec', operation: 'multiply', factor: 1000, direction: 'write' },
            ];

            configService.updateScaleConfigs(newConfigs);

            const result = mockGlobalContext.get('scaleConfigs') as ScaleConfig[];
            expect(result).toHaveLength(2);
        });
    });
});
