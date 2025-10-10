"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_registry_1 = __importDefault(require("../../core/client-registry"));
const global_context_helper_1 = require("../../ultils/global-context-helper");
module.exports = function (RED) {
    function ViisDeviceProtectionNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        // Initialize GlobalContextHelper
        const globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
        // Multi-board state variables
        let currentBoardId = config.boardId;
        let isMultiBoardMode = false;
        let currentModbusConfig = null;
        // Helper function to read fresh config from global context
        const readModbusConfig = () => {
            const boardsConfigStr = globalHelper.getEnvVar('MODBUS_BOARDS', null);
            if (boardsConfigStr) {
                try {
                    const boards = JSON.parse(boardsConfigStr);
                    if (Array.isArray(boards) && boards.length > 0) {
                        return {
                            mode: 'multi',
                            boards: boards,
                            defaultBoard: globalHelper.getEnvVar('MODBUS_DEFAULT_BOARD', boards[0].id)
                        };
                    }
                }
                catch (e) {
                    node.error(`Failed to parse MODBUS_BOARDS: ${e}`);
                }
            }
            return {
                mode: 'single',
                config: {
                    type: globalHelper.getEnvVar("MODBUS_TYPE", "TCP"),
                    host: globalHelper.getEnvVar("MODBUS_HOST", "localhost"),
                    tcpPort: globalHelper.getNumericEnvVar("MODBUS_TCP_PORT", 502),
                    serialPort: globalHelper.getEnvVar("MODBUS_SERIAL_PORT", "/dev/ttyUSB0"),
                    baudRate: globalHelper.getNumericEnvVar("MODBUS_BAUD_RATE", 9600),
                    parity: globalHelper.getEnvVar("MODBUS_PARITY", "none"),
                    unitId: globalHelper.getNumericEnvVar("MODBUS_UNIT_ID", 1),
                    timeout: globalHelper.getNumericEnvVar("MODBUS_TIMEOUT", 5000),
                    reconnectInterval: globalHelper.getNumericEnvVar("MODBUS_RECONNECT_INTERVAL", 5000),
                }
            };
        };
        // Environment variables for Modbus mappings
        let modbusCoils = globalHelper.getJsonEnvVar("MODBUS_COILS", {});
        let modbusHoldingRegisters = globalHelper.getJsonEnvVar("MODBUS_HOLDING_REGISTERS", {});
        let modbusInputRegisters = globalHelper.getJsonEnvVar("MODBUS_INPUT_REGISTERS", {});
        // Initialize Modbus configuration
        const configData = readModbusConfig();
        currentModbusConfig = Object.assign({}, configData);
        // Auto-detect mode
        if (configData.mode === 'multi') {
            isMultiBoardMode = true;
            node.log(`Multi-board mode detected with ${configData.boards.length} boards`);
            const multiConfig = {
                mode: 'multi',
                defaultBoard: configData.defaultBoard,
                boards: configData.boards
            };
            client_registry_1.default.initializeMultiBoardConfig(multiConfig, node);
        }
        else {
            isMultiBoardMode = false;
            node.log(`Single-board mode`);
        }
        // Get Modbus client
        let modbusClient;
        if (isMultiBoardMode) {
            const boardToUse = currentBoardId || configData.defaultBoard;
            node.log(`Getting client for board: ${boardToUse}`);
            modbusClient = client_registry_1.default.getModbusClientV2(boardToUse, node);
        }
        else {
            modbusClient = client_registry_1.default.getModbusClientV2(configData.config, node);
        }
        if (!modbusClient) {
            node.error("Failed to initialize Modbus client");
            node.status({ fill: "red", shape: "ring", text: "Modbus client failed" });
            return;
        }
        // Trạng thái theo dõi thời gian bật của các coil
        const coilTimers = {};
        // Hàm đọc trạng thái coil từ Modbus
        async function readCoil(address) {
            try {
                const result = await modbusClient.readCoils(address, 1);
                return Boolean(result.data[0]);
            }
            catch (error) {
                const err = error;
                node.error(`Modbus read coil error at address ${address}: ${err.message}`);
                return false;
            }
        }
        // Hàm ghi trạng thái coil vào Modbus
        async function writeCoil(address, value) {
            try {
                await modbusClient.writeCoil(address, value);
                node.log(`Wrote to coil at address ${address}: ${value}`);
            }
            catch (error) {
                const err = error;
                node.error(`Modbus write coil error at address ${address}: ${err.message}`);
            }
        }
        // Hàm kiểm tra và áp dụng logic bảo vệ
        async function checkProtection() {
            const configKeyValues = node.context().global.get("configKeyValues") || {};
            if (!configKeyValues || Object.keys(configKeyValues).length === 0) {
                // node.warn("No configKeyValues found in global context");
                node.status({ fill: "yellow", shape: "ring", text: "No configKeyValues" });
                return;
            }
            // Lấy dữ liệu telemetry từ biến global coilRegisterData
            const coilData = node.context().global.get("coilRegisterData") || {};
            for (const [key, value] of Object.entries(configKeyValues)) {
                // Chỉ xử lý các key liên quan đến giới hạn thời gian (có hậu tố _MAX_TIME)
                if (!key.endsWith("_MAX_TIME"))
                    continue;
                const coilKey = key.replace("_MAX_TIME", ""); // Ví dụ: COIL_OUTPUT_WATER_IN_MAX_TIME -> COIL_OUTPUT_WATER_IN
                const maxTime = Number(value); // Thời gian tối đa (giây)
                if (isNaN(maxTime) || maxTime <= 0) {
                    node.warn(`Invalid max time for ${key}: ${value}`);
                    continue;
                }
                // Lấy trạng thái của coil từ dữ liệu telemetry
                const isCoilOn = coilData[coilKey];
                if (isCoilOn) {
                    if (!coilTimers[coilKey]) {
                        // Bắt đầu đếm thời gian nếu coil vừa bật
                        coilTimers[coilKey] = {
                            startTime: Date.now(),
                            maxTime: maxTime * 1000, // Chuyển sang milliseconds
                        };
                        node.log(`Started timer for ${coilKey} with max time ${maxTime}s`);
                    }
                    else {
                        // Kiểm tra thời gian đã vượt quá chưa
                        const elapsedTime = Date.now() - coilTimers[coilKey].startTime;
                        if (elapsedTime > coilTimers[coilKey].maxTime) {
                            node.warn(`Coil ${coilKey} exceeded max time (${maxTime}s). Turning off.`);
                            // Giữ lại thao tác tắt coil qua Modbus nếu cần (ví dụ khi cần gửi lệnh về PLC)
                            await writeCoil(modbusCoils[coilKey], false);
                            delete coilTimers[coilKey];
                            node.send({ payload: { [coilKey]: false, reason: "Exceeded max time" } });
                        }
                    }
                }
                else {
                    // Nếu coil đã tắt, xóa timer (nếu có)
                    if (coilTimers[coilKey]) {
                        delete coilTimers[coilKey];
                        node.log(`Timer for ${coilKey} cleared`);
                    }
                }
            }
            node.status({ fill: "green", shape: "dot", text: "Running" });
        }
        // Chạy kiểm tra định kỳ mỗi 1 giây
        const interval = setInterval(checkProtection, 1000);
        // Auto-detect config changes every 30 seconds
        const configCheckInterval = setInterval(async () => {
            try {
                const newConfig = readModbusConfig();
                // Check if mode has changed or if critical config has changed
                let hasChanged = false;
                let changeDescription = "";
                if (currentModbusConfig.mode !== newConfig.mode) {
                    hasChanged = true;
                    changeDescription = `mode changed from ${currentModbusConfig.mode} to ${newConfig.mode}`;
                }
                else if (newConfig.mode === 'single' && currentModbusConfig.mode === 'single') {
                    const oldCfg = currentModbusConfig.config;
                    const newCfg = newConfig.config;
                    hasChanged =
                        oldCfg.host !== newCfg.host ||
                            oldCfg.tcpPort !== newCfg.tcpPort ||
                            oldCfg.serialPort !== newCfg.serialPort ||
                            oldCfg.type !== newCfg.type;
                    if (hasChanged) {
                        changeDescription = `${newCfg.host}:${newCfg.tcpPort}`;
                    }
                }
                else if (newConfig.mode === 'multi' && currentModbusConfig.mode === 'multi') {
                    const oldBoards = JSON.stringify(currentModbusConfig.boards);
                    const newBoards = JSON.stringify(newConfig.boards);
                    hasChanged = oldBoards !== newBoards;
                    if (hasChanged) {
                        changeDescription = `board configuration updated`;
                    }
                }
                if (hasChanged) {
                    node.warn(`[HOT-RELOAD] Config change detected: ${changeDescription}`);
                    if (newConfig.mode === 'multi') {
                        const multiConfig = {
                            mode: 'multi',
                            defaultBoard: newConfig.defaultBoard,
                            boards: newConfig.boards
                        };
                        client_registry_1.default.initializeMultiBoardConfig(multiConfig, node);
                        const boardToUse = currentBoardId || newConfig.defaultBoard;
                        modbusClient = client_registry_1.default.getModbusClientV2(boardToUse, node);
                    }
                    else {
                        const reloaded = await client_registry_1.default.reloadModbusConfig(newConfig.config, node);
                        if (reloaded) {
                            modbusClient = client_registry_1.default.getModbusClientV2(newConfig.config, node);
                        }
                    }
                    currentModbusConfig = Object.assign({}, newConfig);
                    isMultiBoardMode = newConfig.mode === 'multi';
                    node.warn(`[HOT-RELOAD] Modbus reloaded: ${changeDescription}`);
                }
                // Update Modbus mappings
                modbusCoils = globalHelper.getJsonEnvVar("MODBUS_COILS", {});
                modbusHoldingRegisters = globalHelper.getJsonEnvVar("MODBUS_HOLDING_REGISTERS", {});
                modbusInputRegisters = globalHelper.getJsonEnvVar("MODBUS_INPUT_REGISTERS", {});
            }
            catch (error) {
                node.error(`[HOT-RELOAD] Config check error: ${error.message}`);
            }
        }, 30000); // Check every 30 seconds
        node.log("[HOT-RELOAD] Config monitoring enabled (30s interval)");
        // Cleanup khi node bị xóa hoặc đóng
        node.on("close", (done) => {
            clearInterval(interval);
            if (configCheckInterval) {
                clearInterval(configCheckInterval);
                node.log("[CLEANUP] Config check interval stopped");
            }
            // Release Modbus client (multi-board aware)
            if (isMultiBoardMode && currentBoardId) {
                client_registry_1.default.releaseClientV2("modbus-board", node, currentBoardId);
            }
            else {
                client_registry_1.default.releaseClientV2("modbus", node);
            }
            node.log("Protection node closed and Modbus client released");
            done();
        });
    }
    RED.nodes.registerType("viis-device-protection", ViisDeviceProtectionNode);
};
