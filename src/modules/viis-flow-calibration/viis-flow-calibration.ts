/**
 * viis-flow-calibration Node
 * A custom Node-RED node for calibrating flow sensors and pumps
 * 
 * This node monitors global context for calibration flags and performs
 * calibration calculations for both:
 * - Board1 (Pump Control): HOLDING_CALIB_BOM_{i}
 * - Board2 (Flow Sensor): K-Factor and Expected Pump Flowrate
 */

import { NodeAPI, Node, NodeContext } from "node-red";
import ClientRegistry from "../../core/client-registry";
import { GlobalContextHelper } from "../../ultils/global-context-helper";
import { CalibrationService } from "./services/calibrationService";
import {
    ViisFlowCalibrationNodeDef,
    CalibrationInput,
    CalibrationResult,
    CalibrationStatus,
    CalibrationFlagResetPayload,
} from "./interfaces/types";
import {
    ENV_KEYS,
    DEFAULTS,
    STATUS_MESSAGES,
    ERROR_MESSAGES,
    CONFIG_KEYS,
    BOARD1_KEYS,
    BOARD2_KEYS,
} from "./constants";

module.exports = function (RED: NodeAPI) {
    function ViisFlowCalibrationNode(this: Node, config: ViisFlowCalibrationNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;
        const nodeContext: NodeContext = this.context();

        // State variables
        let checkInterval: NodeJS.Timeout | null = null;
        let calibrationService: CalibrationService | null = null;
        let modbusClientBoard1: any = null;
        let modbusClientBoard2: any = null;
        let globalHelper: GlobalContextHelper;
        let board2Coils: Record<string, number> = {};

        // Statistics
        const stats: CalibrationStatus = {
            lastCheck: null,
            lastCalibration: null,
            totalCalibrations: 0,
            failedCalibrations: 0,
            pendingCalibrations: [],
        };

        // Wrap async initialization
        (async () => {
            try {
                node.status({ fill: "yellow", shape: "ring", text: STATUS_MESSAGES.INITIALIZING });

                // Initialize GlobalContextHelper
                globalHelper = new GlobalContextHelper(nodeContext);

                // Initialize CalibrationService
                calibrationService = new CalibrationService(node.id, config.enableLogging);
                log("CalibrationService initialized");

                // Get Modbus clients for both boards
                await initializeModbusClients();

                // Setup periodic calibration check
                const interval = config.checkInterval || DEFAULTS.CHECK_INTERVAL;
                checkInterval = setInterval(async () => {
                    await checkCalibrationFlags();
                }, interval);

                log(`Periodic calibration check enabled (${interval}ms interval)`);

                // Setup input message handler
                setupInputHandler();

                // Setup cleanup handler
                setupCleanupHandler();

                node.status({ fill: "green", shape: "dot", text: STATUS_MESSAGES.READY });

            } catch (error) {
                node.error(`Initialization failed: ${(error as Error).message}`);
                node.status({ fill: "red", shape: "ring", text: STATUS_MESSAGES.ERROR });
            }
        })().catch((error) => {
            node.error(`Async initialization error: ${(error as Error).message}`);
            node.status({ fill: "red", shape: "ring", text: "Startup error" });
        });

        /**
         * Initialize Modbus clients for both boards
         */
        async function initializeModbusClients(): Promise<void> {
            try {
                // Get board1 client (pump control)
                if (config.calibrateBoard1 !== false) {
                    modbusClientBoard1 = await ClientRegistry.getModbusClientV2("board1", node);
                    if (modbusClientBoard1) {
                        log("Board1 Modbus client initialized");
                    } else {
                        node.warn("Board1 Modbus client not available");
                    }
                }

                // Get board2 client (flow sensor)
                if (config.calibrateBoard2 !== false) {
                    modbusClientBoard2 = await ClientRegistry.getModbusClientV2("board2", node);
                    if (modbusClientBoard2) {
                        log("Board2 Modbus client initialized");
                    } else {
                        node.warn("Board2 Modbus client not available");
                    }
                }
            } catch (error) {
                throw new Error(`Failed to initialize Modbus clients: ${(error as Error).message}`);
            }
        }

        /**
         * Check global context for calibration flags
         */
        async function checkCalibrationFlags(): Promise<void> {
            if (!calibrationService) return;

            stats.lastCheck = Date.now();

            // Get global config values
            const configKeyValues = globalHelper.getGlobalConfigKeyValues();
            
            // FIX: Merge Board1 and Board2 holding register data
            // Global context stores them separately: holding_register_data_1, holding_register_data_2
            const holdingRegisterData1 = globalHelper.getGlobalVar('holding_register_data_1') || {};
            const holdingRegisterData2 = globalHelper.getGlobalVar('holding_register_data_2') || {};
            const holdingRegisterData = { ...holdingRegisterData1, ...holdingRegisterData2 };
            
            // FIX: Merge Board1 and Board2 input register data
            const inputRegisterData1 = globalHelper.getGlobalVar('input_register_data_1') || {};
            const inputRegisterData2 = globalHelper.getGlobalVar('input_register_data_2') || {};
            const inputRegisterData = { ...inputRegisterData1, ...inputRegisterData2 };

            // Try nested structure first (modbusMappings.boardX.holdingRegisters)
            // Fallback to flat structure (modbus_boardX_holding_registers)
            const modbusMappings = globalHelper.getGlobalVar('modbusMappings') || {};
            const board1Registers = modbusMappings.board1?.holdingRegisters ||
                                    globalHelper.getGlobalVar(ENV_KEYS.MODBUS_BOARD1_HOLDING_REGISTERS) || {};
            const board2Registers = modbusMappings.board2?.holdingRegisters ||
                                    globalHelper.getGlobalVar(ENV_KEYS.MODBUS_BOARD2_HOLDING_REGISTERS) || {};
            const board2InputRegisters = modbusMappings.board2?.inputRegisters ||
                                         globalHelper.getGlobalVar(ENV_KEYS.MODBUS_BOARD2_INPUT_REGISTERS) || {};
            board2Coils = modbusMappings.board2?.coils ||
                          globalHelper.getGlobalVar(ENV_KEYS.MODBUS_BOARD2_COILS) || {};

            const pendingCalibrations: number[] = [];
            const flagUpdates: CalibrationFlagResetPayload = {};

            // Check each pump (1-16)
            for (let i = 1; i <= DEFAULTS.NUM_PUMPS; i++) {
                const calculateKey = CONFIG_KEYS.CALCULATE_CALIB(i);

                // Check if calibration is requested
                if (!configKeyValues[calculateKey]) {
                    continue;
                }

                pendingCalibrations.push(i);
                log(`Calibration requested for pump ${i}`);

                try {
                    // Gather calibration input data
                    const input = gatherCalibrationInput(i, configKeyValues, holdingRegisterData, inputRegisterData);

                    if (!input) {
                        node.warn(`Missing data for pump ${i} calibration`);
                        stats.failedCalibrations++;
                        continue;
                    }

                    // Calculate calibration values
                    const result = calibrationService.calculate(
                        input,
                        board1Registers,
                        board2Registers,
                        config.calibrateBoard1 !== false,
                        config.calibrateBoard2 !== false
                    );

                    if (result.success) {
                        // Write calibration values to Modbus
                        await writeCalibrationValues(result);
                        stats.totalCalibrations++;
                        stats.lastCalibration = Date.now();
                        log(`Calibration complete for pump ${i}`);
                    } else {
                        node.warn(`Calibration failed for pump ${i}: ${result.error}`);
                        stats.failedCalibrations++;
                    }

                    // Mark flag for reset
                    flagUpdates[calculateKey] = false;

                } catch (error) {
                    node.error(`Error calibrating pump ${i}: ${(error as Error).message}`);
                    stats.failedCalibrations++;
                    flagUpdates[calculateKey] = false;
                }
            }

            stats.pendingCalibrations = pendingCalibrations;

            // Reset calibration flags in global context
            if (Object.keys(flagUpdates).length > 0) {
                updateGlobalConfigFlags(flagUpdates);

                // Send output message with flag updates
                node.send({
                    topic: "calibration_complete",
                    payload: {
                        flagUpdates,
                        stats: { ...stats },
                    },
                });

                node.status({
                    fill: "green",
                    shape: "dot",
                    text: `${STATUS_MESSAGES.SUCCESS}: ${pendingCalibrations.length} pumps`
                });

                // Reset status after a delay
                setTimeout(() => {
                    node.status({ fill: "green", shape: "dot", text: STATUS_MESSAGES.READY });
                }, 3000);
            }
        }

        /**
         * Reset volume counter for a specific pump
         */
        async function resetVolumeCounter(pumpIndex: number): Promise<void> {
            if (!modbusClientBoard2) {
                log(`Board2 client not available, skipping volume reset for pump ${pumpIndex}`);
                return;
            }

            const resetCoilKey = `RESET_TOTAL_VOLUME_BOM_${pumpIndex}`;
            const resetCoilAddress = board2Coils[resetCoilKey];

            if (resetCoilAddress !== undefined) {
                log(`Resetting volume counter for pump ${pumpIndex} (coil ${resetCoilAddress})`);
                try {
                    await modbusClientBoard2.writeCoil(resetCoilAddress, 1);
                    await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms for device to process
                    log(`Volume counter reset complete for pump ${pumpIndex}`);
                } catch (error) {
                    node.warn(`Failed to reset volume counter for pump ${pumpIndex}: ${(error as Error).message}`);
                }
            } else {
                node.warn(`Reset coil address not found for pump ${pumpIndex}`);
            }
        }

        /**
         * Gather calibration input data from global context
         */
        function gatherCalibrationInput(
            pumpIndex: number,
            configKeyValues: Record<string, any>,
            holdingRegisterData: Record<string, any>,
            inputRegisterData: Record<string, any>
        ): CalibrationInput | null {
            const actualMlKey = CONFIG_KEYS.CALIB_ACTUAL_ML(pumpIndex);
            const setMlKey = BOARD1_KEYS.SET_ML(pumpIndex);
            const calibKey = BOARD1_KEYS.CALIB(pumpIndex);

            const actualMl = configKeyValues[actualMlKey];
            const setMl = holdingRegisterData[setMlKey];
            const currentCalibBoard1 = holdingRegisterData[calibKey];

            // Validate required data
            if (!actualMl || !setMl || !currentCalibBoard1) {
                log(`Missing data for pump ${pumpIndex}: actualMl=${actualMl}, setMl=${setMl}, currentCalib=${currentCalibBoard1}`);
                return null;
            }

            // Get board2 data (may not be available)
            const kFactorKey = BOARD2_KEYS.K_FACTOR(pumpIndex);
            const flowrateKey = BOARD2_KEYS.FLOWRATE(pumpIndex);
            const totalFlowKey = BOARD2_KEYS.INPUT_TOTAL_FLOW(pumpIndex);

            const currentKFactor = holdingRegisterData[kFactorKey];
            const currentFlowrate = holdingRegisterData[flowrateKey];
            const reportedVolume = inputRegisterData[totalFlowKey];

            // Debug logging
            log(`Board2 data for pump ${pumpIndex}:`);
            log(`  kFactorKey=${kFactorKey}, value=${currentKFactor}, exists=${kFactorKey in holdingRegisterData}`);
            log(`  flowrateKey=${flowrateKey}, value=${currentFlowrate}, exists=${flowrateKey in holdingRegisterData}`);
            log(`  totalFlowKey=${totalFlowKey}, value=${reportedVolume}, exists=${totalFlowKey in inputRegisterData}`);

            // Use defaults with warning
            const kFactorValue = currentKFactor !== undefined && currentKFactor !== null && currentKFactor !== 0 ? currentKFactor : 450;
            const flowrateValue = currentFlowrate !== undefined && currentFlowrate !== null && currentFlowrate !== 0 ? currentFlowrate : 10;
            const reportedVolumeValue = reportedVolume !== undefined && reportedVolume !== null && reportedVolume !== 0 ? reportedVolume : setMl;

            if (currentKFactor === undefined || currentKFactor === null || currentKFactor === 0) {
                node.warn(`⚠️ K-Factor not found for pump ${pumpIndex}, using default 450`);
            }
            if (currentFlowrate === undefined || currentFlowrate === null || currentFlowrate === 0) {
                node.warn(`⚠️ Flowrate not found for pump ${pumpIndex}, using default 10`);
            }

            return {
                pumpIndex,
                actualMl: Number(actualMl),
                setMl: Number(setMl),
                currentCalibBoard1: Number(currentCalibBoard1),
                currentKFactor: Number(kFactorValue),
                currentFlowrate: Number(flowrateValue),
                reportedVolume: Number(reportedVolumeValue),
            };
        }

        /**
         * Write calibration values to Modbus registers
         */
        async function writeCalibrationValues(result: CalibrationResult): Promise<void> {
            const writePromises: Promise<void>[] = [];

            // Write to Board1
            if (result.board1 && modbusClientBoard1) {
                log(`Writing to Board1: address=${result.board1.address}, value=${result.board1.newCalibValue}`);
                writePromises.push(
                    modbusClientBoard1.writeRegister(result.board1.address, result.board1.newCalibValue)
                        .catch((err: Error) => {
                            node.error(`Board1 write error: ${err.message}`);
                        })
                );
            }

            // Write to Board2
            if (result.board2 && modbusClientBoard2) {
                log(`Writing to Board2 K-Factor: address=${result.board2.kFactorAddress}, value=${result.board2.newKFactor}`);
                writePromises.push(
                    modbusClientBoard2.writeRegister(result.board2.kFactorAddress, result.board2.newKFactor)
                        .catch((err: Error) => {
                            node.error(`Board2 K-Factor write error: ${err.message}`);
                        })
                );

                log(`Writing to Board2 Flowrate: address=${result.board2.flowrateAddress}, value=${result.board2.newFlowrate}`);
                writePromises.push(
                    modbusClientBoard2.writeRegister(result.board2.flowrateAddress, result.board2.newFlowrate)
                        .catch((err: Error) => {
                            node.error(`Board2 Flowrate write error: ${err.message}`);
                        })
                );
            }

            await Promise.all(writePromises);
        }

        /**
         * Update global config flags
         */
        function updateGlobalConfigFlags(updates: CalibrationFlagResetPayload): void {
            const configKeyValues = globalHelper.getGlobalConfigKeyValues();

            for (const [key, value] of Object.entries(updates)) {
                configKeyValues[key] = value;
            }

            globalHelper.setGlobalVar("configKeyValues", configKeyValues);
            log(`Config flags updated: ${JSON.stringify(updates)}`);
        }

        /**
         * Setup input message handler
         */
        function setupInputHandler(): void {
            node.on("input", async (msg: any, send: any, done: any) => {
                try {
                    const topic = msg.topic || "";

                    switch (topic) {
                        case "calculate":
                            // Manual trigger for specific pump(s)
                            await handleManualCalculation(msg.payload);
                            break;

                        case "reset-volume":
                            // Reset volume counter for specific pump(s)
                            await handleResetVolume(msg.payload);
                            break;

                        case "status":
                            // Return current status
                            send({ payload: { ...stats } });
                            break;

                        case "check":
                            // Force check calibration flags
                            await checkCalibrationFlags();
                            break;

                        default:
                            // Passthrough or trigger check
                            await checkCalibrationFlags();
                            break;
                    }

                    if (done) done();
                } catch (error) {
                    node.error(`Input handler error: ${(error as Error).message}`);
                    if (done) done(error);
                }
            });
        }

        /**
         * Handle manual calculation request
         */
        async function handleManualCalculation(payload: any): Promise<void> {
            if (!calibrationService) {
                node.warn("CalibrationService not initialized");
                return;
            }

            node.status({ fill: "yellow", shape: "ring", text: STATUS_MESSAGES.CALIBRATING });

            const pumpIndex = payload?.pumpIndex || payload?.pump;
            const actualMl = payload?.actualMl || payload?.actual_ml;
            const setMl = payload?.setMl || payload?.set_ml;

            if (!pumpIndex || !actualMl || !setMl) {
                node.warn("Manual calculation requires: pumpIndex, actualMl, setMl");
                return;
            }

            // Get current calibration values from Modbus
            // FIX: Merge Board1 and Board2 holding register data
            const holdingRegisterData1 = globalHelper.getGlobalVar('holding_register_data_1') || {};
            const holdingRegisterData2 = globalHelper.getGlobalVar('holding_register_data_2') || {};
            const holdingRegisterData = { ...holdingRegisterData1, ...holdingRegisterData2 };
            
            // FIX: Merge Board1 and Board2 input register data
            const inputRegisterData1 = globalHelper.getGlobalVar('input_register_data_1') || {};
            const inputRegisterData2 = globalHelper.getGlobalVar('input_register_data_2') || {};
            const inputRegisterData = { ...inputRegisterData1, ...inputRegisterData2 };
            
            const board1Registers = globalHelper.getGlobalVar(ENV_KEYS.MODBUS_BOARD1_HOLDING_REGISTERS) || {};
            const board2Registers = globalHelper.getGlobalVar(ENV_KEYS.MODBUS_BOARD2_HOLDING_REGISTERS) || {};

            const calibKey = BOARD1_KEYS.CALIB(pumpIndex);
            const kFactorKey = BOARD2_KEYS.K_FACTOR(pumpIndex);
            const flowrateKey = BOARD2_KEYS.FLOWRATE(pumpIndex);
            const totalFlowKey = BOARD2_KEYS.INPUT_TOTAL_FLOW(pumpIndex);

            const input: CalibrationInput = {
                pumpIndex,
                actualMl: Number(actualMl),
                setMl: Number(setMl),
                currentCalibBoard1: Number(holdingRegisterData[calibKey]) || 1000,
                currentKFactor: Number(holdingRegisterData[kFactorKey]) || 450,
                currentFlowrate: Number(holdingRegisterData[flowrateKey]) || 10,
                reportedVolume: Number(inputRegisterData[totalFlowKey]) || Number(setMl), // Read from input registers
            };

            const result = calibrationService.calculate(
                input,
                board1Registers,
                board2Registers,
                config.calibrateBoard1 !== false,
                config.calibrateBoard2 !== false
            );

            if (result.success) {
                await writeCalibrationValues(result);
                stats.totalCalibrations++;
                stats.lastCalibration = Date.now();

                node.send({
                    topic: "manual_calibration_complete",
                    payload: {
                        ...result,
                        stats: { ...stats },
                    },
                });

                node.status({ fill: "green", shape: "dot", text: `${STATUS_MESSAGES.SUCCESS}: Pump ${pumpIndex}` });
            } else {
                stats.failedCalibrations++;
                node.warn(`Manual calibration failed: ${result.error}`);
                node.status({ fill: "red", shape: "ring", text: `Failed: ${result.error}` });
            }

            // Reset status after delay
            setTimeout(() => {
                node.status({ fill: "green", shape: "dot", text: STATUS_MESSAGES.READY });
            }, 3000);
        }

        /**
         * Handle reset volume counter request
         */
        async function handleResetVolume(payload: any): Promise<void> {
            const pumpIndex = payload?.pumpIndex || payload?.pump;

            if (!pumpIndex) {
                node.warn("Reset volume requires: pumpIndex");
                return;
            }

            node.status({ fill: "yellow", shape: "ring", text: "Resetting volume..." });

            await resetVolumeCounter(pumpIndex);

            node.send({
                topic: "reset-volume-complete",
                payload: {
                    pumpIndex,
                    success: true,
                },
            });

            node.status({ fill: "green", shape: "dot", text: `Volume reset: Pump ${pumpIndex}` });

            // Reset status after delay
            setTimeout(() => {
                node.status({ fill: "green", shape: "dot", text: STATUS_MESSAGES.READY });
            }, 2000);
        }

        /**
         * Setup cleanup handler
         */
        function setupCleanupHandler(): void {
            node.on("close", async (done: () => void) => {
                try {
                    // Stop periodic check
                    if (checkInterval) {
                        clearInterval(checkInterval);
                        checkInterval = null;
                        log("Periodic check stopped");
                    }

                    // Release Modbus clients
                    if (modbusClientBoard1) {
                        ClientRegistry.releaseClientV2("modbus-board", node, "board1");
                        log("Board1 client released");
                    }

                    if (modbusClientBoard2) {
                        ClientRegistry.releaseClientV2("modbus-board", node, "board2");
                        log("Board2 client released");
                    }

                    log("Node closed and cleaned up");
                    done();
                } catch (error) {
                    node.error(`Cleanup error: ${(error as Error).message}`);
                    done();
                }
            });
        }

        /**
         * Helper logging function
         */
        function log(message: string): void {
            if (config.enableLogging) {
                node.log(`[FLOW_CALIB] ${message}`);
            }
        }
    }

    RED.nodes.registerType("viis-flow-calibration", ViisFlowCalibrationNode);
};
