"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
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
exports.ScheduleService = void 0;
const TabiotSchedule_1 = require("../../orm/entities/schedule/TabiotSchedule");
const moment_1 = __importDefault(require("moment"));
const dataSource_1 = require("../../orm/dataSource");
const SyncScheduleService_1 = require("../../services/syncSchedule/SyncScheduleService");
const typedi_1 = __importStar(require("typedi"));
// require('dotenv').config();
let ScheduleService = class ScheduleService {
    constructor(node) {
        this.node = node; // Lưu node để truy cập global context
        try {
            this.syncScheduleService = typedi_1.default.get(SyncScheduleService_1.SyncScheduleService);
            console.log("SyncScheduleService initialized successfully");
        }
        catch (error) {
            console.error(`Failed to initialize SyncScheduleService: ${error.message}`);
            this.syncScheduleService = undefined;
        }
    }
    // Hàm scaleValue trả về giá trị đã scale hoặc giá trị gốc nếu không có config
    scaleValue(key, value, direction) {
        var _a;
        const scaleConfigs = ((_a = this.node) === null || _a === void 0 ? void 0 : _a.context().global.get("scaleConfigs")) || [];
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
    getDueSchedules() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (!dataSource_1.AppDataSource.isInitialized) {
                    console.log("Initializing AppDataSource...");
                    yield dataSource_1.AppDataSource.initialize();
                    console.log("AppDataSource initialized successfully");
                }
                const repository = dataSource_1.AppDataSource.getRepository(TabiotSchedule_1.TabiotSchedule);
                const schedules = yield repository
                    .createQueryBuilder("schedule")
                    .leftJoin("tabiot_device", "device", "schedule.device_id = device.name")
                    .leftJoin("schedule.schedulePlan", "schedulePlan")
                    .addSelect("device.label", "device_label")
                    .where("schedule.enable = :enable", { enable: 1 })
                    .andWhere("schedulePlan.enable = :planEnable", { planEnable: 1 })
                    .andWhere("schedule.is_deleted = :isDeleted", { isDeleted: 0 })
                    .printSql()
                    .getMany();
                // console.log(`schedules sql: ${JSON.stringify(schedules)}`)
                console.log(`Retrieved ${schedules.length} schedules from DB`);
                return schedules;
            }
            catch (error) {
                console.error(`Error in getDueSchedules: ${error.message}`);
                return []; // Trả về mảng rỗng thay vì throw lỗi
            }
        });
    }
    /**
     * Kiểm tra xem schedule có đang trong khung thời gian thực thi hay không
     */
    isScheduleDue(schedule) {
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
            const now = (0, moment_1.default)().utc().add(7, 'hours');
            const today = now.clone().startOf('day');
            // Kiểm tra phạm vi start_date và end_date nếu có
            if (schedule.start_date && schedule.end_date) {
                const startDate = (0, moment_1.default)(schedule.start_date, "YYYY-MM-DD");
                const endDate = (0, moment_1.default)(schedule.end_date, "YYYY-MM-DD");
                if (!now.isBetween(startDate, endDate, 'day', '[]')) {
                    console.log(`Schedule ${schedule.name} is outside enabled range (${startDate.format('YYYY-MM-DD')} - ${endDate.format('YYYY-MM-DD')})`);
                    return false;
                }
            }
            // Parse start_time và end_time từ chuỗi HH:mm:ss
            const startTime = (0, moment_1.default)(schedule.start_time, "HH:mm:ss");
            const endTime = (0, moment_1.default)(schedule.end_time, "HH:mm:ss");
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
                }
                else {
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
        }
        catch (error) {
            console.error(`Error in isScheduleDue for ${schedule.name}: ${error.message}`);
            return false;
        }
    }
    /**
 * Map schedule thành danh sách các lệnh modbus
 */
    mapScheduleToModbus(schedule) {
        const holdingCommands = [];
        const coilCommands = [];
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
                        }
                        else if (value.toLowerCase() === "false") {
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
                        }
                        else if (modbusCoils.hasOwnProperty(key)) {
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
                        else {
                            console.warn(`No modbus mapping found for key: ${key} in schedule ${schedule.name}`);
                        }
                    }
                }
            }
        }
        catch (error) {
            console.error(`Error parsing action for schedule ${schedule.name}: ${error.message}`);
        }
        return { holdingCommands, coilCommands };
    }
    /**
 * Gửi các lệnh modbus qua modbusClient
 */
    executeModbusCommands(modbusClient, commands) {
        return __awaiter(this, void 0, void 0, function* () {
            // Thực hiện holding commands trước
            for (const cmd of commands.holdingCommands) {
                try {
                    let writeValue = this.scaleValue(cmd.key, cmd.value, 'write'); // Scale nếu có config
                    yield modbusClient.writeRegister(cmd.address, Number(writeValue));
                    console.log(`Wrote register at ${cmd.address} with scaled value ${writeValue}`);
                    yield this.delay(100);
                }
                catch (error) {
                    console.error(`Error executing modbus holding command ${cmd.key}: ${error.message}`);
                }
            }
            // Sau đó thực hiện coil commands
            for (const cmd of commands.coilCommands) {
                try {
                    let writeValue = cmd.value;
                    yield modbusClient.writeCoil(cmd.address, Boolean(writeValue));
                    console.log(`Wrote coil at ${cmd.address} with value ${writeValue}`);
                    yield this.delay(100);
                }
                catch (error) {
                    console.error(`Error executing modbus coil command ${cmd.key}: ${error.message}`);
                }
            }
        });
    }
    /**
     * Xác thực việc ghi modbus
     */
    verifyModbusWrite(modbusClient, commands) {
        return __awaiter(this, void 0, void 0, function* () {
            for (const cmd of commands) {
                try {
                    let readResult;
                    let readValue;
                    if (cmd.fc === 5) {
                        readResult = yield modbusClient.readCoils(cmd.address, 1);
                        readValue = Boolean(readResult.data[0]);
                    }
                    else if (cmd.fc === 6) {
                        readResult = yield modbusClient.readHoldingRegisters(cmd.address, 1);
                        // Đọc giá trị thô và scale nếu có config cho 'read'
                        const rawValue = Number(readResult.data[0]);
                        readValue = this.scaleValue(cmd.key, rawValue, 'read');
                    }
                    else {
                        continue;
                    }
                    // So sánh với giá trị gốc (cmd.value)
                    console.log(`Verifying ${cmd.key}: readValue = ${readValue} (${typeof readValue}), expected = ${cmd.value} (${typeof cmd.value})`);
                    if (readValue !== cmd.value) {
                        console.warn(`Verification failed for ${cmd.key} at ${cmd.address}: expected ${cmd.value}, got ${readValue}`);
                        return false;
                    }
                    console.log(`Verified ${cmd.key} at ${cmd.address} successfully`);
                }
                catch (error) {
                    console.error(`Error verifying modbus write for ${cmd.key}: ${error.message}`);
                    return false;
                }
            }
            return true;
        });
    }
    /**
     * Publish thông báo qua MQTT
     */
    publishMqttNotification(mqttClient, schedule, success) {
        return __awaiter(this, void 0, void 0, function* () {
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
                yield mqttClient.publish(topic, JSON.stringify(payload));
                console.log(`Published MQTT notification for ${schedule.name}`);
            }
            catch (error) {
                console.error(`Error publishing MQTT for ${schedule.name}: ${error.message}`);
                throw error;
            }
        });
    }
    /**
     * Sync schedule log
     */
    syncScheduleLog(schedule, success) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                console.log(`Sync schedule log for ${schedule.name}: status ${success ? "executed" : "error"}, timestamp ${Date.now()}`);
                if (this.syncScheduleService) {
                    // Assuming schedule.start_time and schedule.end_time are in a time-only format like "HH:mm"
                    const now = (0, moment_1.default)(); // Current date and time
                    const todayDate = now.format('YYYY-MM-DD'); // Just the date portion
                    // Combine today's date with the schedule times and format as full datetime
                    const startTime = (0, moment_1.default)(`${todayDate} ${schedule.start_time}`, 'YYYY-MM-DD HH:mm')
                        .toISOString();
                    const endTime = (0, moment_1.default)(`${todayDate} ${schedule.end_time}`, 'YYYY-MM-DD HH:mm')
                        .toISOString();
                    const scheduleLogBody = {
                        start_time: startTime,
                        end_time: endTime,
                        schedule_id: schedule.name,
                        deleted: null
                    };
                    yield this.syncScheduleService.logSchedule(scheduleLogBody);
                    console.log(`Logged schedule ${schedule.name} successfully`);
                }
                else {
                    console.warn("SyncScheduleService is not available, skipping log");
                }
            }
            catch (error) {
                console.error(`Error syncing log for ${schedule.name}: ${error.message}`);
            }
        });
    }
    /**
     * Cập nhật trạng thái của schedule
     */
    updateScheduleStatus(schedule, status) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (!dataSource_1.AppDataSource.isInitialized) {
                    console.log("Initializing AppDataSource...");
                    yield dataSource_1.AppDataSource.initialize();
                    console.log("AppDataSource initialized successfully");
                }
                const repository = dataSource_1.AppDataSource.getRepository(TabiotSchedule_1.TabiotSchedule);
                // Cập nhật trạng thái
                schedule.status = status;
                // Override giá trị modified, cộng thêm 7 giờ
                const nowPlus7 = (0, moment_1.default)().utc().add(7, 'hours').toDate();
                schedule.modified = nowPlus7;
                // Lưu entity với giá trị modified đã chỉnh sửa
                yield repository.save(schedule);
                console.log(`Updated status of ${schedule.name} to ${status} with modified time ${schedule.modified}`);
                if (this.syncScheduleService) {
                    yield this.syncScheduleService.syncScheduleFromLocalToServer([schedule]);
                    console.log(`Synced ${schedule.name} to server`);
                }
                else {
                    console.warn("SyncScheduleService is not available, skipping sync");
                }
            }
            catch (error) {
                console.error(`Error updating status for ${schedule.name}: ${error.message}`);
            }
        });
    }
    /**
     * Reset lại các lệnh modbus
     */
    resetModbusCommands(modbusClient, commands) {
        return __awaiter(this, void 0, void 0, function* () {
            // Reset chỉ các địa chỉ đã ghi lúc running
            for (const cmd of commands) {
                try {
                    if (cmd.fc === 5) {
                        yield modbusClient.writeCoil(cmd.address, false);
                        console.log(`Reset coil at ${cmd.address} to false`);
                    }
                    else if (cmd.fc === 6) {
                        yield modbusClient.writeRegister(cmd.address, 0);
                        console.log(`Reset register at ${cmd.address} to 0`);
                    }
                    yield this.delay(100);
                }
                catch (error) {
                    console.error(`Error resetting modbus command ${cmd.key}: ${error.message}`);
                }
            }
        });
    }
    /**
         * Check if commands can be executed without overlapping with active commands
         */
    canExecuteCommands(currentScheduleId, holdingCommands, coilCommands) {
        return __awaiter(this, void 0, void 0, function* () {
            const activeModbusCommands = this.node.context().global.get("activeModbusCommands") || {};
            const allCommands = [...holdingCommands, ...coilCommands];
            for (const cmd of allCommands) {
                // Kiểm tra overlap với các schedule khác, bỏ qua schedule hiện tại
                for (const scheduleId in activeModbusCommands) {
                    if (scheduleId === currentScheduleId)
                        continue;
                    const activeCmds = activeModbusCommands[scheduleId];
                    if (activeCmds.some(ac => ac.address === cmd.address && ac.fc === cmd.fc)) {
                        console.warn(`Command overlap detected with schedule ${scheduleId} at address ${cmd.address} (fc: ${cmd.fc})`);
                        return false;
                    }
                }
            }
            return true;
        });
    }
    reExecuteAfterPowerLoss(modbusClient, schedule) {
        return __awaiter(this, void 0, void 0, function* () {
            const activeCommands = this.getActiveCommands(schedule.name);
            if (activeCommands.length === 0) {
                console.log(`No active commands stored for schedule ${schedule.name}, mapping anew`);
                const { holdingCommands, coilCommands } = this.mapScheduleToModbus(schedule);
                this.storeActiveCommands(schedule.name, [...holdingCommands, ...coilCommands]);
                yield this.executeModbusCommands(modbusClient, { holdingCommands, coilCommands });
                return true;
            }
            // Lấy manualOverrides từ global context
            const manualOverrides = this.node.context().global.get("manualModbusOverrides") || {};
            // Lọc các lệnh không bị override riêng lẻ
            const holdingCommandsToExecute = activeCommands.filter(cmd => cmd.fc === 6 && !manualOverrides[`${cmd.address}-${cmd.fc}`]);
            const coilCommandsToExecute = activeCommands.filter(cmd => cmd.fc === 5 && !manualOverrides[`${cmd.address}-${cmd.fc}`]);
            // Nếu tất cả các lệnh đều bị override, thì không thực thi re-execute
            if (holdingCommandsToExecute.length === 0 && coilCommandsToExecute.length === 0) {
                console.warn(`All active commands for schedule ${schedule.name} are overridden. Skipping re-execution.`);
                return false;
            }
            console.log(`Re-executing commands for schedule ${schedule.name} after power loss for non-overridden keys`);
            yield this.executeModbusCommands(modbusClient, {
                holdingCommands: holdingCommandsToExecute,
                coilCommands: coilCommandsToExecute
            });
            return true;
        });
    }
    /**
     * Store executed commands in global context
     */
    storeActiveCommands(scheduleId, commands) {
        const activeModbusCommands = this.node.context().global.get("activeModbusCommands") || {};
        activeModbusCommands[scheduleId] = commands;
        this.node.context().global.set("activeModbusCommands", activeModbusCommands);
        console.log(`Stored active commands for schedule ${scheduleId}: ${JSON.stringify(commands)}`);
    }
    /**
     * Retrieve active commands for a schedule
     */
    getActiveCommands(scheduleId) {
        const activeModbusCommands = this.node.context().global.get("activeModbusCommands") || {};
        return activeModbusCommands[scheduleId] || [];
    }
    /**
     * Clear active commands for a schedule
     */
    clearActiveCommands(scheduleId) {
        const activeModbusCommands = this.node.context().global.get("activeModbusCommands") || {};
        delete activeModbusCommands[scheduleId];
        this.node.context().global.set("activeModbusCommands", activeModbusCommands);
        console.log(`Cleared active commands for schedule ${scheduleId}`);
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
};
exports.ScheduleService = ScheduleService;
exports.ScheduleService = ScheduleService = __decorate([
    (0, typedi_1.Service)(),
    __metadata("design:paramtypes", [Object])
], ScheduleService);
