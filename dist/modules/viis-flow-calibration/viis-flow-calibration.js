"use strict";
/**
 * viis-flow-calibration Node
 * A custom Node-RED node for calibrating flow sensors and pumps
 *
 * This node monitors global context for calibration flags and performs
 * calibration calculations for both:
 * - Board1 (Pump Control): HOLDING_CALIB_BOM_{i}
 * - Board2 (Flow Sensor): K-Factor and Expected Pump Flowrate
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_registry_1 = __importDefault(require("../../core/client-registry"));
const global_context_helper_1 = require("../../ultils/global-context-helper");
const calibrationService_1 = require("./services/calibrationService");
const constants_1 = require("./constants");
module.exports = function (RED) {
    function ViisFlowCalibrationNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const nodeContext = this.context();
        // State variables
        let checkInterval = null;
        let calibrationService = null;
        let modbusClientBoard1 = null;
        let modbusClientBoard2 = null;
        let globalHelper;
        let board2Coils = {};
        // Statistics
        const stats = {
            lastCheck: null,
            lastCalibration: null,
            totalCalibrations: 0,
            failedCalibrations: 0,
            pendingCalibrations: [],
        };
        // Wrap async initialization
        (async () => {
            try {
                node.status({ fill: "yellow", shape: "ring", text: constants_1.STATUS_MESSAGES.INITIALIZING });
                // Initialize GlobalContextHelper
                globalHelper = new global_context_helper_1.GlobalContextHelper(nodeContext);
                // Initialize CalibrationService
                calibrationService = new calibrationService_1.CalibrationService(node.id, config.enableLogging);
                log("CalibrationService initialized");
                // Get Modbus clients for both boards
                await initializeModbusClients();
                // Setup periodic calibration check
                const interval = config.checkInterval || constants_1.DEFAULTS.CHECK_INTERVAL;
                checkInterval = setInterval(async () => {
                    await checkCalibrationFlags();
                }, interval);
                log(`Periodic calibration check enabled (${interval}ms interval)`);
                // Setup input message handler
                setupInputHandler();
                // Setup cleanup handler
                setupCleanupHandler();
                node.status({ fill: "green", shape: "dot", text: constants_1.STATUS_MESSAGES.READY });
            }
            catch (error) {
                node.error(`Initialization failed: ${error.message}`);
                node.status({ fill: "red", shape: "ring", text: constants_1.STATUS_MESSAGES.ERROR });
            }
        })().catch((error) => {
            node.error(`Async initialization error: ${error.message}`);
            node.status({ fill: "red", shape: "ring", text: "Startup error" });
        });
        /**
         * Initialize Modbus clients for both boards
         */
        async function initializeModbusClients() {
            try {
                // Get board1 client (pump control)
                if (config.calibrateBoard1 !== false) {
                    modbusClientBoard1 = await client_registry_1.default.getModbusClientV2("board1", node);
                    if (modbusClientBoard1) {
                        log("Board1 Modbus client initialized");
                    }
                    else {
                        node.warn("Board1 Modbus client not available");
                    }
                }
                // Get board2 client (flow sensor)
                if (config.calibrateBoard2 !== false) {
                    modbusClientBoard2 = await client_registry_1.default.getModbusClientV2("board2", node);
                    if (modbusClientBoard2) {
                        log("Board2 Modbus client initialized");
                    }
                    else {
                        node.warn("Board2 Modbus client not available");
                    }
                }
            }
            catch (error) {
                throw new Error(`Failed to initialize Modbus clients: ${error.message}`);
            }
        }
        /**
         * Check global context for calibration flags
         */
        async function checkCalibrationFlags() {
            var _a, _b, _c, _d;
            if (!calibrationService)
                return;
            stats.lastCheck = Date.now();
            // Get global config values
            const configKeyValues = globalHelper.getGlobalConfigKeyValues();
            // FIX: Merge Board1 and Board2 holding register data
            // Global context stores them separately: holding_register_data_1, holding_register_data_2
            const holdingRegisterData1 = globalHelper.getGlobalVar('holding_register_data_1') || {};
            const holdingRegisterData2 = globalHelper.getGlobalVar('holding_register_data_2') || {};
            const holdingRegisterData = Object.assign(Object.assign({}, holdingRegisterData1), holdingRegisterData2);
            // FIX: Merge Board1 and Board2 input register data
            const inputRegisterData1 = globalHelper.getGlobalVar('input_register_data_1') || {};
            const inputRegisterData2 = globalHelper.getGlobalVar('input_register_data_2') || {};
            const inputRegisterData = Object.assign(Object.assign({}, inputRegisterData1), inputRegisterData2);
            // Try nested structure first (modbusMappings.boardX.holdingRegisters)
            // Fallback to flat structure (modbus_boardX_holding_registers)
            const modbusMappings = globalHelper.getGlobalVar('modbusMappings') || {};
            const board1Registers = ((_a = modbusMappings.board1) === null || _a === void 0 ? void 0 : _a.holdingRegisters) ||
                globalHelper.getGlobalVar(constants_1.ENV_KEYS.MODBUS_BOARD1_HOLDING_REGISTERS) || {};
            const board2Registers = ((_b = modbusMappings.board2) === null || _b === void 0 ? void 0 : _b.holdingRegisters) ||
                globalHelper.getGlobalVar(constants_1.ENV_KEYS.MODBUS_BOARD2_HOLDING_REGISTERS) || {};
            const board2InputRegisters = ((_c = modbusMappings.board2) === null || _c === void 0 ? void 0 : _c.inputRegisters) ||
                globalHelper.getGlobalVar(constants_1.ENV_KEYS.MODBUS_BOARD2_INPUT_REGISTERS) || {};
            board2Coils = ((_d = modbusMappings.board2) === null || _d === void 0 ? void 0 : _d.coils) ||
                globalHelper.getGlobalVar(constants_1.ENV_KEYS.MODBUS_BOARD2_COILS) || {};
            const pendingCalibrations = [];
            const flagUpdates = {};
            // Check each pump (1-16)
            for (let i = 1; i <= constants_1.DEFAULTS.NUM_PUMPS; i++) {
                const calculateKey = constants_1.CONFIG_KEYS.CALCULATE_CALIB(i);
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
                    const result = calibrationService.calculate(input, board1Registers, board2Registers, config.calibrateBoard1 !== false, config.calibrateBoard2 !== false);
                    if (result.success) {
                        // Write calibration values to Modbus
                        await writeCalibrationValues(result);
                        stats.totalCalibrations++;
                        stats.lastCalibration = Date.now();
                        log(`Calibration complete for pump ${i}`);
                    }
                    else {
                        node.warn(`Calibration failed for pump ${i}: ${result.error}`);
                        stats.failedCalibrations++;
                    }
                    // Mark flag for reset
                    flagUpdates[calculateKey] = false;
                }
                catch (error) {
                    node.error(`Error calibrating pump ${i}: ${error.message}`);
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
                        stats: Object.assign({}, stats),
                    },
                });
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: `${constants_1.STATUS_MESSAGES.SUCCESS}: ${pendingCalibrations.length} pumps`
                });
                // Reset status after a delay
                setTimeout(() => {
                    node.status({ fill: "green", shape: "dot", text: constants_1.STATUS_MESSAGES.READY });
                }, 3000);
            }
        }
        /**
         * Reset volume counter for a specific pump
         */
        async function resetVolumeCounter(pumpIndex) {
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
                }
                catch (error) {
                    node.warn(`Failed to reset volume counter for pump ${pumpIndex}: ${error.message}`);
                }
            }
            else {
                node.warn(`Reset coil address not found for pump ${pumpIndex}`);
            }
        }
        /**
         * Gather calibration input data from global context
         */
        function gatherCalibrationInput(pumpIndex, configKeyValues, holdingRegisterData, inputRegisterData) {
            const actualMlKey = constants_1.CONFIG_KEYS.CALIB_ACTUAL_ML(pumpIndex);
            const setMlKey = constants_1.BOARD1_KEYS.SET_ML(pumpIndex);
            const calibKey = constants_1.BOARD1_KEYS.CALIB(pumpIndex);
            const actualMl = configKeyValues[actualMlKey];
            const setMl = holdingRegisterData[setMlKey];
            const currentCalibBoard1 = holdingRegisterData[calibKey];
            // Validate required data
            if (!actualMl || !setMl || !currentCalibBoard1) {
                log(`Missing data for pump ${pumpIndex}: actualMl=${actualMl}, setMl=${setMl}, currentCalib=${currentCalibBoard1}`);
                return null;
            }
            // Get board2 data (may not be available)
            const kFactorKey = constants_1.BOARD2_KEYS.K_FACTOR(pumpIndex);
            const flowrateKey = constants_1.BOARD2_KEYS.FLOWRATE(pumpIndex);
            const totalFlowKey = constants_1.BOARD2_KEYS.INPUT_TOTAL_FLOW(pumpIndex);
            const currentKFactor = holdingRegisterData[kFactorKey] || 450; // Default K-factor
            const currentFlowrate = holdingRegisterData[flowrateKey] || 10; // Default flowrate mL/s
            const reportedVolume = inputRegisterData[totalFlowKey] || setMl; // Read from input registers
            return {
                pumpIndex,
                actualMl: Number(actualMl),
                setMl: Number(setMl),
                currentCalibBoard1: Number(currentCalibBoard1),
                currentKFactor: Number(currentKFactor),
                currentFlowrate: Number(currentFlowrate),
                reportedVolume: Number(reportedVolume),
            };
        }
        /**
         * Write calibration values to Modbus registers
         */
        async function writeCalibrationValues(result) {
            const writePromises = [];
            // Write to Board1
            if (result.board1 && modbusClientBoard1) {
                log(`Writing to Board1: address=${result.board1.address}, value=${result.board1.newCalibValue}`);
                writePromises.push(modbusClientBoard1.writeRegister(result.board1.address, result.board1.newCalibValue)
                    .catch((err) => {
                    node.error(`Board1 write error: ${err.message}`);
                }));
            }
            // Write to Board2
            if (result.board2 && modbusClientBoard2) {
                log(`Writing to Board2 K-Factor: address=${result.board2.kFactorAddress}, value=${result.board2.newKFactor}`);
                writePromises.push(modbusClientBoard2.writeRegister(result.board2.kFactorAddress, result.board2.newKFactor)
                    .catch((err) => {
                    node.error(`Board2 K-Factor write error: ${err.message}`);
                }));
                log(`Writing to Board2 Flowrate: address=${result.board2.flowrateAddress}, value=${result.board2.newFlowrate}`);
                writePromises.push(modbusClientBoard2.writeRegister(result.board2.flowrateAddress, result.board2.newFlowrate)
                    .catch((err) => {
                    node.error(`Board2 Flowrate write error: ${err.message}`);
                }));
            }
            await Promise.all(writePromises);
        }
        /**
         * Update global config flags
         */
        function updateGlobalConfigFlags(updates) {
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
        function setupInputHandler() {
            node.on("input", async (msg, send, done) => {
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
                            send({ payload: Object.assign({}, stats) });
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
                    if (done)
                        done();
                }
                catch (error) {
                    node.error(`Input handler error: ${error.message}`);
                    if (done)
                        done(error);
                }
            });
        }
        /**
         * Handle manual calculation request
         */
        async function handleManualCalculation(payload) {
            if (!calibrationService) {
                node.warn("CalibrationService not initialized");
                return;
            }
            node.status({ fill: "yellow", shape: "ring", text: constants_1.STATUS_MESSAGES.CALIBRATING });
            const pumpIndex = (payload === null || payload === void 0 ? void 0 : payload.pumpIndex) || (payload === null || payload === void 0 ? void 0 : payload.pump);
            const actualMl = (payload === null || payload === void 0 ? void 0 : payload.actualMl) || (payload === null || payload === void 0 ? void 0 : payload.actual_ml);
            const setMl = (payload === null || payload === void 0 ? void 0 : payload.setMl) || (payload === null || payload === void 0 ? void 0 : payload.set_ml);
            if (!pumpIndex || !actualMl || !setMl) {
                node.warn("Manual calculation requires: pumpIndex, actualMl, setMl");
                return;
            }
            // Get current calibration values from Modbus
            // FIX: Merge Board1 and Board2 holding register data
            const holdingRegisterData1 = globalHelper.getGlobalVar('holding_register_data_1') || {};
            const holdingRegisterData2 = globalHelper.getGlobalVar('holding_register_data_2') || {};
            const holdingRegisterData = Object.assign(Object.assign({}, holdingRegisterData1), holdingRegisterData2);
            // FIX: Merge Board1 and Board2 input register data
            const inputRegisterData1 = globalHelper.getGlobalVar('input_register_data_1') || {};
            const inputRegisterData2 = globalHelper.getGlobalVar('input_register_data_2') || {};
            const inputRegisterData = Object.assign(Object.assign({}, inputRegisterData1), inputRegisterData2);
            const board1Registers = globalHelper.getGlobalVar(constants_1.ENV_KEYS.MODBUS_BOARD1_HOLDING_REGISTERS) || {};
            const board2Registers = globalHelper.getGlobalVar(constants_1.ENV_KEYS.MODBUS_BOARD2_HOLDING_REGISTERS) || {};
            const calibKey = constants_1.BOARD1_KEYS.CALIB(pumpIndex);
            const kFactorKey = constants_1.BOARD2_KEYS.K_FACTOR(pumpIndex);
            const flowrateKey = constants_1.BOARD2_KEYS.FLOWRATE(pumpIndex);
            const totalFlowKey = constants_1.BOARD2_KEYS.INPUT_TOTAL_FLOW(pumpIndex);
            const input = {
                pumpIndex,
                actualMl: Number(actualMl),
                setMl: Number(setMl),
                currentCalibBoard1: Number(holdingRegisterData[calibKey]) || 1000,
                currentKFactor: Number(holdingRegisterData[kFactorKey]) || 450,
                currentFlowrate: Number(holdingRegisterData[flowrateKey]) || 10,
                reportedVolume: Number(inputRegisterData[totalFlowKey]) || Number(setMl), // Read from input registers
            };
            const result = calibrationService.calculate(input, board1Registers, board2Registers, config.calibrateBoard1 !== false, config.calibrateBoard2 !== false);
            if (result.success) {
                await writeCalibrationValues(result);
                stats.totalCalibrations++;
                stats.lastCalibration = Date.now();
                node.send({
                    topic: "manual_calibration_complete",
                    payload: Object.assign(Object.assign({}, result), { stats: Object.assign({}, stats) }),
                });
                node.status({ fill: "green", shape: "dot", text: `${constants_1.STATUS_MESSAGES.SUCCESS}: Pump ${pumpIndex}` });
            }
            else {
                stats.failedCalibrations++;
                node.warn(`Manual calibration failed: ${result.error}`);
                node.status({ fill: "red", shape: "ring", text: `Failed: ${result.error}` });
            }
            // Reset status after delay
            setTimeout(() => {
                node.status({ fill: "green", shape: "dot", text: constants_1.STATUS_MESSAGES.READY });
            }, 3000);
        }
        /**
         * Handle reset volume counter request
         */
        async function handleResetVolume(payload) {
            const pumpIndex = (payload === null || payload === void 0 ? void 0 : payload.pumpIndex) || (payload === null || payload === void 0 ? void 0 : payload.pump);
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
                node.status({ fill: "green", shape: "dot", text: constants_1.STATUS_MESSAGES.READY });
            }, 2000);
        }
        /**
         * Setup cleanup handler
         */
        function setupCleanupHandler() {
            node.on("close", async (done) => {
                try {
                    // Stop periodic check
                    if (checkInterval) {
                        clearInterval(checkInterval);
                        checkInterval = null;
                        log("Periodic check stopped");
                    }
                    // Release Modbus clients
                    if (modbusClientBoard1) {
                        client_registry_1.default.releaseClientV2("modbus-board", node, "board1");
                        log("Board1 client released");
                    }
                    if (modbusClientBoard2) {
                        client_registry_1.default.releaseClientV2("modbus-board", node, "board2");
                        log("Board2 client released");
                    }
                    log("Node closed and cleaned up");
                    done();
                }
                catch (error) {
                    node.error(`Cleanup error: ${error.message}`);
                    done();
                }
            });
        }
        /**
         * Helper logging function
         */
        function log(message) {
            if (config.enableLogging) {
                node.log(`[FLOW_CALIB] ${message}`);
            }
        }
    }
    RED.nodes.registerType("viis-flow-calibration", ViisFlowCalibrationNode);
};
