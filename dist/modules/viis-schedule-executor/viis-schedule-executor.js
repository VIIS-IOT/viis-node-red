"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const viis_schedule_executor_service_1 = require("./viis-schedule-executor-service");
const client_registry_1 = __importDefault(require("../../core/client-registry"));
const moment_1 = __importDefault(require("moment"));
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
        node.name = config.name;
        const scheduleInterval = config.scheduleInterval;
        node.warn(`Schedule interval set to: ${scheduleInterval}`);
        let scheduleService;
        try {
            scheduleService = new viis_schedule_executor_service_1.ScheduleService(node);
            node.warn("ScheduleService initialized successfully");
        }
        catch (error) {
            node.error(`Failed to initialize ScheduleService: ${error.message}`);
            return;
        }
        const modbusConfig = {
            type: process.env.MODBUS_TYPE || "TCP",
            host: process.env.MODBUS_HOST || "localhost",
            tcpPort: parseInt(process.env.MODBUS_TCP_PORT || "502", 10),
            serialPort: process.env.MODBUS_SERIAL_PORT || "/dev/ttyUSB0",
            baudRate: parseInt(process.env.MODBUS_BAUD_RATE || "9600", 10),
            parity: process.env.MODBUS_PARITY || "none",
            unitId: parseInt(process.env.MODBUS_UNIT_ID || "1", 10),
            timeout: parseInt(process.env.MODBUS_TIMEOUT || "5000", 10),
            reconnectInterval: parseInt(process.env.MODBUS_RECONNECT_INTERVAL || "5000", 10),
        };
        const mqttConfig = {
            broker: `mqtt://${process.env.THINGSBOARD_HOST || "mqtt.viis.tech"}:${process.env.THINGSBOARD_PORT || "1883"}`,
            clientId: `node-red-tb-${Math.random().toString(16).substr(2, 8)}`,
            username: process.env.DEVICE_ACCESS_TOKEN || "",
            password: process.env.THINGSBOARD_PASSWORD || "",
            qos: 1,
        };
        const modbusClient = client_registry_1.default.getModbusClient(modbusConfig, node);
        node.on("input", function (msg, send, done) {
            return __awaiter(this, void 0, void 0, function* () {
                try {
                    const mqttClient = yield client_registry_1.default.getThingsboardMqttClient(mqttConfig, node);
                    node.warn(`MQTT client connected: ${mqttClient.isConnected()}`);
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
                        const schedules = yield scheduleService.getDueSchedules();
                        const schedule = schedules.find(s => s.name === scheduleId);
                        if (!schedule) {
                            node.warn(`Schedule with id ${scheduleId} not found`);
                            node.status({ fill: "yellow", shape: "ring", text: "Schedule not found" });
                            send(msg);
                            done();
                            return;
                        }
                        if (schedule.status === "running") {
                            schedule.status = "finished";
                            schedule.enable = 0;
                            yield scheduleService.updateScheduleStatus(schedule, "finished");
                            const { holdingCommands, coilCommands } = scheduleService.mapScheduleToModbus(schedule);
                            if (holdingCommands.length > 0 || coilCommands.length > 0) {
                                yield scheduleService.resetModbusCommands(modbusClient, [...holdingCommands, ...coilCommands]);
                                scheduleService.clearActiveCommands(schedule.name); // Xóa lệnh đã lưu
                                node.warn(`Cleared active commands for schedule ${schedule.name} via RPC`);
                            }
                            yield scheduleService.publishMqttNotification(mqttClient, schedule, true);
                            // await scheduleService.syncScheduleLog(schedule, true);
                        }
                        else {
                            node.warn(`Schedule id: ${schedule.name}, label: ${schedule.label} is not running, only disabling`);
                            schedule.enable = 0;
                            yield scheduleService.updateScheduleStatus(schedule, schedule.status);
                        }
                        node.status({ fill: "green", shape: "dot", text: "RPC processed" });
                        send(msg);
                        done();
                        return;
                    }
                    else if (msg.payload && typeof msg.payload === 'object' && 'method' in msg.payload) {
                        return null;
                    }
                    const schedules = yield scheduleService.getDueSchedules();
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
                            const { holdingCommands, coilCommands } = scheduleService.mapScheduleToModbus(schedule);
                            if (yield scheduleService.canExecuteCommands(schedule.name, holdingCommands, coilCommands)) {
                                yield scheduleService.updateScheduleStatus(schedule, "running");
                                let writeSuccess = false;
                                let attempt = 0;
                                while (!writeSuccess && attempt < 3) {
                                    attempt++;
                                    try {
                                        yield scheduleService.executeModbusCommands(modbusClient, { holdingCommands, coilCommands });
                                        writeSuccess = yield scheduleService.verifyModbusWrite(modbusClient, [...holdingCommands, ...coilCommands]);
                                        if (writeSuccess) {
                                            scheduleService.storeActiveCommands(schedule.name, [...holdingCommands, ...coilCommands]);
                                        }
                                    }
                                    catch (error) {
                                        node.error(`Error writing modbus: ${error.message}`);
                                    }
                                }
                                yield scheduleService.publishMqttNotification(mqttClient, schedule, writeSuccess);
                                yield scheduleService.syncScheduleLog(schedule, writeSuccess);
                            }
                        }
                        else if (schedule.status === "running" && isDue) {
                            // Trường hợp đang running nhưng có thể đã mất điện
                            const writeSuccess = yield scheduleService.reExecuteAfterPowerLoss(modbusClient, schedule);
                            if (writeSuccess) {
                                node.warn(`Re-executed commands for schedule ${schedule.name} after power loss or frequently`);
                                yield scheduleService.publishMqttNotification(mqttClient, schedule, true);
                                yield scheduleService.syncScheduleLog(schedule, true);
                            }
                        }
                        else if (schedule.status === "running" && now.isAfter(endDateTime)) {
                            node.warn("strart finishing schedule");
                            yield scheduleService.updateScheduleStatus(schedule, "finished");
                            const activeCommands = scheduleService.getActiveCommands(schedule.name);
                            if (activeCommands.length > 0) {
                                yield scheduleService.resetModbusCommands(modbusClient, activeCommands);
                                scheduleService.clearActiveCommands(schedule.name);
                            }
                            yield scheduleService.publishMqttNotification(mqttClient, schedule, true);
                            // await scheduleService.syncScheduleLog(schedule, true);
                        }
                        else {
                            node.warn(`Schedule ${schedule.name} skipped (status: ${schedule.status}, due: ${isDue})`);
                        }
                    }
                    // Cleanup activeModbusCommands
                    const runningScheduleIds = schedules
                        .filter(s => s.status === "running" && scheduleService.isScheduleDue(s))
                        .map(s => s.name);
                    for (const scheduleId in activeModbusCommands) {
                        if (!runningScheduleIds.includes(scheduleId)) {
                            const commands = activeModbusCommands[scheduleId];
                            const resetSuccess = yield scheduleService.resetModbusCommands(modbusClient, commands);
                            if (resetSuccess) {
                                scheduleService.clearActiveCommands(scheduleId);
                                node.warn(`Cleaned up stale commands for schedule ${scheduleId}`);
                            }
                            else {
                                node.warn(`Failed to reset commands for ${scheduleId}, retaining in activeModbusCommands`);
                            }
                        }
                    }
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
        });
        node.on("close", function (done) {
            client_registry_1.default.releaseClient("modbus", node);
            client_registry_1.default.releaseClient("thingsboard", node);
            done();
        });
    }
    RED.nodes.registerType("viis-schedule-executor", ScheduleExecutorNode);
};
