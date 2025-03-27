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
                            node.warn(`Disabled and finished schedule id: ${schedule.name}, label: ${schedule.label} via RPC`);
                            const { holdingCommands, coilCommands } = scheduleService.mapScheduleToModbus(schedule);
                            if (holdingCommands.length > 0 || coilCommands.length > 0) {
                                yield scheduleService.resetModbusCommands(modbusClient, [...holdingCommands, ...coilCommands]);
                                node.warn(`Reset modbus commands for id: ${schedule.name}, label: ${schedule.label} via RPC`);
                            }
                            yield scheduleService.publishMqttNotification(mqttClient, schedule, true);
                            yield scheduleService.syncScheduleLog(schedule, true);
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
                        const now = (0, moment_1.default)().utc().add(7, 'hours');
                        const scheduleStart = (0, moment_1.default)(schedule.start_time, "HH:mm:ss");
                        const scheduleEnd = (0, moment_1.default)(schedule.end_time, "HH:mm:ss");
                        const isDue = scheduleService.isScheduleDue(schedule);
                        if (isDue && schedule.status !== "running") {
                            yield scheduleService.updateScheduleStatus(schedule, "running");
                            node.warn(`Updated schedule id: ${schedule.name}, label: ${schedule.label} to running.`);
                            const { holdingCommands, coilCommands } = scheduleService.mapScheduleToModbus(schedule);
                            if (holdingCommands.length > 0 || coilCommands.length > 0) {
                                let writeSuccess = false;
                                let attempt = 0;
                                while (!writeSuccess && attempt < 3) {
                                    attempt++;
                                    node.warn(`Ghi modbus cho id: ${schedule.name}, label: ${schedule.label}, lần thử ${attempt}`);
                                    try {
                                        yield scheduleService.executeModbusCommands(modbusClient, { holdingCommands, coilCommands });
                                        writeSuccess = yield scheduleService.verifyModbusWrite(modbusClient, [...holdingCommands, ...coilCommands]);
                                        if (writeSuccess) {
                                            node.warn(`Ghi và xác thực thành công cho id: ${schedule.name}, label: ${schedule.label} tại lần ${attempt}.`);
                                        }
                                        else {
                                            node.warn(`Xác thực thất bại cho id: ${schedule.name}, label: ${schedule.label} tại lần ${attempt}.`);
                                        }
                                    }
                                    catch (error) {
                                        node.error(`Lỗi ghi modbus cho id: ${schedule.name}, label: ${schedule.label} tại lần ${attempt}: ${error.message}`);
                                    }
                                }
                                yield scheduleService.publishMqttNotification(mqttClient, schedule, writeSuccess);
                                yield scheduleService.syncScheduleLog(schedule, writeSuccess);
                            }
                            else {
                                node.warn(`No modbus commands mapped for id: ${schedule.name}, label: ${schedule.label}.`);
                            }
                        }
                        else if (schedule.status === "running" && now.isAfter(scheduleEnd)) {
                            yield scheduleService.updateScheduleStatus(schedule, "finished");
                            node.warn(`Updated schedule id: ${schedule.name}, label: ${schedule.label} to finished.`);
                            const { holdingCommands, coilCommands } = scheduleService.mapScheduleToModbus(schedule);
                            if (holdingCommands.length > 0 || coilCommands.length > 0) {
                                yield scheduleService.resetModbusCommands(modbusClient, [...holdingCommands, ...coilCommands]);
                                node.warn(`Reset modbus commands for id: ${schedule.name}, label: ${schedule.label}.`);
                            }
                            yield scheduleService.publishMqttNotification(mqttClient, schedule, true);
                            // await scheduleService.syncScheduleLog(schedule, true); // Đoạn này bị comment trong code gốc
                        }
                        else {
                            node.warn(`Schedule id: ${schedule.name}, label: ${schedule.label} skipped (status: ${schedule.status}, due: ${isDue}).`);
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
