/**
 * viis-fertilizer-ec-control
 *
 * Node-RED custom node for intelligent EC-based fertilizer control.
 *
 * Control Strategy:
 * - Feedforward: Lookup table predicts valve times before start
 * - Open-loop: PLC pulses valves per cycle_EC (e.g., 10 = 6s cycle)
 * - Learning: Post-run EC averaging updates lookup table for next run
 *
 * Features:
 * - Lookup table interpolation for valve time prediction
 * - Real-time context window (20s ramp-up, then averaging)
 * - Post-run adaptive learning (weighted average)
 * - Local MySQL storage for offline operation
 * - Backend API sync for machine learning
 *
 * Inputs:
 *   msg.action: 'start' | 'stop' | 'getValveTimes' | 'status' | 'sync'
 *   msg.ec_setpoint: Target EC value (e.g., 1.8)
 *   msg.schedule_name: Optional schedule reference
 *   msg.readings: Optional sensor readings for context window
 *
 * Outputs:
 *   Output 1: Modbus write commands (initial valve times only)
 *   Output 2: Status/telemetry
 *   Output 3: Errors
 */

import { NodeAPI, Node, NodeContext } from 'node-red';
import ClientRegistry from '../../core/client-registry';
import { ModbusConfig } from '../../core/modbus-client';
import { ModbusClientCore } from '../../core/modbus-client';
import { GlobalContextHelper } from '../../ultils/global-context-helper';
import {
    ViisFertilizerEcControlNodeDef,
    EcControlState,
    EcControlContext,
    EcControlInputMsg,
    EcControlOutputMsg,
    ValveTimes,
    SensorReadings,
    ModbusWrite,
} from './interfaces/types';
import {
    LookupTableService,
    ContextWindowService,
    IrrigationRunService,
    BackendSyncService,
} from './services';
import {
    MODBUS_REGISTER_KEYS,
    MODBUS_COIL_KEYS,
    CONTROL_MODES,
    EC_CONTROL_DEFAULTS,
    ERROR_CODES,
} from './constants';
import { ModbusRegisterHelper } from './utils/ModbusRegisterHelper';


