import { TabiotSchedule, TabiotScheduleLog } from "../../orm/entities/schedule/TabiotSchedule";
import moment from "moment";
import { ModbusClientCore } from "../../core/modbus-client";
import { MqttClientCore } from "../../core/mqtt-client";
import { AppDataSource } from "../../orm/dataSource";
import { SyncScheduleService } from "../../services/syncSchedule/SyncScheduleService";
import Container, { Service } from "typedi";
import { Node } from "node-red";
import { ActiveModbusCommands, ManualModbusOverrides, ModbusCmd, ScaleConfig, ScheduleConfigValues, ConfigParameter } from "./type";
import { GlobalContextHelper } from "../../ultils/global-context-helper";

// require('dotenv').config();




@Service()
export class ScheduleService {
    private syncScheduleService: SyncScheduleService;
    private node: Node; // Thêm biến để giữ node từ Node-RED
    private globalHelper: GlobalContextHelper; // Thêm GlobalContextHelper

    constructor(node?: Node) { // Thêm tham số node vào constructor
        this.node = node; // Lưu node để truy cập global context
        this.globalHelper = node ? new GlobalContextHelper(node.context()) : null; // Khởi tạo GlobalContextHelper
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

            // Lấy device_id từ global variable
            const deviceId = this.globalHelper ? this.globalHelper.getEnvVar("DEVICE_ID", "") : (process.env.DEVICE_ID || "");
            if (!deviceId) {
                console.warn("No DEVICE_ID found in global variable, returning empty schedules");
                return [];
            }

            const repository = AppDataSource.getRepository(TabiotSchedule);
            const schedules = await repository
                .createQueryBuilder("schedule")
                .leftJoin("tabiot_device", "device", "schedule.device_id = device.name")
                .leftJoin("schedule.schedulePlan", "schedulePlan")
                .addSelect("device.label", "device_label")
                .where("schedule.enable = :enable", { enable: 1 })
                .andWhere("schedulePlan.enable = :planEnable", { planEnable: 1 })
                .andWhere("schedule.is_deleted = :isDeleted", { isDeleted: 0 })
                .andWhere("schedule.device_id = :deviceId", { deviceId: deviceId })
                .printSql()
                .getMany();
            // console.log(`schedules sql: ${JSON.stringify(schedules)}`)
            console.log(`Retrieved ${schedules.length} schedules from DB for device_id: ${deviceId}`);
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

            if (schedule.enable !== 1) {
                console.log(`Schedule ${schedule.name} is not enabled`);
                return false;
            }

            // Lấy giờ hiện tại theo múi giờ UTC+7
            const now = moment().utc().add(7, 'hours');
            const today = now.clone().startOf('day');

            // Kiểm tra phạm vi start_date và end_date nếu có
            if (schedule.start_date && schedule.end_date) {
                const startDate = moment(schedule.start_date, "YYYY-MM-DD");
                const endDate = moment(schedule.end_date, "YYYY-MM-DD");
                if (!now.isBetween(startDate, endDate, 'day', '[]')) {
                    console.log(`Schedule ${schedule.name} is outside enabled range (${startDate.format('YYYY-MM-DD')} - ${endDate.format('YYYY-MM-DD')})`);
                    return false;
                }
            }

            // Parse start_time và end_time từ chuỗi HH:mm:ss
            const startTime = moment(schedule.start_time, "HH:mm:ss");
            const endTime = moment(schedule.end_time, "HH:mm:ss");

            // Gán ngày cho startTime và endTime
            let startDateTime = today.clone().set({
                hour: startTime.hour(),
                minute: startTime.minute(),
                second: startTime.second(),
            });
            let endDateTime = today.clone().set({
                hour: endTime.hour(),
                minute: endTime.minute(),
                second: endTime.second(),
            });

            // Xử lý trường hợp qua ngày (cross-midnight)
            if (startDateTime.isAfter(endDateTime)) {
                if (now.isBefore(endDateTime)) {
                    // Nếu giờ hiện tại nằm sau nửa đêm nhưng trước endTime, nghĩa là schedule đã bắt đầu từ ngày hôm trước.
                    startDateTime.subtract(1, 'day');
                } else {
                    // Nếu giờ hiện tại sau giờ startTime, thì endTime nằm vào ngày hôm sau.
                    endDateTime.add(1, 'day');
                }
            }

            // Kiểm tra xem giờ hiện tại có nằm trong khoảng startDateTime và endDateTime không
            const isDue = now.isBetween(startDateTime, endDateTime, undefined, "[]");
            console.log({
                now: now.format(),
                startDateTime: startDateTime.format(),
                endDateTime: endDateTime.format(),
                isDue,
            });
            console.log(`Schedule ${schedule.name} isDue: ${isDue}`);
            return isDue;
        } catch (error) {
            console.error(`Error in isScheduleDue for ${schedule.name}: ${(error as Error).message}`);
            return false;
        }
    }


    /**
 * Map schedule thành danh sách các lệnh modbus và xử lý unmapped keys như config parameters
 */
    mapScheduleToModbus(schedule: TabiotSchedule): { holdingCommands: ModbusCmd[], coilCommands: ModbusCmd[], configParameters: ConfigParameter[] } {
        const holdingCommands: ModbusCmd[] = [];
        const coilCommands: ModbusCmd[] = [];
        const configParameters: ConfigParameter[] = [];

        if (!schedule.action) {
            console.warn(`Schedule ${schedule.name} has no action defined`);
            return { holdingCommands, coilCommands, configParameters };
        }

        try {
            const actionObj = JSON.parse(schedule.action);
            // Thêm iri_time nếu chưa có
            if (!('iri_time' in actionObj)) {
                // Tính toán iri_time dựa trên start_time và end_time (đơn vị: giây)
                if (schedule.start_time && schedule.end_time) {
                    const startMoment = moment(schedule.start_time, "HH:mm:ss");
                    const endMoment = moment(schedule.end_time, "HH:mm:ss");
                    let diff = endMoment.diff(startMoment, 'seconds');
                    // Nếu end nhỏ hơn start (qua ngày), cộng thêm 24h
                    if (diff < 0) {
                        diff += 24 * 3600;
                    }
                    actionObj.iri_time = diff;
                } else {
                    actionObj.iri_time = null; // hoặc 0 tuỳ ý
                }
            }
            // Normalize string numbers (with comma/dot) to real numbers
            for (const key in actionObj) {
                if (actionObj.hasOwnProperty(key)) {
                    let val = actionObj[key];
                    if (typeof val === 'string') {
                        const trimmed = val.trim();
                        // Match e.g. "1,800.00", "1800", "1800.25"
                        if (/^-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(trimmed) || /^-?\d+(\.\d+)?$/.test(trimmed)) {
                            const num = parseFloat(trimmed.replace(/,/g, ''));
                            if (!isNaN(num)) {
                                actionObj[key] = num;
                            }
                        }
                    }
                }
            }
            const modbusCoils = this.globalHelper ? this.globalHelper.getJsonEnvVar("MODBUS_COILS", {}) : JSON.parse(process.env.MODBUS_COILS || "{}");
            const modbusHolding = this.globalHelper ? this.globalHelper.getJsonEnvVar("MODBUS_HOLDING_REGISTERS", {}) : JSON.parse(process.env.MODBUS_HOLDING_REGISTERS || "{}");

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

                    // Xử lý tất cả các key, không chỉ những key có giá trị truthy
                    if (modbusHolding.hasOwnProperty(key)) {
                        // Chỉ xử lý các key có giá trị truthy cho Modbus commands
                        if (value) {
                            holdingCommands.push({
                                key,
                                value: Number(value),
                                fc: 6,
                                unitid: 1,
                                address: modbusHolding[key],
                                quantity: 1,
                            });
                            console.log(`Mapped ${key} to holding register at address ${modbusHolding[key]}`);
                        }
                    } else if (modbusCoils.hasOwnProperty(key)) {
                        // Chỉ xử lý các key có giá trị truthy cho Modbus commands
                        if (value) {
                            coilCommands.push({
                                key,
                                value: Boolean(value),
                                fc: 5,
                                unitid: 1,
                                address: modbusCoils[key],
                                quantity: 1,
                            });
                            console.log(`Mapped ${key} to coil at address ${modbusCoils[key]}`);
                        }
                    } else {
                        // Xử lý unmapped keys như configuration parameters
                        console.warn(`No modbus mapping found for key: ${key} in schedule ${schedule.name}, storing as config parameter`);
                        try {
                            const configParam = this.storeConfigParameter(key, value, schedule.name);
                            configParameters.push(configParam);
                            console.log(`Successfully stored config parameter: ${key}=${configParam.value} (type: ${configParam.type})`);
                        } catch (error) {
                            console.error(`Failed to store config parameter ${key}: ${(error as Error).message}`);
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Error parsing action for schedule ${schedule.name}: ${(error as Error).message}`);
        }

        return { holdingCommands, coilCommands, configParameters };
    }


    /**
 * Gửi các lệnh modbus qua modbusClient
 */
    async executeModbusCommands(modbusClient: ModbusClientCore, commands: { holdingCommands: ModbusCmd[], coilCommands: ModbusCmd[] }, schedule?: TabiotSchedule): Promise<void> {
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

        // Phân loại coil commands
        const valveCoils = commands.coilCommands.filter(cmd => cmd.key.includes('valve_'));
        const controlCoils = commands.coilCommands.filter(cmd =>
            cmd.key.includes('pump') || cmd.key.includes('power'));
        const otherCoils = commands.coilCommands.filter(cmd =>
            !cmd.key.includes('valve_') && !cmd.key.includes('pump') && !cmd.key.includes('power'));

        // Xác định đang start hay finish dựa vào status của schedule
        const isStarting = schedule && schedule.status === 'running';
        const isFinishing = schedule && schedule.status === 'finished';

        if (isStarting) {
            // Khi start: ghi valve trước, delay 5s, sau đó ghi pump/power
            console.log(`Starting schedule ${schedule?.name}: executing valve coils first`);

            // Thực hiện valve coils trước
            for (const cmd of valveCoils) {
                try {
                    await modbusClient.writeCoil(cmd.address, Boolean(cmd.value));
                    console.log(`Wrote valve coil at ${cmd.address} with value ${cmd.value}`);
                    await this.delay(100);
                } catch (error) {
                    console.error(`Error executing modbus valve coil command ${cmd.key}: ${(error as Error).message}`);
                }
            }

            // Thực hiện other coils
            for (const cmd of otherCoils) {
                try {
                    await modbusClient.writeCoil(cmd.address, Boolean(cmd.value));
                    console.log(`Wrote other coil at ${cmd.address} with value ${cmd.value}`);
                    await this.delay(100);
                } catch (error) {
                    console.error(`Error executing modbus other coil command ${cmd.key}: ${(error as Error).message}`);
                }
            }

            // Delay 5 giây trước khi ghi các pump/power coils
            if (controlCoils.length > 0) {
                console.log('Delaying 5 seconds before writing pump/power coils');
                await this.delay(5000);

                // Thực hiện control coils (pump, power)
                for (const cmd of controlCoils) {
                    try {
                        await modbusClient.writeCoil(cmd.address, Boolean(cmd.value));
                        console.log(`Wrote control coil at ${cmd.address} with value ${cmd.value}`);
                        await this.delay(100);
                    } catch (error) {
                        console.error(`Error executing modbus control coil command ${cmd.key}: ${(error as Error).message}`);
                    }
                }
            }
        } else if (isFinishing) {
            // Khi finish: ghi tắt pump/power trước, delay 5s, sau đó tắt valve
            console.log(`Finishing schedule ${schedule?.name}: executing pump/power coils first`);

            // Thực hiện control coils (pump, power) trước
            for (const cmd of controlCoils) {
                try {
                    await modbusClient.writeCoil(cmd.address, Boolean(cmd.value));
                    console.log(`Wrote control coil at ${cmd.address} with value ${cmd.value}`);
                    await this.delay(100);
                } catch (error) {
                    console.error(`Error executing modbus control coil command ${cmd.key}: ${(error as Error).message}`);
                }
            }

            // Thực hiện other coils
            for (const cmd of otherCoils) {
                try {
                    await modbusClient.writeCoil(cmd.address, Boolean(cmd.value));
                    console.log(`Wrote other coil at ${cmd.address} with value ${cmd.value}`);
                    await this.delay(100);
                } catch (error) {
                    console.error(`Error executing modbus other coil command ${cmd.key}: ${(error as Error).message}`);
                }
            }

            // Delay 5 giây trước khi ghi các valve coils
            if (valveCoils.length > 0) {
                console.log('Delaying 5 seconds before writing valve coils');
                await this.delay(5000);

                // Thực hiện valve coils
                for (const cmd of valveCoils) {
                    try {
                        await modbusClient.writeCoil(cmd.address, Boolean(cmd.value));
                        console.log(`Wrote valve coil at ${cmd.address} with value ${cmd.value}`);
                        await this.delay(100);
                    } catch (error) {
                        console.error(`Error executing modbus valve coil command ${cmd.key}: ${(error as Error).message}`);
                    }
                }
            }
        } else {
            // Nếu không có schedule hoặc status không phải running/finished, thực hiện theo thứ tự thông thường
            console.log('Executing coil commands in default order');

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
     * Publish thông báo qua MQTT (ThingsBoard và EMQX local)
     */
    async publishMqttNotification(
        thingsboardClient: MqttClientCore,
        emqxClient: MqttClientCore,
        schedule: TabiotSchedule,
        success: boolean
    ): Promise<void> {
        try {
            const active_schedule = {
                scheduleId: schedule.name,
                label: schedule.label,
                device_label: schedule.device_label,
                status: schedule.status,
                start_time: schedule.start_time,
                end_time: schedule.end_time,
                timestamp: Date.now(),
            };
            const payload = { "active_schedule": JSON.stringify(active_schedule) };
            const payloadString = JSON.stringify(payload);

            // Publish to ThingsBoard
            const thingsboardTopic = "v1/devices/me/telemetry";
            await thingsboardClient.publish(thingsboardTopic, payloadString);
            console.log(`Published MQTT notification to ThingsBoard for ${schedule.name}`);

            // Publish to EMQX local
            const deviceId = this.globalHelper ? this.globalHelper.getEnvVar("DEVICE_ID", "unknown") : (process.env.DEVICE_ID || "unknown");
            const emqxTopic = `viis/things/v2/${deviceId}/telemetry`;
            await emqxClient.publish(emqxTopic, payloadString);
            console.log(`Published MQTT notification to EMQX local for ${schedule.name}`);

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
    async resetModbusCommands(modbusClient: ModbusClientCore, commands: ModbusCmd[], schedule?: TabiotSchedule): Promise<boolean> {
        let allSuccessful = true; // Initialize a flag to track overall success

        // Phân loại commands
        const valveCoils = commands.filter(cmd => cmd.fc === 5 && cmd.key.includes('valve_'));
        const controlCoils = commands.filter(cmd => cmd.fc === 5 &&
            (cmd.key.includes('pump') || cmd.key.includes('power')));
        const otherCoils = commands.filter(cmd => cmd.fc === 5 &&
            !cmd.key.includes('valve_') && !cmd.key.includes('pump') && !cmd.key.includes('power'));
        const holdingRegisters = commands.filter(cmd => cmd.fc === 6);

        // Reset holding registers
        for (const cmd of holdingRegisters) {
            try {
                await modbusClient.writeRegister(cmd.address, 0);
                console.log(`Reset register at ${cmd.address} to 0`);
                await this.delay(100);
            } catch (error) {
                console.error(`Error resetting modbus command ${cmd.key}: ${(error as Error).message}`);
                allSuccessful = false;
            }
        }

        // Khi finish schedule, luôn reset theo thứ tự: pump/power trước, sau đó đến valve
        if (schedule && schedule.status === 'finished') {
            console.log(`Ordered reset for finished schedule ${schedule.name}`);

            // Reset control coils (pump, power) trước
            for (const cmd of controlCoils) {
                try {
                    await modbusClient.writeCoil(cmd.address, false);
                    console.log(`Reset control coil at ${cmd.address} to false`);
                    await this.delay(100);
                } catch (error) {
                    console.error(`Error resetting modbus command ${cmd.key}: ${(error as Error).message}`);
                    allSuccessful = false;
                }
            }

            // Reset other coils
            for (const cmd of otherCoils) {
                try {
                    await modbusClient.writeCoil(cmd.address, false);
                    console.log(`Reset other coil at ${cmd.address} to false`);
                    await this.delay(100);
                } catch (error) {
                    console.error(`Error resetting modbus command ${cmd.key}: ${(error as Error).message}`);
                    allSuccessful = false;
                }
            }

            // Delay 5 giây trước khi reset valve coils
            if (valveCoils.length > 0) {
                console.log('Delaying 5 seconds before resetting valve coils');
                await this.delay(5000);

                // Reset valve coils
                for (const cmd of valveCoils) {
                    try {
                        await modbusClient.writeCoil(cmd.address, false);
                        console.log(`Reset valve coil at ${cmd.address} to false`);
                        await this.delay(100);
                    } catch (error) {
                        console.error(`Error resetting modbus command ${cmd.key}: ${(error as Error).message}`);
                        allSuccessful = false;
                    }
                }
            }
        } else {
            // Nếu không phải finishing schedule, reset theo thứ tự thông thường
            for (const cmd of commands.filter(cmd => cmd.fc === 5)) {
                try {
                    await modbusClient.writeCoil(cmd.address, false);
                    console.log(`Reset coil at ${cmd.address} to false`);
                    await this.delay(100);
                } catch (error) {
                    console.error(`Error resetting modbus command ${cmd.key}: ${(error as Error).message}`);
                    allSuccessful = false;
                }
            }
        }

        return allSuccessful;
    }



    /**
     * Check if commands can be executed without overlapping with active commands
     */
    async canExecuteCommands(currentScheduleId: string, holdingCommands: ModbusCmd[], coilCommands: ModbusCmd[]): Promise<boolean> {
        const activeModbusCommands: ActiveModbusCommands = this.node.context().global.get("activeModbusCommands") as ActiveModbusCommands || {};
        const allCommands = [...holdingCommands, ...coilCommands];

        for (const cmd of allCommands) {
            // Kiểm tra overlap với các schedule khác, bỏ qua schedule hiện tại
            for (const scheduleId in activeModbusCommands) {
                if (scheduleId === currentScheduleId) continue;
                const activeCmds: ModbusCmd[] = activeModbusCommands[scheduleId];
                if (activeCmds.some(ac => ac.address === cmd.address && ac.fc === cmd.fc)) {
                    console.warn(`Command overlap detected with schedule ${scheduleId} at address ${cmd.address} (fc: ${cmd.fc})`);
                    return false;
                }
            }
        }
        return true;
    }



    async reExecuteAfterPowerLoss(modbusClient: ModbusClientCore, schedule: TabiotSchedule): Promise<boolean> {
        const activeCommands = this.getActiveCommands(schedule.name);
        if (activeCommands.length === 0) {
            console.log(`No active commands stored for schedule ${schedule.name}, mapping anew`);
            const { holdingCommands, coilCommands, configParameters } = this.mapScheduleToModbus(schedule);
            this.storeActiveCommands(schedule.name, [...holdingCommands, ...coilCommands]);
            await this.executeModbusCommands(modbusClient, { holdingCommands, coilCommands });

            // Note: Config parameters are not re-published during power loss recovery
            // as they are already stored in global context
            if (configParameters && configParameters.length > 0) {
                console.log(`Found ${configParameters.length} config parameters during re-execution, already stored in context`);
            }

            return true;
        }

        // Lấy manualOverrides từ global context
        const manualOverrides: ManualModbusOverrides = this.node.context().global.get("manualModbusOverrides") as ManualModbusOverrides || {};

        // Lọc các lệnh không bị override riêng lẻ
        const holdingCommandsToCheck = activeCommands.filter(cmd => cmd.fc === 6 && !manualOverrides[`${cmd.address}-${cmd.fc}`]);
        const coilCommandsToCheck = activeCommands.filter(cmd => cmd.fc === 5 && !manualOverrides[`${cmd.address}-${cmd.fc}`]);

        // Nếu tất cả các lệnh đều bị override, thì không thực thi re-execute
        if (holdingCommandsToCheck.length === 0 && coilCommandsToCheck.length === 0) {
            console.warn(`All active commands for schedule ${schedule.name} are overridden. Skipping re-execution.`);
            return false;
        }

        // console.log(`Checking commands for schedule ${schedule.name} for non-overridden keys`);

        // Kiểm tra và thực thi holding commands
        const holdingCommandsToExecute: ModbusCmd[] = [];
        for (const cmd of holdingCommandsToCheck) {
            try {
                const readResult = await modbusClient.readHoldingRegisters(cmd.address, 1);
                const rawValue = Number(readResult.data[0]);
                const currentValue = this.scaleValue(cmd.key, rawValue, 'read');

                if (currentValue !== cmd.value) {
                    holdingCommandsToExecute.push(cmd);
                    console.log(`Holding register at ${cmd.address} needs update: current=${currentValue}, expected=${cmd.value}`);
                } else {
                    // console.log(`Holding register at ${cmd.address} already correct: ${currentValue}`);
                }
            } catch (error) {
                console.error(`Error reading holding register ${cmd.address}: ${(error as Error).message}`);
                holdingCommandsToExecute.push(cmd); // Nếu đọc lỗi, thêm vào để thử ghi lại
            }
        }

        // Kiểm tra và thực thi coil commands
        const coilCommandsToExecute: ModbusCmd[] = [];
        for (const cmd of coilCommandsToCheck) {
            try {
                const readResult = await modbusClient.readCoils(cmd.address, 1);
                const currentValue = Boolean(readResult.data[0]);

                if (currentValue !== cmd.value) {
                    coilCommandsToExecute.push(cmd);
                    console.log(`Coil at ${cmd.address} needs update: current=${currentValue}, expected=${cmd.value}`);
                } else {
                    // console.log(`Coil at ${cmd.address} already correct: ${currentValue}`);
                }
            } catch (error) {
                console.error(`Error reading coil ${cmd.address}: ${(error as Error).message}`);
                coilCommandsToExecute.push(cmd); // Nếu đọc lỗi, thêm vào để thử ghi lại
            }
        }

        // Nếu không có lệnh nào cần thực thi, trả về false ngay lập tức
        if (holdingCommandsToExecute.length === 0 && coilCommandsToExecute.length === 0) {
            // console.log(`All registers and coils for schedule ${schedule.name} are already in correct state. No re-execution needed.`);
            return false;
        }

        // Thực thi các lệnh cần cập nhật
        await this.executeModbusCommands(modbusClient, {
            holdingCommands: holdingCommandsToExecute,
            coilCommands: coilCommandsToExecute
        });

        // Xác minh lại sau khi ghi
        const writeSuccess = await this.verifyModbusWrite(modbusClient, [...holdingCommandsToExecute, ...coilCommandsToExecute]);
        if (writeSuccess) {
            console.log(`Successfully re-executed necessary commands for schedule ${schedule.name}`);
        } else {
            console.warn(`Failed to verify some commands for schedule ${schedule.name} after re-execution`);
        }

        return writeSuccess;
    }


    /**
     * Store executed commands in global context
     */
    storeActiveCommands(scheduleId: string, commands: ModbusCmd[]): void {
        const activeModbusCommands: ActiveModbusCommands = this.node.context().global.get("activeModbusCommands") as ActiveModbusCommands || {};
        activeModbusCommands[scheduleId] = commands;
        this.node.context().global.set("activeModbusCommands", activeModbusCommands);
        console.log(`Stored active commands for schedule ${scheduleId}: ${JSON.stringify(commands)}`);
    }

    /**
     * Retrieve active commands for a schedule
     */
    getActiveCommands(scheduleId: string): ModbusCmd[] {
        const activeModbusCommands: ActiveModbusCommands = this.node.context().global.get("activeModbusCommands") as ActiveModbusCommands || {};
        return activeModbusCommands[scheduleId] || [];
    }

    /**
     * Clear active commands for a schedule
     */
    clearActiveCommands(scheduleId: string): void {
        const activeModbusCommands: ActiveModbusCommands = this.node.context().global.get("activeModbusCommands") as ActiveModbusCommands || {};
        delete activeModbusCommands[scheduleId];
        this.node.context().global.set("activeModbusCommands", activeModbusCommands);
        console.log(`Cleared active commands for schedule ${scheduleId}`);
    }

    delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Validate and convert value for configuration parameters
     */
    private validateAndConvertValue(key: string, rawValue: any): any {
        // Handle null/undefined
        if (rawValue === null || rawValue === undefined) {
            return rawValue;
        }

        // Handle boolean strings
        if (typeof rawValue === "string") {
            const lowerValue = rawValue.toLowerCase().trim();
            if (lowerValue === "true") {
                return true;
            } else if (lowerValue === "false") {
                return false;
            }

            // Handle numeric strings
            const trimmed = rawValue.trim();
            if (/^-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(trimmed) || /^-?\d+(\.\d+)?$/.test(trimmed)) {
                const num = parseFloat(trimmed.replace(/,/g, ''));
                if (!isNaN(num)) {
                    return num;
                }
            }
        }

        // Handle numbers
        if (typeof rawValue === "number") {
            return rawValue;
        }

        // Handle booleans
        if (typeof rawValue === "boolean") {
            return rawValue;
        }

        // Default to string
        return String(rawValue);
    }

    /**
     * Auto-detect type for configuration parameter
     */
    private detectParameterType(value: any): 'number' | 'boolean' | 'string' {
        if (typeof value === "boolean") {
            return "boolean";
        } else if (typeof value === "number") {
            return "number";
        } else {
            return "string";
        }
    }

    /**
     * Get schedule configuration values from global context
     */
    private getScheduleConfigValues(): ScheduleConfigValues {
        return this.node?.context().global.get("scheduleConfigValues") as ScheduleConfigValues || {};
    }

    /**
     * Set schedule configuration values in global context
     */
    private setScheduleConfigValues(values: ScheduleConfigValues): void {
        this.node?.context().global.set("scheduleConfigValues", values);
        console.log(`Updated schedule config values: ${JSON.stringify(values)}`);
    }

    /**
     * Store configuration parameter
     */
    private storeConfigParameter(key: string, value: any, scheduleId: string): ConfigParameter {
        const validatedValue = this.validateAndConvertValue(key, value);
        const type = this.detectParameterType(validatedValue);

        const configParam: ConfigParameter = {
            key,
            value: validatedValue,
            type,
            timestamp: Date.now(),
            scheduleId
        };

        // Store in global context
        const currentConfig = this.getScheduleConfigValues();
        currentConfig[key] = validatedValue;
        this.setScheduleConfigValues(currentConfig);

        console.log(`Stored config parameter: ${key}=${validatedValue} (type: ${type}) for schedule ${scheduleId}`);
        return configParam;
    }

    /**
     * Publish configuration update via MQTT
     */
    async publishConfigUpdate(
        thingsboardClient: MqttClientCore,
        emqxClient: MqttClientCore,
        configParam: ConfigParameter
    ): Promise<void> {
        try {
            const payload = {
                ts: configParam.timestamp,
                [configParam.key]: configParam.value,
                note: `Config parameter updated (no Modbus mapping) for schedule ${configParam.scheduleId}`,
                type: configParam.type,
                source: "schedule-executor"
            };
            const payloadString = JSON.stringify(payload);

            // Publish to ThingsBoard
            const thingsboardTopic = "v1/devices/me/telemetry";
            await thingsboardClient.publish(thingsboardTopic, payloadString);
            console.log(`Published config update to ThingsBoard: ${configParam.key}=${configParam.value}`);

            // Publish to EMQX local
            const deviceId = this.globalHelper ? this.globalHelper.getEnvVar("DEVICE_ID", "unknown") : (process.env.DEVICE_ID || "unknown");
            const emqxTopic = `viis/things/v2/${deviceId}/telemetry`;
            await emqxClient.publish(emqxTopic, payloadString);
            console.log(`Published config update to EMQX local: ${configParam.key}=${configParam.value}`);

        } catch (error) {
            console.error(`Error publishing config update for ${configParam.key}: ${(error as Error).message}`);
            throw error;
        }
    }
}
