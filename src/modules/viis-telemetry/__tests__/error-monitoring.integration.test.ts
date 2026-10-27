/**
 * Unit tests for proactive error monitoring on Modbus connection failures
 * Tests the error notification creation in ViisTelemetryPollingService
 */

import { ViisTelemetryPollingService } from '../viis-telemetry-polling-service';
import { Node, NodeContext } from 'node-red';
import { ModbusClientCore } from '../../../core/modbus-client';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { MAX_CONSECUTIVE_FAILURES, MAX_RETRY_ATTEMPTS } from '../viis-telemetry-constants';

// Mock ErrorNotificationService
jest.mock('../../../services/error-notification.service');

describe('ViisTelemetryPollingService - Error Monitoring', () => {
  let pollingService: ViisTelemetryPollingService;
  let mockNode: any;
  let mockNodeContext: any;
  let mockModbusClient: any;
  let createFromBusinessLogicSpy: jest.SpyInstance;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Mock Node
    mockNode = {
      id: 'test-node-id',
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
      status: jest.fn(),
      context: jest.fn().mockReturnValue({
        global: {
          get: jest.fn().mockReturnValue(null),
          set: jest.fn()
        }
      })
    } as unknown as Node;

    // Mock NodeContext
    mockNodeContext = {
      set: jest.fn(),
      get: jest.fn(),
      global: {
        get: jest.fn().mockReturnValue(null),
        set: jest.fn()
      }
    } as unknown as NodeContext;

    // Mock ModbusClientCore with failing methods
    mockModbusClient = {
      readHoldingRegisters: jest.fn().mockRejectedValue(new Error('Connection timeout')),
      readInputRegisters: jest.fn().mockRejectedValue(new Error('Connection refused')),
      readCoils: jest.fn().mockRejectedValue(new Error('Device not responding'))
    } as unknown as ModbusClientCore;

    // Spy on ErrorNotificationService.createFromBusinessLogic
    createFromBusinessLogicSpy = jest.spyOn(ErrorNotificationService.prototype, 'createFromBusinessLogic')
      .mockResolvedValue({
        name: 'test-notification',
        err_code: 'MODBUS_CONNECTION_FAILURE',
        message: 'Failed to read after retries',
        severity: 'high'
      } as any);

    // Initialize polling service
    pollingService = new ViisTelemetryPollingService(
      mockNode,
      mockNodeContext,
      mockModbusClient,
      'board1',
      'device-123'
    );
  });

  describe('Error Notification on Max Failures', () => {
    it('should create error notification when holding register polling reaches max failures', async () => {
      const config = { interval: 1000, startAddress: 0, quantity: 10 };
      const mapping = { temp: 0, pressure: 1 };

      // Simulate multiple polling attempts to reach max failures
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) {
        await (pollingService as any).pollHoldingRegisters(config, mapping);
      }

      // Verify error notification was created
      expect(createFromBusinessLogicSpy).toHaveBeenCalled();
      
      const callArgs = createFromBusinessLogicSpy.mock.calls[0][0];
      expect(callArgs.err_code).toBe('MODBUS_HOLDINGREGISTERS_CONNECTION_FAILURE');
      expect(callArgs.severity).toBe('high');
      expect(callArgs.type).toBe('error');
      expect(callArgs.entity).toBe('device-123');
      expect(callArgs.metadata.register_type).toBe('holdingRegisters');
      expect(callArgs.metadata.board_id).toBe('board1');
      expect(callArgs.metadata.consecutive_failures).toBe(MAX_CONSECUTIVE_FAILURES);
      expect(callArgs.metadata.max_retry_attempts).toBe(MAX_RETRY_ATTEMPTS);
    });

    it('should create error notification when input register polling reaches max failures', async () => {
      const config = { interval: 1000, startAddress: 0, quantity: 10 };
      const mapping = { temp: 0, pressure: 1 };

      // Simulate multiple polling attempts to reach max failures
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) {
        await (pollingService as any).pollInputRegisters(config, mapping);
      }

      expect(createFromBusinessLogicSpy).toHaveBeenCalled();
      
      const callArgs = createFromBusinessLogicSpy.mock.calls[0][0];
      expect(callArgs.err_code).toBe('MODBUS_INPUTREGISTERS_CONNECTION_FAILURE');
      expect(callArgs.message).toContain('Failed to read inputRegisters after');
      expect(callArgs.metadata.register_type).toBe('inputRegisters');
    });

    it('should create error notification when coil polling reaches max failures', async () => {
      const config = { interval: 1000, startAddress: 0, quantity: 10 };
      const mapping = { pump1: 0, pump2: 1 };

      // Simulate multiple polling attempts to reach max failures
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) {
        await (pollingService as any).pollCoils(config, mapping);
      }

      expect(createFromBusinessLogicSpy).toHaveBeenCalled();
      
      const callArgs = createFromBusinessLogicSpy.mock.calls[0][0];
      expect(callArgs.err_code).toBe('MODBUS_COILS_CONNECTION_FAILURE');
      expect(callArgs.metadata.register_type).toBe('coils');
    });

    it('should NOT create error notification before reaching max failures', async () => {
      const config = { interval: 1000, startAddress: 0, quantity: 10 };
      const mapping = { temp: 0 };

      // Poll less than max failures
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES - 1; i++) {
        await (pollingService as any).pollHoldingRegisters(config, mapping);
      }

      // Error notification should not be created yet
      expect(createFromBusinessLogicSpy).not.toHaveBeenCalled();
    });

    it('should include error message in notification metadata', async () => {
      const config = { interval: 1000, startAddress: 0, quantity: 10 };
      const mapping = { temp: 0 };

      const specificError = new Error('Specific connection error message');
      mockModbusClient.readHoldingRegisters = jest.fn().mockRejectedValue(specificError);

      // Reach max failures
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) {
        await (pollingService as any).pollHoldingRegisters(config, mapping);
      }

      const callArgs = createFromBusinessLogicSpy.mock.calls[0][0];
      expect(callArgs.metadata.error_message).toBe('Specific connection error message');
      expect(callArgs.message).toContain('Specific connection error message');
    });

    it('should include timestamp in notification metadata', async () => {
      const config = { interval: 1000, startAddress: 0, quantity: 10 };
      const mapping = { temp: 0 };

      const beforeTime = new Date();
      
      // Reach max failures
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) {
        await (pollingService as any).pollHoldingRegisters(config, mapping);
      }

      const afterTime = new Date();
      const callArgs = createFromBusinessLogicSpy.mock.calls[0][0];
      const timestamp = new Date(callArgs.metadata.timestamp);

      expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });
  });

  describe('Error Handling Edge Cases', () => {
    it('should handle database not initialized error gracefully', async () => {
      // Mock database not ready
      createFromBusinessLogicSpy = jest.fn()
        .mockRejectedValue(new Error('Database not initialized'));

      const config = { interval: 1000, startAddress: 0, quantity: 10 };
      const mapping = { temp: 0 };

      // Reach max failures - should not throw error
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) {
        await expect((pollingService as any).pollHoldingRegisters(config, mapping))
          .resolves.not.toThrow();
      }

      // Should have attempted to create notification but failed silently
      expect(createFromBusinessLogicSpy).toHaveBeenCalled();
      // Node should log warning but not error
      expect(mockNode.warn).toHaveBeenCalled();
    });

    it('should log error for non-database initialization failures', async () => {
      // Mock different error
      createFromBusinessLogicSpy = jest.fn()
        .mockRejectedValue(new Error('Network error'));

      const config = { interval: 1000, startAddress: 0, quantity: 10 };
      const mapping = { temp: 0 };

      // Reach max failures
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) {
        await (pollingService as any).pollHoldingRegisters(config, mapping);
      }

      // Should log the error
      expect(mockNode.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create error notification: Network error')
      );
    });

    it('should reset consecutive failures counter after successful read', async () => {
      const config = { interval: 1000, startAddress: 0, quantity: 10 };
      const mapping = { temp: 0 };

      // First, cause some failures (but not max)
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES - 2; i++) {
        await (pollingService as any).pollHoldingRegisters(config, mapping);
      }

      // Now make it succeed
      mockModbusClient.readHoldingRegisters = jest.fn().mockResolvedValue({
        address: 0,
        data: [100, 200]
      });

      await (pollingService as any).pollHoldingRegisters(config, mapping);

      // Counter should be reset, so we should not create notification
      expect(createFromBusinessLogicSpy).not.toHaveBeenCalled();

      // Now fail again multiple times - should need full MAX_CONSECUTIVE_FAILURES
      mockModbusClient.readHoldingRegisters = jest.fn().mockRejectedValue(new Error('Failed'));
      
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES - 1; i++) {
        await (pollingService as any).pollHoldingRegisters(config, mapping);
      }

      // Still shouldn't create notification (not reached max yet)
      expect(createFromBusinessLogicSpy).not.toHaveBeenCalled();
    });
  });

  describe('Multiple Register Types', () => {
    it('should track failures independently for each register type', async () => {
      const config = { interval: 1000, startAddress: 0, quantity: 10 };
      const mapping = { value: 0 };

      // Fail holding registers to max
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) {
        await (pollingService as any).pollHoldingRegisters(config, mapping);
      }

      // Fail input registers less than max
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES - 2; i++) {
        await (pollingService as any).pollInputRegisters(config, mapping);
      }

      // Only holding registers should create notification
      expect(createFromBusinessLogicSpy).toHaveBeenCalledTimes(1);
      
      const callArgs = createFromBusinessLogicSpy.mock.calls[0][0];
      expect(callArgs.err_code).toBe('MODBUS_HOLDINGREGISTERS_CONNECTION_FAILURE');
    });

    it('should create separate notifications for different register types', async () => {
      const config = { interval: 1000, startAddress: 0, quantity: 10 };
      const mapping = { value: 0 };

      // Fail holding registers to max
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) {
        await (pollingService as any).pollHoldingRegisters(config, mapping);
      }

      // Fail input registers to max
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) {
        await (pollingService as any).pollInputRegisters(config, mapping);
      }

      // Should create two separate notifications
      expect(createFromBusinessLogicSpy).toHaveBeenCalledTimes(2);
      
      const call1Args = createFromBusinessLogicSpy.mock.calls[0][0];
      const call2Args = createFromBusinessLogicSpy.mock.calls[1][0];
      
      expect(call1Args.err_code).toBe('MODBUS_HOLDINGREGISTERS_CONNECTION_FAILURE');
      expect(call2Args.err_code).toBe('MODBUS_INPUTREGISTERS_CONNECTION_FAILURE');
    });
  });

  describe('Error Code Format', () => {
    it('should format error code correctly for holding registers', async () => {
      const config = { interval: 1000, startAddress: 0, quantity: 10 };
      const mapping = { temp: 0 };

      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) {
        await (pollingService as any).pollHoldingRegisters(config, mapping);
      }

      const callArgs = createFromBusinessLogicSpy.mock.calls[0][0];
      expect(callArgs.err_code).toMatch(/^MODBUS_[A-Z]+_CONNECTION_FAILURE$/);
      expect(callArgs.err_code).toBe('MODBUS_HOLDINGREGISTERS_CONNECTION_FAILURE');
    });

    it('should include retry count in error message', async () => {
      const config = { interval: 1000, startAddress: 0, quantity: 10 };
      const mapping = { temp: 0 };

      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) {
        await (pollingService as any).pollHoldingRegisters(config, mapping);
      }

      const callArgs = createFromBusinessLogicSpy.mock.calls[0][0];
      expect(callArgs.message).toContain(`after ${MAX_RETRY_ATTEMPTS} retry attempts`);
    });
  });
});
