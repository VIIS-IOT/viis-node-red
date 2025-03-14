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
const typedi_1 = __importStar(require("typedi"));
const TabiotSchedule_1 = require("../../orm/entities/schedule/TabiotSchedule");
const moment_1 = __importDefault(require("moment"));
const dataSource_1 = require("../../orm/dataSource");
const SyncScheduleService_1 = require("../../services/syncSchedule/SyncScheduleService");
let ScheduleService = class ScheduleService {
    constructor() {
        this.syncScheduleService = typedi_1.default.get(SyncScheduleService_1.SyncScheduleService);
    }
    /**
     * Lấy danh sách schedule từ DB
     */
    getDueSchedules() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!dataSource_1.AppDataSource.isInitialized) {
                yield dataSource_1.AppDataSource.initialize();
            }
            const repository = dataSource_1.AppDataSource.getRepository(TabiotSchedule_1.TabiotSchedule);
            // Ví dụ: chỉ lấy các schedule enable, chưa bị xóa và plan cũng enable.
            const schedules = yield repository.createQueryBuilder("schedule")
                .leftJoin("tabiot_device", "device", "schedule.device_id = device.id")
                .leftJoin("schedule.schedulePlan", "schedulePlan") // Join với bảng schedulePlan qua relation
                .addSelect("device.label", "device_label")
                .where("schedule.enable = :enable", { enable: 1 })
                .andWhere("schedulePlan.enable = :planEnable", { planEnable: 1 }) // Thêm điều kiện plan enable
                .getMany();
            return schedules;
        });
    }
    /**
     * Kiểm tra xem schedule có đang trong khung thời gian thực thi hay không
     * (dựa trên start_time và end_time, định dạng HH:mm:ss, UTC+7)
     */
    isScheduleDue(schedule) {
        if (!schedule.start_time || !schedule.end_time) {
            return false;
        }
        const now = (0, moment_1.default)().utcOffset(420);
        const startTime = (0, moment_1.default)(schedule.start_time, "HH:mm:ss");
        const endTime = (0, moment_1.default)(schedule.end_time, "HH:mm:ss");
        // Sử dụng khoảng thời gian bao gồm cả biên
        return now.isBetween(startTime, endTime, undefined, '[]');
    }
    /**
     * Map schedule (dựa trên trường action) thành danh sách các lệnh modbus.
     * Mapping được thực hiện dựa vào các biến môi trường MODBUS_COILS và MODBUS_HOLDING_REGISTERS.
     */
    mapScheduleToModbus(schedule) {
        const commands = [];
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
                        }
                        else if (modbusHolding.hasOwnProperty(key)) {
                            commands.push({
                                key,
                                value: Number(value),
                                fc: 6, // Holding register write
                                unitid: 1,
                                address: modbusHolding[key],
                                quantity: 1
                            });
                        }
                        else {
                            console.warn(`No modbus mapping found for key: ${key}`);
                        }
                    }
                }
            }
            catch (error) {
                throw new Error(`Error parsing action for schedule ${schedule.name}: ${error.message}`);
            }
        }
        return commands;
    }
    /**
     * Gửi các lệnh modbus qua modbusClient.
     */
    executeModbusCommands(modbusClient, commands) {
        return __awaiter(this, void 0, void 0, function* () {
            for (const cmd of commands) {
                if (cmd.fc === 5) {
                    yield modbusClient.writeCoil(cmd.address, Boolean(cmd.value));
                }
                else if (cmd.fc === 6) {
                    yield modbusClient.writeRegister(cmd.address, Number(cmd.value));
                }
                yield this.delay(100);
            }
        });
    }
    /**
     * Xác thực việc ghi modbus bằng cách đọc lại giá trị.
     */
    verifyModbusWrite(modbusClient, commands) {
        return __awaiter(this, void 0, void 0, function* () {
            for (const cmd of commands) {
                let readResult;
                if (cmd.fc === 5) {
                    readResult = yield modbusClient.readCoils(cmd.address, 1);
                    if (Boolean(readResult.data[0]) !== Boolean(cmd.value)) {
                        return false;
                    }
                }
                else if (cmd.fc === 6) {
                    readResult = yield modbusClient.readHoldingRegisters(cmd.address, 1);
                    if (Number(readResult.data[0]) !== Number(cmd.value)) {
                        return false;
                    }
                }
            }
            return true;
        });
    }
    /**
     * Publish thông báo qua MQTT với payload gồm scheduleId, status, và timestamp.
     */
    publishMqttNotification(mqttClient, schedule, success) {
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
    syncScheduleLog(schedule, success) {
        return __awaiter(this, void 0, void 0, function* () {
            console.log(`Sync schedule log for schedule ${schedule.name}: status ${success ? "executed" : "error"}, timestamp ${Date.now()}`);
            // TODO: Thực hiện HTTP call hoặc update DB theo nghiệp vụ của bạn.
            yield this.syncScheduleService.logSchedule(schedule);
        });
    }
    /**
     * Cập nhật trạng thái của schedule (running hoặc finished) trong DB.
     */
    updateScheduleStatus(schedule, status) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!dataSource_1.AppDataSource.isInitialized) {
                yield dataSource_1.AppDataSource.initialize();
            }
            const repository = dataSource_1.AppDataSource.getRepository(TabiotSchedule_1.TabiotSchedule);
            schedule.status = status;
            yield repository.save(schedule);
            yield this.syncScheduleService.syncLocalToServer(schedule);
        });
    }
    /**
     * Reset lại các lệnh modbus đã được thực thi sang giá trị falsey:
     * - Với coil (fc=5): giá trị false.
     * - Với holding register (fc=6): giá trị 0.
     */
    resetModbusCommands(modbusClient, commands) {
        return __awaiter(this, void 0, void 0, function* () {
            for (const cmd of commands) {
                if (cmd.fc === 5) {
                    yield modbusClient.writeCoil(cmd.address, false);
                }
                else if (cmd.fc === 6) {
                    yield modbusClient.writeRegister(cmd.address, 0);
                }
                yield this.delay(100);
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
    __metadata("design:paramtypes", [])
], ScheduleService);
