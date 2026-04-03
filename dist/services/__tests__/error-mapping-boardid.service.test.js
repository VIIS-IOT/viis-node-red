"use strict";
/**
 * Unit tests for ErrorMappingService - BoardId approach
 */
Object.defineProperty(exports, "__esModule", { value: true });
const error_mapping_service_1 = require("../error-mapping.service");
const global_context_helper_1 = require("../../ultils/global-context-helper");
// Mock GlobalContextHelper
jest.mock('../../ultils/global-context-helper');
describe('ErrorMappingService - BoardId Approach', () => {
    let errorMappingService;
    let mockNodeContext;
    let mockGlobalContextHelper;
    const sampleBoard1Mapping = {
        board_id: 'board1',
        board_name: 'Main Control Board',
        mappings: [
            {
                register_type: 'holding',
                address: 1000,
                description: 'Temperature error register',
                error_codes: [
                    {
                        code: 1,
                        err_code: 'ERR_TEMP_HIGH',
                        message: 'Nhiệt độ vượt ngưỡng',
                        severity: 'high',
                        auto_resolve: true
                    },
                    {
                        code: 2,
                        err_code: 'ERR_TEMP_SENSOR_FAULT',
                        message: 'Cảm biến nhiệt độ lỗi',
                        severity: 'critical',
                        auto_resolve: false
                    }
                ]
            },
            {
                register_type: 'coil',
                address: 500,
                description: 'Fan error flag',
                error_codes: [
                    {
                        code: true,
                        err_code: 'ERR_FAN_OVERRUN',
                        message: 'Quạt chạy quá lâu',
                        severity: 'medium',
                        auto_resolve: true
                    }
                ]
            }
        ]
    };
    const sampleBoard2Mapping = {
        board_id: 'board2',
        board_name: 'Sensor Board',
        mappings: [
            {
                register_type: 'holding',
                address: 2000,
                description: 'Pump error register',
                error_codes: [
                    {
                        code: 1,
                        err_code: 'ERR_PUMP_OVERLOAD',
                        message: 'Máy bơm quá tải',
                        severity: 'critical',
                        auto_resolve: false
                    }
                ]
            }
        ]
    };
    beforeEach(() => {
        mockNodeContext = {
            global: {
                get: jest.fn(),
                set: jest.fn(),
                keys: jest.fn()
            }
        };
        mockGlobalContextHelper = {
            getErrorCodeMappings: jest.fn().mockReturnValue({
                board1: sampleBoard1Mapping,
                board2: sampleBoard2Mapping
            }),
            getErrorCodeMappingForDevice: jest.fn(),
            getAvailableErrorDeviceTypes: jest.fn(),
            hasErrorCodeMappings: jest.fn()
        };
        global_context_helper_1.GlobalContextHelper.mockImplementation(() => mockGlobalContextHelper);
        errorMappingService = new error_mapping_service_1.ErrorMappingService(mockNodeContext);
    });
    describe('parseModbusErrorByBoardId()', () => {
        it('should parse holding register error with board ID', () => {
            var _a;
            const source = {
                register_type: 'holding',
                address: 1000,
                value: 1
            };
            const result = errorMappingService.parseModbusErrorByBoardId(source, 'board1');
            expect(result).not.toBeNull();
            expect(result === null || result === void 0 ? void 0 : result.err_code).toBe('ERR_TEMP_HIGH');
            expect(result === null || result === void 0 ? void 0 : result.message).toBe('Nhiệt độ vượt ngưỡng');
            expect(result === null || result === void 0 ? void 0 : result.severity).toBe('high');
            expect(result === null || result === void 0 ? void 0 : result.auto_resolve).toBe(true);
            expect((_a = result === null || result === void 0 ? void 0 : result.metadata) === null || _a === void 0 ? void 0 : _a.board_id).toBe('board1');
        });
        it('should parse coil error with board ID', () => {
            const source = {
                register_type: 'coil',
                address: 500,
                value: true
            };
            const result = errorMappingService.parseModbusErrorByBoardId(source, 'board1');
            expect(result).not.toBeNull();
            expect(result === null || result === void 0 ? void 0 : result.err_code).toBe('ERR_FAN_OVERRUN');
            expect(result === null || result === void 0 ? void 0 : result.message).toBe('Quạt chạy quá lâu');
            expect(result === null || result === void 0 ? void 0 : result.severity).toBe('medium');
        });
        it('should handle different boards correctly', () => {
            var _a;
            const source = {
                register_type: 'holding',
                address: 2000,
                value: 1
            };
            const result = errorMappingService.parseModbusErrorByBoardId(source, 'board2');
            expect(result).not.toBeNull();
            expect(result === null || result === void 0 ? void 0 : result.err_code).toBe('ERR_PUMP_OVERLOAD');
            expect((_a = result === null || result === void 0 ? void 0 : result.metadata) === null || _a === void 0 ? void 0 : _a.board_id).toBe('board2');
        });
        it('should return null for non-existent board', () => {
            const source = {
                register_type: 'holding',
                address: 1000,
                value: 1
            };
            const result = errorMappingService.parseModbusErrorByBoardId(source, 'board999');
            expect(result).toBeNull();
        });
        it('should return null for unmapped register address', () => {
            const source = {
                register_type: 'holding',
                address: 9999,
                value: 1
            };
            const result = errorMappingService.parseModbusErrorByBoardId(source, 'board1');
            expect(result).toBeNull();
        });
        it('should return null for unmapped error code value', () => {
            const source = {
                register_type: 'holding',
                address: 1000,
                value: 99 // Not defined in mapping
            };
            const result = errorMappingService.parseModbusErrorByBoardId(source, 'board1');
            expect(result).toBeNull();
        });
        it('should handle auto_resolve flag correctly', () => {
            const source = {
                register_type: 'holding',
                address: 1000,
                value: 2 // ERR_TEMP_SENSOR_FAULT with auto_resolve: false
            };
            const result = errorMappingService.parseModbusErrorByBoardId(source, 'board1');
            expect(result).not.toBeNull();
            expect(result === null || result === void 0 ? void 0 : result.err_code).toBe('ERR_TEMP_SENSOR_FAULT');
            expect(result === null || result === void 0 ? void 0 : result.auto_resolve).toBe(false);
        });
    });
    describe('getMappingForBoardId()', () => {
        it('should get mapping for board1', () => {
            const mapping = errorMappingService.getMappingForBoardId('board1');
            expect(mapping).not.toBeNull();
            expect(mapping === null || mapping === void 0 ? void 0 : mapping.board_id).toBe('board1');
            expect(mapping === null || mapping === void 0 ? void 0 : mapping.board_name).toBe('Main Control Board');
        });
        it('should get mapping for board2', () => {
            const mapping = errorMappingService.getMappingForBoardId('board2');
            expect(mapping).not.toBeNull();
            expect(mapping === null || mapping === void 0 ? void 0 : mapping.board_id).toBe('board2');
        });
        it('should return null for non-existent board', () => {
            const mapping = errorMappingService.getMappingForBoardId('board999');
            expect(mapping).toBeNull();
        });
    });
    describe('getAvailableBoardIds()', () => {
        it('should return list of available board IDs', () => {
            const boardIds = errorMappingService.getAvailableBoardIds();
            expect(boardIds).toContain('board1');
            expect(boardIds).toContain('board2');
            expect(boardIds.length).toBe(2);
        });
        it('should return empty array when no mappings', () => {
            mockGlobalContextHelper.getErrorCodeMappings.mockReturnValue(null);
            const boardIds = errorMappingService.getAvailableBoardIds();
            expect(boardIds).toEqual([]);
        });
    });
    describe('Edge Cases', () => {
        it('should handle coil with false value (no error)', () => {
            const source = {
                register_type: 'coil',
                address: 500,
                value: false
            };
            const result = errorMappingService.parseModbusErrorByBoardId(source, 'board1');
            // Should return null because coil=false means no error
            expect(result).toBeNull();
        });
        it('should handle holding register with value 0 (no error)', () => {
            const source = {
                register_type: 'holding',
                address: 1000,
                value: 0
            };
            const result = errorMappingService.parseModbusErrorByBoardId(source, 'board1');
            // Should return null because value=0 means no error
            expect(result).toBeNull();
        });
    });
});
