import { NodeAPI, NodeDef, Node } from "node-red";

import { ModbusClientCore } from "../../core/modbus-client";
import { MqttClientCore } from "../../core/mqtt-client";
import { ScheduleService } from "./viis-schedule-executor-service";
import ClientRegistry from "../../core/client-registry";
import { TabiotSchedule } from "../../orm/entities/schedule/TabiotSchedule";
import moment from "moment";

interface ScheduleExecutorNodeDef extends NodeDef {
    name: string;
    mqttBroker: string;
    scheduleInterval: number;
    description: string;
}


interface ModbusCmd {
    key: string,
    value: number | boolean
    fc: number,
    unitid: number,
    address: number,
    quantity: number
}

interface RpcPayload {
    method: string;
    params?: {
        scheduleId?: string;
    };
}

module.exports = function (RED: NodeAPI) {
    function ScheduleExecutorNode(this: Node, config: ScheduleExecutorNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.name = config.name;
        const scheduleInterval = config.scheduleInterval; // Sử dụng nếu cần
        node.warn(`Schedule interval set to: ${scheduleInterval}`);

        let scheduleService: ScheduleService;
        try {
            scheduleService = new ScheduleService(node); // Truyền node vào constructor
            node.warn("ScheduleService initialized successfully");
        } catch (error) {
            node.error(`Failed to initialize ScheduleService: ${(error as Error).message}`);
            return;
        }
        // Khởi tạo Modbus và MQTT client thông qua ClientRegistry
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

        const mqttConfig = config.mqttBroker === "thingsboard"
            ? {
                broker: `mqtt://${process.env.THINGSBOARD_HOST || "mqtt.viis.tech"}:${process.env.THINGSBOARD_PORT || "1883"}`,
                clientId: `node-red-thingsboard-${Math.random().toString(16).substr(2, 8)}`,
                username: process.env.DEVICE_ACCESS_TOKEN || "",
                password: process.env.THINGSBOARD_PASSWORD || "",
                qos: 1 as 0 | 1 | 2,
            }
            : {
                broker: `mqtt://${process.env.EMQX_HOST || "emqx"}:${process.env.EMQX_PORT || "1883"}`,
                clientId: `node-red-local-${Math.random().toString(16).substr(2, 8)}`,
                username: process.env.EMQX_USERNAME || "",
                password: process.env.EMQX_PASSWORD || "",
                qos: 1 as 0 | 1 | 2,
            };

        const modbusClient: ModbusClientCore = ClientRegistry.getModbusClient(modbusConfig, node);
        const mqttClient: MqttClientCore = config.mqttBroker === "thingsboard"
            ? ClientRegistry.getThingsboardMqttClient(mqttConfig, node)
            : ClientRegistry.getLocalMqttClient(mqttConfig, node);

        node.on("input", async function (msg, send, done) {
            try {

                // Kiểm tra xem input có phải là RPC command không
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

                    // Lấy schedule từ DB dựa trên scheduleId
                    const schedules: TabiotSchedule[] = await scheduleService.getDueSchedules();
                    const schedule = schedules.find(s => s.name === scheduleId);

                    if (!schedule) {
                        node.warn(`Schedule with id ${scheduleId} not found`);
                        node.status({ fill: "yellow", shape: "ring", text: "Schedule not found" });
                        send(msg);
                        done();
                        return;
                    }

                    // Chỉ xử lý nếu schedule đang running
                    if (schedule.status === "running") {
                        // Cập nhật status thành finished và disable schedule
                        schedule.status = "finished";
                        schedule.enable = 0;
                        await scheduleService.updateScheduleStatus(schedule, "finished");
                        node.warn(`Disabled and finished schedule id: ${schedule.name}, label: ${schedule.label} via RPC`);

                        // Reset các lệnh modbus nếu có
                        const commands: ModbusCmd[] = scheduleService.mapScheduleToModbus(schedule);
                        if (commands.length > 0) {
                            await scheduleService.resetModbusCommands(modbusClient, commands);
                            node.warn(`Reset modbus commands for id: ${schedule.name}, label: ${schedule.label} via RPC`);
                        }

                        // Publish MQTT notification và sync log
                        scheduleService.publishMqttNotification(mqttClient, schedule, true);
                        await scheduleService.syncScheduleLog(schedule, true);
                    } else {
                        node.warn(`Schedule id: ${schedule.name}, label: ${schedule.label} is not running, only disabling`);
                        schedule.enable = 0;
                        await scheduleService.updateScheduleStatus(schedule, schedule.status as "running" | "finished");
                    }

                    node.status({ fill: "green", shape: "dot", text: "RPC processed" });
                    send(msg);
                    done();
                    return;
                }

                // Lấy tất cả schedules từ DB, không lọc trước
                const schedules: TabiotSchedule[] = await scheduleService.getDueSchedules();
                node.warn(`Found ${schedules.length} schedule(s).`);
                console.log(`schedules are ${schedules}`)

                for (const schedule of schedules) {
                    const now = moment().utc().add(7, 'hours');
                    const scheduleStart = moment(schedule.start_time, "HH:mm:ss");
                    const scheduleEnd = moment(schedule.end_time, "HH:mm:ss");
                    const isDue = scheduleService.isScheduleDue(schedule); // Kiểm tra xem có trong khung giờ chạy không

                    // Trường hợp 1: Schedule đang trong khung giờ chạy và chưa running
                    if (isDue && schedule.status !== "running") {
                        await scheduleService.updateScheduleStatus(schedule, "running");
                        node.warn(`Updated schedule id: ${schedule.name}, label: ${schedule.label} to running.`);

                        const commands: ModbusCmd[] = scheduleService.mapScheduleToModbus(schedule);
                        if (commands.length > 0) {
                            let writeSuccess = false;
                            let attempt = 0;
                            while (!writeSuccess && attempt < 3) {
                                attempt++;
                                node.warn(`Ghi modbus cho id: ${schedule.name}, label: ${schedule.label}, lần thử ${attempt}`);
                                try {
                                    await scheduleService.executeModbusCommands(modbusClient, commands);
                                    writeSuccess = await scheduleService.verifyModbusWrite(modbusClient, commands);
                                    if (writeSuccess) {
                                        node.warn(`Ghi và xác thực thành công cho id: ${schedule.name}, label: ${schedule.label} tại lần ${attempt}.`);
                                    } else {
                                        node.warn(`Xác thực thất bại cho id: ${schedule.name}, label: ${schedule.label} tại lần ${attempt}.`);
                                    }
                                } catch (error) {
                                    node.error(`Lỗi ghi modbus cho id: ${schedule.name}, label: ${schedule.label} tại lần ${attempt}: ${(error as Error).message}`);
                                }
                            }

                            // Publish và sync log bất kể thành công hay thất bại
                            scheduleService.publishMqttNotification(mqttClient, schedule, writeSuccess);
                            await scheduleService.syncScheduleLog(schedule, writeSuccess);
                        } else {
                            node.warn(`No modbus commands mapped for id: ${schedule.name}, label: ${schedule.label}.`);
                        }
                    }

                    // Trường hợp 2: Schedule đang running nhưng đã quá end_time
                    else if (schedule.status === "running" && now.isAfter(scheduleEnd)) {
                        await scheduleService.updateScheduleStatus(schedule, "finished");
                        node.warn(`Updated schedule id: ${schedule.name}, label: ${schedule.label} to finished.`);

                        const commands: ModbusCmd[] = scheduleService.mapScheduleToModbus(schedule); // Lấy lại commands đã ghi lúc running
                        if (commands.length > 0) {
                            await scheduleService.resetModbusCommands(modbusClient, commands);
                            node.warn(`Reset modbus commands for id: ${schedule.name}, label: ${schedule.label}.`);
                        }

                        // Publish và sync log khi finished
                        scheduleService.publishMqttNotification(mqttClient, schedule, true);
                        // await scheduleService.syncScheduleLog(schedule, true);
                    }

                    // Trường hợp khác: Bỏ qua (ví dụ: đã finished hoặc chưa đến giờ chạy)
                    else {
                        node.warn(`Schedule id: ${schedule.name}, label: ${schedule.label} skipped (status: ${schedule.status}, due: ${isDue}).`);
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
            mqttClient.disconnect();
            done();
        });

    }

    RED.nodes.registerType("viis-schedule-executor", ScheduleExecutorNode);
};
