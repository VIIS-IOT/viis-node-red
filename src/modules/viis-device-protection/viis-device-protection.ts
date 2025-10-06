import { NodeAPI, NodeDef, Node } from "node-red";
import ClientRegistry from "../../core/client-registry";
import { GlobalContextHelper } from "../../ultils/global-context-helper";

interface ViisDeviceProtectionNodeDef extends NodeDef { }

module.exports = function (RED: NodeAPI) {
    function ViisDeviceProtectionNode(this: Node, config: ViisDeviceProtectionNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize GlobalContextHelper
        const globalHelper = new GlobalContextHelper(node.context());

        // Helper function to read fresh config from global context
        const readModbusConfig = () => {
            return {
                type: (globalHelper.getEnvVar("MODBUS_TYPE", "TCP") as "TCP" | "RTU"),
                host: globalHelper.getEnvVar("MODBUS_HOST", "localhost"),
                tcpPort: globalHelper.getNumericEnvVar("MODBUS_TCP_PORT", 502),
                serialPort: globalHelper.getEnvVar("MODBUS_SERIAL_PORT", "/dev/ttyUSB0"),
                baudRate: globalHelper.getNumericEnvVar("MODBUS_BAUD_RATE", 9600),
                parity: (globalHelper.getEnvVar("MODBUS_PARITY", "none") as "none" | "even" | "odd"),
                unitId: globalHelper.getNumericEnvVar("MODBUS_UNIT_ID", 1),
                timeout: globalHelper.getNumericEnvVar("MODBUS_TIMEOUT", 5000),
                reconnectInterval: globalHelper.getNumericEnvVar("MODBUS_RECONNECT_INTERVAL", 5000),
            };
        };

        // Environment variables for Modbus mappings
        let modbusCoils = globalHelper.getJsonEnvVar("MODBUS_COILS", {});
        let modbusHoldingRegisters = globalHelper.getJsonEnvVar("MODBUS_HOLDING_REGISTERS", {});
        let modbusInputRegisters = globalHelper.getJsonEnvVar("MODBUS_INPUT_REGISTERS", {});

        // Modbus client configuration
        const modbusConfig = readModbusConfig();
        let currentModbusConfig = { ...modbusConfig };

        let modbusClient = ClientRegistry.getModbusClient(modbusConfig, node);
        if (!modbusClient) {
            node.error("Failed to initialize Modbus client");
            node.status({ fill: "red", shape: "ring", text: "Modbus client failed" });
            return;
        }

        // Trạng thái theo dõi thời gian bật của các coil
        const coilTimers: { [key: string]: { startTime: number; maxTime: number } } = {};

        // Hàm đọc trạng thái coil từ Modbus
        async function readCoil(address: number): Promise<boolean> {
            try {
                const result = await modbusClient.readCoils(address, 1);
                return Boolean(result.data[0]);
            } catch (error) {
                const err = error as Error;
                node.error(`Modbus read coil error at address ${address}: ${err.message}`);
                return false;
            }
        }

        // Hàm ghi trạng thái coil vào Modbus
        async function writeCoil(address: number, value: boolean): Promise<void> {
            try {
                await modbusClient.writeCoil(address, value);
                node.log(`Wrote to coil at address ${address}: ${value}`);
            } catch (error) {
                const err = error as Error;
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
                if (!key.endsWith("_MAX_TIME")) continue;

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
                    } else {
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
                } else {
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
                
                // Check if critical Modbus config has changed
                const hasChanged = 
                    currentModbusConfig.host !== newConfig.host ||
                    currentModbusConfig.tcpPort !== newConfig.tcpPort ||
                    currentModbusConfig.serialPort !== newConfig.serialPort ||
                    currentModbusConfig.type !== newConfig.type;

                if (hasChanged) {
                    node.warn("[HOT-RELOAD] Config change detected, triggering Modbus reconnection...");
                    
                    const reloaded = await ClientRegistry.reloadModbusConfig(newConfig, node);
                    
                    if (reloaded) {
                        // Get updated client
                        modbusClient = ClientRegistry.getModbusClient(newConfig, node);
                        currentModbusConfig = { ...newConfig };
                        node.warn(`[HOT-RELOAD] Modbus reloaded: ${newConfig.host}:${newConfig.tcpPort}`);
                    }
                }

                // Update Modbus mappings
                modbusCoils = globalHelper.getJsonEnvVar("MODBUS_COILS", {});
                modbusHoldingRegisters = globalHelper.getJsonEnvVar("MODBUS_HOLDING_REGISTERS", {});
                modbusInputRegisters = globalHelper.getJsonEnvVar("MODBUS_INPUT_REGISTERS", {});
            } catch (error) {
                node.error(`[HOT-RELOAD] Config check error: ${(error as Error).message}`);
            }
        }, 30000); // Check every 30 seconds

        node.log("[HOT-RELOAD] Config monitoring enabled (30s interval)");

        // Cleanup khi node bị xóa hoặc đóng
        node.on("close", (done: any) => {
            clearInterval(interval);
            if (configCheckInterval) {
                clearInterval(configCheckInterval);
                node.log("[CLEANUP] Config check interval stopped");
            }
            ClientRegistry.releaseClient("modbus", node);
            node.log("Protection node closed and Modbus client released");
            done();
        });
    }

    RED.nodes.registerType("viis-device-protection", ViisDeviceProtectionNode);
};