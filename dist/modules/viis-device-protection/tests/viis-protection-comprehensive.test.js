"use strict";
/**
 * Unit Tests for VIIS Device Protection Node
 *
 * Comprehensive test suite covering:
 * - ProtectionManager logic
 * - ConfigService functionality
 * - Integration scenarios
 */
Object.defineProperty(exports, "__esModule", { value: true });
const protection_manager_1 = require("../protection-manager");
const configService_1 = require("../services/configService");
// Mock Node-RED context
const createMockContext = (globalData = {}) => ({
    global: {
        get: jest.fn((key) => globalData[key] || null),
        set: jest.fn(),
    },
    flow: {
        get: jest.fn(),
        set: jest.fn(),
    },
});
// Mock Node-RED node
const createMockNode = (contextData = {}) => ({
    context: () => createMockContext(contextData),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    send: jest.fn(),
    status: jest.fn(),
    id: 'test-node-id',
});
describe('VIIS Device Protection', () => {
    // ========================================================================
    // ProtectionManager Tests
    // ========================================================================
    describe('ProtectionManager', () => {
        let protectionManager;
        beforeEach(() => {
            protectionManager = new protection_manager_1.ProtectionManager();
        });
        afterEach(() => {
            protectionManager.clearAllStates();
        });
        describe('Bypass Protection', () => {
            it('should allow all operations when bypass is enabled', () => {
                const config = {
                    maxTimeOn: 60,
                    minTimeOn: 10,
                    minOffTime: 30,
                    bypass: true,
                    forceOn: false,
                    forceOff: false,
                    upperLimit: 0,
                    lowerLimit: 0,
                    deviceType: 'lamp'
                };
                const result = protectionManager.evaluateProtection('test_device', true, config);
                expect(result.allowed).toBe(true);
                expect(result.action).toBe('bypass');
                expect(result.reason).toContain('Bypass active');
            });
            it('should skip all protection checks when bypassed', () => {
                const config = {
                    maxTimeOn: 1,
                    minTimeOn: 100,
                    minOffTime: 100,
                    bypass: true,
                    forceOn: false,
                    forceOff: false,
                    upperLimit: 0,
                    lowerLimit: 0,
                    deviceType: 'lamp'
                };
                const result = protectionManager.evaluateProtection('test_device', true, config);
                expect(result.allowed).toBe(true);
                expect(result.action).toBe('bypass');
            });
        });
        describe('Force ON/OFF', () => {
            it('should force ON when forceOn is true', () => {
                const config = {
                    maxTimeOn: 0,
                    minTimeOn: 0,
                    minOffTime: 0,
                    bypass: false,
                    forceOn: true,
                    forceOff: false,
                    upperLimit: 0,
                    lowerLimit: 0,
                    deviceType: 'lamp'
                };
                const result = protectionManager.evaluateProtection('test_device', false, config);
                expect(result.allowed).toBe(true);
                expect(result.finalState).toBe(true);
                expect(result.action).toBe('force_on');
            });
            it('should force OFF when forceOff is true', () => {
                const config = {
                    maxTimeOn: 0,
                    minTimeOn: 0,
                    minOffTime: 0,
                    bypass: false,
                    forceOn: false,
                    forceOff: true,
                    upperLimit: 0,
                    lowerLimit: 0,
                    deviceType: 'lamp'
                };
                const result = protectionManager.evaluateProtection('test_device', true, config);
                expect(result.allowed).toBe(true);
                expect(result.finalState).toBe(false);
                expect(result.action).toBe('force_off');
            });
            it('should prioritize force OFF when both are true', () => {
                const config = {
                    maxTimeOn: 0,
                    minTimeOn: 0,
                    minOffTime: 0,
                    bypass: false,
                    forceOn: true,
                    forceOff: true,
                    upperLimit: 0,
                    lowerLimit: 0,
                    deviceType: 'lamp'
                };
                const result = protectionManager.evaluateProtection('test_device', true, config);
                expect(result.allowed).toBe(false);
                expect(result.finalState).toBe(false);
                expect(result.reason).toContain('prioritizing OFF');
            });
        });
        describe('Max Time ON Protection', () => {
            beforeAll(() => {
                jest.useFakeTimers();
            });
            afterAll(() => {
                jest.useRealTimers();
            });
            it('should allow operation within max time', () => {
                const config = {
                    maxTimeOn: 60,
                    minTimeOn: 0,
                    minOffTime: 0,
                    bypass: false,
                    forceOn: false,
                    forceOff: false,
                    upperLimit: 0,
                    lowerLimit: 0,
                    deviceType: 'lamp'
                };
                const result = protectionManager.evaluateProtection('test_device', true, config);
                expect(result.allowed).toBe(true);
                expect(result.action).toBe('allow');
            });
            it('should auto OFF when max time is exceeded', () => {
                const config = {
                    maxTimeOn: 5,
                    minTimeOn: 0,
                    minOffTime: 0,
                    bypass: false,
                    forceOn: false,
                    forceOff: false,
                    upperLimit: 0,
                    lowerLimit: 0,
                    deviceType: 'lamp'
                };
                protectionManager.evaluateProtection('test_device', true, config);
                jest.advanceTimersByTime(6000);
                const result = protectionManager.evaluateProtection('test_device', true, config);
                expect(result.allowed).toBe(true);
                expect(result.finalState).toBe(false);
                expect(result.action).toBe('auto_off');
                expect(result.reason).toContain('Max time');
            });
            it('should track max time violations', () => {
                const config = {
                    maxTimeOn: 1,
                    minTimeOn: 0,
                    minOffTime: 0,
                    bypass: false,
                    forceOn: false,
                    forceOff: false,
                    upperLimit: 0,
                    lowerLimit: 0,
                    deviceType: 'lamp'
                };
                protectionManager.evaluateProtection('test_device', true, config);
                jest.advanceTimersByTime(2000);
                protectionManager.evaluateProtection('test_device', true, config);
                const stats = protectionManager.getViolationStats('test_device');
                expect(stats === null || stats === void 0 ? void 0 : stats.maxTime).toBeGreaterThan(0);
            });
        });
        describe('Sensor-based Protection', () => {
            it('should auto ON when temperature exceeds upper limit (cooling)', () => {
                const config = {
                    maxTimeOn: 0,
                    minTimeOn: 0,
                    minOffTime: 0,
                    bypass: false,
                    forceOn: false,
                    forceOff: false,
                    upperLimit: 30,
                    lowerLimit: 20,
                    deviceType: 'cool_ac1'
                };
                protectionManager.updateSensorValue('cool_ac1', 32);
                const result = protectionManager.evaluateProtection('cool_ac1', false, config);
                expect(result.allowed).toBe(true);
                expect(result.finalState).toBe(true);
                expect(result.action).toBe('auto_on');
                expect(result.reason).toContain('upper limit');
            });
            it('should auto OFF when temperature is below lower limit (cooling)', () => {
                const config = {
                    maxTimeOn: 0,
                    minTimeOn: 0,
                    minOffTime: 0,
                    bypass: false,
                    forceOn: false,
                    forceOff: false,
                    upperLimit: 30,
                    lowerLimit: 22,
                    deviceType: 'cool_ac1'
                };
                protectionManager.updateSensorValue('cool_ac1', 20);
                const result = protectionManager.evaluateProtection('cool_ac1', true, config);
                expect(result.allowed).toBe(true);
                expect(result.finalState).toBe(false);
                expect(result.action).toBe('auto_off');
                expect(result.reason).toContain('lower limit');
            });
            it('should include sensor value in metadata', () => {
                var _a;
                const config = {
                    maxTimeOn: 0,
                    minTimeOn: 0,
                    minOffTime: 0,
                    bypass: false,
                    forceOn: false,
                    forceOff: false,
                    upperLimit: 30,
                    lowerLimit: 0,
                    deviceType: 'cool_ac1'
                };
                protectionManager.updateSensorValue('cool_ac1', 35);
                const result = protectionManager.evaluateProtection('cool_ac1', false, config);
                expect((_a = result.metadata) === null || _a === void 0 ? void 0 : _a.sensorValue).toBe(35);
            });
        });
        describe('Violation Tracking', () => {
            beforeAll(() => {
                jest.useFakeTimers();
            });
            afterAll(() => {
                jest.useRealTimers();
            });
            it('should track violations separately', () => {
                const config = {
                    maxTimeOn: 1,
                    minTimeOn: 0,
                    minOffTime: 0,
                    bypass: false,
                    forceOn: false,
                    forceOff: false,
                    upperLimit: 0,
                    lowerLimit: 0,
                    deviceType: 'lamp'
                };
                protectionManager.evaluateProtection('test_device', true, config);
                jest.advanceTimersByTime(2000);
                protectionManager.evaluateProtection('test_device', true, config);
                const stats = protectionManager.getViolationStats('test_device');
                expect(stats === null || stats === void 0 ? void 0 : stats.maxTime).toBeGreaterThan(0);
            });
            it('should reset violations on command', () => {
                const config = {
                    maxTimeOn: 1,
                    minTimeOn: 0,
                    minOffTime: 0,
                    bypass: false,
                    forceOn: false,
                    forceOff: false,
                    upperLimit: 0,
                    lowerLimit: 0,
                    deviceType: 'lamp'
                };
                protectionManager.evaluateProtection('test_device', true, config);
                jest.advanceTimersByTime(2000);
                protectionManager.evaluateProtection('test_device', true, config);
                protectionManager.resetViolations('test_device');
                const stats = protectionManager.getViolationStats('test_device');
                expect(stats === null || stats === void 0 ? void 0 : stats.maxTime).toBe(0);
            });
        });
        describe('Multi-device Independence', () => {
            beforeAll(() => {
                jest.useFakeTimers();
            });
            afterAll(() => {
                jest.useRealTimers();
            });
            it('should handle multiple devices independently', () => {
                const config1 = {
                    maxTimeOn: 10,
                    minTimeOn: 0,
                    minOffTime: 0,
                    bypass: false,
                    forceOn: false,
                    forceOff: false,
                    upperLimit: 0,
                    lowerLimit: 0,
                    deviceType: 'lamp'
                };
                const config2 = {
                    maxTimeOn: 20,
                    minTimeOn: 0,
                    minOffTime: 0,
                    bypass: false,
                    forceOn: false,
                    forceOff: false,
                    upperLimit: 0,
                    lowerLimit: 0,
                    deviceType: 'fan'
                };
                protectionManager.evaluateProtection('lamp', true, config1);
                protectionManager.evaluateProtection('fan', true, config2);
                jest.advanceTimersByTime(15000);
                const lampResult = protectionManager.evaluateProtection('lamp', true, config1);
                expect(lampResult.action).toBe('auto_off');
                const fanResult = protectionManager.evaluateProtection('fan', true, config2);
                expect(fanResult.action).toBe('allow');
            });
        });
    });
    // ========================================================================
    // ConfigService Tests
    // ========================================================================
    describe('ConfigService', () => {
        it('should get config key values from global context', () => {
            const mockData = {
                configKeyValues: {
                    'LAMP_PROTECT_MAX_TIME_ON': 60,
                    'LAMP_PROTECT_BYPASS': false
                }
            };
            const mockNode = createMockNode(mockData);
            const configService = new configService_1.ConfigService(mockNode);
            const result = configService.getConfigKeyValues();
            expect(result).toEqual(mockData.configKeyValues);
        });
        it('should get protection config for device', () => {
            const mockData = {
                configKeyValues: {
                    'lamp_protect_max_time_on': 300,
                    'lamp_protect_min_time_on': 60,
                    'lamp_protect_bypass': false,
                    'lamp_protect_force_on': true,
                    'lamp_protect_upper_limit': 30
                }
            };
            const mockNode = createMockNode(mockData);
            const configService = new configService_1.ConfigService(mockNode);
            const result = configService.getProtectionConfig('lamp');
            expect(result.maxTimeOn).toBe(300);
            expect(result.minTimeOn).toBe(60);
            expect(result.bypass).toBe(false);
            expect(result.forceOn).toBe(true);
            expect(result.upperLimit).toBe(30);
            expect(result.deviceType).toBe('lamp');
        });
        it('should get coil data from global context', () => {
            const mockData = {
                coilRegisterData: {
                    'LAMP_CONTROL': true,
                    'FAN_CONTROL': false
                }
            };
            const mockNode = createMockNode(mockData);
            const configService = new configService_1.ConfigService(mockNode);
            const result = configService.getCoilData();
            expect(result).toEqual(mockData.coilRegisterData);
        });
        it('should get sensor data from global context', () => {
            const mockData = {
                sensorRegisterData: {
                    'cool_Aquara_temp_1': 25.5,
                    'humid_sensor_1': 65.0
                }
            };
            const mockNode = createMockNode(mockData);
            const configService = new configService_1.ConfigService(mockNode);
            const result = configService.getSensorData();
            expect(result).toEqual(mockData.sensorRegisterData);
        });
        it('should get specific coil state', () => {
            const mockData = {
                coilRegisterData: {
                    'LAMP_CONTROL': true
                }
            };
            const mockNode = createMockNode(mockData);
            const configService = new configService_1.ConfigService(mockNode);
            const result = configService.getCoilState('LAMP_CONTROL');
            expect(result).toBe(true);
        });
        it('should get specific sensor value', () => {
            const mockData = {
                sensorRegisterData: {
                    'cool_Aquara_temp_1': 28.5
                }
            };
            const mockNode = createMockNode(mockData);
            const configService = new configService_1.ConfigService(mockNode);
            const result = configService.getSensorValue('cool_Aquara_temp_1');
            expect(result).toBe(28.5);
        });
        it('should return empty objects when data is missing', () => {
            const mockNode = createMockNode({});
            const configService = new configService_1.ConfigService(mockNode);
            expect(configService.getConfigKeyValues()).toEqual({});
            expect(configService.getCoilData()).toEqual({});
            expect(configService.getSensorData()).toEqual({});
        });
        it('should handle alternative field names (UPPER_TEMP, LOWER_TEMP)', () => {
            const mockData = {
                configKeyValues: {
                    'cool_protect_1_upper_temp': 32,
                    'cool_protect_1_lower_temp': 20
                }
            };
            const mockNode = createMockNode(mockData);
            const configService = new configService_1.ConfigService(mockNode);
            const result = configService.getProtectionConfig('cool_ac1');
            expect(result.upperLimit).toBe(32);
            expect(result.lowerLimit).toBe(20);
        });
        it('should resolve generalized protect config for dynamic label', () => {
            const mockData = {
                configKeyValues: {
                    'lamp_control_protect_max_time_on': 120,
                    'lamp_control_protect_bypass': true
                }
            };
            const mockNode = createMockNode(mockData);
            const configService = new configService_1.ConfigService(mockNode);
            const result = configService.getProtectionConfigByLabel('lamp_control_1');
            expect(result.maxTimeOn).toBe(120);
            expect(result.bypass).toBe(true);
            expect(result.deviceType).toBe('lamp_control_1');
        });
        it('should prioritize specific protect config over generalized config', () => {
            const mockData = {
                configKeyValues: {
                    'lamp_control_protect_max_time_on': 120,
                    'lamp_control_1_protect_max_time_on': 30,
                    'lamp_control_protect_force_on': false,
                    'lamp_control_1_protect_force_on': true
                }
            };
            const mockNode = createMockNode(mockData);
            const configService = new configService_1.ConfigService(mockNode);
            const result = configService.getProtectionConfigByLabel('lamp_control_1');
            expect(result.maxTimeOn).toBe(30);
            expect(result.forceOn).toBe(true);
        });
    });
});
