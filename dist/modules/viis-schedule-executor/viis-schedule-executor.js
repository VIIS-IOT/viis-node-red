"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const viis_schedule_executor_service_1 = require("./viis-schedule-executor-service");
const client_registry_1 = __importDefault(require("../../core/client-registry"));
const moment_1 = __importDefault(require("moment"));
const global_context_helper_1 = require("../../ultils/global-context-helper");
module.exports = function (RED) {
    function ScheduleExecutorNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        // Initialize global activeModbusCommands with type
        const globalContext = node.context().global;
        if (!globalContext.get("activeModbusCommands")) {
            globalContext.set("activeModbusCommands", {});
        }
        if (!globalContext.get("manualModbusOverrides")) {
            globalContext.set("manualModbusOverrides", {});
        }
        // Initialize last check timestamps to avoid frequent re-execution checks
        if (!globalContext.get("scheduleLastCheckTimestamps")) {
            globalContext.set("scheduleLastCheckTimestamps", {});
        }
        // Initialize schedule status tracking to detect status changes
        if (!globalContext.get("scheduleStatusHistory")) {
            globalContext.set("scheduleStatusHistory", {});
        }
        node.name = config.name;
        const scheduleInterval = config.scheduleInterval;
        node.warn(`Schedule interval set to: ${scheduleInterval}`);
        // Initialize GlobalContextHelper
        const globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
        // Helper function to check and track status changes
        const hasStatusChanged = (scheduleName, newStatus) => {
            const statusHistory = globalContext.get("scheduleStatusHistory") || {};
            const previousStatus = statusHistory[scheduleName];
            const changed = previousStatus !== newStatus;
            // Update status history
            statusHistory[scheduleName] = newStatus;
            globalContext.set("scheduleStatusHistory", statusHistory);
            if (changed) {
                node.warn(`Status changed for ${scheduleName}: ${previousStatus || 'undefined'} -> ${newStatus}`);
            }
            return changed;
        };
        let scheduleService;
        try {
            scheduleService = new viis_schedule_executor_service_1.ScheduleService(node);
            node.warn("ScheduleService initialized successfully");
        }
        catch (error) {
            node.error(`Failed to initialize ScheduleService: ${error.message}`);
            return;
        }
        // Modbus configuration
        const modbusConfig = {
            type: globalHelper.getEnvVar("MODBUS_TYPE", "TCP"),
            host: globalHelper.getEnvVar("MODBUS_HOST", "localhost"),
            tcpPort: globalHelper.getNumericEnvVar("MODBUS_TCP_PORT", 502),
            serialPort: globalHelper.getEnvVar("MODBUS_SERIAL_PORT", "/dev/ttyUSB0"),
            baudRate: globalHelper.getNumericEnvVar("MODBUS_BAUD_RATE", 9600),
            parity: globalHelper.getEnvVar("MODBUS_PARITY", "none"),
            unitId: globalHelper.getNumericEnvVar("MODBUS_UNIT_ID", 1),
            timeout: globalHelper.getNumericEnvVar("MODBUS_TIMEOUT", 5000),
            reconnectInterval: globalHelper.getNumericEnvVar("MODBUS_RECONNECT_INTERVAL", 5000),
        };
        // ThingsBoard MQTT configuration
        const thingsboardConfig = {
            broker: `mqtt://${globalHelper.getEnvVar("THINGSBOARD_HOST", "mqtt.viis.tech")}:${globalHelper.getEnvVar("THINGSBOARD_PORT", "1883")}`,
            clientId: `node-red-tb-${Math.random().toString(16).substring(2, 10)}`,
            username: globalHelper.getEnvVar("DEVICE_ACCESS_TOKEN", ""),
            password: globalHelper.getEnvVar("THINGSBOARD_PASSWORD", ""),
            qos: 1,
        };
        // EMQX (local) MQTT configuration
        const emqxConfig = {
            broker: `mqtt://${globalHelper.getEnvVar("EMQX_HOST", "emqx")}:${globalHelper.getEnvVar("EMQX_PORT", "1883")}`,
            clientId: `node-red-emqx-${Math.random().toString(16).substring(2, 10)}`,
            username: globalHelper.getEnvVar("EMQX_USERNAME", ""),
            password: globalHelper.getEnvVar("EMQX_PASSWORD", ""),
            qos: 1,
        };
        const modbusClient = client_registry_1.default.getModbusClient(modbusConfig, node);
        node.on("input", async function (msg, send, done) {
            var _a;
            try {
                // Initialize MQTT clients
                const thingsboardClient = await client_registry_1.default.getThingsboardMqttClient(thingsboardConfig, node);
                const emqxClient = await client_registry_1.default.getLocalMqttClient(emqxConfig, node);
                node.warn(`MQTT TB connected: ${thingsboardClient.isConnected()}, EMQX connected: ${emqxClient.isConnected()}`);
                client_registry_1.default.logConnectionCounts(node);
                // Kiểm tra và xoá overrides nếu không có hẹn giờ nào đang chạy
                const activeModbusCommands = node.context().global.get("activeModbusCommands") || {};
                if (Object.keys(activeModbusCommands).length === 0) {
                    node.context().global.set("manualModbusOverrides", {});
                    node.warn("Không có hẹn giờ đang chạy. Đã xoá manualModbusOverrides.");
                }
                // Xử lý RPC command
                if (msg.payload && typeof msg.payload === 'object' && 'method' in msg.payload && msg.payload.method === "schedule-disable-by-backend") {
                    const payload = msg.payload;
                    const params = payload.params || {};
                    const scheduleId = params.scheduleId;
                    if (!scheduleId) {
                        node.error("Missing scheduleId in schedule-disable-by-backend RPC command");
                        node.status({ fill: "red", shape: "ring", text: "Missing scheduleId" });
                        done(new Error("Missing scheduleId"));
                        return;
                    }
                    const schedules = await scheduleService.getDueSchedules();
                    const schedule = schedules.find(s => s.name === scheduleId);
                    if (!schedule) {
                        node.warn(`Schedule with id ${scheduleId} not found`);
                        node.status({ fill: "yellow", shape: "ring", text: "Schedule not found" });
                        send(msg);
                        done();
                        return;
                    }
                    if (schedule.status === "running") {
                        // Check if status will actually change
                        const statusChanged = hasStatusChanged(schedule.name, "finished");
                        schedule.status = "finished";
                        schedule.enable = 0;
                        await scheduleService.updateScheduleStatus(schedule, "finished");
                        // Xóa timestamp khi schedule bị disable qua RPC
                        const lastCheckTimestamps = globalContext.get("scheduleLastCheckTimestamps") || {};
                        delete lastCheckTimestamps[schedule.name];
                        globalContext.set("scheduleLastCheckTimestamps", lastCheckTimestamps);
                        const { holdingCommands, coilCommands, configParameters } = scheduleService.mapScheduleToModbus(schedule);
                        const activeCommands = scheduleService.getActiveCommands(schedule.name);
                        // Publish configuration parameters if any
                        if (configParameters && configParameters.length > 0) {
                            for (const configParam of configParameters) {
                                try {
                                    await scheduleService.publishConfigUpdate(thingsboardClient, emqxClient, configParam);
                                    node.warn(`Published config parameter: ${configParam.key}=${configParam.value} for schedule ${schedule.name}`);
                                }
                                catch (error) {
                                    node.error(`Failed to publish config parameter ${configParam.key}: ${error.message}`);
                                }
                            }
                        }
                        // --- Bổ sung reset các key time_valve_ và set_flow ---
                        const holdingRegisters = globalHelper.getJsonEnvVar("MODBUS_HOLDING_REGISTERS", {});
                        node.warn(`debug holdingRegisters: ${JSON.stringify(holdingRegisters)}`);
                        const extraResetKeys = Object.entries(holdingRegisters)
                            .filter(([key, _]) => key.startsWith('time_valve_') || key.startsWith('set_flow'))
                            .map(([key, address]) => ({
                            key,
                            value: 0,
                            fc: 6, // holding register
                            unitid: modbusConfig.unitId,
                            address: Number(address),
                            quantity: 1
                        }));
                        // Loại bỏ các lệnh đã có trong activeCommands (theo address và fc)
                        const activeCmdKey = (cmd) => `${cmd.fc}_${cmd.address}`;
                        const activeCmdSet = new Set([...activeCommands, ...holdingCommands, ...coilCommands].map(activeCmdKey));
                        const extraResetCommands = extraResetKeys.filter(cmd => !activeCmdSet.has(activeCmdKey(cmd)));
                        const allResetCommands = [...activeCommands, ...holdingCommands, ...coilCommands, ...extraResetCommands];
                        if (allResetCommands.length > 0) {
                            await scheduleService.resetModbusCommands(modbusClient, allResetCommands);
                            scheduleService.clearActiveCommands(schedule.name); // Xóa lệnh đã lưu
                            node.warn(`Cleared active commands for schedule ${schedule.name} via RPC`);
                        }
                        // Only publish MQTT and sync log if status actually changed
                        if (statusChanged) {
                            await scheduleService.publishMqttNotification(thingsboardClient, emqxClient, schedule, true);
                            await scheduleService.syncScheduleLog(schedule, true);
                        }
                    }
                    else {
                        node.warn(`Schedule id: ${schedule.name}, label: ${schedule.label} is not running, only disabling`);
                        schedule.enable = 0;
                        await scheduleService.updateScheduleStatus(schedule, schedule.status);
                        // No MQTT/log needed since status didn't change, just disabled
                    }
                    node.status({ fill: "green", shape: "dot", text: "RPC processed" });
                    send(msg);
                    done();
                    return;
                }
                else if (msg.payload && typeof msg.payload === 'object' && 'method' in msg.payload) {
                    // Handle other RPC methods (e.g., control commands)
                    const payload = msg.payload;
                    if (payload.method === "control" && payload.params) {
                        // Process RPC control commands
                        const results = [];
                        for (const [key, value] of Object.entries(payload.params)) {
                            if (key === 'scheduleId')
                                continue; // Skip scheduleId parameter
                            const result = scheduleService.processRpcControlCommand(key, value);
                            results.push(Object.assign({ key }, result));
                            if (result.success && result.action === 'config') {
                                node.warn(`RPC control: ${key}=${value} stored in configKeyValues`);
                            }
                            else if (result.success && result.action === 'modbus') {
                                node.warn(`RPC control: ${key}=${value} should be handled by modbus (address: ${(_a = result.result) === null || _a === void 0 ? void 0 : _a.address})`);
                            }
                            else {
                                node.error(`RPC control failed for ${key}=${value}`);
                            }
                        }
                        // Send response with results
                        const responseMsg = Object.assign(Object.assign({}, msg), { payload: {
                                method: payload.method,
                                results: results,
                                timestamp: Date.now()
                            } });
                        node.status({ fill: "green", shape: "dot", text: "RPC control processed" });
                        send(responseMsg);
                        done();
                        return;
                    }
                    // Unknown RPC method
                    node.warn(`Unknown RPC method: ${payload.method}`);
                    return null;
                }
                const schedules = await scheduleService.getDueSchedules();
                node.warn(`Found ${schedules.length} schedule(s).`);
                for (const schedule of schedules) {
                    const isDue = scheduleService.isScheduleDue(schedule);
                    const now = (0, moment_1.default)().utc().add(7, 'hours');
                    // const now = moment('2025-04-03T00:10:00Z').utc();
                    const today = now.clone().startOf('day');
                    const startTime = (0, moment_1.default)(schedule.start_time, "HH:mm:ss");
                    const endTime = (0, moment_1.default)(schedule.end_time, "HH:mm:ss");
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
                    // Xử lý trường hợp qua ngày (cross-midnight)
                    if (startDateTime.isAfter(endDateTime)) {
                        if (now.isBefore(endDateTime)) {
                            // Nếu giờ hiện tại nằm sau nửa đêm (ví dụ: 00:10) và trước endTime,
                            // schedule đã bắt đầu từ ngày hôm trước.
                            startDateTime.subtract(1, 'day');
                        }
                        else {
                            // Nếu giờ hiện tại nằm sau startTime,
                            // thì endTime nằm vào ngày hôm sau.
                            endDateTime.add(1, 'day');
                        }
                    }
                    if (isDue && schedule.status !== "running") {
                        node.warn("start running schedule");
                        // Check if status will actually change
                        const statusChanged = hasStatusChanged(schedule.name, "running");
                        // --- Reset time_valve_ and set_flow keys except those present in action ---
                        const holdingRegisters = globalHelper.getJsonEnvVar("MODBUS_HOLDING_REGISTERS", {});
                        node.warn(`debug holdingRegisters: ${JSON.stringify(holdingRegisters)}`);
                        // Parse action (may be string or object)
                        let actionObj = {};
                        if (typeof schedule.action === 'string' && schedule.action.trim() !== '') {
                            try {
                                actionObj = JSON.parse(schedule.action);
                            }
                            catch (err) {
                                node.warn('Cannot parse schedule.action, treat as empty object');
                            }
                        }
                        else if (typeof schedule.action === 'object' && schedule.action !== null) {
                            actionObj = schedule.action;
                        }
                        // Compose reset commands for all time_valve_ and set_flow keys not in actionObj or with falsy value
                        const resetKeys = Object.entries(holdingRegisters)
                            .filter(([key, _]) => (key.startsWith('time_valve_') || key.startsWith('set_flow')) && (!actionObj[key] || actionObj[key] === 0))
                            .map(([key, address]) => ({
                            key,
                            value: 0,
                            fc: 6, // holding register
                            unitid: modbusConfig.unitId,
                            address: Number(address),
                            quantity: 1
                        }));
                        if (resetKeys.length > 0) {
                            node.warn(`Resetting keys at schedule start: ${resetKeys.map(k => k.key).join(', ')}`);
                            await scheduleService.resetModbusCommands(modbusClient, resetKeys);
                        }
                        // --- End reset logic ---
                        const { holdingCommands, coilCommands, configParameters } = scheduleService.mapScheduleToModbus(schedule);
                        // Publish configuration parameters if any
                        if (configParameters && configParameters.length > 0) {
                            for (const configParam of configParameters) {
                                try {
                                    await scheduleService.publishConfigUpdate(thingsboardClient, emqxClient, configParam);
                                    node.warn(`Published config parameter: ${configParam.key}=${configParam.value} for schedule ${schedule.name}`);
                                }
                                catch (error) {
                                    node.error(`Failed to publish config parameter ${configParam.key}: ${error.message}`);
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
                                }
                                catch (error) {
                                    node.error(`Error writing modbus: ${error.message}`);
                                }
                            }
                            // Only publish MQTT and sync log if status actually changed
                            if (statusChanged) {
                                await scheduleService.publishMqttNotification(thingsboardClient, emqxClient, schedule, writeSuccess);
                                await scheduleService.syncScheduleLog(schedule, writeSuccess);
                            }
                        }
                    }
                    else if (schedule.status === "running" && isDue) {
                        // Trường hợp đang running - DISABLED automatic coil recovery
                        // Previously: System would check every 60 seconds and re-execute commands if coil states changed
                        // Now: If external source turns off coils, they will remain off (no automatic recovery)
                        // Keep the timestamp tracking for potential future use, but don't perform recovery
                        const lastCheckTimestamps = globalContext.get("scheduleLastCheckTimestamps") || {};
                        const now = Date.now();
                        const lastCheck = lastCheckTimestamps[schedule.name] || 0;
                        const checkInterval = 60000; // Chỉ kiểm tra mỗi 60 giây
                        if (now - lastCheck >= checkInterval) {
                            // DISABLED: Automatic coil recovery logic
                            // const writeSuccess = await scheduleService.reExecuteAfterPowerLoss(modbusClient, schedule);
                            // if (writeSuccess) {
                            //     node.warn(`Re-executed commands for schedule ${schedule.name} after detecting changes`);
                            // }
                            node.warn(`Schedule ${schedule.name} is running - automatic coil recovery is DISABLED`);
                            // Cập nhật timestamp
                            lastCheckTimestamps[schedule.name] = now;
                            globalContext.set("scheduleLastCheckTimestamps", lastCheckTimestamps);
                        }
                        // Không sync log liên tục khi đang running
                    }
                    else if (schedule.status === "running" && now.isAfter(endDateTime)) {
                        node.warn("strart finishing schedule");
                        // Check if status will actually change
                        const statusChanged = hasStatusChanged(schedule.name, "finished");
                        await scheduleService.updateScheduleStatus(schedule, "finished");
                        // Xóa timestamp khi schedule kết thúc
                        const lastCheckTimestamps = globalContext.get("scheduleLastCheckTimestamps") || {};
                        delete lastCheckTimestamps[schedule.name];
                        globalContext.set("scheduleLastCheckTimestamps", lastCheckTimestamps);
                        const activeCommands = scheduleService.getActiveCommands(schedule.name);
                        // --- Bổ sung reset các key time_valve_ và set_flow ---
                        const holdingRegisters = globalHelper.getJsonEnvVar("MODBUS_HOLDING_REGISTERS", {});
                        node.warn(`debug holdingRegisters: ${JSON.stringify(holdingRegisters)}`);
                        const extraResetKeys = Object.entries(holdingRegisters)
                            .filter(([key, _]) => key.startsWith('time_valve_') || key.startsWith('set_flow'))
                            .map(([key, address]) => ({
                            key,
                            value: 0,
                            fc: 6, // holding register
                            unitid: modbusConfig.unitId,
                            address: Number(address),
                            quantity: 1
                        }));
                        // Loại bỏ các lệnh đã có trong activeCommands (theo address và fc)
                        const activeCmdKey = (cmd) => `${cmd.fc}_${cmd.address}`;
                        const activeCmdSet = new Set(activeCommands.map(activeCmdKey));
                        const extraResetCommands = extraResetKeys.filter(cmd => !activeCmdSet.has(activeCmdKey(cmd)));
                        const allResetCommands = [...activeCommands, ...extraResetCommands];
                        if (allResetCommands.length > 0) {
                            await scheduleService.resetModbusCommands(modbusClient, allResetCommands, schedule);
                            scheduleService.clearActiveCommands(schedule.name);
                        }
                        // Only publish MQTT and sync log if status actually changed
                        if (statusChanged) {
                            await scheduleService.publishMqttNotification(thingsboardClient, emqxClient, schedule, true);
                            await scheduleService.syncScheduleLog(schedule, true);
                        }
                    }
                    else {
                        node.warn(`Schedule ${schedule.name} skipped (status: ${schedule.status}, due: ${isDue})`);
                    }
                }
                // Cleanup activeModbusCommands - chỉ cleanup những schedule không còn trong DB hoặc bị disable
                const enabledScheduleIds = schedules.map(s => s.name);
                for (const scheduleId in activeModbusCommands) {
                    // Chỉ cleanup nếu schedule không còn tồn tại trong DB hoặc không còn enabled
                    // Không cleanup những schedule vừa finished trong lần chạy này
                    if (!enabledScheduleIds.includes(scheduleId)) {
                        const commands = activeModbusCommands[scheduleId];
                        const resetSuccess = await scheduleService.resetModbusCommands(modbusClient, commands);
                        if (resetSuccess) {
                            scheduleService.clearActiveCommands(scheduleId);
                            node.warn(`Cleaned up stale commands for schedule ${scheduleId} (not in enabled schedules)`);
                        }
                        else {
                            node.warn(`Failed to reset commands for ${scheduleId}, retaining in activeModbusCommands`);
                        }
                    }
                }
                // Cleanup old status history entries for schedules that are no longer enabled
                const statusHistory = globalContext.get("scheduleStatusHistory") || {};
                for (const scheduleId in statusHistory) {
                    if (!enabledScheduleIds.includes(scheduleId)) {
                        delete statusHistory[scheduleId];
                        node.warn(`Cleaned up status history for disabled schedule ${scheduleId}`);
                    }
                }
                globalContext.set("scheduleStatusHistory", statusHistory);
                node.status({ fill: "green", shape: "dot", text: "Schedules processed" });
                send(msg);
                done();
            }
            catch (err) {
                node.error("Error processing schedules: " + err.message);
                node.status({ fill: "red", shape: "ring", text: "Processing error" });
                done(err);
            }
        });
        node.on("close", function (done) {
            client_registry_1.default.releaseClient("modbus", node);
            client_registry_1.default.releaseClient("thingsboard", node);
            client_registry_1.default.releaseClient("local", node);
            done();
        });
    }
    RED.nodes.registerType("viis-schedule-executor", ScheduleExecutorNode);
};
