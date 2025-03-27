import { TabiotSchedule, TabiotScheduleLog } from "../../orm/entities/schedule/TabiotSchedule";
import moment from "moment";
import { ModbusClientCore } from "../../core/modbus-client";
import { MqttClientCore } from "../../core/mqtt-client";
import { AppDataSource } from "../../orm/dataSource";
import { SyncScheduleService } from "../../services/syncSchedule/SyncScheduleService";
import Container, { Service } from "typedi";
import { Node } from "node-red";

// require('dotenv').config();

export interface ModbusCmd {
    key: string;
    value: number | boolean;
    fc: number;
    unitid: number;
    address: number;
    quantity: number;
}

interface ScaleConfig {
    key: string;
    operation: 'multiply' | 'divide';
    factor: number;
    direction: 'read' | 'write';
}

@Service()
export class ScheduleService {
    private syncScheduleService: SyncScheduleService;
    private node: Node; // Thêm biến để giữ node từ Node-RED

    constructor(node?: Node) { // Thêm tham số node vào constructor
        this.node = node; // Lưu node để truy cập global context
        try {
            this.syncScheduleService = Container.get(SyncScheduleService);
            console.log("SyncScheduleService initialized successfully");
        } catch (error) {
            console.error(`Failed to initialize SyncScheduleService: ${(error as Error).message}`);
            this.syncScheduleService = undefined as any;
        }
    }

    // Hàm scaleValue trả về giá trị đã scale hoặc giá trị gốc nếu không có config
    private scaleValue(key: string, value: number, direction: 'read' | 'write'): number {
        const scaleConfigs: ScaleConfig[] = this.node?.context().global.get("scaleConfigs") as ScaleConfig[] || [];
        const config = scaleConfigs.find(c => c.key === key && c.direction === direction);
        if (!config) {
            console.log(`No scale config for ${key} in ${direction}, returning ${value}`);
            return value;
        }

        const shouldMultiply = config.operation === 'multiply';
        const result = shouldMultiply ? value * config.factor : value / config.factor;
        console.log(`Scaled ${key} (${direction}): ${value} -> ${result} (operation: ${config.operation}, factor: ${config.factor})`);
        return result;
    }

    /**
     * Lấy danh sách schedule từ DB
     */
    async getDueSchedules(): Promise<TabiotSchedule[]> {
        try {
            if (!AppDataSource.isInitialized) {
                console.log("Initializing AppDataSource...");
                await AppDataSource.initialize();
                console.log("AppDataSource initialized successfully");
            }
            const repository = AppDataSource.getRepository(TabiotSchedule);
            const schedules = await repository
                .createQueryBuilder("schedule")
                .leftJoin("tabiot_device", "device", "schedule.device_id = device.name")
                .leftJoin("schedule.schedulePlan", "schedulePlan")
                .addSelect("device.label", "device_label")
                .where("schedule.enable = :enable", { enable: 1 })
                .andWhere("schedulePlan.enable = :planEnable", { planEnable: 1 })
                .printSql()
                .getMany();
            // console.log(`schedules sql: ${JSON.stringify(schedules)}`)
            console.log(`Retrieved ${schedules.length} schedules from DB`);
            return schedules;
        } catch (error) {
            console.error(`Error in getDueSchedules: ${(error as Error).message}`);
            return []; // Trả về mảng rỗng thay vì throw lỗi
        }
    }

    /**
     * Kiểm tra xem schedule có đang trong khung thời gian thực thi hay không
     */
    isScheduleDue(schedule: TabiotSchedule): boolean {
        try {
            if (!schedule.start_time || !schedule.end_time) {
                console.warn(`Schedule ${schedule.name} missing start_time or end_time`);
                return false;
            }
            const now = moment().utc().add(7, 'hours');
            const startTime = moment(schedule.start_time, "HH:mm:ss");
            const endTime = moment(schedule.end_time, "HH:mm:ss");
            const isDue = now.isBetween(startTime, endTime, undefined, "[]");
            console.log({ now, startTime, endTime, isDue })
            console.log(`Schedule ${schedule.name} isDue: ${isDue}`);
            return isDue;
        } catch (error) {
            console.error(`Error in isScheduleDue for ${schedule.name}: ${(error as Error).message}`);
            return false; // Trả về false nếu có lỗi
        }
    }

