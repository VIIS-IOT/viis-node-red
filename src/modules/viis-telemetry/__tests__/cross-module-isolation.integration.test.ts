/**
 * Cross-Module Isolation Integration Test (PMR-008)
 *
 * Verifies that after PMR-004 namespace refactor (vt_ prefix on telemetry
 * global keys), the viis-telemetry module and flow-RTU function-node writers
 * use DISJOINT global context keys — no concurrent-writer collision.
 *
 * Scenarios:
 * 1. viis-telemetry writes only vt_* keys (no bare coilRegisterData).
 * 2. A manual writer using bare coilRegisterData coexists with viis-telemetry's
 *    vt_coilRegisterData — both preserved after polls.
 * 3. Multi-instance sanity: 2 polling-service instances with unique node.id
 *    share vt_coilRegisterData but maintain independent per-node previousState.
 *
 * This test guards against future regressions where someone removes the vt_
 * prefix without considering flow-RTU writers.
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

/** Bare key historically used by flow-RTU function nodes (e.g. Process Holding Threshold). */
const BARE_COIL_REGISTER_DATA_KEY = 'coilRegisterData';

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
    // Optional leak detection (per brief, marked "Optional: assert leak-free").
    // Tests intentionally populate the store, so we only check that any keys
    // left behind are namespaced (vt_*) — bare keys would indicate a regression
    // where viis-telemetry started writing without the vt_ prefix again.
    const bareKeys = Object.keys(globalContextStore).filter(k => !k.startsWith('vt_'));
    expect(bareKeys).toEqual([]);
  });

  describe('Scenario 1: viis-telemetry writes only vt_* keys', () => {
    it('writes vt_coilRegisterData and never bare coilRegisterData on a single pollCoils cycle', async () => {
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

      // Assertion 1: namespaced vt_* key exists with all 3 mapped keys.
      expect(globalContextStore[GLOBAL_CONTEXT_KEYS.COIL_REGISTER_DATA]).toEqual({
        pump_main: true,
        pump_sub: false,
        valve_1: true,
      });

      // Assertion 2: bare coilRegisterData is NOT written — disjoint namespace.
      expect(globalContextStore[BARE_COIL_REGISTER_DATA_KEY]).toBeUndefined();

      // Assertion 3: vt_scaleConfigs is not written during coil poll
      //              (only input/holding registers populate it) — confirms
      //              pollCoils only touches vt_coilRegisterData.
      expect(globalContextStore[GLOBAL_CONTEXT_KEYS.SCALE_CONFIGS]).toBeUndefined();
    });
  });

  describe('Scenario 2: Manual writer using bare coilRegisterData does not collide', () => {
    it('coexists with viis-telemetry vt_coilRegisterData across multiple polls', async () => {
      const mockNodeContext = buildMockNodeContext();
      const mockNode = buildMockNode('node-scenario-2', mockNodeContext);
      const mockModbusClient = buildMockModbusClient();

      const service = new ViisTelemetryPollingService(
        mockNode,
        mockNodeContext,
        mockModbusClient,
        'board1',
        'device-scenario-2'
      );

      const coilMapping = { pump_main: 0, pump_sub: 1 };
      const coilConfig = { interval: 1000, startAddress: 0, quantity: 2 };

      // ---- First pollCoils cycle ----
      mockModbusClient.readCoils.mockResolvedValueOnce({
        address: 0,
        data: [true, false],
      });
      await (service as any).pollCoils(coilConfig, coilMapping);

      // Assertion 1: vt_coilRegisterData populated by viis-telemetry.
      expect(globalContextStore[GLOBAL_CONTEXT_KEYS.COIL_REGISTER_DATA]).toEqual({
        pump_main: true,
        pump_sub: false,
      });

      // ---- Simulate flow-RTU function node writing bare coilRegisterData ----
      globalContextStore[BARE_COIL_REGISTER_DATA_KEY] = { pump_main: false };

      // Assertion 2: both keys coexist — disjoint namespaces.
      expect(globalContextStore[GLOBAL_CONTEXT_KEYS.COIL_REGISTER_DATA]).toEqual({
        pump_main: true,
        pump_sub: false,
      });
      expect(globalContextStore[BARE_COIL_REGISTER_DATA_KEY]).toEqual({
        pump_main: false,
      });

      // ---- Second pollCoils cycle (values changed) ----
      mockModbusClient.readCoils.mockResolvedValueOnce({
        address: 0,
        data: [false, true],
      });
      await (service as any).pollCoils(coilConfig, coilMapping);

      // Assertion 3: vt_coilRegisterData updated by viis-telemetry only.
      expect(globalContextStore[GLOBAL_CONTEXT_KEYS.COIL_REGISTER_DATA]).toEqual({
        pump_main: false,
        pump_sub: true,
      });

      // Assertion 4: bare coilRegisterData UNTOUCHED — no collision,
      //               even after viis-telemetry ran a second cycle.
      expect(globalContextStore[BARE_COIL_REGISTER_DATA_KEY]).toEqual({
        pump_main: false,
      });

      // Cleanup the simulated manual writer so the afterEach leak-check passes.
      delete globalContextStore[BARE_COIL_REGISTER_DATA_KEY];
    });
  });

  describe('Scenario 3: Multi-instance sanity (2 polling services, unique node.id)', () => {
    it('each instance maintains its own previousState while sharing vt_coilRegisterData', async () => {
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

      // Assertion 1: shared global vt_coilRegisterData reflects instance B's
      //              last write (last-writer-wins, documented limitation).
      //              The critical property: the key is vt_coilRegisterData,
      //              NOT bare coilRegisterData — so manual writers using the
      //              bare key remain disjoint.
      expect(globalContextStore[GLOBAL_CONTEXT_KEYS.COIL_REGISTER_DATA]).toEqual({
        main_pump: false,
        pump_sub: true,
      });
      expect(globalContextStore[BARE_COIL_REGISTER_DATA_KEY]).toBeUndefined();

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