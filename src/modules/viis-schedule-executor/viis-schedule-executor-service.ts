import Container, { Service } from "typedi";
import { TabiotSchedule } from "../../orm/entities/schedule/TabiotSchedule";
import moment from "moment";
import { ModbusClientCore } from "../../core/modbus-client";
import { MqttClientCore } from "../../core/mqtt-client";
import { AppDataSource } from "../../orm/dataSource";
import { MySqlClientCore } from "../../core/mysql-client";
import { SyncScheduleService } from "../../services/syncSchedule/SyncScheduleService";

export interface ModbusCmd {
    key: string;
    value: number | boolean;
    fc: number;
    unitid: number;
    address: number;
    quantity: number;
}

@Service()
export class ScheduleService {

    private syncScheduleService: SyncScheduleService
    constructor() {
        this.syncScheduleService = Container.get(SyncScheduleService)
    }
    /**
     * Lấy danh sách schedule từ DB
     */
    async getDueSchedules(): Promise<TabiotSchedule[]> {
        if (!AppDataSource.isInitialized) {
            await AppDataSource.initialize();
        }
        const repository = AppDataSource.getRepository(TabiotSchedule);
        // Ví dụ: chỉ lấy các schedule enable, chưa bị xóa và plan cũng enable.
        const schedules = await repository.createQueryBuilder("schedule")
            .leftJoin("tabiot_device", "device", "schedule.device_id = device.id")
            .leftJoin("schedule.schedulePlan", "schedulePlan") // Join với bảng schedulePlan qua relation
            .addSelect("device.label", "device_label")
            .where("schedule.enable = :enable", { enable: 1 })
            .andWhere("schedulePlan.enable = :planEnable", { planEnable: 1 }) // Thêm điều kiện plan enable
            .getMany();
        return schedules;
    }

    /**
     * Kiểm tra xem schedule có đang trong khung thời gian thực thi hay không
     * (dựa trên start_time và end_time, định dạng HH:mm:ss, UTC+7)
     */
    isScheduleDue(schedule: TabiotSchedule): boolean {
        if (!schedule.start_time || !schedule.end_time) {
            return false;
        }
        const now = moment().utcOffset(420);
        const startTime = moment(schedule.start_time, "HH:mm:ss");
        const endTime = moment(schedule.end_time, "HH:mm:ss");
        // Sử dụng khoảng thời gian bao gồm cả biên
        return now.isBetween(startTime, endTime, undefined, '[]');
    }

    /**
     * Map schedule (dựa trên trường action) thành danh sách các lệnh modbus.
     * Mapping được thực hiện dựa vào các biến môi trường MODBUS_COILS và MODBUS_HOLDING_REGISTERS.
     */
    mapScheduleToModbus(schedule: TabiotSchedule): ModbusCmd[] {
        const commands: ModbusCmd[] = [];
        if (schedule.action) {
            try {
                const actionObj = JSON.parse(schedule.action);
                const modbusCoils = JSON.parse(process.env.MODBUS_COILS || "{}");
                const modbusHolding = JSON.parse(process.env.MODBUS_HOLDING_REGISTERS || "{}");
                for (const key in actionObj) {
                    if (actionObj.hasOwnProperty(key)) {
                        const value = actionObj[key];
                        if (modbusCoils.hasOwnProperty(key)) {
                            commands.push({
                                key,
                                value: Boolean(value),
                                fc: 5, // Coil write
                                unitid: 1,
                                address: modbusCoils[key],
                                quantity: 1
                            });
                        } else if (modbusHolding.hasOwnProperty(key)) {
                            commands.push({
                                key,
                                value: Number(value),
                                fc: 6, // Holding register write
                                unitid: 1,
                                address: modbusHolding[key],
                                quantity: 1
                            });
                        } else {
                            console.warn(`No modbus mapping found for key: ${key}`);
                        }
                    }
                }
            } catch (error) {
                throw new Error(`Error parsing action for schedule ${schedule.name}: ${(error as Error).message}`);
            }
        }
        return commands;
    }

    /**
     * Gửi các lệnh modbus qua modbusClient.
     */
    async executeModbusCommands(modbusClient: ModbusClientCore, commands: ModbusCmd[]): Promise<void> {
        for (const cmd of commands) {
            if (cmd.fc === 5) {
                await modbusClient.writeCoil(cmd.address, Boolean(cmd.value));
            } else if (cmd.fc === 6) {
                await modbusClient.writeRegister(cmd.address, Number(cmd.value));
            }
            await this.delay(100);
        }
    }

    /**
     * Xác thực việc ghi modbus bằng cách đọc lại giá trị.
     */
    async verifyModbusWrite(modbusClient: ModbusClientCore, commands: ModbusCmd[]): Promise<boolean> {
        for (const cmd of commands) {
            let readResult: { data: any[] };
            if (cmd.fc === 5) {
                readResult = await modbusClient.readCoils(cmd.address, 1);
                if (Boolean(readResult.data[0]) !== Boolean(cmd.value)) {
                    return false;
                }
            } else if (cmd.fc === 6) {
                readResult = await modbusClient.readHoldingRegisters(cmd.address, 1);
                if (Number(readResult.data[0]) !== Number(cmd.value)) {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * Publish thông báo qua MQTT với payload gồm scheduleId, status, và timestamp.
     */
    publishMqttNotification(mqttClient: MqttClientCore, schedule: TabiotSchedule, success: boolean): void {
        const payload = {
            scheduleId: schedule.name,
            label: schedule.label,
            device_label: schedule.device_label,
            status: schedule.status,
            timestamp: Date.now()
        };
        const topic = "v1/devices/me/telemetry";
        mqttClient.publish(topic, JSON.stringify(payload));
    }

    /**
     * Sync schedule log (có thể gọi API hoặc update DB).
     * Ở đây demo bằng console.log; bạn có thể thay thế bằng HTTP call (sử dụng HttpService).
     */
    async syncScheduleLog(schedule: TabiotSchedule, success: boolean): Promise<void> {
        console.log(`Sync schedule log for schedule ${schedule.name}: status ${success ? "executed" : "error"}, timestamp ${Date.now()}`);
        // TODO: Thực hiện HTTP call hoặc update DB theo nghiệp vụ của bạn.
        await this.syncScheduleService.logSchedule(schedule)
    }

    /**
     * Cập nhật trạng thái của schedule (running hoặc finished) trong DB.
     */
    async updateScheduleStatus(schedule: TabiotSchedule, status: "running" | "finished"): Promise<void> {
        if (!AppDataSource.isInitialized) {
            await AppDataSource.initialize();
        }
        const repository = AppDataSource.getRepository(TabiotSchedule);
        schedule.status = status;
        await repository.save(schedule);
        await this.syncScheduleService.syncLocalToServer(schedule)
    }

    /**
     * Reset lại các lệnh modbus đã được thực thi sang giá trị falsey:
     * - Với coil (fc=5): giá trị false.
     * - Với holding register (fc=6): giá trị 0.
     */
    async resetModbusCommands(modbusClient: ModbusClientCore, commands: ModbusCmd[]): Promise<void> {
        for (const cmd of commands) {
            if (cmd.fc === 5) {
                await modbusClient.writeCoil(cmd.address, false);
            } else if (cmd.fc === 6) {
                await modbusClient.writeRegister(cmd.address, 0);
            }
            await this.delay(100);
        }
    }

    delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