    /**
 * Map schedule thành danh sách các lệnh modbus
 */
    mapScheduleToModbus(schedule: TabiotSchedule): { holdingCommands: ModbusCmd[], coilCommands: ModbusCmd[] } {
        const holdingCommands: ModbusCmd[] = [];
        const coilCommands: ModbusCmd[] = [];
        if (!schedule.action) {
            console.warn(`Schedule ${schedule.name} has no action defined`);
            return { holdingCommands, coilCommands };
        }

        try {
            const actionObj = JSON.parse(schedule.action);
            const modbusCoils = JSON.parse(process.env.MODBUS_COILS || "{}");
            const modbusHolding = JSON.parse(process.env.MODBUS_HOLDING_REGISTERS || "{}");

            for (const key in actionObj) {
                if (actionObj.hasOwnProperty(key)) {
                    let value = actionObj[key];
                    // Chuyển đổi chuỗi boolean thành kiểu boolean
                    if (typeof value === "string") {
                        if (value.toLowerCase() === "true") {
                            value = true;
                        } else if (value.toLowerCase() === "false") {
                            value = false;
                        }
                    }
                    // Chỉ xử lý các key có giá trị truthy sau khi xử lý
                    if (value) {
                        if (modbusHolding.hasOwnProperty(key)) {
                            holdingCommands.push({
                                key,
                                value: Number(value),
                                fc: 6,
                                unitid: 1,
                                address: modbusHolding[key],
                                quantity: 1,
                            });
                            console.log(`Mapped ${key} to holding register at address ${modbusHolding[key]}`);
                        } else if (modbusCoils.hasOwnProperty(key)) {
                            coilCommands.push({
                                key,
                                value: Boolean(value),
                                fc: 5,
                                unitid: 1,
                                address: modbusCoils[key],
                                quantity: 1,
                            });
                            console.log(`Mapped ${key} to coil at address ${modbusCoils[key]}`);
                        } else {
                            console.warn(`No modbus mapping found for key: ${key} in schedule ${schedule.name}`);
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Error parsing action for schedule ${schedule.name}: ${(error as Error).message}`);
        }

        return { holdingCommands, coilCommands };
    }


    /**
 * Gửi các lệnh modbus qua modbusClient
 */
    async executeModbusCommands(modbusClient: ModbusClientCore, commands: { holdingCommands: ModbusCmd[], coilCommands: ModbusCmd[] }): Promise<void> {
        // Thực hiện holding commands trước
        for (const cmd of commands.holdingCommands) {
            try {
                let writeValue = this.scaleValue(cmd.key, cmd.value as number, 'write'); // Scale nếu có config
                await modbusClient.writeRegister(cmd.address, Number(writeValue));
                console.log(`Wrote register at ${cmd.address} with scaled value ${writeValue}`);
                await this.delay(100);
            } catch (error) {
                console.error(`Error executing modbus holding command ${cmd.key}: ${(error as Error).message}`);
            }
        }

        // Sau đó thực hiện coil commands
        for (const cmd of commands.coilCommands) {
            try {
                let writeValue = cmd.value;
                await modbusClient.writeCoil(cmd.address, Boolean(writeValue));
                console.log(`Wrote coil at ${cmd.address} with value ${writeValue}`);
                await this.delay(100);
            } catch (error) {
                console.error(`Error executing modbus coil command ${cmd.key}: ${(error as Error).message}`);
            }
        }
    }

    /**
     * Xác thực việc ghi modbus
     */
    async verifyModbusWrite(modbusClient: ModbusClientCore, commands: ModbusCmd[]): Promise<boolean> {
        for (const cmd of commands) {
            try {
                let readResult: { data: any[] };
                let readValue: number | boolean;

                if (cmd.fc === 5) {
                    readResult = await modbusClient.readCoils(cmd.address, 1);
                    readValue = Boolean(readResult.data[0]);
                } else if (cmd.fc === 6) {
                    readResult = await modbusClient.readHoldingRegisters(cmd.address, 1);
                    // Đọc giá trị thô và scale nếu có config cho 'read'
                    const rawValue = Number(readResult.data[0]);
                    readValue = this.scaleValue(cmd.key, rawValue, 'read');
                } else {
                    continue;
                }

                // So sánh với giá trị gốc (cmd.value)
                console.log(`Verifying ${cmd.key}: readValue = ${readValue} (${typeof readValue}), expected = ${cmd.value} (${typeof cmd.value})`);

                if (readValue !== cmd.value) {
                    console.warn(`Verification failed for ${cmd.key} at ${cmd.address}: expected ${cmd.value}, got ${readValue}`);
                    return false;
                }
                console.log(`Verified ${cmd.key} at ${cmd.address} successfully`);
            } catch (error) {
                console.error(`Error verifying modbus write for ${cmd.key}: ${(error as Error).message}`);
                return false;
            }
        }
        return true;
    }

    /**
     * Publish thông báo qua MQTT
     */
    async publishMqttNotification(mqttClient: MqttClientCore, schedule: TabiotSchedule, success: boolean): Promise<void> {
        try {
            const active_schedule = {
                scheduleId: schedule.name,
                label: schedule.label,
                device_label: schedule.device_label,
                status: schedule.status,
                timestamp: Date.now(),
            };
            const payload = { "active_schedule": JSON.stringify(active_schedule) };
            const topic = "v1/devices/me/telemetry";
            await mqttClient.publish(topic, JSON.stringify(payload));
            console.log(`Published MQTT notification for ${schedule.name}`);
        } catch (error) {
            console.error(`Error publishing MQTT for ${schedule.name}: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Sync schedule log
     */
    async syncScheduleLog(schedule: TabiotSchedule, success: boolean): Promise<void> {
        try {
            console.log(`Sync schedule log for ${schedule.name}: status ${success ? "executed" : "error"}, timestamp ${Date.now()}`);

            if (this.syncScheduleService) {
                // Assuming schedule.start_time and schedule.end_time are in a time-only format like "HH:mm"
                const now = moment(); // Current date and time
                const todayDate = now.format('YYYY-MM-DD'); // Just the date portion

                // Combine today's date with the schedule times and format as full datetime
                const startTime = moment(`${todayDate} ${schedule.start_time}`, 'YYYY-MM-DD HH:mm')
                    .toISOString();
                const endTime = moment(`${todayDate} ${schedule.end_time}`, 'YYYY-MM-DD HH:mm')
                    .toISOString();

                const scheduleLogBody: TabiotScheduleLog = {
                    start_time: startTime,
                    end_time: endTime,
                    schedule_id: schedule.name,
                    deleted: null
                };

                await this.syncScheduleService.logSchedule(scheduleLogBody);
                console.log(`Logged schedule ${schedule.name} successfully`);
            } else {
                console.warn("SyncScheduleService is not available, skipping log");
            }
        } catch (error) {
            console.error(`Error syncing log for ${schedule.name}: ${(error as Error).message}`);
        }
    }

    /**
     * Cập nhật trạng thái của schedule
     */
    async updateScheduleStatus(schedule: TabiotSchedule, status: "running" | "finished"): Promise<void> {
        try {
            if (!AppDataSource.isInitialized) {
                console.log("Initializing AppDataSource...");
                await AppDataSource.initialize();
                console.log("AppDataSource initialized successfully");
            }
            const repository = AppDataSource.getRepository(TabiotSchedule);

            // Cập nhật trạng thái
            schedule.status = status;

            // Override giá trị modified, cộng thêm 7 giờ
            const nowPlus7 = moment().utc().add(7, 'hours').toDate();
            schedule.modified = nowPlus7;

            // Lưu entity với giá trị modified đã chỉnh sửa
            await repository.save(schedule);
            console.log(`Updated status of ${schedule.name} to ${status} with modified time ${schedule.modified}`);

            if (this.syncScheduleService) {
                await this.syncScheduleService.syncScheduleFromLocalToServer([schedule]);
                console.log(`Synced ${schedule.name} to server`);
            } else {
                console.warn("SyncScheduleService is not available, skipping sync");
            }
        } catch (error) {
            console.error(`Error updating status for ${schedule.name}: ${(error as Error).message}`);
        }
    }

    /**
     * Reset lại các lệnh modbus
     */
    async resetModbusCommands(modbusClient: ModbusClientCore, commands: ModbusCmd[]): Promise<void> {
        // Reset chỉ các địa chỉ đã ghi lúc running
        for (const cmd of commands) {
            try {
                if (cmd.fc === 5) {
                    await modbusClient.writeCoil(cmd.address, false);
                    console.log(`Reset coil at ${cmd.address} to false`);
                } else if (cmd.fc === 6) {
                    await modbusClient.writeRegister(cmd.address, 0);
                    console.log(`Reset register at ${cmd.address} to 0`);
                }
                await this.delay(100);
            } catch (error) {
                console.error(`Error resetting modbus command ${cmd.key}: ${(error as Error).message}`);
            }
        }
    }

    delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}