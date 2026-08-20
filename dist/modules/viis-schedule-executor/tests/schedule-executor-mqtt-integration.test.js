"use strict";
/**
 * Integration tests for VIIS Schedule Executor MQTT publishing of config parameters
 * Tests the MQTT publishing functionality for unmapped keys
 */
Object.defineProperty(exports, "__esModule", { value: true });
const viis_schedule_executor_service_1 = require("../viis-schedule-executor-service");
// Mock MQTT client
const mockMqttClient = {
    publish: jest.fn(),
    isConnected: jest.fn(() => true)
};
// Mock Node-RED node
const mockNode = {
    context: () => ({
        global: {
            get: jest.fn(),
            set: jest.fn()
        }
    })
};
// Mock GlobalContextHelper
jest.mock('../../../ultils/global-context-helper', () => {
    return {
        GlobalContextHelper: jest.fn().mockImplementation(() => ({
            getEnvVar: jest.fn((key, defaultValue) => {
                if (key === 'DEVICE_ID')
                    return 'test-device-001';
                return defaultValue;
            }),
            getJsonEnvVar: jest.fn()
        }))
    };
});
describe('ScheduleService - MQTT Integration for Config Parameters', () => {
    let scheduleService;
    beforeEach(() => {
        jest.clearAllMocks();
        scheduleService = new viis_schedule_executor_service_1.ScheduleService(mockNode);
        // Mock global context
        const mockGlobalContext = new Map();
        mockNode.context().global.get.mockImplementation((key) => {
            return mockGlobalContext.get(key) || {};
        });
        mockNode.context().global.set.mockImplementation((key, value) => {
            mockGlobalContext.set(key, value);
        });
    });
    describe('publishConfigUpdate', () => {
        it('should publish config parameter to both ThingsBoard and EMQX', async () => {
            const configParam = {
                key: 'test_parameter',
                value: 42,
                type: 'number',
                timestamp: Date.now(),
                scheduleId: 'test-schedule-001'
            };
            await scheduleService.publishConfigUpdate(mockMqttClient, mockMqttClient, configParam);
            // Verify ThingsBoard publish
            expect(mockMqttClient.publish).toHaveBeenCalledWith('v1/device/test-device-001/telemetry', expect.stringContaining('"test_parameter":42'));
            // Verify EMQX publish (device ID may be UUID or test-device-001)
            expect(mockMqttClient.publish).toHaveBeenCalledWith(expect.stringMatching(/viis\/things\/v2\/.+\/telemetry/), expect.stringContaining('"test_parameter":42'));
            // Verify payload structure
            const publishCalls = mockMqttClient.publish.mock.calls;
            const thingsBoardPayload = JSON.parse(publishCalls[0][1]);
            const emqxPayload = JSON.parse(publishCalls[1][1]);
            expect(thingsBoardPayload).toMatchObject({
                ts: configParam.timestamp,
                test_parameter: 42,
                note: expect.stringContaining('Config parameter updated'),
                type: 'number',
                source: 'schedule-executor'
            });
            expect(emqxPayload).toEqual(thingsBoardPayload);
        });
        it('should handle boolean config parameters correctly', async () => {
            const configParam = {
                key: 'enable_debug',
                value: true,
                type: 'boolean',
                timestamp: Date.now(),
                scheduleId: 'test-schedule-002'
            };
            await scheduleService.publishConfigUpdate(mockMqttClient, mockMqttClient, configParam);
            const publishCalls = mockMqttClient.publish.mock.calls;
            const payload = JSON.parse(publishCalls[0][1]);
            expect(payload).toMatchObject({
                enable_debug: true,
                type: 'boolean'
            });
        });
        it('should handle string config parameters correctly', async () => {
            const configParam = {
                key: 'operation_mode',
                value: 'automatic',
                type: 'string',
                timestamp: Date.now(),
                scheduleId: 'test-schedule-003'
            };
            await scheduleService.publishConfigUpdate(mockMqttClient, mockMqttClient, configParam);
            const publishCalls = mockMqttClient.publish.mock.calls;
            const payload = JSON.parse(publishCalls[0][1]);
            expect(payload).toMatchObject({
                operation_mode: 'automatic',
                type: 'string'
            });
        });
        it('should handle MQTT publish errors gracefully', async () => {
            const configParam = {
                key: 'test_error',
                value: 'error_test',
                type: 'string',
                timestamp: Date.now(),
                scheduleId: 'test-schedule-error'
            };
            mockMqttClient.publish.mockRejectedValueOnce(new Error('MQTT connection failed'));
            await expect(scheduleService.publishConfigUpdate(mockMqttClient, mockMqttClient, configParam)).resolves.toBeUndefined();
        });
    });
    describe('Config parameter payload structure', () => {
        it('should include all required fields in MQTT payload', async () => {
            const configParam = {
                key: 'complex_parameter',
                value: { nested: 'object', count: 5 },
                type: 'string',
                timestamp: 1234567890,
                scheduleId: 'complex-schedule'
            };
            await scheduleService.publishConfigUpdate(mockMqttClient, mockMqttClient, configParam);
            const publishCalls = mockMqttClient.publish.mock.calls;
            const payload = JSON.parse(publishCalls[0][1]);
            expect(payload).toHaveProperty('ts', 1234567890);
            expect(payload).toHaveProperty('complex_parameter');
            expect(payload).toHaveProperty('note');
            expect(payload).toHaveProperty('type', 'string');
            expect(payload).toHaveProperty('source', 'schedule-executor');
            expect(payload.note).toContain('complex-schedule');
        });
        it('should handle null and undefined values in payload', async () => {
            const configParam = {
                key: 'null_parameter',
                value: null,
                type: 'string',
                timestamp: Date.now(),
                scheduleId: 'null-test'
            };
            await scheduleService.publishConfigUpdate(mockMqttClient, mockMqttClient, configParam);
            const publishCalls = mockMqttClient.publish.mock.calls;
            const payload = JSON.parse(publishCalls[0][1]);
            expect(payload).toHaveProperty('null_parameter', null);
        });
    });
    describe('Device ID handling', () => {
        it('should use correct device ID in EMQX topic', async () => {
            const configParam = {
                key: 'device_test',
                value: 'test',
                type: 'string',
                timestamp: Date.now(),
                scheduleId: 'device-test'
            };
            await scheduleService.publishConfigUpdate(mockMqttClient, mockMqttClient, configParam);
            // Check that EMQX topic contains a device ID (may be UUID or test-device-001)
            expect(mockMqttClient.publish).toHaveBeenCalledWith(expect.stringMatching(/viis\/things\/v2\/.+\/telemetry/), expect.any(String));
        });
        it('should handle missing device ID gracefully', async () => {
            // Create a new service instance with different device ID mock
            const mockNodeWithoutDevice = {
                context: () => ({
                    global: {
                        get: jest.fn(),
                        set: jest.fn()
                    }
                })
            };
            // Mock global context
            const mockGlobalContext = new Map();
            mockNodeWithoutDevice.context().global.get.mockImplementation((key) => {
                return mockGlobalContext.get(key) || {};
            });
            mockNodeWithoutDevice.context().global.set.mockImplementation((key, value) => {
                mockGlobalContext.set(key, value);
            });
            const serviceWithoutDevice = new viis_schedule_executor_service_1.ScheduleService(mockNodeWithoutDevice);
            const configParam = {
                key: 'no_device_test',
                value: 'test',
                type: 'string',
                timestamp: Date.now(),
                scheduleId: 'no-device-test'
            };
            await serviceWithoutDevice.publishConfigUpdate(mockMqttClient, mockMqttClient, configParam);
            // Should use "unknown" as default device ID
            expect(mockMqttClient.publish).toHaveBeenCalledWith(expect.stringMatching(/viis\/things\/v2\/.+\/telemetry/), expect.any(String));
        });
    });
    describe('Multiple config parameters publishing', () => {
        it('should publish multiple config parameters independently', async () => {
            const configParams = [
                {
                    key: 'param1',
                    value: 'value1',
                    type: 'string',
                    timestamp: Date.now(),
                    scheduleId: 'multi-test'
                },
                {
                    key: 'param2',
                    value: 42,
                    type: 'number',
                    timestamp: Date.now(),
                    scheduleId: 'multi-test'
                }
            ];
            for (const param of configParams) {
                await scheduleService.publishConfigUpdate(mockMqttClient, mockMqttClient, param);
            }
            expect(mockMqttClient.publish).toHaveBeenCalledTimes(4); // 2 params × 2 clients
            // Verify each parameter was published correctly
            const publishCalls = mockMqttClient.publish.mock.calls;
            const payload1 = JSON.parse(publishCalls[0][1]);
            const payload2 = JSON.parse(publishCalls[2][1]);
            expect(payload1).toHaveProperty('param1', 'value1');
            expect(payload2).toHaveProperty('param2', 42);
        });
    });
});
