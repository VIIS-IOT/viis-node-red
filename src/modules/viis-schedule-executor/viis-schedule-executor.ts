import { NodeAPI, Node } from "node-red";

import { ModbusClientCore } from "../../core/modbus-client";
import { MqttClientCore, MqttConfig } from "../../core/mqtt-client";
import { ScheduleService } from "./viis-schedule-executor-service";
import ClientRegistry, { MultiModbusConfig } from "../../core/client-registry";
import { TabiotSchedule } from "../../orm/entities/schedule/TabiotSchedule";
import moment from "moment";
import { ActiveModbusCommands, ManualModbusOverrides, RpcPayload, RpcControlResult, ScheduleExecutorNodeDef } from "./type";
import { GlobalContextHelper } from "../../ultils/global-context-helper";

module.exports = function (RED: NodeAPI) {
    function ScheduleExecutorNode(this: Node, config: ScheduleExecutorNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize global activeModbusCommands with type
        const globalContext = node.context().global;
        if (!globalContext.get("activeModbusCommands")) {
            globalContext.set("activeModbusCommands", {} as ActiveModbusCommands);
        }

        if (!globalContext.get("manualModbusOverrides")) {
            globalContext.set("manualModbusOverrides", {} as ManualModbusOverrides);
        }

        // Initialize last check timestamps to avoid frequent re-execution checks
        if (!globalContext.get("scheduleLastCheckTimestamps")) {
            globalContext.set("scheduleLastCheckTimestamps", {} as Record<string, number>);
        }

        // Initialize schedule status tracking to detect status changes
        if (!globalContext.get("scheduleStatusHistory")) {
            globalContext.set("scheduleStatusHistory", {} as Record<string, string>);
        }

        node.name = config.name;
        const scheduleInterval = config.scheduleInterval;
        const debugEnable = config.debugEnable; // Read debugEnable from config
        
        // Multi-board state variables
        let currentBoardId: string | undefined = config.boardId;
        let isMultiBoardMode: boolean = false;
        let currentModbusConfig: any = null;

        // Helper function for conditional logging
        const debugLog = (message: string) => {
            if (debugEnable) {
                node.warn(message);
            }
        };

        debugLog(`Schedule interval set to: ${scheduleInterval}`);

        // Initialize GlobalContextHelper
        const globalHelper = new GlobalContextHelper(node.context());

        // Helper function to check and track status changes
        const hasStatusChanged = (scheduleName: string, newStatus: string): boolean => {
            const statusHistory: Record<string, string> = (globalContext.get("scheduleStatusHistory") as Record<string, string>) || {};
            const previousStatus = statusHistory[scheduleName];
            const changed = previousStatus !== newStatus;

            if (changed && debugEnable) {
                debugLog(`Status changed for ${scheduleName}: ${previousStatus || 'undefined'} -> ${newStatus}`);
            }

            // Update status history
            statusHistory[scheduleName] = newStatus;
            globalContext.set("scheduleStatusHistory", statusHistory);

            return changed;
        };

        let scheduleService: ScheduleService;
        try {
            scheduleService = new ScheduleService(node);
            debugLog("ScheduleService initialized successfully");
        } catch (error) {
            node.error(`Failed to initialize ScheduleService: ${(error as Error).message}`);
            return;
        }

        // Helper function to read Modbus config
        const readModbusConfig = () => {
            const boardsConfig = globalHelper.getEnvVar('MODBUS_BOARDS', null);
            
            if (boardsConfig) {
                try {
                    let boards;
                    
                    // Handle both already-parsed array and JSON string
                    if (Array.isArray(boardsConfig)) {
                        boards = boardsConfig;
                    } else if (typeof boardsConfig === 'string') {
                        boards = JSON.parse(boardsConfig);
                    } else {
                        node.error(`Invalid MODBUS_BOARDS type: ${typeof boardsConfig}`);
                        boards = null;
                    }
                    
                    if (Array.isArray(boards) && boards.length > 0) {
                        return {
                            mode: 'multi',
                            boards: boards,
                            defaultBoard: globalHelper.getEnvVar('MODBUS_DEFAULT_BOARD', boards[0].id)
                        };
                    }
                } catch (e) {
                    node.error(`Failed to parse MODBUS_BOARDS: ${e}`);
                }
            }
            
            return {
                mode: 'single',
                config: {
                    type: (globalHelper.getEnvVar("MODBUS_TYPE", "TCP") as "TCP" | "RTU"),
                    host: globalHelper.getEnvVar("MODBUS_HOST", "localhost"),
                    tcpPort: globalHelper.getNumericEnvVar("MODBUS_TCP_PORT", 502),
                    serialPort: globalHelper.getEnvVar("MODBUS_SERIAL_PORT", "/dev/ttyUSB0"),
                    baudRate: globalHelper.getNumericEnvVar("MODBUS_BAUD_RATE", 9600),
                    parity: (globalHelper.getEnvVar("MODBUS_PARITY", "none") as "none" | "even" | "odd"),
                    unitId: globalHelper.getNumericEnvVar("MODBUS_UNIT_ID", 1),
                    timeout: globalHelper.getNumericEnvVar("MODBUS_TIMEOUT", 5000),
                    reconnectInterval: globalHelper.getNumericEnvVar("MODBUS_RECONNECT_INTERVAL", 5000),
                }
            };
        };
        
        // Initialize Modbus configuration
        const configData = readModbusConfig();
        currentModbusConfig = { ...configData };
        
        // Auto-detect mode
        if (configData.mode === 'multi') {
            isMultiBoardMode = true;
            debugLog(`Multi-board mode detected with ${configData.boards.length} boards`);
            
            const multiConfig: MultiModbusConfig = {
                mode: 'multi',
                defaultBoard: configData.defaultBoard,
                boards: configData.boards
            };
            ClientRegistry.initializeMultiBoardConfig(multiConfig, node);
        } else {
            isMultiBoardMode = false;
            debugLog(`Single-board mode: ${configData.config.type} ${configData.config.host}:${configData.config.tcpPort}`);
        }

        // ThingsBoard MQTT configuration
        const thingsboardConfig: MqttConfig = {
            broker: `mqtt://${globalHelper.getEnvVar("THINGSBOARD_HOST", "mqtt.viis.tech")}:${globalHelper.getEnvVar("THINGSBOARD_PORT", "1883")}`,
            clientId: `node-red-tb-${Math.random().toString(16).substring(2, 10)}`,
            username: globalHelper.getEnvVar("DEVICE_ACCESS_TOKEN", ""),
            password: globalHelper.getEnvVar("THINGSBOARD_PASSWORD", ""),
            qos: 1 as 0 | 1 | 2,
        };

        // EMQX (local) MQTT configuration
        const emqxConfig: MqttConfig = {
            broker: `mqtt://${globalHelper.getEnvVar("EMQX_HOST", "emqx")}:${globalHelper.getEnvVar("EMQX_PORT", "1883")}`,
            clientId: `node-red-emqx-${Math.random().toString(16).substring(2, 10)}`,
            username: globalHelper.getEnvVar("EMQX_USERNAME", ""),
            password: globalHelper.getEnvVar("EMQX_PASSWORD", ""),
            qos: 1 as 0 | 1 | 2,
        };

        // Get Modbus client
        let modbusClient: ModbusClientCore;
        let modbusUnitId: number;
        if (isMultiBoardMode) {
            const boardToUse = currentBoardId || configData.defaultBoard;
            debugLog(`Getting client for board: ${boardToUse}`);
            modbusClient = ClientRegistry.getModbusClientV2(boardToUse, node);
            // Get unitId from board config
            const boardConfig = configData.boards.find((b: any) => b.id === boardToUse);
            modbusUnitId = boardConfig?.unitId || 1;
        } else {
            modbusClient = ClientRegistry.getModbusClientV2(configData.config, node);
            modbusUnitId = configData.config.unitId;
        }

        node.on("input", async function (msg, send, done) {
            try {
                // Initialize MQTT clients
                const thingsboardClient: MqttClientCore = await ClientRegistry.getThingsboardMqttClient(thingsboardConfig, node);
                const emqxClient: MqttClientCore = await ClientRegistry.getLocalMqttClient(emqxConfig, node);
                debugLog(`MQTT TB connected: ${thingsboardClient.isConnected()}, EMQX connected: ${emqxClient.isConnected()}`);

                ClientRegistry.logConnectionCounts(node);

                // Check and clear overrides if no schedules are running
                const activeModbusCommands: ActiveModbusCommands = node.context().global.get("activeModbusCommands") as ActiveModbusCommands || {};
                if (Object.keys(activeModbusCommands).length === 0) {
                    node.context().global.set("manualModbusOverrides", {});
                    debugLog("No schedules running. Cleared manualModbusOverrides.");
                }

                // Handle RPC command
                if (msg.payload && typeof msg.payload === 'object' && 'method' in msg.payload && (msg.payload as RpcPayload).method === "schedule-disable-by-backend") {
                    const payload = msg.payload as RpcPayload;
                    const params = payload.params || {};
                    const scheduleId = params.scheduleId;

                    if (!scheduleId) {
                        node.error("Missing scheduleId in schedule-disable-by-backend RPC command");
                        node.status({ fill: "red", shape: "ring", text: "Missing scheduleId" });
                        done(new Error("Missing scheduleId"));
                        return;
                    }

                    const schedules: TabiotSchedule[] = await scheduleService.getDueSchedules();
                    const schedule = schedules.find(s => s.name === scheduleId);

                    if (!schedule) {
                        debugLog(`Schedule with id ${scheduleId} not found`);
                        node.status({ fill: "yellow", shape: "ring", text: "Schedule not found" });
                        send(msg);
                        done();
                        return;
                    }

                    if (schedule.status === "running") {
                        const statusChanged = hasStatusChanged(schedule.name, "finished");

                        schedule.status = "finished";
                        schedule.enable = 0;
                        await scheduleService.updateScheduleStatus(schedule, "finished");

                        // Clear timestamp when schedule is disabled via RPC
                        const lastCheckTimestamps: Record<string, number> = (globalContext.get("scheduleLastCheckTimestamps") as Record<string, number>) || {};
                        delete lastCheckTimestamps[schedule.name];
                        globalContext.set("scheduleLastCheckTimestamps", lastCheckTimestamps);
                        const { holdingCommands, coilCommands, configParameters } = scheduleService.mapScheduleToModbus(schedule);
                        const activeCommands = scheduleService.getActiveCommands(schedule.name);

                        // Publish configuration parameters if any
                        if (configParameters && configParameters.length > 0) {
                            for (const configParam of configParameters) {
                                try {
                                    await scheduleService.publishConfigUpdate(thingsboardClient, emqxClient, configParam);
                                    debugLog(`Published config parameter: ${configParam.key}=${configParam.value} for schedule ${schedule.name}`);
                                } catch (error) {
                                    node.error(`Failed to publish config parameter ${configParam.key}: ${(error as Error).message}`);
                                }
                            }
                        }

                        // Reset time_valve_ and set_flow keys
                        const holdingRegisters: Record<string, number> = globalHelper.getJsonEnvVar("MODBUS_HOLDING_REGISTERS", {});
                        debugLog(`debug holdingRegisters: ${JSON.stringify(holdingRegisters)}`);
                        const extraResetKeys = Object.entries(holdingRegisters)
                            .filter(([key, _]) => key.startsWith('time_valve_') || key.startsWith('set_flow'))
                            .map(([key, address]) => ({
                                key,
                                value: 0,
                                fc: 6,
                                unitid: modbusUnitId,
                                address: Number(address),
                                quantity: 1
                            }));
                        const activeCmdKey = (cmd: any) => `${cmd.fc}_${cmd.address}`;
                        const activeCmdSet = new Set([...activeCommands, ...holdingCommands, ...coilCommands].map(activeCmdKey));
                        const extraResetCommands = extraResetKeys.filter(cmd => !activeCmdSet.has(activeCmdKey(cmd)));
                        const allResetCommands = [...activeCommands, ...holdingCommands, ...coilCommands, ...extraResetCommands];
                        if (allResetCommands.length > 0) {
                            await scheduleService.resetModbusCommands(modbusClient, allResetCommands);
                            scheduleService.clearActiveCommands(schedule.name);
                            debugLog(`Cleared active commands for schedule ${schedule.name} via RPC`);
                        }

                        if (statusChanged) {
                            // Send HTTP notification directly to backend when schedule disabled via RPC
                            await scheduleService.sendNotificationToBackend(schedule, 'end', true);
                            await scheduleService.syncScheduleLog(schedule, true);
                        }
                    } else {
                        debugLog(`Schedule id: ${schedule.name}, label: ${schedule.label} is not running, only disabling`);
                        schedule.enable = 0;
                        await scheduleService.updateScheduleStatus(schedule, schedule.status as "running" | "finished");
                    }

                    node.status({ fill: "green", shape: "dot", text: "RPC processed" });
                    send(msg);
                    done();
                    return;
                } else if (msg.payload && typeof msg.payload === 'object' && 'method' in msg.payload) {
                    const payload = msg.payload as RpcPayload;

                    if (payload.method === "control" && payload.params) {
                        const results: any[] = [];

                        for (const [key, value] of Object.entries(payload.params)) {
                            if (key === 'scheduleId') continue;

                            const result = scheduleService.processRpcControlCommand(key, value);
                            results.push({ key, ...result });

                            if (result.success && result.action === 'config') {
                                debugLog(`RPC control: ${key}=${value} stored in configKeyValues`);
                            } else if (result.success && result.action === 'modbus') {
                                debugLog(`RPC control: ${key}=${value} should be handled by modbus (address: ${result.result?.address})`);
                            } else {
                                node.error(`RPC control failed for ${key}=${value}`);
                            }
                        }

                        const responseMsg = {
                            ...msg,
                            payload: {
                                method: payload.method,
                                results: results,
                                timestamp: Date.now()
                            }
                        };

                        node.status({ fill: "green", shape: "dot", text: "RPC control processed" });
                        send(responseMsg);
                        done();
                        return;
                    }

                    debugLog(`Unknown RPC method: ${payload.method}`);
                    return null;
                }

                const schedules: TabiotSchedule[] = await scheduleService.getDueSchedules();
                debugLog(`Found ${schedules.length} schedule(s).`);

                for (const schedule of schedules) {
                    const isDue = scheduleService.isScheduleDue(schedule);
                    const now = moment().utc().add(7, 'hours');
                    const today = now.clone().startOf('day');
                    const startTime = moment(schedule.start_time, "HH:mm:ss");
                    const endTime = moment(schedule.end_time, "HH:mm:ss");

                    let startDateTime = today.clone().set({
                        hour: startTime.hour(),
                        minute: startTime.minute(),
                        second: startTime.second()
                    });
                    let endDateTime = today.clone().set({
                        hour: endTime.hour(),
                        minute: endTime.minute(),
                        second: endTime.second()
                    });

                    if (startDateTime.isAfter(endDateTime)) {
                        if (now.isBefore(endDateTime)) {
                            startDateTime.subtract(1, 'day');
                        } else {
                            endDateTime.add(1, 'day');
                        }
                    }

                    if (isDue && schedule.status !== "running") {
                        debugLog("start running schedule");

                        const statusChanged = hasStatusChanged(schedule.name, "running");

                        const holdingRegisters: Record<string, number> = globalHelper.getJsonEnvVar("MODBUS_HOLDING_REGISTERS", {});
                        debugLog(`debug holdingRegisters: ${JSON.stringify(holdingRegisters)}`);
                        let actionObj: Record<string, any> = {};
                        if (typeof schedule.action === 'string' && schedule.action.trim() !== '') {
                            try {
                                actionObj = JSON.parse(schedule.action);
                            } catch (err) {
                                debugLog('Cannot parse schedule.action, treat as empty object');
                            }
                        } else if (typeof schedule.action === 'object' && schedule.action !== null) {
                            actionObj = schedule.action;
                        }
                        const resetKeys = Object.entries(holdingRegisters)
                            .filter(([key, _]) => (key.startsWith('time_valve_') || key.startsWith('set_flow')) && (!actionObj[key] || actionObj[key] === 0))
                            .map(([key, address]) => ({
                                key,
                                value: 0,
                                fc: 6,
                                unitid: modbusUnitId,
                                address: Number(address),
                                quantity: 1
                            }));
                        if (resetKeys.length > 0) {
                            debugLog(`Resetting keys at schedule start: ${resetKeys.map(k => k.key).join(', ')}`);
                            await scheduleService.resetModbusCommands(modbusClient, resetKeys);
                        }
                        const { holdingCommands, coilCommands, configParameters } = scheduleService.mapScheduleToModbus(schedule);

                        if (configParameters && configParameters.length > 0) {
                            for (const configParam of configParameters) {
                                try {
                                    await scheduleService.publishConfigUpdate(thingsboardClient, emqxClient, configParam);
                                    debugLog(`Published config parameter: ${configParam.key}=${configParam.value} for schedule ${schedule.name}`);
                                } catch (error) {
                                    node.error(`Failed to publish config parameter ${configParam.key}: ${(error as Error).message}`);
                                }
                            }
                        }

                        if (await scheduleService.canExecuteCommands(schedule.name, holdingCommands, coilCommands)) {
                            await scheduleService.updateScheduleStatus(schedule, "running");
                            let writeSuccess = false;
                            let attempt = 0;
                            while (!writeSuccess && attempt < 3) {
                                attempt++;
                                try {
                                    await scheduleService.executeModbusCommands(modbusClient, { holdingCommands, coilCommands }, schedule);
                                    writeSuccess = await scheduleService.verifyModbusWrite(modbusClient, [...holdingCommands, ...coilCommands]);
                                    if (writeSuccess) {
                                        scheduleService.storeActiveCommands(schedule.name, [...holdingCommands, ...coilCommands]);
                                    }
                                } catch (error) {
                                    node.error(`Error writing modbus: ${(error as Error).message}`);
                                }
                            }

                            if (statusChanged) {
                                // Send HTTP notification directly to backend when schedule starts
                                await scheduleService.sendNotificationToBackend(schedule, 'start', writeSuccess);
                                await scheduleService.syncScheduleLog(schedule, writeSuccess);
                            }
                        }
                    } else if (schedule.status === "running" && isDue) {
                        const lastCheckTimestamps: Record<string, number> = (globalContext.get("scheduleLastCheckTimestamps") as Record<string, number>) || {};
                        const now = Date.now();
                        const lastCheck = lastCheckTimestamps[schedule.name] || 0;
                        const checkInterval = 60000;

                        if (now - lastCheck >= checkInterval) {
                            debugLog(`Schedule ${schedule.name} is running - automatic coil recovery is DISABLED`);
                            lastCheckTimestamps[schedule.name] = now;
                            globalContext.set("scheduleLastCheckTimestamps", lastCheckTimestamps);
                        }
                    } else if (schedule.status === "running" && now.isAfter(endDateTime)) {
                        debugLog("start finishing schedule");

                        const statusChanged = hasStatusChanged(schedule.name, "finished");

                        await scheduleService.updateScheduleStatus(schedule, "finished");

                        const lastCheckTimestamps: Record<string, number> = (globalContext.get("scheduleLastCheckTimestamps") as Record<string, number>) || {};
                        delete lastCheckTimestamps[schedule.name];
                        globalContext.set("scheduleLastCheckTimestamps", lastCheckTimestamps);

                        const activeCommands = scheduleService.getActiveCommands(schedule.name);
                        const holdingRegisters: Record<string, number> = globalHelper.getJsonEnvVar("MODBUS_HOLDING_REGISTERS", {});
                        debugLog(`debug holdingRegisters: ${JSON.stringify(holdingRegisters)}`);
                        const extraResetKeys = Object.entries(holdingRegisters)
                            .filter(([key, _]) => key.startsWith('time_valve_') || key.startsWith('set_flow'))
                            .map(([key, address]) => ({
                                key,
                                value: 0,
                                fc: 6,
                                unitid: modbusUnitId,
                                address: Number(address),
                                quantity: 1
                            }));
                        const activeCmdKey = (cmd: any) => `${cmd.fc}_${cmd.address}`;
                        const activeCmdSet = new Set(activeCommands.map(activeCmdKey));
                        const extraResetCommands = extraResetKeys.filter(cmd => !activeCmdSet.has(activeCmdKey(cmd)));
                        const allResetCommands = [...activeCommands, ...extraResetCommands];
                        if (allResetCommands.length > 0) {
                            await scheduleService.resetModbusCommands(modbusClient, allResetCommands, schedule);
                            scheduleService.clearActiveCommands(schedule.name);
                        }

                        if (statusChanged) {
                            // Send HTTP notification directly to backend when schedule finishes
                            await scheduleService.sendNotificationToBackend(schedule, 'end', true);
                            await scheduleService.syncScheduleLog(schedule, true);
                        }
                    } else {
                        debugLog(`Schedule ${schedule.name} skipped (status: ${schedule.status}, due: ${isDue})`);
                    }
                }

                const enabledScheduleIds = schedules.map(s => s.name);

                for (const scheduleId in activeModbusCommands) {
                    if (!enabledScheduleIds.includes(scheduleId)) {
                        const commands = activeModbusCommands[scheduleId];
                        const resetSuccess = await scheduleService.resetModbusCommands(modbusClient, commands);
                        if (resetSuccess) {
                            scheduleService.clearActiveCommands(scheduleId);
                            debugLog(`Cleaned up stale commands for schedule ${scheduleId} (not in enabled schedules)`);
                        } else {
                            debugLog(`Failed to reset commands for ${scheduleId}, retaining in activeModbusCommands`);
                        }
                    }
                }

                const statusHistory: Record<string, string> = (globalContext.get("scheduleStatusHistory") as Record<string, string>) || {};
                for (const scheduleId in statusHistory) {
                    if (!enabledScheduleIds.includes(scheduleId)) {
                        delete statusHistory[scheduleId];
                        debugLog(`Cleaned up status history for disabled schedule ${scheduleId}`);
                    }
                }
                globalContext.set("scheduleStatusHistory", statusHistory);
                node.status({ fill: "green", shape: "dot", text: "Schedules processed" });
                send(msg);
                done();
            } catch (err) {
                node.error("Error processing schedules: " + (err as Error).message);
                node.status({ fill: "red", shape: "ring", text: "Processing error" });
                done(err);
            }
        });

        node.on("close", function (done: () => void) {
            // Release Modbus client (multi-board aware)
            if (isMultiBoardMode && currentBoardId) {
                ClientRegistry.releaseClientV2("modbus-board", node, currentBoardId);
            } else {
                ClientRegistry.releaseClientV2("modbus", node);
            }
            
            ClientRegistry.releaseClient("thingsboard", node);
            ClientRegistry.releaseClient("local", node);
            done();
        });
    }

    RED.nodes.registerType("viis-schedule-executor", ScheduleExecutorNode);
};