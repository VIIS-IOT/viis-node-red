import { NodeAPI, NodeDef, Node } from "node-red";
import { Container } from "typedi";

import { ModbusClientCore } from "../../core/modbus-client";
import { MqttClientCore } from "../../core/mqtt-client";
import { ScheduleService } from "./viis-schedule-executor-service";
import ClientRegistry from "../../core/client-registry";
import { TabiotSchedule } from "../../orm/entities/schedule/TabiotSchedule";
import moment from "moment";

interface ScheduleExecutorNodeDef extends NodeDef {
    name: string;
    mqttBroker: string;
    // Các trường cấu hình bổ sung nếu cần
}


interface ModbusCmd {
    key: string,
    value: number | boolean
    fc: number,
    unitid: number,
    address: number,
    quantity: number
}

module.exports = function (RED: NodeAPI) {
    function ScheduleExecutorNode(this: Node, config: ScheduleExecutorNodeDef) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.name = config.name;

        // Lấy service từ container (đã đăng ký với typedi)
        const scheduleService = Container.get(ScheduleService);

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
                // 1. Đọc danh sách schedule từ DB qua ORM
                const schedules: TabiotSchedule[] = await scheduleService.getDueSchedules();
                node.warn(`Found ${schedules.length} schedule(s).`);

                // 2. Lọc ra các schedule đang đến thời gian chạy
                const dueSchedules = schedules.filter(schedule => scheduleService.isScheduleDue(schedule));
                node.warn(`Có ${dueSchedules.length} schedule(s) đến giờ chạy.`);

                // 3. Với mỗi schedule, thực hiện quy trình:
                //    Nếu schedule chưa ở trạng thái running thì cập nhật status và sync
                //    -> mapScheduleToModbus → executeModbusCommands (retry 3 lần) → verifyModbusWrite
                //    Nếu đã hết giờ thực thi (now > end_time): update status thành finished, reset modbus (ghi false/0)
                for (const schedule of dueSchedules) {
                    const now = moment().utcOffset(420);
                    const scheduleEnd = moment(schedule.end_time, "HH:mm:ss");

                    // Nếu schedule đang running và chưa hết giờ thì bỏ qua xử lý
                    if (schedule.status === "running" && now.isBefore(scheduleEnd)) {
                        node.warn(`Schedule ${schedule.name} đã ở trạng thái running và chưa hết giờ, bỏ qua xử lý.`);
                        continue;
                    }

                    // Nếu schedule chưa running thì cập nhật status running và xử lý các bước modbus
                    if (schedule.status !== "running") {
                        await scheduleService.updateScheduleStatus(schedule, "running");
                        node.warn(`Updated schedule ${schedule.name} status to running.`);
                        await scheduleService.syncScheduleLog(schedule, true);
                    }

                    // Tiến hành xử lý modbus như trước
                    const commands: ModbusCmd[] = scheduleService.mapScheduleToModbus(schedule);
                    if (!commands || commands.length === 0) {
                        node.warn(`Không có lệnh modbus nào được map cho schedule ${schedule.name}.`);
                        continue;
                    }

                    let writeSuccess = false;
                    let attempt = 0;
                    while (!writeSuccess && attempt < 3) {
                        attempt++;
                        node.warn(`Ghi modbus cho schedule ${schedule.name}, lần thử ${attempt}`);
                        try {
                            await scheduleService.executeModbusCommands(modbusClient, commands);
                            const verified = await scheduleService.verifyModbusWrite(modbusClient, commands);
                            if (verified) {
                                writeSuccess = true;
                                node.warn(`Schedule ${schedule.name} ghi và xác thực thành công tại lần thử ${attempt}.`);
                            } else {
                                node.warn(`Xác thực thất bại cho schedule ${schedule.name} tại lần thử ${attempt}.`);
                            }
                        } catch (error) {
                            node.error(`Lỗi ghi modbus cho schedule ${schedule.name} tại lần thử ${attempt}: ${(error as Error).message}`);
                        }
                    }

                    // Nếu thời gian hiện tại đã vượt qua end_time, cập nhật status thành finished và reset modbus.
                    if (now.isAfter(scheduleEnd)) {
                        await scheduleService.updateScheduleStatus(schedule, "finished");
                        node.warn(`Updated schedule ${schedule.name} status to finished.`);
                        await scheduleService.resetModbusCommands(modbusClient, commands);
                        scheduleService.publishMqttNotification(mqttClient, schedule, writeSuccess);
                        await scheduleService.syncScheduleLog(schedule, writeSuccess);
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
            // Giải phóng client
            ClientRegistry.releaseClient("modbus", node);
            mqttClient.disconnect();
            done();
        });
    }

    RED.nodes.registerType("viis-schedule-executor", ScheduleExecutorNode);
};
