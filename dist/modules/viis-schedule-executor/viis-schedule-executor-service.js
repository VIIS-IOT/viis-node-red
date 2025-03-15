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
require('dotenv').config();
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
            const now = (0, moment_1.default)().utc().add(7, 'hours');
            const startTime = (0, moment_1.default)(schedule.start_time, "HH:mm:ss");
            const endTime = (0, moment_1.default)(schedule.end_time, "HH:mm:ss");
            const isDue = now.isBetween(startTime, endTime, undefined, "[]");
            console.log({ now, startTime, endTime, isDue });
            console.log(`Schedule ${schedule.name} isDue: ${isDue}`);
            return isDue;
        }
        catch (error) {
            console.error(`Error in isScheduleDue for ${schedule.name}: ${error.message}`);
            return false; // Trả về false nếu có lỗi
        }
    }
    /**
     * Map schedule thành danh sách các lệnh modbus
     */
    mapScheduleToModbus(schedule) {
        const commands = [];
        if (!schedule.action) {
            console.warn(`Schedule ${schedule.name} has no action defined`);
            return commands;
        }
        try {
            const actionObj = JSON.parse(schedule.action);
            const modbusCoils = JSON.parse(process.env.MODBUS_COILS || "{}");
            const modbusHolding = JSON.parse(process.env.MODBUS_HOLDING_REGISTERS || "{}");
            // console.log("actionObj", actionObj, "for schedule", schedule.label);
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
                        if (modbusCoils.hasOwnProperty(key)) {
                            commands.push({
                                key,
                                value: Boolean(value),
                                fc: 5,
                                unitid: 1,
                                address: modbusCoils[key],
                                quantity: 1,
                            });
                            // console.log(`Mapped ${key} to coil at address ${modbusCoils[key]}`);
                        }
                        else if (modbusHolding.hasOwnProperty(key)) {
                            commands.push({
                                key,
                                value: Number(value),
                                fc: 6,
                                unitid: 1,
                                address: modbusHolding[key],
                                quantity: 1,
                            });
                            console.log(`Mapped ${key} to holding register at address ${modbusHolding[key]}`);
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
        return commands;
    }
    /**
     * Gửi các lệnh modbus qua modbusClient
     */
    executeModbusCommands(modbusClient, commands) {
        return __awaiter(this, void 0, void 0, function* () {
            for (const cmd of commands) {
                try {
                    let writeValue = cmd.value;
                    if (typeof cmd.value === 'number') {
                        writeValue = this.scaleValue(cmd.key, cmd.value, 'write'); // Scale nếu có config
                    }
                    if (cmd.fc === 5) {
                        yield modbusClient.writeCoil(cmd.address, Boolean(writeValue));
                        console.log(`Wrote coil at ${cmd.address} with value ${writeValue}`);
                    }
                    else if (cmd.fc === 6) {
                        yield modbusClient.writeRegister(cmd.address, Number(writeValue));
                        console.log(`Wrote register at ${cmd.address} with scaled value ${writeValue}`);
                    }
                    yield this.delay(100);
                }
                catch (error) {
                    console.error(`Error executing modbus command ${cmd.key}: ${error.message}`);
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
        try {
            const active_schedule = {
                scheduleId: schedule.name,
                label: schedule.label,
                device_label: schedule.device_label,
                status: schedule.status,
                timestamp: Date.now(),
            };
            const payload = {
                "active_schedule": JSON.stringify(active_schedule)
            };
            const topic = "v1/devices/me/telemetry";
            mqttClient.publish(topic, JSON.stringify(payload));
            console.log(`Published MQTT notification for ${schedule.name}`);
        }
        catch (error) {
            console.error(`Error publishing MQTT for ${schedule.name}: ${error.message}`);
        }
    }
    /**
     * Sync schedule log
     */
    syncScheduleLog(schedule, success) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                console.log(`Sync schedule log for ${schedule.name}: status ${success ? "executed" : "error"}, timestamp ${Date.now()}`);
                if (this.syncScheduleService) {
                    const scheduleLogBody = {
                        start_time: schedule.start_time,
                        end_time: schedule.end_time,
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
                schedule.status = status;
                yield repository.save(schedule);
                console.log(`Updated status of ${schedule.name} to ${status}`);
                if (this.syncScheduleService) {
                    yield this.syncScheduleService.syncLocalToServer(schedule);
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
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
};
exports.ScheduleService = ScheduleService;
exports.ScheduleService = ScheduleService = __decorate([
    (0, typedi_1.Service)(),
    __metadata("design:paramtypes", [Object])
], ScheduleService);
