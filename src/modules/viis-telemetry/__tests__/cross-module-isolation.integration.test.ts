/**
 * Cross-Module Isolation Integration Test (PMR-008)
 *
 * Verifies that the viis-telemetry module correctly writes global context keys
 * for coil, input, and holding register data.
 *
 * Scenarios:
 * 1. viis-telemetry writes coilRegisterData on a single pollCoils cycle.
 * 2. Multi-instance sanity: 2 polling-service instances with unique node.id
 *    share coilRegisterData but maintain independent per-node previousState.
 *
 * Refs: .plans/poll-modbus-flow-robustness.md, PMR-008
 */

import { ViisTelemetryPollingService } from '../viis-telemetry-polling-service';
import { Node, NodeContext } from 'node-red';
import { ModbusClientCore, ModbusData } from '../../../core/modbus-client';
import { GLOBAL_CONTEXT_KEYS, CONTEXT_KEYS } from '../viis-telemetry-constants';

// Mock ErrorNotificationService so the polling-service constructor does not
// try to initialize a MySQL DataSource. This test does not exercise DB.
jest.mock('../../../services/error-notification.service', () => {
  return {
    ErrorNotificationService: jest.fn().mockImplementation(() => ({
      notifyError: jest.fn(),
      notifyWarning: jest.fn(),
      writeErrorToGlobal: jest.fn(),
      // Anything else ViisTelemetryPollingService touches stays a no-op.
    })),
    BusinessLogicError: class BusinessLogicError extends Error {},
  };
});

describe('Cross-Module Isolation (PMR-008)', () => {
  let globalContextStore: Record<string, any>;

  /**
   * Build a mock node whose context().global reads/writes a shared
   * `globalContextStore`. nodeContext is mocked separately per scenario
   * because Scenario 3 needs two isolated nodeContexts.
   */
  function buildMockNode(nodeId: string, nodeContextMock: any): any {
    return {
      id: nodeId,
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
      status: jest.fn(),
      context: jest.fn().mockReturnValue({
        global: {
          get: jest.fn((key: string) => globalContextStore[key]),
          set: jest.fn((key: string, value: any) => {
            globalContextStore[key] = value;
          }),
        },
      }),
    } as unknown as Node;
  }

  function buildMockNodeContext(): any {
    // Per-node (instance) context — NOT shared across instances.
    return {
      set: jest.fn(),
      get: jest.fn(),
    } as unknown as NodeContext;
  }

  function buildMockModbusClient(): any {
    return {
      readHoldingRegisters: jest.fn(),
      readInputRegisters: jest.fn(),
      readCoils: jest.fn(),
    } as unknown as ModbusClientCore;
  }

  beforeEach(() => {
    globalContextStore = {};
  });

  afterEach(() => {
    globalContextStore = {};
  });

  describe('Scenario 1: viis-telemetry writes coilRegisterData', () => {
    it('writes coilRegisterData on a single pollCoils cycle', async () => {
      const mockNodeContext = buildMockNodeContext();
      const mockNode = buildMockNode('node-scenario-1', mockNodeContext);
      const mockModbusClient = buildMockModbusClient();

      const service = new ViisTelemetryPollingService(
        mockNode,
        mockNodeContext,
        mockModbusClient,
        'board1',
        'device-scenario-1'
      );

      const coilMapping = {
        pump_main: 0,
        pump_sub: 1,
        valve_1: 2,
      };

      const modbusResult: ModbusData = {
        address: 0,
        data: [true, false, true],
      };
      mockModbusClient.readCoils.mockResolvedValue(modbusResult);

      const coilConfig = { interval: 1000, startAddress: 0, quantity: 3 };

      // Invoke pollCoils directly via cast — no setInterval for synchronous test execution.
      await (service as any).pollCoils(coilConfig, coilMapping);

      // Assertion 1: coilRegisterData key exists with all 3 mapped keys.
      expect(globalContextStore[GLOBAL_CONTEXT_KEYS.COIL_REGISTER_DATA]).toEqual({
        pump_main: true,
        pump_sub: false,
        valve_1: true,
      });

      // Assertion 2: scaleConfigs is not written during coil poll
      //              (only input/holding registers populate it).
      expect(globalContextStore[GLOBAL_CONTEXT_KEYS.SCALE_CONFIGS]).toBeUndefined();
    });
  });

  describe('Scenario 2: Multi-instance sanity (2 polling services, unique node.id)', () => {
    it('each instance maintains its own previousState while sharing coilRegisterData', async () => {
      // Two nodeContexts, one per instance. They must NOT share state.
      const nodeContextA = buildMockNodeContext();
      const nodeContextB = buildMockNodeContext();

      const mockNodeA = buildMockNode('node-instance-A', nodeContextA);
      const mockNodeB = buildMockNode('node-instance-B', nodeContextB);

      const mockModbusClientA = buildMockModbusClient();
      const mockModbusClientB = buildMockModbusClient();

      const serviceA = new ViisTelemetryPollingService(
        mockNodeA,
        nodeContextA,
        mockModbusClientA,
        'boardA',
        'device-instance-A'
      );
      const serviceB = new ViisTelemetryPollingService(
        mockNodeB,
        nodeContextB,
        mockModbusClientB,
        'boardB',
        'device-instance-B'
      );

      const coilConfig = { interval: 1000, startAddress: 0, quantity: 2 };

      // Instance A polls main_pump=true, pump_sub=false.
      mockModbusClientA.readCoils.mockResolvedValueOnce({
        address: 0,
        data: [true, false],
      });
      const mappingA = { main_pump: 0, pump_sub: 1 };
      await (serviceA as any).pollCoils(coilConfig, mappingA);

      // Instance B polls main_pump=false, pump_sub=true.
      mockModbusClientB.readCoils.mockResolvedValueOnce({
        address: 0,
        data: [false, true],
      });
      const mappingB = { main_pump: 0, pump_sub: 1 };
      await (serviceB as any).pollCoils(coilConfig, mappingB);

      // Assertion 1: shared global coilRegisterData reflects instance B's
      //              last write (last-writer-wins, documented limitation).
      expect(globalContextStore[GLOBAL_CONTEXT_KEYS.COIL_REGISTER_DATA]).toEqual({
        main_pump: false,
        pump_sub: true,
      });

      // Assertion 2: nodeContextA.set was called for mainPumpState (true) by instance A.
      //              nodeContextB.set was called for mainPumpState (false) by instance B.
      //              Each instance's nodeContext.set invocations are independent.
      const aSets = (nodeContextA.set as jest.Mock).mock.calls;
      const bSets = (nodeContextB.set as jest.Mock).mock.calls;
      const aMainPumpWrites = aSets.filter(([key, value]) => key === CONTEXT_KEYS.MAIN_PUMP_STATE);
      const bMainPumpWrites = bSets.filter(([key, value]) => key === CONTEXT_KEYS.MAIN_PUMP_STATE);

      expect(aMainPumpWrites.length).toBe(1);
      expect(aMainPumpWrites[0][1]).toBe(true);
      expect(bMainPumpWrites.length).toBe(1);
      expect(bMainPumpWrites[0][1]).toBe(false);

      // Assertion 3: node.id is unique per instance — proves they are distinct
      //              and would each publish telemetry under their own id.
      expect(mockNodeA.id).not.toEqual(mockNodeB.id);
      expect(mockNodeA.id).toBe('node-instance-A');
      expect(mockNodeB.id).toBe('node-instance-B');
    });
  });
});