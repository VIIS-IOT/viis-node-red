"use strict";
/**
 * Unit tests for GlobalContextHelper error code methods
 */
Object.defineProperty(exports, "__esModule", { value: true });
const global_context_helper_1 = require("../global-context-helper");
describe('GlobalContextHelper - Error Code Methods', () => {
    let globalContextHelper;
    let mockNodeContext;
    let mockGlobalContext;
    const sampleErrorCodeMappings = {
        'Climate_Controller': {
            device_type: 'Climate_Controller',
            mappings: [
                {
                    register_type: 'holding',
                    address: 1000,
                    error_codes: [
                        {
                            code: 1,
                            err_code: 'ERR_TEMP_HIGH',
                            message: 'Temperature high',
                            severity: 'high'
                        }
                    ]
                }
            ]
        },
        'Irrigation_System': {
            device_type: 'Irrigation_System',
            mappings: []
        },
        'default': {
            device_type: 'default',
            mappings: []
        }
    };
    beforeEach(() => {
        mockGlobalContext = {
            get: jest.fn(),
            set: jest.fn(),
            keys: jest.fn()
        };
        mockNodeContext = {
            global: mockGlobalContext
        };
        globalContextHelper = new global_context_helper_1.GlobalContextHelper(mockNodeContext);
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    describe('getErrorCodeMappings()', () => {
        it('should return all error code mappings from global context', () => {
            mockGlobalContext.get.mockReturnValue(sampleErrorCodeMappings);
            const result = globalContextHelper.getErrorCodeMappings();
            expect(mockGlobalContext.get).toHaveBeenCalledWith('errorCodeMappings');
            expect(result).toEqual(sampleErrorCodeMappings);
            expect(Object.keys(result)).toHaveLength(3);
        });
        it('should return empty object if no mappings exist', () => {
            mockGlobalContext.get.mockReturnValue(undefined);
            const result = globalContextHelper.getErrorCodeMappings();
            expect(result).toEqual({});
        });
        it('should return empty object if mappings is null', () => {
            mockGlobalContext.get.mockReturnValue(null);
            const result = globalContextHelper.getErrorCodeMappings();
            expect(result).toEqual({});
        });
    });
    describe('getErrorCodeMappingForDevice()', () => {
        beforeEach(() => {
            mockGlobalContext.get.mockReturnValue(sampleErrorCodeMappings);
        });
        it('should return mapping for specific device type', () => {
            const result = globalContextHelper.getErrorCodeMappingForDevice('Climate_Controller');
            expect(result).not.toBeNull();
            expect(result === null || result === void 0 ? void 0 : result.device_type).toBe('Climate_Controller');
            expect(result === null || result === void 0 ? void 0 : result.mappings).toHaveLength(1);
        });
        it('should return mapping for another device type', () => {
            const result = globalContextHelper.getErrorCodeMappingForDevice('Irrigation_System');
            expect(result).not.toBeNull();
            expect(result === null || result === void 0 ? void 0 : result.device_type).toBe('Irrigation_System');
        });
        it('should fallback to default if device type not found', () => {
            const result = globalContextHelper.getErrorCodeMappingForDevice('Unknown_Device');
            expect(result).not.toBeNull();
            expect(result === null || result === void 0 ? void 0 : result.device_type).toBe('default');
        });
        it('should return null if no mappings exist at all', () => {
            mockGlobalContext.get.mockReturnValue({});
            const result = globalContextHelper.getErrorCodeMappingForDevice('Climate_Controller');
            expect(result).toBeNull();
        });
        it('should return null if neither device type nor default exists', () => {
            mockGlobalContext.get.mockReturnValue({
                'Other_Device': { device_type: 'Other_Device' }
            });
            const result = globalContextHelper.getErrorCodeMappingForDevice('Unknown_Device');
            expect(result).toBeNull();
        });
    });
    describe('getAvailableErrorDeviceTypes()', () => {
        it('should return all available device types', () => {
            mockGlobalContext.get.mockReturnValue(sampleErrorCodeMappings);
            const result = globalContextHelper.getAvailableErrorDeviceTypes();
            expect(result).toHaveLength(3);
            expect(result).toContain('Climate_Controller');
            expect(result).toContain('Irrigation_System');
            expect(result).toContain('default');
        });
        it('should return empty array if no mappings exist', () => {
            mockGlobalContext.get.mockReturnValue({});
            const result = globalContextHelper.getAvailableErrorDeviceTypes();
            expect(result).toHaveLength(0);
        });
        it('should return empty array if mappings is undefined', () => {
            mockGlobalContext.get.mockReturnValue(undefined);
            const result = globalContextHelper.getAvailableErrorDeviceTypes();
            expect(result).toHaveLength(0);
        });
    });
    describe('hasErrorCodeMappings()', () => {
        it('should return true if mappings exist', () => {
            mockGlobalContext.get.mockReturnValue(sampleErrorCodeMappings);
            const result = globalContextHelper.hasErrorCodeMappings();
            expect(result).toBe(true);
        });
        it('should return false if mappings is empty object', () => {
            mockGlobalContext.get.mockReturnValue({});
            const result = globalContextHelper.hasErrorCodeMappings();
            expect(result).toBe(false);
        });
        it('should return false if mappings is undefined', () => {
            mockGlobalContext.get.mockReturnValue(undefined);
            const result = globalContextHelper.hasErrorCodeMappings();
            expect(result).toBe(false);
        });
        it('should return false if mappings is null', () => {
            mockGlobalContext.get.mockReturnValue(null);
            const result = globalContextHelper.hasErrorCodeMappings();
            expect(result).toBe(false);
        });
    });
    describe('Integration with namespace', () => {
        it('should work with namespaced context', () => {
            const namespacedHelper = new global_context_helper_1.GlobalContextHelper(mockNodeContext, 'test_namespace');
            mockGlobalContext.get.mockReturnValue(sampleErrorCodeMappings);
            const result = namespacedHelper.getErrorCodeMappings();
            // Error code mappings are stored globally, not namespaced
            expect(mockGlobalContext.get).toHaveBeenCalledWith('errorCodeMappings');
            expect(result).toEqual(sampleErrorCodeMappings);
        });
    });
});
