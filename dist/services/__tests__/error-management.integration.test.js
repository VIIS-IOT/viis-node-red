"use strict";
/**
 * Integration tests for Error Management System
 * Tests the full flow from error detection to notification creation
 */
Object.defineProperty(exports, "__esModule", { value: true });
const error_mapping_service_1 = require("../error-mapping.service");
describe('Error Management System - Integration Tests', () => {
    let mockNodeContext;
    let mockGlobalContext;
    let errorMappingService;
    let errorNotificationService;
    const sampleErrorCodeMappings = {
        'Climate_Controller': {
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
                            message: 'Nhiệt độ vượt ngưỡng an toàn',
                            severity: 'high',
                            auto_resolve: true,
                            description: 'Temperature exceeds safe threshold'
                        },
                        {
                            code: 2,
                            err_code: 'ERR_TEMP_SENSOR_FAULT',
                            message: 'Cảm biến nhiệt độ bị lỗi',
                            severity: 'critical',
                            auto_resolve: false
                        }
                    ]
                },
                {
                    register_type: 'coil',
                    address: 500,
                    error_codes: [
                        {
                            code: true,
                            err_code: 'ERR_FAN_OVERRUN',
                            message: 'Quạt chạy quá giới hạn thời gian',
                            severity: 'medium',
                            auto_resolve: true
                        }
                    ]
                }
            ]
        },
        'default': {
            device_type: 'default',
            mappings: [
                {
                    register_type: 'holding',
                    address: 9999,
                    error_codes: [
                        {
                            code: 1,
                            err_code: 'ERR_GENERAL',
                            message: 'General system error',
                            severity: 'medium',
                            auto_resolve: true
                        }
                    ]
                }
            ]
        }
    };
    beforeEach(() => {
        // Setup mock global context with error code mappings
        mockGlobalContext = {
            get: jest.fn((key) => {
                if (key === 'errorCodeMappings') {
                    return sampleErrorCodeMappings;
                }
                return undefined;
            }),
            set: jest.fn(),
            keys: jest.fn()
        };
        mockNodeContext = {
            global: mockGlobalContext
        };
        errorMappingService = new error_mapping_service_1.ErrorMappingService(mockNodeContext);
    });
    describe('End-to-End Modbus Error Flow', () => {
        it('should parse Modbus error and return complete error information', () => {
            const source = {
                register_type: 'holding',
                address: 1000,
                value: 1
            };
            const result = errorMappingService.parseModbusError(source, 'Climate_Controller');
            expect(result).not.toBeNull();
            expect(result === null || result === void 0 ? void 0 : result.err_code).toBe('ERR_TEMP_HIGH');
            expect(result === null || result === void 0 ? void 0 : result.message).toBe('Nhiệt độ vượt ngưỡng an toàn');
            expect(result === null || result === void 0 ? void 0 : result.severity).toBe('high');
            expect(result === null || result === void 0 ? void 0 : result.auto_resolve).toBe(true);
            expect(result === null || result === void 0 ? void 0 : result.metadata).toMatchObject({
                register_type: 'holding',
                address: 1000,
                raw_value: 1,
                device_type: 'Climate_Controller'
            });
        });
        it('should handle different error codes on same register', () => {
            // Test first error code
            let source = {
                register_type: 'holding',
                address: 1000,
                value: 1
            };
            let result = errorMappingService.parseModbusError(source, 'Climate_Controller');
            expect(result === null || result === void 0 ? void 0 : result.err_code).toBe('ERR_TEMP_HIGH');
            // Test second error code
            source = {
                register_type: 'holding',
                address: 1000,
                value: 2
            };
            result = errorMappingService.parseModbusError(source, 'Climate_Controller');
            expect(result === null || result === void 0 ? void 0 : result.err_code).toBe('ERR_TEMP_SENSOR_FAULT');
            expect(result === null || result === void 0 ? void 0 : result.auto_resolve).toBe(false);
        });
        it('should handle coil-based errors', () => {
            const source = {
                register_type: 'coil',
                address: 500,
                value: true
            };
            const result = errorMappingService.parseModbusError(source, 'Climate_Controller');
            expect(result).not.toBeNull();
            expect(result === null || result === void 0 ? void 0 : result.err_code).toBe('ERR_FAN_OVERRUN');
            expect(result === null || result === void 0 ? void 0 : result.severity).toBe('medium');
        });
        it('should fallback to default mapping for unknown device type', () => {
            const source = {
                register_type: 'holding',
                address: 9999,
                value: 1
            };
            const result = errorMappingService.parseModbusError(source, 'Unknown_Device');
            expect(result).not.toBeNull();
            expect(result === null || result === void 0 ? void 0 : result.err_code).toBe('ERR_GENERAL');
            expect(result === null || result === void 0 ? void 0 : result.message).toBe('General system error');
        });
        it('should return null for cleared error (value = 0)', () => {
            const source = {
                register_type: 'holding',
                address: 1000,
                value: 0 // No error
            };
            const result = errorMappingService.parseModbusError(source, 'Climate_Controller');
            expect(result).toBeNull();
        });
        it('should return null for cleared coil (value = false)', () => {
            const source = {
                register_type: 'coil',
                address: 500,
                value: false // No error
            };
            const result = errorMappingService.parseModbusError(source, 'Climate_Controller');
            expect(result).toBeNull();
        });
    });
    describe('Auto-Resolve Logic', () => {
        it('should identify auto-resolvable errors', () => {
            const source = {
                register_type: 'holding',
                address: 1000,
                value: 1
            };
            const shouldResolve = errorMappingService.shouldAutoResolve(source, 'Climate_Controller');
            expect(shouldResolve).toBe(true);
        });
        it('should identify non-auto-resolvable errors', () => {
            const source = {
                register_type: 'holding',
                address: 1000,
                value: 2 // Sensor fault - requires manual intervention
            };
            const shouldResolve = errorMappingService.shouldAutoResolve(source, 'Climate_Controller');
            expect(shouldResolve).toBe(false);
        });
    });
    describe('Device Type Discovery', () => {
        it('should list all available device types', () => {
            const deviceTypes = errorMappingService.getAvailableDeviceTypes();
            expect(deviceTypes).toContain('Climate_Controller');
            expect(deviceTypes).toContain('default');
            expect(deviceTypes.length).toBeGreaterThan(0);
        });
        it('should retrieve mapping for specific device type', () => {
            const mapping = errorMappingService.getMappingForDeviceType('Climate_Controller');
            expect(mapping).not.toBeNull();
            expect(mapping === null || mapping === void 0 ? void 0 : mapping.device_type).toBe('Climate_Controller');
            expect(mapping === null || mapping === void 0 ? void 0 : mapping.mappings).toHaveLength(2);
        });
    });
    describe('Statistics and Monitoring', () => {
        it('should provide mapping statistics', () => {
            const stats = errorMappingService.getMappingStats();
            expect(stats.loaded).toBe(true);
            expect(stats.deviceTypeCount).toBeGreaterThan(0);
            expect(stats.deviceTypes).toContain('Climate_Controller');
        });
        it('should detect if mappings are loaded', () => {
            const hasMappings = errorMappingService.hasMappings();
            expect(hasMappings).toBe(true);
        });
    });
    describe('Error Scenarios', () => {
        it('should handle non-existent register gracefully', () => {
            const source = {
                register_type: 'holding',
                address: 99999, // Non-existent
                value: 1
            };
            const result = errorMappingService.parseModbusError(source, 'Climate_Controller');
            expect(result).toBeNull();
        });
        it('should handle non-existent error code on valid register', () => {
            const source = {
                register_type: 'holding',
                address: 1000,
                value: 999 // Non-existent error code
            };
            const result = errorMappingService.parseModbusError(source, 'Climate_Controller');
            expect(result).toBeNull();
        });
        it('should handle missing global context mappings', () => {
            // Create new service with empty context
            const emptyContext = {
                global: {
                    get: jest.fn().mockReturnValue(undefined),
                    set: jest.fn(),
                    keys: jest.fn()
                }
            };
            const service = new error_mapping_service_1.ErrorMappingService(emptyContext);
            const result = service.parseModbusError({ register_type: 'holding', address: 1000, value: 1 }, 'Climate_Controller');
            expect(result).toBeNull();
            expect(service.hasMappings()).toBe(false);
        });
    });
    describe('Real-World Scenarios', () => {
        it('should handle temperature alarm lifecycle', () => {
            // 1. Temperature rises - error detected
            let source = {
                register_type: 'holding',
                address: 1000,
                value: 1
            };
            let error = errorMappingService.parseModbusError(source, 'Climate_Controller');
            expect(error === null || error === void 0 ? void 0 : error.err_code).toBe('ERR_TEMP_HIGH');
            expect(error === null || error === void 0 ? void 0 : error.auto_resolve).toBe(true);
            // 2. Temperature normalizes - error clears
            source = {
                register_type: 'holding',
                address: 1000,
                value: 0
            };
            error = errorMappingService.parseModbusError(source, 'Climate_Controller');
            expect(error).toBeNull(); // No error
            // 3. Verify it should auto-resolve
            source.value = 1;
            const shouldResolve = errorMappingService.shouldAutoResolve(source, 'Climate_Controller');
            expect(shouldResolve).toBe(true);
        });
        it('should handle sensor fault lifecycle', () => {
            // 1. Sensor fault detected
            const source = {
                register_type: 'holding',
                address: 1000,
                value: 2
            };
            const error = errorMappingService.parseModbusError(source, 'Climate_Controller');
            expect(error === null || error === void 0 ? void 0 : error.err_code).toBe('ERR_TEMP_SENSOR_FAULT');
            expect(error === null || error === void 0 ? void 0 : error.severity).toBe('critical');
            expect(error === null || error === void 0 ? void 0 : error.auto_resolve).toBe(false); // Requires manual intervention
            // 2. Verify it should NOT auto-resolve
            const shouldResolve = errorMappingService.shouldAutoResolve(source, 'Climate_Controller');
            expect(shouldResolve).toBe(false);
        });
    });
});
