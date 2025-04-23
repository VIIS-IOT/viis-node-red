import { NodeAPI, NodeDef, Node } from "node-red";

import { ModbusClientCore } from "../../core/modbus-client";
import { MqttClientCore } from "../../core/mqtt-client";
import { ScheduleService } from "./viis-schedule-executor-service";
import ClientRegistry from "../../core/client-registry";
import { TabiotSchedule } from "../../orm/entities/schedule/TabiotSchedule";
import moment from "moment";
import { ActiveModbusCommands, ManualModbusOverrides, RpcPayload, ScheduleExecutorNodeDef } from "./type";

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

        node.name = config.name;
        const scheduleInterval = config.scheduleInterval;
        node.warn(`Schedule interval set to: ${scheduleInterval}`);

        let scheduleService: ScheduleService;
        try {
            scheduleService = new ScheduleService(node);
            node.warn("ScheduleService initialized successfully");
        } catch (error) {
            node.error(`Failed to initialize ScheduleService: ${(error as Error).message}`);
            return;
        }

        const modbusConfig = {
            type: (process.env.MODBUS_TYPE as "TCP" | "RTU") || "TCP",
            host: process.env.MODBUS_HOST || "localhost",
            tcpPort: parseInt(process.env.MODBUS_TCP_PORT || "502", 10),
            serialPort: process.env.MODBUS_SERIAL_PORT || "/dev/ttyUSB0",
            baudRate: parseInt(process.env.MODBUS_BAUD_RATE || "9600", 10),
            parity: (process.env.MODBUS_PARITY as "none" | "even" | "odd") || "none",
            unitId: parseInt(process.env.MODBUS_UNIT_ID || "1", 10),
            timeout: parseInt(process.env.MODBUS_TIMEOUT || "5000", 10),
            reconnectInterval: parseInt(process.env.MODBUS_RECONNECT_INTERVAL || "5000", 10),
        };

        const mqttConfig = {
            broker: `mqtt://${process.env.THINGSBOARD_HOST || "mqtt.viis.tech"}:${process.env.THINGSBOARD_PORT || "1883"}`,
            clientId: `node-red-tb-${Math.random().toString(16).substr(2, 8)}`,
            username: process.env.DEVICE_ACCESS_TOKEN || "",
            password: process.env.THINGSBOARD_PASSWORD || "",
            qos: 1 as 0 | 1 | 2,
        };

        const modbusClient: ModbusClientCore = ClientRegistry.getModbusClient(modbusConfig, node);

        node.on("input", async function (msg, send, done) {
            try {
                const mqttClient: MqttClientCore = await ClientRegistry.getThingsboardMqttClient(mqttConfig, node);
                node.warn(`MQTT client connected: ${mqttClient.isConnected()}`);

                ClientRegistry.logConnectionCounts(node);

                // Kiểm tra và xoá overrides nếu không có hẹn giờ nào đang chạy
                const activeModbusCommands: ActiveModbusCommands = node.context().global.get("activeModbusCommands") as ActiveModbusCommands || {};
                if (Object.keys(activeModbusCommands).length === 0) {
                    node.context().global.set("manualModbusOverrides", {});
                    node.warn("Không có hẹn giờ đang chạy. Đã xoá manualModbusOverrides.");
                }

                // Xử lý RPC command
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
                        node.warn(`Schedule with id ${scheduleId} not found`);
                        node.status({ fill: "yellow", shape: "ring", text: "Schedule not found" });
                        send(msg);
                        done();
                        return;
                    }

                    if (schedule.status === "running") {
                        schedule.status = "finished";
                        schedule.enable = 0;
                        await scheduleService.updateScheduleStatus(schedule, "finished");
                        const { holdingCommands, coilCommands } = scheduleService.mapScheduleToModbus(schedule);
                        const activeCommands = scheduleService.getActiveCommands(schedule.name);
                        // --- Bổ sung reset các key time_valve_ và set_flow ---
                        let holdingRegisters: Record<string, number> = {};
                        try {
                            holdingRegisters = JSON.parse(process.env.MODBUS_HOLDING_REGISTERS || '{}');
                        } catch (err) {
                            node.error("Cannot parse MODBUS_HOLDING_REGISTERS from .env");
                        }
                        node.warn(`debug holdingRegisters: ${JSON.stringify(holdingRegisters)}`)
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
                        const activeCmdKey = (cmd: any) => `${cmd.fc}_${cmd.address}`;
                        const activeCmdSet = new Set([...activeCommands, ...holdingCommands, ...coilCommands].map(activeCmdKey));
                        const extraResetCommands = extraResetKeys.filter(cmd => !activeCmdSet.has(activeCmdKey(cmd)));
                        const allResetCommands = [...activeCommands, ...holdingCommands, ...coilCommands, ...extraResetCommands];
                        if (allResetCommands.length > 0) {
                            await scheduleService.resetModbusCommands(modbusClient, allResetCommands);
                            scheduleService.clearActiveCommands(schedule.name); // Xóa lệnh đã lưu
                            node.warn(`Cleared active commands for schedule ${schedule.name} via RPC`);
                        }
                        await scheduleService.publishMqttNotification(mqttClient, schedule, true);
                        // await scheduleService.syncScheduleLog(schedule, true);
                    } else {
                        node.warn(`Schedule id: ${schedule.name}, label: ${schedule.label} is not running, only disabling`);
                        schedule.enable = 0;
                        await scheduleService.updateScheduleStatus(schedule, schedule.status as "running" | "finished");
                    }



                    node.status({ fill: "green", shape: "dot", text: "RPC processed" });
                    send(msg);
                    done();
                    return;
                } else if (msg.payload && typeof msg.payload === 'object' && 'method' in msg.payload) {
                    return null;
                }

                const schedules: TabiotSchedule[] = await scheduleService.getDueSchedules();
                node.warn(`Found ${schedules.length} schedule(s).`);

                for (const schedule of schedules) {
                    const isDue = scheduleService.isScheduleDue(schedule);
                    const now = moment().utc().add(7, 'hours');
                    // const now = moment('2025-04-03T00:10:00Z').utc();
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

                    // Xử lý trường hợp qua ngày (cross-midnight)
                    if (startDateTime.isAfter(endDateTime)) {
                        if (now.isBefore(endDateTime)) {
                            // Nếu giờ hiện tại nằm sau nửa đêm (ví dụ: 00:10) và trước endTime,
                            // schedule đã bắt đầu từ ngày hôm trước.
                            startDateTime.subtract(1, 'day');
                        } else {
                            // Nếu giờ hiện tại nằm sau startTime,
                            // thì endTime nằm vào ngày hôm sau.
                            endDateTime.add(1, 'day');
                        }
                    }

                    if (isDue && schedule.status !== "running") {
                        node.warn("start running schedule")
                        // --- Reset time_valve_ and set_flow keys except those present in action ---
                        let holdingRegisters: Record<string, number> = {};
                        try {
                            holdingRegisters = JSON.parse(process.env.MODBUS_HOLDING_REGISTERS || '{}');
                        } catch (err) {
                            node.error("Cannot parse MODBUS_HOLDING_REGISTERS from .env");
                        }
                        node.warn(`debug holdingRegisters: ${JSON.stringify(holdingRegisters)}`);
                        // Parse action (may be string or object)
                        let actionObj: Record<string, any> = {};
                        if (typeof schedule.action === 'string' && schedule.action.trim() !== '') {
                            try {
                                actionObj = JSON.parse(schedule.action);
                            } catch (err) {
                                node.warn('Cannot parse schedule.action, treat as empty object');
                            }
                        } else if (typeof schedule.action === 'object' && schedule.action !== null) {
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
                        const { holdingCommands, coilCommands } = scheduleService.mapScheduleToModbus(schedule);
                        if (await scheduleService.canExecuteCommands(schedule.name, holdingCommands, coilCommands)) {
                            await scheduleService.updateScheduleStatus(schedule, "running");
                            let writeSuccess = false;
                            let attempt = 0;
                            while (!writeSuccess && attempt < 3) {
                                attempt++;
                                try {
                                    await scheduleService.executeModbusCommands(modbusClient, { holdingCommands, coilCommands });
                                    writeSuccess = await scheduleService.verifyModbusWrite(modbusClient, [...holdingCommands, ...coilCommands]);
                                    if (writeSuccess) {
                                        scheduleService.storeActiveCommands(schedule.name, [...holdingCommands, ...coilCommands]);
                                    }
                                } catch (error) {
                                    node.error(`Error writing modbus: ${(error as Error).message}`);
                                }
                            }
                            await scheduleService.publishMqttNotification(mqttClient, schedule, writeSuccess);
                            await scheduleService.syncScheduleLog(schedule, writeSuccess);
                        }
                    } else if (schedule.status === "running" && isDue) {
                        // Trường hợp đang running nhưng có thể đã mất điện
                        const writeSuccess = await scheduleService.reExecuteAfterPowerLoss(modbusClient, schedule);
                        if (writeSuccess) {
                            node.warn(`Re-executed commands for schedule ${schedule.name} after power loss or frequently`);
                            await scheduleService.publishMqttNotification(mqttClient, schedule, true);
                            await scheduleService.syncScheduleLog(schedule, true);
                        }
                    } else if (schedule.status === "running" && now.isAfter(endDateTime)) {
                        node.warn("strart finishing schedule")
                        await scheduleService.updateScheduleStatus(schedule, "finished");
                        const activeCommands = scheduleService.getActiveCommands(schedule.name);
                        // --- Bổ sung reset các key time_valve_ và set_flow ---
                        let holdingRegisters: Record<string, number> = {};
                        try {
                            holdingRegisters = JSON.parse(process.env.MODBUS_HOLDING_REGISTERS || '{}');
                        } catch (err) {
                            node.error("Cannot parse MODBUS_HOLDING_REGISTERS from .env");
                        }
                        node.warn(`debug holdingRegisters: ${JSON.stringify(holdingRegisters)}`)
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
                        const activeCmdKey = (cmd: any) => `${cmd.fc}_${cmd.address}`;
                        const activeCmdSet = new Set(activeCommands.map(activeCmdKey));
                        const extraResetCommands = extraResetKeys.filter(cmd => !activeCmdSet.has(activeCmdKey(cmd)));
                        const allResetCommands = [...activeCommands, ...extraResetCommands];
                        if (allResetCommands.length > 0) {
                            await scheduleService.resetModbusCommands(modbusClient, allResetCommands);
                            scheduleService.clearActiveCommands(schedule.name);
                        }
                        await scheduleService.publishMqttNotification(mqttClient, schedule, true);
                        // await scheduleService.syncScheduleLog(schedule, true);
                    } else {
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
                        const resetSuccess = await scheduleService.resetModbusCommands(modbusClient, commands);
                        if (resetSuccess) {
                            scheduleService.clearActiveCommands(scheduleId);
                            node.warn(`Cleaned up stale commands for schedule ${scheduleId}`);
                        } else {
                            node.warn(`Failed to reset commands for ${scheduleId}, retaining in activeModbusCommands`);
                        }
                    }
                }
                node.status({ fill: "green", shape: "dot", text: "Schedules processed" });
                send(msg);
                done();
            } catch (err) {
                node.error("Error processing schedules: " + (err as Error).message);
                node.status({ fill: "red", shape: "ring", text: "Processing error" });
                done(err);
            }
        });

        node.on("close", function (done) {
            ClientRegistry.releaseClient("modbus", node);
            ClientRegistry.releaseClient("thingsboard", node);
            done();
        });
    }

    RED.nodes.registerType("viis-schedule-executor", ScheduleExecutorNode);
};