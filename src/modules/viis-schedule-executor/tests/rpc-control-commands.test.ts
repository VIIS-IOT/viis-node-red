/**
 * Test for RPC Control Commands Logic
 * Tests the business logic: RPC control commands that are not found in modbus mapping
 * should be written to global variable configKeyValues
 */

import { ScheduleService } from '../viis-schedule-executor-service';
import { GlobalContextHelper } from '../../../ultils/global-context-helper';

// Mock Node-RED context
const mockFlowContext = {
    get: jest.fn(),
    set: jest.fn()
};

const mockGlobalContext = {
    get: jest.fn(),
    set: jest.fn()
};

const mockNode = {
    context: () => ({
        flow: mockFlowContext,
        global: mockGlobalContext
    }),
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn()
};

// Mock GlobalContextHelper
const mockGlobalHelper = {
    getJsonEnvVar: jest.fn(),
    getEnvVar: jest.fn()
} as unknown as GlobalContextHelper;

describe('RPC Control Commands Logic', () => {
    let scheduleService: ScheduleService;

    beforeEach(() => {
        jest.clearAllMocks();
        
        // Initialize service
        scheduleService = new ScheduleService(mockNode as any, mockGlobalHelper);
        
        // Setup default mock returns
        mockGlobalContext.get.mockImplementation((key: string) => {
            if (key === 'configKeyValues') {
                return {};
            }
            return {};
        });
    });

    describe('processRpcControlCommand', () => {
        it('should write to configKeyValues when key is not found in modbus mapping', () => {
            // Setup: No modbus mapping for the key
            mockGlobalHelper.getJsonEnvVar = jest.fn().mockImplementation((envKey: string) => {
                if (envKey === 'MODBUS_COILS') return { pump_1: 0, valve_A1: 1 };
                if (envKey === 'MODBUS_HOLDING_REGISTERS') return { set_flow_A1: 10, temperature: 12 };
                return {};
            });

            // Test: Process RPC control command with unmapped key
            const result = scheduleService.processRpcControlCommand('custom_setting', 42);

            // Verify: Should write to configKeyValues
            expect(result.success).toBe(true);
            expect(result.action).toBe('config');
            expect(result.result).toEqual({ key: 'custom_setting', value: 42 });
            
            // Verify configKeyValues was updated
            expect(mockGlobalContext.set).toHaveBeenCalledWith('configKeyValues', { custom_setting: 42 });
        });

        it('should return modbus action when key is found in coil mapping', () => {
            // Setup: Key exists in modbus coil mapping
            mockGlobalHelper.getJsonEnvVar = jest.fn().mockImplementation((envKey: string) => {
                if (envKey === 'MODBUS_COILS') return { pump_1: 0, valve_A1: 1 };
                if (envKey === 'MODBUS_HOLDING_REGISTERS') return { set_flow_A1: 10, temperature: 12 };
                return {};
            });

            // Test: Process RPC control command with mapped key
            const result = scheduleService.processRpcControlCommand('pump_1', true);

            // Verify: Should return modbus action
            expect(result.success).toBe(true);
            expect(result.action).toBe('modbus');
            expect(result.result).toEqual({ address: 0, type: 'coil' });
            
            // Verify configKeyValues was NOT updated
            expect(mockGlobalContext.set).not.toHaveBeenCalledWith('configKeyValues', expect.anything());
        });

        it('should return modbus action when key is found in holding register mapping', () => {
            // Setup: Key exists in modbus holding register mapping
            mockGlobalHelper.getJsonEnvVar = jest.fn().mockImplementation((envKey: string) => {
                if (envKey === 'MODBUS_COILS') return { pump_1: 0, valve_A1: 1 };
                if (envKey === 'MODBUS_HOLDING_REGISTERS') return { set_flow_A1: 10, temperature: 12 };
                return {};
            });

            // Test: Process RPC control command with mapped key
            const result = scheduleService.processRpcControlCommand('set_flow_A1', 150);

            // Verify: Should return modbus action
            expect(result.success).toBe(true);
            expect(result.action).toBe('modbus');
            expect(result.result).toEqual({ address: 10, type: 'holding' });
            
            // Verify configKeyValues was NOT updated
            expect(mockGlobalContext.set).not.toHaveBeenCalledWith('configKeyValues', expect.anything());
        });

        it('should handle multiple unmapped keys correctly', () => {
            // Setup: No modbus mapping for the keys
            mockGlobalHelper.getJsonEnvVar = jest.fn().mockImplementation((envKey: string) => {
                if (envKey === 'MODBUS_COILS') return { pump_1: 0 };
                if (envKey === 'MODBUS_HOLDING_REGISTERS') return { temperature: 12 };
                return {};
            });

            // Mock existing configKeyValues
            mockGlobalContext.get.mockImplementation((key: string) => {
                if (key === 'configKeyValues') {
                    return { existing_key: 'existing_value' };
                }
                return {};
            });

            // Test: Process first RPC control command
            const result1 = scheduleService.processRpcControlCommand('custom_setting_1', 42);
            expect(result1.success).toBe(true);
            expect(result1.action).toBe('config');

            // Test: Process second RPC control command
            const result2 = scheduleService.processRpcControlCommand('custom_setting_2', 'test_value');
            expect(result2.success).toBe(true);
            expect(result2.action).toBe('config');

            // Verify both keys were added to configKeyValues
            expect(mockGlobalContext.set).toHaveBeenCalledWith('configKeyValues', {
                existing_key: 'existing_value',
                custom_setting_1: 42
            });
            expect(mockGlobalContext.set).toHaveBeenCalledWith('configKeyValues', {
                existing_key: 'existing_value',
                custom_setting_2: 'test_value'
            });
        });

        it('should handle boolean values correctly', () => {
            // Setup: No modbus mapping
            mockGlobalHelper.getJsonEnvVar = jest.fn().mockReturnValue({});

            // Test: Process boolean value
            const result = scheduleService.processRpcControlCommand('debug_mode', true);

            // Verify: Should store boolean correctly
            expect(result.success).toBe(true);
            expect(result.action).toBe('config');
            expect(result.result).toEqual({ key: 'debug_mode', value: true });
            
            expect(mockGlobalContext.set).toHaveBeenCalledWith('configKeyValues', { debug_mode: true });
        });

        it('should handle string values correctly', () => {
            // Setup: No modbus mapping
            mockGlobalHelper.getJsonEnvVar = jest.fn().mockReturnValue({});

            // Test: Process string value
            const result = scheduleService.processRpcControlCommand('user_preference', 'high');

            // Verify: Should store string correctly
            expect(result.success).toBe(true);
            expect(result.action).toBe('config');
            expect(result.result).toEqual({ key: 'user_preference', value: 'high' });
            
            expect(mockGlobalContext.set).toHaveBeenCalledWith('configKeyValues', { user_preference: 'high' });
        });
    });
});
