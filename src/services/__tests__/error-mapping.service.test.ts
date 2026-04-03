/**
 * Unit tests for ErrorMappingService
 */

import { ErrorMappingService, ModbusErrorSource } from '../error-mapping.service';
import { GlobalContextHelper } from '../../ultils/global-context-helper';
import { NodeContext } from 'node-red';

// Mock GlobalContextHelper
jest.mock('../../ultils/global-context-helper');

describe('ErrorMappingService', () => {
    let errorMappingService: ErrorMappingService;
    let mockNodeContext: NodeContext;
    let mockGlobalContextHelper: jest.Mocked<GlobalContextHelper>;

    const sampleMapping = {
        device_type: 'Climate_Controller',
        mappings: [
            {
                register_type: 'holding',
                address: 1000,
                description: 'Temperature error register',
                error_codes: [
                    {
                        code: 1,
                        err_code: 'ERR_TEMP_HIGH',
                        message: 'Temperature too high',
                        severity: 'high',
                        auto_resolve: true,
                        description: 'Temperature exceeds threshold'
                    },
                    {
                        code: 2,
                        err_code: 'ERR_TEMP_SENSOR_FAULT',
                        message: 'Temperature sensor fault',
                        severity: 'critical',
                        auto_resolve: false
                    }
                ]
            },
            {
                register_type: 'coil',
                address: 500,
                description: 'Fan overrun flag',
                error_codes: [
                    {
                        code: true,
                        err_code: 'ERR_FAN_OVERRUN',
                        message: 'Fan running too long',
                        severity: 'medium',
                        auto_resolve: true
                    }
                ]
            }
        ]
    };

    beforeEach(() => {
        // Create mock node context
        mockNodeContext = {
            global: {
                get: jest.fn(),
                set: jest.fn(),
                keys: jest.fn()
            }
        } as any;

        // Mock GlobalContextHelper
        mockGlobalContextHelper = {
            getErrorCodeMappingForDevice: jest.fn(),
            getAvailableErrorDeviceTypes: jest.fn(),
            hasErrorCodeMappings: jest.fn()
        } as any;

        (GlobalContextHelper as jest.Mock).mockImplementation(() => mockGlobalContextHelper);

        errorMappingService = new ErrorMappingService(mockNodeContext);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('parseModbusError()', () => {
        it('should parse holding register error successfully', () => {
            mockGlobalContextHelper.getErrorCodeMappingForDevice.mockReturnValue(sampleMapping);

            const source: ModbusErrorSource = {
                register_type: 'holding',
                address: 1000,
                value: 1
            };

            const result = errorMappingService.parseModbusError(source, 'Climate_Controller');

            expect(result).not.toBeNull();
            expect(result?.err_code).toBe('ERR_TEMP_HIGH');
            expect(result?.message).toBe('Temperature too high');
            expect(result?.severity).toBe('high');
            expect(result?.auto_resolve).toBe(true);
            expect(result?.metadata?.register_type).toBe('holding');
            expect(result?.metadata?.address).toBe(1000);
            expect(result?.metadata?.raw_value).toBe(1);
            expect(result?.metadata?.device_type).toBe('Climate_Controller');
        });

        it('should parse coil error successfully', () => {
            mockGlobalContextHelper.getErrorCodeMappingForDevice.mockReturnValue(sampleMapping);

            const source: ModbusErrorSource = {
                register_type: 'coil',
                address: 500,
                value: true
            };

            const result = errorMappingService.parseModbusError(source, 'Climate_Controller');

            expect(result).not.toBeNull();
            expect(result?.err_code).toBe('ERR_FAN_OVERRUN');
            expect(result?.message).toBe('Fan running too long');
            expect(result?.severity).toBe('medium');
        });

        it('should return null if no mapping found for device type', () => {
            mockGlobalContextHelper.getErrorCodeMappingForDevice.mockReturnValue(null);

            const source: ModbusErrorSource = {
                register_type: 'holding',
                address: 1000,
                value: 1
            };

            const result = errorMappingService.parseModbusError(source, 'Unknown_Device');

            expect(result).toBeNull();
        });

        it('should return null if no mapping for specific register', () => {
            mockGlobalContextHelper.getErrorCodeMappingForDevice.mockReturnValue(sampleMapping);

            const source: ModbusErrorSource = {
                register_type: 'holding',
                address: 9999, // Non-existent address
                value: 1
            };

            const result = errorMappingService.parseModbusError(source, 'Climate_Controller');

            expect(result).toBeNull();
        });

        it('should return null if no error code for value', () => {
            mockGlobalContextHelper.getErrorCodeMappingForDevice.mockReturnValue(sampleMapping);

            const source: ModbusErrorSource = {
                register_type: 'holding',
                address: 1000,
                value: 99 // Non-existent error code
            };

            const result = errorMappingService.parseModbusError(source, 'Climate_Controller');

            expect(result).toBeNull();
        });

        it('should handle multiple error codes for same register', () => {
            mockGlobalContextHelper.getErrorCodeMappingForDevice.mockReturnValue(sampleMapping);

            // Test first error code
            let source: ModbusErrorSource = {
                register_type: 'holding',
                address: 1000,
                value: 1
            };
            let result = errorMappingService.parseModbusError(source, 'Climate_Controller');
            expect(result?.err_code).toBe('ERR_TEMP_HIGH');

            // Test second error code
            source = {
                register_type: 'holding',
                address: 1000,
                value: 2
            };
            result = errorMappingService.parseModbusError(source, 'Climate_Controller');
            expect(result?.err_code).toBe('ERR_TEMP_SENSOR_FAULT');
            expect(result?.auto_resolve).toBe(false);
        });
    });

    describe('shouldAutoResolve()', () => {
        it('should return true for auto_resolve error', () => {
            mockGlobalContextHelper.getErrorCodeMappingForDevice.mockReturnValue(sampleMapping);

            const source: ModbusErrorSource = {
                register_type: 'holding',
                address: 1000,
                value: 1
            };

            const result = errorMappingService.shouldAutoResolve(source, 'Climate_Controller');

            expect(result).toBe(true);
        });

        it('should return false for non-auto_resolve error', () => {
            mockGlobalContextHelper.getErrorCodeMappingForDevice.mockReturnValue(sampleMapping);

            const source: ModbusErrorSource = {
                register_type: 'holding',
                address: 1000,
                value: 2
            };

            const result = errorMappingService.shouldAutoResolve(source, 'Climate_Controller');

            expect(result).toBe(false);
        });

        it('should return true by default if no error found', () => {
            mockGlobalContextHelper.getErrorCodeMappingForDevice.mockReturnValue(sampleMapping);

            const source: ModbusErrorSource = {
                register_type: 'holding',
                address: 9999,
                value: 1
            };

            const result = errorMappingService.shouldAutoResolve(source, 'Climate_Controller');

            expect(result).toBe(true);
        });
    });

    describe('getAvailableDeviceTypes()', () => {
        it('should return list of device types', () => {
            mockGlobalContextHelper.getAvailableErrorDeviceTypes.mockReturnValue([
                'Climate_Controller',
                'Irrigation_System',
                'default'
            ]);

            const result = errorMappingService.getAvailableDeviceTypes();

            expect(result).toHaveLength(3);
            expect(result).toContain('Climate_Controller');
            expect(result).toContain('Irrigation_System');
            expect(result).toContain('default');
        });

        it('should return empty array if no mappings', () => {
            mockGlobalContextHelper.getAvailableErrorDeviceTypes.mockReturnValue([]);

            const result = errorMappingService.getAvailableDeviceTypes();

            expect(result).toHaveLength(0);
        });
    });

    describe('getMappingForDeviceType()', () => {
        it('should return mapping for device type', () => {
            mockGlobalContextHelper.getErrorCodeMappingForDevice.mockReturnValue(sampleMapping);

            const result = errorMappingService.getMappingForDeviceType('Climate_Controller');

            expect(result).not.toBeNull();
            expect(result?.device_type).toBe('Climate_Controller');
            expect(result?.mappings).toHaveLength(2);
        });

        it('should return null if device type not found', () => {
            mockGlobalContextHelper.getErrorCodeMappingForDevice.mockReturnValue(null);

            const result = errorMappingService.getMappingForDeviceType('Unknown');

            expect(result).toBeNull();
        });
    });

    describe('hasMappings()', () => {
        it('should return true if mappings exist', () => {
            mockGlobalContextHelper.hasErrorCodeMappings.mockReturnValue(true);

            const result = errorMappingService.hasMappings();

            expect(result).toBe(true);
        });

        it('should return false if no mappings', () => {
            mockGlobalContextHelper.hasErrorCodeMappings.mockReturnValue(false);

            const result = errorMappingService.hasMappings();

            expect(result).toBe(false);
        });
    });

    describe('getMappingStats()', () => {
        it('should return correct statistics', () => {
            mockGlobalContextHelper.getAvailableErrorDeviceTypes.mockReturnValue([
                'Climate_Controller',
                'default'
            ]);

            const stats = errorMappingService.getMappingStats();

            expect(stats.loaded).toBe(true);
            expect(stats.deviceTypeCount).toBe(2);
            expect(stats.deviceTypes).toHaveLength(2);
        });

        it('should return empty stats if no mappings', () => {
            mockGlobalContextHelper.getAvailableErrorDeviceTypes.mockReturnValue([]);

            const stats = errorMappingService.getMappingStats();

            expect(stats.loaded).toBe(false);
            expect(stats.deviceTypeCount).toBe(0);
            expect(stats.deviceTypes).toHaveLength(0);
        });
    });
});