module.exports = function (RED: NodeAPI) {

    function ViisFertilizerEcControlNode(this: Node, config: ViisFertilizerEcControlNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;
        const nodeContext: NodeContext = this.context();
        const globalContext = this.context().global;

        // Initialize GlobalContextHelper
        const globalHelper = new GlobalContextHelper(nodeContext);

        // Get device ID
        const deviceId = globalHelper.getEnvVar('DEVICE_ID', '');
        if (!deviceId) {
            node.error('DEVICE_ID not configured in environment');
            node.status({ fill: 'red', shape: 'ring', text: 'No DEVICE_ID' });
            return;
        }

        // Configuration from node settings or environment
        const rampUpSeconds = config.rampUpSeconds ?? globalHelper.getNumericEnvVar('FERTILIZER_RAMP_UP_SECONDS', EC_CONTROL_DEFAULTS.RAMP_UP_SECONDS);
        const adjustmentStep = config.adjustmentStep ?? globalHelper.getNumericEnvVar('FERTILIZER_ADJUSTMENT_STEP', EC_CONTROL_DEFAULTS.ADJUSTMENT_STEP);
        const adjustmentThreshold = config.adjustmentThreshold ?? globalHelper.getNumericEnvVar('FERTILIZER_ADJUSTMENT_THRESHOLD', EC_CONTROL_DEFAULTS.ADJUSTMENT_THRESHOLD);
        const maxValveTime = config.maxValveTime ?? globalHelper.getNumericEnvVar('FERTILIZER_MAX_VALVE_TIME', EC_CONTROL_DEFAULTS.MAX_VALVE_TIME);
        const debugEnable = config.debugEnable ?? false;

        // Multi-board Modbus config
        let currentBoardId: string | undefined = config.boardId;
        let isMultiBoardMode: boolean = false;
        let currentModbusConfig: ModbusConfig | null = null;

        // Modbus register helper for dynamic address lookup
        const modbusHelper = new ModbusRegisterHelper(node, nodeContext, currentBoardId || 'board1');

        // Services
        let lookupService: LookupTableService;
        let contextService: ContextWindowService;
        let runService: IrrigationRunService;
        let syncService: BackendSyncService;

        // State
        let controlContext: EcControlContext = {
            state: 'IDLE',
            ecBuffer: [],
            flowBuffers: { flow_1: [], flow_2: [], flow_3: [], flow_4: [], flow_5: [] },
            currentValveTimes: { time_on_valve_01: 0, time_on_valve_02: 0, time_on_valve_03: 0, time_on_valve_04: 0, time_on_valve_05: 0 },
            targetEc: 0,
        };

        let pollingInterval: NodeJS.Timeout | null = null;
        let servicesInitialized = false;

        // Debug logging helper
        const debugLog = (message: string) => {
            if (debugEnable) {
                node.warn(`[DEBUG] ${message}`);
            }
        };

        // Initialize services
        async function initializeServices(): Promise<boolean> {
            try {
                // Initialize lookup table service
                lookupService = new LookupTableService(node, deviceId);
                await lookupService.initialize(nodeContext);

                // Initialize context window service
                contextService = new ContextWindowService(node, {
                    windowSize: EC_CONTROL_DEFAULTS.CONTEXT_WINDOW_SIZE,
                    adjustmentThreshold,
                    adjustmentStep,
                    maxValveTime,
                });

                // Initialize irrigation run service
                runService = new IrrigationRunService(node, deviceId);
                await runService.initialize(nodeContext);

                // Initialize backend sync service
                syncService = new BackendSyncService(node, deviceId, globalHelper);

                // Clean up any stale runs from power outage
                await runService.cleanupStaleRuns();

                servicesInitialized = true;
                debugLog('All services initialized successfully');
                node.status({ fill: 'green', shape: 'dot', text: 'Ready' });
                return true;

            } catch (error) {
                node.error(`Failed to initialize services: ${(error as Error).message}`);
                node.status({ fill: 'red', shape: 'ring', text: 'Init failed' });
                return false;
            }
        }

        // Read Modbus config from global context
        function readModbusConfig(): ModbusConfig | null {
            const boardsConfig = globalHelper.getEnvVar('MODBUS_BOARDS', null);

            if (boardsConfig) {
                try {
                    let boards = Array.isArray(boardsConfig)
                        ? boardsConfig
                        : JSON.parse(boardsConfig as string);

                    if (Array.isArray(boards) && boards.length > 0) {
                        isMultiBoardMode = true;
                        const defaultBoard = globalHelper.getEnvVar('MODBUS_DEFAULT_BOARD', boards[0].id);
                        currentBoardId = currentBoardId || defaultBoard;

                        const board = boards.find((b: any) => b.id === currentBoardId) || boards[0];
                        return {
                            host: board.host,
                            tcpPort: board.tcpPort || 502,
                            type: board.type || 'TCP',
                            unitId: board.unitId || 1,
                            serialPort: board.serialPort,
                            baudRate: board.baudRate,
                        };
                    }
                } catch (e) {
                    node.error(`Failed to parse MODBUS_BOARDS: ${e}`);
                }
            }

            return null;
        }

        // Get Modbus client using ClientRegistry
        async function getModbusClient(): Promise<ModbusClientCore> {
            if (isMultiBoardMode && currentBoardId) {
                // Use multi-board API
                return await ClientRegistry.getModbusClientV2(currentBoardId, node);
            } else {
                // Fall back to single-board mode
                const config = readModbusConfig();
                if (!config) {
                    throw new Error('No Modbus configuration available');
                }
                currentModbusConfig = config;
                return await ClientRegistry.getModbusClient(config, node);
            }
        }

        // Write valve times to Modbus
        async function writeValveTimes(valveTimes: ValveTimes): Promise<boolean> {
            try {
                const client = await getModbusClient();

                // Get addresses from global context
                const addr01 = modbusHelper.getHoldingAddress(MODBUS_REGISTER_KEYS.TIME_ON_VALVE_01)!;
                const addr02 = modbusHelper.getHoldingAddress(MODBUS_REGISTER_KEYS.TIME_ON_VALVE_02)!;
                const addr03 = modbusHelper.getHoldingAddress(MODBUS_REGISTER_KEYS.TIME_ON_VALVE_03)!;
                const addr04 = modbusHelper.getHoldingAddress(MODBUS_REGISTER_KEYS.TIME_ON_VALVE_04)!;
                const addr05 = modbusHelper.getHoldingAddress(MODBUS_REGISTER_KEYS.TIME_ON_VALVE_05)!;

                // Write time_on_valve_01-05
                await client.writeRegister(addr01, valveTimes.time_on_valve_01);
                await client.writeRegister(addr02, valveTimes.time_on_valve_02);
                await client.writeRegister(addr03, valveTimes.time_on_valve_03);
                await client.writeRegister(addr04, valveTimes.time_on_valve_04);
                await client.writeRegister(addr05, valveTimes.time_on_valve_05);

                debugLog(`Wrote valve times: ${JSON.stringify(valveTimes)}`);
                return true;
            } catch (error) {
                node.error(`Failed to write valve times: ${(error as Error).message}`);
                return false;
            }
        }

        // Read sensor values from Modbus
        async function readSensors(): Promise<SensorReadings | null> {
            try {
                const client = await getModbusClient();

                // Get addresses from global context
                const addrEc = modbusHelper.getHoldingAddress(MODBUS_REGISTER_KEYS.CURRENT_EC)!;
                const addrFlow1 = modbusHelper.getHoldingAddress(MODBUS_REGISTER_KEYS.CURRENT_FLOW_1)!;
                const addrFlow2 = modbusHelper.getHoldingAddress(MODBUS_REGISTER_KEYS.CURRENT_FLOW_2)!;
                const addrFlow3 = modbusHelper.getHoldingAddress(MODBUS_REGISTER_KEYS.CURRENT_FLOW_3)!;
                const addrFlow4 = modbusHelper.getHoldingAddress(MODBUS_REGISTER_KEYS.CURRENT_FLOW_4)!;
                const addrFlow5 = modbusHelper.getHoldingAddress(MODBUS_REGISTER_KEYS.CURRENT_FLOW_5)!;

                // Read EC and flow registers
                const ecRaw = await client.readHoldingRegisters(addrEc, 1);
                const flow1Raw = await client.readHoldingRegisters(addrFlow1, 1);
                const flow2Raw = await client.readHoldingRegisters(addrFlow2, 1);
                const flow3Raw = await client.readHoldingRegisters(addrFlow3, 1);
                const flow4Raw = await client.readHoldingRegisters(addrFlow4, 1);
                const flow5Raw = await client.readHoldingRegisters(addrFlow5, 1);

                return {
                    current_ec: (Number(ecRaw?.data?.[0] ?? 0)) / 10, // Convert from x10
                    current_flow_1: Number(flow1Raw?.data?.[0] ?? 0),
                    current_flow_2: Number(flow2Raw?.data?.[0] ?? 0),
                    current_flow_3: Number(flow3Raw?.data?.[0] ?? 0),
                    current_flow_4: Number(flow4Raw?.data?.[0] ?? 0),
                    current_flow_5: Number(flow5Raw?.data?.[0] ?? 0),
                };
            } catch (error) {
                node.error(`Failed to read sensors: ${(error as Error).message}`);
                return null;
            }
        }

        // Set control mode to EC
        async function setEcControlMode(ecSetpoint: number): Promise<boolean> {
            try {
                const client = await getModbusClient();

                // Get addresses from global context
                const addrControlMode = modbusHelper.getHoldingAddress(MODBUS_REGISTER_KEYS.CONTROL_MODE)!;
                const addrSetEc = modbusHelper.getHoldingAddress(MODBUS_REGISTER_KEYS.SET_EC)!;

                // Set control_mode = 2 (EC mode)
                await client.writeRegister(addrControlMode, CONTROL_MODES.EC);

                // Set EC setpoint (x10)
                await client.writeRegister(addrSetEc, Math.round(ecSetpoint * 10));

                debugLog(`Set EC control mode: setpoint=${ecSetpoint}`);
                return true;
            } catch (error) {
                node.error(`Failed to set EC control mode: ${(error as Error).message}`);
                return false;
            }
        }

        // Start irrigation
        async function startIrrigation(ecSetpoint: number, scheduleName?: string): Promise<void> {
            if (controlContext.state !== 'IDLE') {
                node.warn(`Cannot start: already in state ${controlContext.state}`);
                return;
            }

            controlContext.state = 'STARTING';
            controlContext.targetEc = ecSetpoint;
            node.status({ fill: 'yellow', shape: 'dot', text: `Starting EC=${ecSetpoint}` });

            try {
                // Get valve times from lookup table
                const interpolation = await lookupService.getValveTimesForEc(ecSetpoint);
                controlContext.currentValveTimes = interpolation.valveTimes;

                debugLog(`Interpolation result: ${interpolation.confidence}, valves: ${JSON.stringify(interpolation.valveTimes)}`);

                // Write valve times to Modbus
                const writeSuccess = await writeValveTimes(interpolation.valveTimes);
                if (!writeSuccess) {
                    throw new Error('Failed to write valve times');
                }

                // Set EC control mode
                const modeSuccess = await setEcControlMode(ecSetpoint);
                if (!modeSuccess) {
                    throw new Error('Failed to set EC control mode');
                }

                // Start irrigation run tracking
                const run = await runService.startRun({
                    ecSetpoint,
                    valveTimes: interpolation.valveTimes,
                    scheduleName,
                });
                controlContext.currentRun = run;

                // Start context window
                contextService.startRun(rampUpSeconds);

                // Start polling for sensor readings
                startPolling();

                controlContext.state = 'RAMPING_UP';
                node.status({ fill: 'blue', shape: 'dot', text: `Ramp-up EC=${ecSetpoint}` });

                // Send output
                sendOutput(1, {
                    topic: 'fertilizer/started',
                    payload: {
                        action: 'started',
                        success: true,
                        data: {
                            runId: run.id,
                            ecSetpoint,
                            valveTimes: interpolation.valveTimes,
                            confidence: interpolation.confidence,
                        },
                    },
                    valve_times: interpolation.valveTimes,
                    modbus_writes: getModbusWrites(interpolation.valveTimes, ecSetpoint),
                });

            } catch (error) {
                controlContext.state = 'ERROR';
                node.error(`Failed to start irrigation: ${(error as Error).message}`);
                node.status({ fill: 'red', shape: 'ring', text: 'Start failed' });

                sendOutput(3, {
                    topic: 'fertilizer/error',
                    payload: {
                        action: 'start',
                        success: false,
                        error: (error as Error).message,
                    },
                });
            }
        }

        // Stop irrigation
        async function stopIrrigation(reason: 'user' | 'complete' | 'error' = 'user'): Promise<void> {
            if (controlContext.state === 'IDLE') {
                return;
            }

            controlContext.state = 'STOPPING';
            node.status({ fill: 'yellow', shape: 'ring', text: 'Stopping...' });

            // Stop polling
            stopPolling();

            // Get final averages from context window
            const stats = contextService.getStats();

            try {
                if (controlContext.currentRun?.id) {
                    if (reason === 'complete' || reason === 'user') {
                        // Complete the run
                        await runService.completeRun({
                            runId: controlContext.currentRun.id,
                            ecAchievedAvg: stats.avgEc,
                            flowAverages: stats.flowAverages,
                        });

                        // Update lookup table with run data
                        if (stats.sampleCount > 0) {
                            await lookupService.updateWithRunData(
                                controlContext.targetEc,
                                stats.avgEc,
                                controlContext.currentValveTimes,
                                stats.flowAverages
                            );
                        }

                        // Try to sync to backend
                        try {
                            const updatedRun = await runService.getRunById(controlContext.currentRun.id);
                            if (updatedRun) {
                                const synced = await syncService.reportIrrigationFinished(updatedRun);
                                if (synced) {
                                    await runService.markAsSynced(controlContext.currentRun.id);
                                }
                            }
                        } catch (syncError) {
                            debugLog(`Sync failed, will retry later: ${(syncError as Error).message}`);
                        }

                    } else if (reason === 'error') {
                        await runService.failRun({
                            runId: controlContext.currentRun.id,
                            errorCode: ERROR_CODES.MODBUS_ERROR,
                        });
                    }
                }

                // No need to reset control_mode - let RPC control or user manage PLC state

            } catch (error) {
                node.error(`Error during stop: ${(error as Error).message}`);
            }

            // Reset state
            controlContext.state = 'IDLE';
            controlContext.currentRun = undefined;
            contextService.reset();

            node.status({ fill: 'green', shape: 'dot', text: 'Ready' });

            sendOutput(2, {
                topic: 'fertilizer/stopped',
                payload: {
                    action: 'stopped',
                    success: true,
                    data: {
                        reason,
                        stats,
                    },
                },
            });
        }

        // Polling for sensor readings during run
        function startPolling(): void {
            if (pollingInterval) return;

            pollingInterval = setInterval(async () => {
                if (controlContext.state !== 'RAMPING_UP' && controlContext.state !== 'RUNNING') {
                    stopPolling();
                    return;
                }

                const readings = await readSensors();
                if (!readings) return;

                // Add to context window
                const added = contextService.addSample(readings);

                // Check if ramp-up is complete
                if (controlContext.state === 'RAMPING_UP' && contextService.isRampUpComplete()) {
                    controlContext.state = 'RUNNING';
                    node.status({ fill: 'green', shape: 'dot', text: `Running EC=${controlContext.targetEc}` });
                }

                // If running, monitor EC deviation for telemetry (no real-time adjustment)
                // PLC handles open-loop control via cycle_EC - no Modbus writes during run
                if (controlContext.state === 'RUNNING' && added) {
                    const deviation = contextService.getEcDeviation(controlContext.targetEc);

                    // Log significant deviations for monitoring
                    if (Math.abs(deviation.deviation) > adjustmentThreshold) {
                        debugLog(`EC deviation: ${deviation.deviation.toFixed(3)} mS/cm (target: ${controlContext.targetEc}, actual: ${deviation.avgEc.toFixed(2)})`);
                    }
                }

                // Send telemetry
                const stats = contextService.getStats();
                sendOutput(2, {
                    topic: 'fertilizer/telemetry',
                    payload: {
                        action: 'telemetry',
                        success: true,
                        data: {
                            readings,
                            stats,
                            state: controlContext.state,
                        },
                    },
                });

            }, EC_CONTROL_DEFAULTS.POLLING_INTERVAL);
        }

        function stopPolling(): void {
            if (pollingInterval) {
                clearInterval(pollingInterval);
                pollingInterval = null;
            }
        }

        // Generate Modbus write commands
        function getModbusWrites(valveTimes: ValveTimes, ecSetpoint: number): ModbusWrite[] {
            return [
                { register: 'control_mode', value: CONTROL_MODES.EC, address: modbusHelper.getHoldingAddress(MODBUS_REGISTER_KEYS.CONTROL_MODE)! },
                { register: 'set_ec', value: Math.round(ecSetpoint * 10), address: modbusHelper.getHoldingAddress(MODBUS_REGISTER_KEYS.SET_EC)! },
                { register: 'time_on_valve_01', value: valveTimes.time_on_valve_01, address: modbusHelper.getHoldingAddress(MODBUS_REGISTER_KEYS.TIME_ON_VALVE_01)! },
                { register: 'time_on_valve_02', value: valveTimes.time_on_valve_02, address: modbusHelper.getHoldingAddress(MODBUS_REGISTER_KEYS.TIME_ON_VALVE_02)! },
                { register: 'time_on_valve_03', value: valveTimes.time_on_valve_03, address: modbusHelper.getHoldingAddress(MODBUS_REGISTER_KEYS.TIME_ON_VALVE_03)! },
                { register: 'time_on_valve_04', value: valveTimes.time_on_valve_04, address: modbusHelper.getHoldingAddress(MODBUS_REGISTER_KEYS.TIME_ON_VALVE_04)! },
                { register: 'time_on_valve_05', value: valveTimes.time_on_valve_05, address: modbusHelper.getHoldingAddress(MODBUS_REGISTER_KEYS.TIME_ON_VALVE_05)! },
            ];
        }

        // Send output message
        function sendOutput(outputIndex: number, msg: EcControlOutputMsg): void {
            const outputs: (EcControlOutputMsg | null)[] = [null, null, null];
            outputs[outputIndex - 1] = msg;
            node.send(outputs);
        }

        // Handle input messages
        node.on('input', async (msg: any) => {
            if (!servicesInitialized) {
                node.warn('Services not initialized yet');
                return;
            }

            const input = msg as EcControlInputMsg;
            const action = input.action || msg.payload?.action;

            switch (action) {
                case 'start':
                    const ecSetpoint = input.ec_setpoint ?? msg.payload?.ec_setpoint;
                    if (typeof ecSetpoint !== 'number' || ecSetpoint <= 0) {
                        node.error('Invalid ec_setpoint');
                        return;
                    }
                    await startIrrigation(ecSetpoint, input.schedule_name);
                    break;

                case 'stop':
                    await stopIrrigation('user');
                    break;

                case 'getValveTimes':
                    const targetEc = input.ec_setpoint ?? msg.payload?.ec_setpoint;
                    if (typeof targetEc !== 'number') {
                        node.error('Invalid ec_setpoint for getValveTimes');
                        return;
                    }
                    const result = await lookupService.getValveTimesForEc(targetEc);
                    sendOutput(1, {
                        topic: 'fertilizer/valveTimes',
                        payload: {
                            action: 'getValveTimes',
                            success: true,
                            data: result,
                        },
                        valve_times: result.valveTimes,
                    });
                    break;

                case 'status':
                    const stats = contextService.getStats();
                    sendOutput(2, {
                        topic: 'fertilizer/status',
                        payload: {
                            action: 'status',
                            success: true,
                            data: {
                                state: controlContext.state,
                                targetEc: controlContext.targetEc,
                                currentValveTimes: controlContext.currentValveTimes,
                                runId: controlContext.currentRun?.id,
                                stats,
                            },
                        },
                    });
                    break;

                case 'sync':
                    try {
                        const unsyncedRuns = await runService.getUnsyncedRuns();
                        const syncedIds = await syncService.syncPendingRuns(unsyncedRuns);
                        for (const id of syncedIds) {
                            await runService.markAsSynced(id);
                        }
                        sendOutput(2, {
                            topic: 'fertilizer/synced',
                            payload: {
                                action: 'sync',
                                success: true,
                                data: { syncedCount: syncedIds.length },
                            },
                        });
                    } catch (error) {
                        sendOutput(3, {
                            topic: 'fertilizer/error',
                            payload: {
                                action: 'sync',
                                success: false,
                                error: (error as Error).message,
                            },
                        });
                    }
                    break;

                case 'readings':
                    // Manual sensor readings injection (for testing)
                    if (input.payload && controlContext.state !== 'IDLE') {
                        contextService.addSample(input.payload as SensorReadings);
                    }
                    break;

                default:
                    node.warn(`Unknown action: ${action}`);
            }
        });

        // Cleanup on close
        node.on('close', async (done: () => void) => {
            stopPolling();

            // Stop any running irrigation
            if (controlContext.state !== 'IDLE') {
                await stopIrrigation('user');
            }

            // Release database connections
            if (lookupService) await lookupService.destroy();
            if (runService) await runService.destroy();

            // Release Modbus client
            if (currentBoardId) {
                ClientRegistry.releaseClientV2('modbus-board', node, currentBoardId);
            } else {
                ClientRegistry.releaseClient('modbus', node);
            }

            done();
        });

        // Initialize on startup
        (async () => {
            node.status({ fill: 'yellow', shape: 'ring', text: 'Initializing...' });
            await initializeServices();
        })();
    }

    RED.nodes.registerType('viis-fertilizer-ec-control', ViisFertilizerEcControlNode);
};
