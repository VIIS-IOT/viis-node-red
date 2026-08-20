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
import {
    executeWithTimeout,
    executeWithExponentialBackoff,
    executeWithCircuitBreaker,
    executeWithResilience,
    CircuitBreakerManager,
    MqttFailedQueue,
    ResilienceOptions,
    CircuitBreakerOptions
} from "./resilience-utils";
import axios, { AxiosError } from "axios";
import { v4 as uuidv4 } from "uuid";
import { ProtectionGateService } from "../viis-device-protection/services/protection-gate-service";
import { GLOBAL_CONTEXT_KEYS } from "../viis-telemetry/viis-telemetry-constants";
import { classifyCoils } from "./schedule-coil-classify";
import { writeAndVerifyKey, KeyWriterDeps } from "./schedule-key-writer";
import { ExecutionStepBuffer } from "./schedule-execution-buffer";
import {
    ExecutionReport,
    ExecutionStep,
    KeyOutcome,
    ScheduleAction,
    SchedulePhase,
    failedOutcomes,
} from "./schedule-execution-types";
import {
    buildValveProgramCommand,
    buildValveProgramOffCommand,
    mergeHoldingMaps,
} from "./schedule-valve-program";

// require('dotenv').config();

/**
 * Configuration parameter keys that should be excluded from command overlap checking.
 * These parameters are stored in global context and do not conflict with Modbus commands.
 */
/** Water-hammer delay between valves and pump/power (start), or power and valves (finish). */
const WATER_HAMMER_DELAY_MS = 7000;

const CONFIG_PARAMETER_KEYS = new Set([
    'iri_time',
    'set_ec',
    'set_ph',
    'control_mode',
    'iri_sensor_mode',
    'water_only_time',
    'cycle_ec',
    'cycle_ph',
    'time_on_valve_01',
    'time_on_valve_02',
    'time_on_valve_03',
    'time_on_valve_04',
    'time_on_valve_05',
    'set_flow',
    'set_flow_1',
    'set_flow_2',
    'set_flow_3',
    'set_flow_4',
    'set_flow_5',
    'volume_factor_01',
    'volume_factor_02',
    'volume_factor_03',
    'volume_factor_04',
    'volume_factor_05',
    'volume_factor_main',
    'flow_factor_01',
    'flow_factor_02',
    'flow_factor_03',
    'flow_factor_04',
    'flow_factor_05',
    'flow_factor_main',
    'pressure_div_factor',
    'pressure_sub_factor',
    'min_pressure_limit',
    'max_pressure_limit',
    'EC_max',
    'EC_min',
]);

@Service()
export class ScheduleService {
    private readonly luoiMapping: Record<string, { thu: string; dai: string }> = {
        luoi_1: { thu: "luoi_1_thu", dai: "luoi_1_dai" },
        luoi_2: { thu: "luoi_2_thu", dai: "luoi_2_dai" },
        luoi_3: { thu: "luoi_3_thu", dai: "luoi_3_dai" },
    };

    private syncScheduleService: SyncScheduleService;
    private node: Node; // Thêm biến để giữ node từ Node-RED
    private globalHelper: GlobalContextHelper; // Thêm GlobalContextHelper
    private debugEnable: boolean; // Thêm biến debugEnable
    private verifyAfterWrite: boolean; // Enable/disable write verification
    private skipCoilVerify: boolean; // Skip coil verification after write
    private readonly CONFIG_KEY_VALUES_UPDATED_AT = "configKeyValuesUpdatedAt";
    private readonly PUBLISHED_VALUE_CACHE_KEY = "scheduleExecutorPublishedValueCache";
    private protectionGate: ProtectionGateService | null = null;

    constructor(node?: Node, verifyAfterWrite: boolean = true, debugEnable: boolean = false, skipCoilVerify: boolean = true) {
        this.node = node;
        this.verifyAfterWrite = verifyAfterWrite; // Store verifyAfterWrite setting
        this.debugEnable = debugEnable; // Store debugEnable setting from node config
        this.skipCoilVerify = skipCoilVerify; // Store skipCoilVerify setting
        this.globalHelper = node ? new GlobalContextHelper(node.context()) : null;
        try {
            // Initialize SyncScheduleService with node context to get proper access token
            this.syncScheduleService = node
                ? new SyncScheduleService(node.context())
                : Container.get(SyncScheduleService);
            this.debugLog("SyncScheduleService initialized successfully");
        } catch (error) {
            console.error(`Failed to initialize SyncScheduleService: ${(error as Error).message}`);
            this.syncScheduleService = undefined as any;
        }
    }

    setProtectionGate(gate: ProtectionGateService): void {
        this.protectionGate = gate;
    }

    // Helper function for conditional logging
    private debugLog(message: string): void {
        if (this.debugEnable) {
            if (this.node) {
                this.node.warn(message);
            }
        }
    }

    /** Always-log helper for Modbus commands — visible in Node-RED debug panel regardless of debugEnable */
    private logModbusCmd(action: string, cmd: { key: string; address: number; value: any; fc?: number }): void {
        if (!this.node) return;
        const fcLabel = cmd.fc === 6 ? 'HOLD' : cmd.fc === 5 ? 'COIL' : `FC${cmd.fc}`;
        this.node.warn(`[MODBUS] ${action} ${fcLabel} ${cmd.key}=${cmd.value} @${cmd.address}`);
    }

    private getPublishedValueCache(): Record<string, string> {
        return this.node?.context().global.get(this.PUBLISHED_VALUE_CACHE_KEY) as Record<string, string> || {};
    }

    private setPublishedValueCache(cache: Record<string, string>): void {
        this.node?.context().global.set(this.PUBLISHED_VALUE_CACHE_KEY, cache);
    }

    private valueHash(value: any): string {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    private hasPublishedValueChanged(cacheKey: string, value: any): boolean {
        const cache = this.getPublishedValueCache();
        return cache[cacheKey] !== this.valueHash(value);
    }

    private updatePublishedValueCache(entries: Record<string, any>): void {
        if (!this.node) return;
        const cache = this.getPublishedValueCache();
        for (const [key, value] of Object.entries(entries)) {
            cache[key] = this.valueHash(value);
        }
        this.setPublishedValueCache(cache);
    }

    /**
     * Clear dedup cache entries for specific keys to ensure next publish goes through.
     * Used before publishing config values at schedule start.
     */
    clearPublishedValueCacheForKeys(keys: string[]): void {
        if (!this.node || keys.length === 0) return;
        const cache = this.getPublishedValueCache();
        for (const key of keys) {
            delete cache[`config:${key}`];
            delete cache[`telemetry:${key}`];
        }
        this.setPublishedValueCache(cache);
    }

    // Hàm scaleValue trả về giá trị đã scale hoặc giá trị gốc nếu không có config
    private scaleValue(key: string, value: number, direction: 'read' | 'write'): number {
        const scaleConfigs: ScaleConfig[] = this.node?.context().global.get(GLOBAL_CONTEXT_KEYS.SCALE_CONFIGS) as ScaleConfig[] || [];
        const config = scaleConfigs.find(c => c.key === key && c.direction === direction);
        if (!config) {
            this.debugLog(`No scale config for ${key} in ${direction}, returning ${value}`);
            return value;
        }

        const shouldMultiply = config.operation === 'multiply';
        const result = shouldMultiply ? value * config.factor : value / config.factor;
        this.debugLog(`Scaled ${key} (${direction}): ${value} -> ${result} (operation: ${config.operation}, factor: ${config.factor})`);
        return result;
    }

    /**
     * Check if a value is falsy (should be skipped during schedule execution)
     * Falsy values: 0, "0", false, "false", null, undefined, ""
     */
    private isFalsyValue(value: any): boolean {
        // Explicit null/undefined check
        if (value === null || value === undefined) {
            return true;
        }

        // Empty string check
        if (value === "") {
            return true;
        }

        // Boolean check (including string "false")
        if (value === false || value === "false") {
            return true;
        }

        // Number check (including 0 and "0")
        if (value === 0 || value === "0") {
            return true;
        }

        // For string numbers like "0.0", "0.00", etc.
        if (typeof value === 'string') {
            const trimmed = value.trim();
            // Check if it's a numeric string that equals 0
            if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
                const num = parseFloat(trimmed);
                if (num === 0) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Normalize luoi command value to binary mode.
     * Returns:
     * - 0: thu=true, dai=false
     * - 1: thu=false, dai=true
     * - 2: N/A (no action — skip coil entirely)
     * - null: invalid value
     */
    private normalizeLuoiValue(value: any): 0 | 1 | 2 | null {
        if (value === 0 || value === "0" || value === false || value === "false") {
            return 0;
        }

        if (value === 1 || value === "1" || value === true || value === "true") {
            return 1;
        }

        if (value === 2 || value === "2") {
            return 2;
        }

        return null;
    }

    /**
     * Expand abstract luoi keys (luoi_1/2/3) into concrete coil keys
     * (luoi_X_thu/luoi_X_dai) so schedule execution can write Modbus coils directly.
     */
    private expandLuoiActionParams(actionObj: Record<string, any>, scheduleName: string): Record<string, any> {
        const expanded = { ...actionObj };

        for (const [luoiKey, mapping] of Object.entries(this.luoiMapping)) {
            if (!Object.prototype.hasOwnProperty.call(expanded, luoiKey)) {
                continue;
            }

            const mode = this.normalizeLuoiValue(expanded[luoiKey]);
            if (mode === null) {
                console.warn(`Invalid ${luoiKey} value in schedule ${scheduleName}: ${JSON.stringify(expanded[luoiKey])}`);
                delete expanded[luoiKey];
                continue;
            }

            // N/A (2) — không tác động coil, xóa key và skip
            if (mode === 2) {
                delete expanded[luoiKey];
                this.debugLog(`Skipped ${luoiKey}=2 (N/A) in schedule ${scheduleName}`);
                continue;
            }

            expanded[mapping.thu] = mode === 0;
            expanded[mapping.dai] = mode === 1;
            delete expanded[luoiKey];

            this.debugLog(
                `Expanded ${luoiKey}=${mode} -> ${mapping.thu}=${expanded[mapping.thu]}, ${mapping.dai}=${expanded[mapping.dai]}`
            );
        }

        return expanded;
    }

    /**
     * Load all Modbus coils from both legacy single-board and multi-board configurations
     * Returns a merged object with all coil mappings
     */
    private loadAllModbusCoils(): Record<string, number> {
        let allCoils: Record<string, number> = {};

        // Try to load legacy single-board coils first
        const legacyCoils = this.globalHelper
            ? this.globalHelper.getJsonEnvVar("MODBUS_COILS", {})
            : {};

        if (Object.keys(legacyCoils).length > 0) {
            this.debugLog(`Loaded ${Object.keys(legacyCoils).length} legacy coil mappings`);
            allCoils = { ...allCoils, ...legacyCoils };
        }

        // Check if we're in multi-board mode
        const boardsConfigStr = this.globalHelper ? this.globalHelper.getEnvVar('MODBUS_BOARDS', null) : null;

        if (boardsConfigStr) {
            try {
                let boards;

                // Handle both already-parsed array and JSON string
                if (Array.isArray(boardsConfigStr)) {
                    boards = boardsConfigStr;
                } else if (typeof boardsConfigStr === 'string') {
                    boards = JSON.parse(boardsConfigStr);
                } else {
                    this.debugLog(`Invalid MODBUS_BOARDS type: ${typeof boardsConfigStr}`);
                    return allCoils;
                }

                if (Array.isArray(boards) && boards.length > 0) {
                    this.debugLog(`Multi-board mode detected with ${boards.length} boards`);

                    // Load coils from each board
                    for (const board of boards) {
                        const boardId = board.id.toUpperCase();
                        const boardCoils = this.globalHelper
                            ? this.globalHelper.getJsonEnvVar(`MODBUS_${boardId}_COILS`, {})
                            : {};

                        if (Object.keys(boardCoils).length > 0) {
                            this.debugLog(`Loaded ${Object.keys(boardCoils).length} coil mappings from board ${board.id}`);
                            allCoils = { ...allCoils, ...boardCoils };
                        }
                    }
                }
            } catch (e) {
                console.error(`Error parsing MODBUS_BOARDS: ${e}`);
            }
        }

        this.debugLog(`Total coil mappings loaded: ${Object.keys(allCoils).length}`);
        return allCoils;
    }

    /**
     * Load all Modbus holding registers from both legacy single-board and multi-board configurations
     * Returns a merged object with all holding register mappings
     */
    private loadAllModbusHoldingRegisters(): Record<string, number> {
        let allHolding: Record<string, number> = {};

        // Try to load legacy single-board holding registers first
        const legacyHolding = this.globalHelper
            ? this.globalHelper.getJsonEnvVar("MODBUS_HOLDING_REGISTERS", {})
            : {};

        if (Object.keys(legacyHolding).length > 0) {
            this.debugLog(`Loaded ${Object.keys(legacyHolding).length} legacy holding register mappings`);
            allHolding = { ...allHolding, ...legacyHolding };
        }

        // Check if we're in multi-board mode
        const boardsConfigStr = this.globalHelper ? this.globalHelper.getEnvVar('MODBUS_BOARDS', null) : null;

        if (boardsConfigStr) {
            try {
                let boards;

                // Handle both already-parsed array and JSON string
                if (Array.isArray(boardsConfigStr)) {
                    boards = boardsConfigStr;
                } else if (typeof boardsConfigStr === 'string') {
                    boards = JSON.parse(boardsConfigStr);
                } else {
                    this.debugLog(`Invalid MODBUS_BOARDS type: ${typeof boardsConfigStr}`);
                    return allHolding;
                }

                if (Array.isArray(boards) && boards.length > 0) {
                    this.debugLog(`Multi-board mode detected with ${boards.length} boards`);

                    // Load holding registers from each board
                    for (const board of boards) {
                        const boardId = board.id.toUpperCase();
                        const boardHolding = this.globalHelper
                            ? this.globalHelper.getJsonEnvVar(`MODBUS_${boardId}_HOLDING_REGISTERS`, {})
                            : {};

                        if (Object.keys(boardHolding).length > 0) {
                            this.debugLog(`Loaded ${Object.keys(boardHolding).length} holding register mappings from board ${board.id}`);
                            allHolding = { ...allHolding, ...boardHolding };
                        }
                    }
                }
            } catch (e) {
                console.error(`Error parsing MODBUS_BOARDS: ${e}`);
            }
        }

        this.debugLog(`Total holding register mappings loaded: ${Object.keys(allHolding).length}`);
        return allHolding;
    }

    public getAllModbusCoils(): Record<string, number> {
        return this.loadAllModbusCoils();
    }

    public getAllModbusHoldingRegisters(): Record<string, number> {
        return this.loadAllModbusHoldingRegisters();
    }

    public getMergedHoldingMaps(): Record<string, number> {
        const loaded = this.loadAllModbusHoldingRegisters();
        const board1Holdings = this.globalHelper?.getJsonEnvVar('MODBUS_BOARD1_HOLDING_REGISTERS', {}) || {};
        const legacyHoldings = this.globalHelper?.getJsonEnvVar('MODBUS_HOLDING_REGISTERS', {}) || {};
        return mergeHoldingMaps(legacyHoldings, board1Holdings, loaded);
    }

    public mergeValveProgramOffCommand(commands: ModbusCmd[]): ModbusCmd[] {
        const off = buildValveProgramOffCommand(this.getMergedHoldingMaps());
        if (!off || commands.some(cmd => cmd.key === 'valve_program')) {
            return commands;
        }
        return [off, ...commands];
    }

    /**
     * Lấy danh sách schedule từ DB
     */
    async getDueSchedules(): Promise<TabiotSchedule[]> {
        try {
            if (!AppDataSource.isInitialized) {
                this.debugLog("Initializing AppDataSource...");
                await AppDataSource.initialize();
                this.debugLog("AppDataSource initialized successfully");
            }

            // Lấy device_id từ global variable
            const deviceId = this.globalHelper ? this.globalHelper.getEnvVar("DEVICE_ID", "") : "";
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
            // this.debugLog(`schedules sql: ${JSON.stringify(schedules)}`)
            this.debugLog(`Retrieved ${schedules.length} schedules from DB for device_id: ${deviceId}`);
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
                this.debugLog(`Schedule ${schedule.name} is not enabled`);
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
                    this.debugLog(`Schedule ${schedule.name} is outside enabled range (${startDate.format('YYYY-MM-DD')} - ${endDate.format('YYYY-MM-DD')})`);
                    return false;
                }
            }

            // Kiểm tra interval (ngày trong tuần: 0=Sunday, 1=Monday, ..., 6=Saturday)
            if (schedule.interval && schedule.interval.trim() !== '') {
                const currentDayOfWeek = now.day(); // 0=Sunday, 1=Monday, ..., 6=Saturday
                let allowedDays: number[] = [];

                try {
                    // Parse interval - có thể là:
                    // - Single number: "3" -> [3]
                    // - Comma-separated: "1,3,5" -> [1, 3, 5]
                    // - JSON array: "[1,3,5]" -> [1, 3, 5]
                    const trimmedInterval = schedule.interval.trim();

                    if (trimmedInterval.startsWith('[') && trimmedInterval.endsWith(']')) {
                        // JSON array format
                        allowedDays = JSON.parse(trimmedInterval);
                    } else if (trimmedInterval.includes(',')) {
                        // Comma-separated format
                        allowedDays = trimmedInterval.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
                    } else {
                        // Single number format
                        const dayNum = parseInt(trimmedInterval);
                        if (!isNaN(dayNum)) {
                            allowedDays = [dayNum];
                        }
                    }

                    // Kiểm tra xem ngày hiện tại có trong danh sách cho phép không
                    if (allowedDays.length > 0 && !allowedDays.includes(currentDayOfWeek)) {
                        this.debugLog(`Schedule ${schedule.name} skipped: current day ${currentDayOfWeek} not in interval ${JSON.stringify(allowedDays)}`);
                        return false;
                    }

                    this.debugLog(`Schedule ${schedule.name} interval check passed: day ${currentDayOfWeek} in ${JSON.stringify(allowedDays)}`);
                } catch (error) {
                    console.error(`Error parsing interval for schedule ${schedule.name}: ${(error as Error).message}`);
                    // Nếu parse lỗi, cho phép schedule chạy (fallback to old behavior)
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
            // Sử dụng [start, end) - exclusive end boundary để tránh overlap khi 2 schedule liên tiếp nhau
            const isDue = now.isBetween(startDateTime, endDateTime, undefined, "[)");
            this.debugLog(JSON.stringify({
                now: now.format(),
                startDateTime: startDateTime.format(),
                endDateTime: endDateTime.format(),
                isDue,
            }));
            this.debugLog(`Schedule ${schedule.name} isDue: ${isDue}`);
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
        let holdingCommands: ModbusCmd[] = [];
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
            // Expand abstract luoi keys before Modbus mapping
            const expandedActionObj = this.expandLuoiActionParams(actionObj, schedule.name);

            // Load Modbus mappings with multi-board support
            const modbusCoils = this.loadAllModbusCoils();
            const modbusHolding = this.loadAllModbusHoldingRegisters();

            for (const key in expandedActionObj) {
                if (expandedActionObj.hasOwnProperty(key)) {
                    if (key === 'valve_program') {
                        continue;
                    }
                    let value = expandedActionObj[key];
                    // Chuyển đổi chuỗi boolean thành kiểu boolean
                    if (typeof value === "string") {
                        if (value.toLowerCase() === "true") {
                            value = true;
                        } else if (value.toLowerCase() === "false") {
                            value = false;
                        }
                    }

                    const isMappedHolding = modbusHolding.hasOwnProperty(key);
                    const isMappedCoil = modbusCoils.hasOwnProperty(key);
                    const isValidModbusMapping = isMappedHolding || isMappedCoil;
                    const isAllowedMappedFalsyValue = value === 0 || value === "0" || value === false || value === "false";

                    // Skip falsy values only for unmapped keys (config parameters)
                    // For valid Modbus mappings, only keep 0/"0"/false/"false".
                    if (this.isFalsyValue(value) && (!isValidModbusMapping || !isAllowedMappedFalsyValue)) {
                        this.debugLog(`Skipping falsy value for key "${key}": ${JSON.stringify(value)} in schedule ${schedule.name}`);
                        continue;
                    }

                    // Process Modbus-mapped keys
                    if (isMappedHolding) {
                        holdingCommands.push({
                            key,
                            value: Number(value),
                            fc: 6,
                            unitid: 1,
                            address: modbusHolding[key],
                            quantity: 1,
                        });
                        this.debugLog(`Mapped ${key} to holding register at address ${modbusHolding[key]}`);
                    } else if (isMappedCoil) {
                        // Skip falsy coil values - only write coils that should be ON
                        if (value === false || value === 0 || value === "false" || value === "0") {
                            this.debugLog(`Skipping falsy coil "${key}": ${JSON.stringify(value)}`);
                            continue;
                        }
                        coilCommands.push({
                            key,
                            value: Boolean(value),
                            fc: 5,
                            unitid: 1,
                            address: modbusCoils[key],
                            quantity: 1,
                        });
                        this.debugLog(`Mapped ${key} to coil at address ${modbusCoils[key]}`);
                    } else {
                        // Unmapped keys → config parameters (MQTT publish)
                        try {
                            const configParam = this.storeConfigParameter(key, value, schedule.name);
                            if (configParam) {
                                configParameters.push(configParam);
                                this.debugLog(`Successfully stored config parameter: ${key}=${configParam.value} (type: ${configParam.type})`);
                            }
                        } catch (error) {
                            console.error(`Failed to store config parameter ${key}: ${(error as Error).message}`);
                        }
                    }
                }
            }

            const mergedHoldings = this.getMergedHoldingMaps();
            const valveProgramCmd = buildValveProgramCommand(expandedActionObj, mergedHoldings);
            const hasNumberedValves = Array.from({ length: 16 }, (_, i) => `valve_${i}`)
                .some(key => Object.prototype.hasOwnProperty.call(expandedActionObj, key));
            if (valveProgramCmd && hasNumberedValves) {
                holdingCommands = holdingCommands.filter(cmd => cmd.key !== 'valve_program');
                holdingCommands.unshift(valveProgramCmd);
            } else if (hasNumberedValves && !valveProgramCmd) {
                this.node?.warn('[MODBUS] skip valve_program: address 20 occupied by another holding or unresolved');
            }
        } catch (error) {
            console.error(`Error parsing action for schedule ${schedule.name}: ${(error as Error).message}`);
        }

        return { holdingCommands, coilCommands, configParameters };
    }


    private verifyEnabledFor(cmd: ModbusCmd): boolean {
        return cmd.fc === 5 ? !this.skipCoilVerify : this.verifyAfterWrite;
    }

    private makeKeyWriterDeps(modbusClient: ModbusClientCore): KeyWriterDeps {
        return {
            writeCoil: async (cmd) => {
                const written = await this.writeCoilWithGate(modbusClient, cmd);
                return written ? 'written' : 'blocked';
            },
            writeRegister: (address, raw) => modbusClient.writeRegister(address, raw),
            readCoil: async (address) => {
                const result = await modbusClient.readCoils(address, 1);
                return Boolean(result.data[0]);
            },
            readHolding: async (address) => {
                const result = await modbusClient.readHoldingRegisters(address, 1);
                return Number(result.data[0]);
            },
            scaleWrite: (key, value) => this.scaleValue(key, value, 'write'),
            scaleRead: (key, value) => this.scaleValue(key, value, 'read'),
            delay: (ms) => this.delay(ms),
        };
    }

    private async writeCommandGroup(
        cmds: ModbusCmd[],
        deps: KeyWriterDeps,
        phase: SchedulePhase,
        logAction: string
    ): Promise<KeyOutcome[]> {
        const outcomes: KeyOutcome[] = [];
        for (const cmd of cmds) {
            const outcome = await writeAndVerifyKey(cmd, deps, {
                phase,
                verifyEnabled: this.verifyEnabledFor(cmd),
            });
            if (outcome.status === 'blocked') {
                this.logModbusCmd('BLOCKED', cmd);
            } else if (outcome.status === 'fail') {
                this.logModbusCmd('FAIL', cmd);
            } else {
                this.logModbusCmd(logAction, { ...cmd, value: outcome.rawWritten ?? cmd.value });
            }
            outcomes.push(outcome);
            await this.delay(100);
        }
        return outcomes;
    }

    /**
     * Write a single coil with protection gate check.
     * Returns true if written, false if blocked by gate.
     * OFF commands (value=false) always bypass the gate.
     */
    private async writeCoilWithGate(
        modbusClient: ModbusClientCore,
        cmd: ModbusCmd,
        source: string = 'schedule'
    ): Promise<boolean> {
        // Protection gate check — only for ON commands
        if (this.protectionGate && cmd.fc === 5 && Boolean(cmd.value)) {
            const gate = this.protectionGate.checkGate(cmd.key, Boolean(cmd.value), source);
            if (!gate.allowed) {
                if (this.node) {
                    this.node.warn(`[PROTECTION] BLOCKED: ${cmd.key}=${cmd.value} — ${gate.reason}`);
                }
                return false;
            }
        }

        // Write coil
        await modbusClient.writeCoil(cmd.address, Boolean(cmd.value));

        // Update gate state after successful write
        if (this.protectionGate && cmd.fc === 5) {
            this.protectionGate.updateState(cmd.key, Boolean(cmd.value));
        }

        return true;
    }

    /**
 * Gửi các lệnh modbus qua modbusClient
 */
    async executeModbusCommands(
        modbusClient: ModbusClientCore,
        commands: { holdingCommands: ModbusCmd[], coilCommands: ModbusCmd[] },
        schedule?: TabiotSchedule,
        options?: { runId?: string }
    ): Promise<ExecutionReport> {
        const buffer = new ExecutionStepBuffer(
            options?.runId ?? uuidv4(),
            'start',
            schedule?.name ?? 'unknown'
        );
        const deps = this.makeKeyWriterDeps(modbusClient);

        if (this.node && (commands.holdingCommands.length > 0 || commands.coilCommands.length > 0)) {
            this.node.warn(`[MODBUS] EXEC ${schedule?.name || '?'}: ${commands.holdingCommands.length} registers + ${commands.coilCommands.length} coils`);
        }

        const valveProgramCmds = commands.holdingCommands.filter(cmd => cmd.key === 'valve_program');
        const otherHoldingCmds = commands.holdingCommands.filter(cmd => cmd.key !== 'valve_program');

        if (valveProgramCmds.length > 0) {
            const keys = await this.writeCommandGroup(valveProgramCmds, deps, 'set_valve_program', 'WRITE');
            buffer.pushPhase({ phase: 'set_valve_program', keys });
        }
        if (otherHoldingCmds.length > 0) {
            const keys = await this.writeCommandGroup(otherHoldingCmds, deps, 'set_holding', 'WRITE');
            buffer.pushPhase({ phase: 'set_holding', keys });
        }

        const { powerCoils, pumpCoils, valveCoils, otherCoils } = classifyCoils(commands.coilCommands);
        const isStarting = schedule && schedule.status === 'running';

        if (isStarting) {
            if (this.node) {
                this.node.warn(`🔧 START ${schedule.name}: valve(${valveCoils.length}) → other(${otherCoils.length}) → delay → pump(${pumpCoils.length}) → power(${powerCoils.length})`);
            }

            if (valveCoils.length > 0) {
                const keys = await this.writeCommandGroup(valveCoils, deps, 'open_valves', 'START');
                buffer.pushPhase({ phase: 'open_valves', keys });
            }
            if (otherCoils.length > 0) {
                const keys = await this.writeCommandGroup(otherCoils, deps, 'other_coils', 'START');
                buffer.pushPhase({ phase: 'other_coils', keys });
            }

            if (pumpCoils.length > 0 || powerCoils.length > 0) {
                if (this.node) this.node.warn(`[MODBUS] ⏱️ delay before PUMP/POWER...`);
                const t0 = Date.now();
                await this.delay(WATER_HAMMER_DELAY_MS);
                buffer.pushPhase({ phase: 'water_hammer_delay', keys: [], ok: true, duration_ms: Date.now() - t0 });
            }

            if (pumpCoils.length > 0) {
                const keys = await this.writeCommandGroup(pumpCoils, deps, 'start_pumps', 'START');
                buffer.pushPhase({ phase: 'start_pumps', keys });
            }
            if (powerCoils.length > 0) {
                const keys = await this.writeCommandGroup(powerCoils, deps, 'system_power', 'START');
                buffer.pushPhase({ phase: 'system_power', keys });
            }
        } else if (commands.coilCommands.length > 0) {
            const keys = await this.writeCommandGroup(commands.coilCommands, deps, 'other_coils', 'WRITE');
            buffer.pushPhase({ phase: 'other_coils', keys });
        }

        return buffer.toReport();
    }

    /**
     * Xác thực việc ghi modbus
     * @param modbusClient - Modbus client instance
     * @param commands - Array of Modbus commands to verify
     * @returns Promise<boolean> - true if verification passed or disabled, false if verification failed
     *
     * Note: Coils (FC=5) are verified when skipCoilVerify = false.
     *       Holding registers (FC=6) are only verified when verifyAfterWrite = true.
     */
    async verifyModbusWrite(modbusClient: ModbusClientCore, commands: ModbusCmd[]): Promise<boolean> {
        const coilCommands = commands.filter(cmd => cmd.fc === 5);
        const holdingCommands = commands.filter(cmd => cmd.fc === 6);

        const commandsToVerify = [
            ...(this.skipCoilVerify ? [] : coilCommands),
            ...(this.verifyAfterWrite ? holdingCommands : [])
        ];

        if (commandsToVerify.length === 0) return true;

        if (this.node) {
            this.node.warn(`[MODBUS] VERIFY ${commandsToVerify.length} commands...`);
        }

        for (const cmd of commandsToVerify) {
            try {
                let readValue: number | boolean;

                if (cmd.fc === 5) {
                    const readResult = await modbusClient.readCoils(cmd.address, 1);
                    readValue = Boolean(readResult.data[0]);
                } else if (cmd.fc === 6) {
                    const readResult = await modbusClient.readHoldingRegisters(cmd.address, 1);
                    readValue = this.scaleValue(cmd.key, Number(readResult.data[0]), 'read');
                } else {
                    continue;
                }

                const ok = readValue === cmd.value;
                if (this.node) {
                    const fcLabel = cmd.fc === 6 ? 'HOLD' : 'COIL';
                    this.node.warn(`[MODBUS] VERIFY ${fcLabel} ${cmd.key}@${cmd.address}: read=${readValue} expected=${cmd.value} → ${ok ? '✅' : '❌'}`);
                }
                if (!ok) return false;
            } catch (error) {
                if (this.node) {
                    this.node.warn(`[MODBUS] VERIFY ERROR ${cmd.key}@${cmd.address}: ${(error as Error).message}`);
                }
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
            this.debugLog(`Published MQTT notification to ThingsBoard for ${schedule.name}`);

            // Publish to EMQX local
            const deviceId = this.globalHelper ? this.globalHelper.getEnvVar("DEVICE_ID", "unknown") : "unknown";
            const emqxTopic = `viis/things/v2/${deviceId}/telemetry`;
            await emqxClient.publish(emqxTopic, payloadString);
            this.debugLog(`Published MQTT notification to EMQX local for ${schedule.name}`);

            // CRITICAL LOG: MQTT published successfully
            if (this.node) {
                this.node.warn(`📡 MQTT PUBLISHED: ${schedule.name} | Status: ${schedule.status} | Topics: ThingsBoard + EMQX`);
            }

        } catch (error) {
            // CRITICAL LOG: MQTT error
            if (this.node) {
                this.node.warn(`❌ MQTT ERROR: ${schedule.name} | ${(error as Error).message}`);
                this.node.warn(`⚠️  Continuing local operations despite MQTT publish failure`);
            }
            console.error(`Error publishing MQTT for ${schedule.name}: ${(error as Error).message}`);
            // Don't throw - let local services continue even if MQTT fails
        }
    }

    /**
     * Publish schedule telemetry to MQTT (ThingsBoard + EMQX)
     * Publishes all written Modbus keys in one object, matching viis-rpc-control format
     * Includes deduplication to avoid redundant publishes
     */
    async publishScheduleTelemetry(
        thingsboardClient: MqttClientCore,
        emqxClient: MqttClientCore,
        schedule: TabiotSchedule,
        action: 'start' | 'end',
        commands: { holdingCommands: ModbusCmd[], coilCommands: ModbusCmd[] },
        configKeyValues?: Record<string, any>
    ): Promise<void> {
        try {
            const changedValues: Record<string, any> = {};

            for (const cmd of [...commands.holdingCommands, ...commands.coilCommands]) {
                const cacheKey = `telemetry:${cmd.key}`;
                if (this.hasPublishedValueChanged(cacheKey, cmd.value)) {
                    changedValues[cmd.key] = cmd.value;
                }
            }

            if (configKeyValues && Object.keys(configKeyValues).length > 0) {
                for (const [key, value] of Object.entries(configKeyValues)) {
                    const cacheKey = `telemetry:${key}`;
                    if (this.hasPublishedValueChanged(cacheKey, value)) {
                        changedValues[key] = value;
                    }
                }
            }

            if (Object.keys(changedValues).length === 0) {
                this.debugLog(`Skipping unchanged schedule telemetry for ${schedule.name} (${action})`);
                return;
            }

            // Build telemetry payload matching viis-rpc-control format
            const telemetryData: Record<string, any> = {
                ts: Date.now(),
                _schedule_action: action,
                _schedule_id: schedule.name,
                _schedule_label: schedule.label,
            };

            Object.assign(telemetryData, changedValues);

            // Deduplication: Check if we already published the same data
            const lastPublishedKey = `telemetryLastPublished_${schedule.name}_${action}`;
            const lastPublished = this.node?.context().global.get(lastPublishedKey) as { hash: string; timestamp: number } | null;

            // Create hash from telemetry keys and values (excluding timestamp)
            const hashData = { ...telemetryData };
            delete hashData.ts;
            const currentHash = JSON.stringify(hashData);

            // Skip if same data published within last 5 seconds (prevent duplicates from retries)
            const now = Date.now();
            if (lastPublished && lastPublished.hash === currentHash && (now - lastPublished.timestamp) < 5000) {
                this.debugLog(`Skipping duplicate telemetry for ${schedule.name} (${action}) - last published ${now - lastPublished.timestamp}ms ago`);
                return;
            }

            const payloadString = JSON.stringify(telemetryData);

            // Publish to ThingsBoard
            const thingsboardTopic = "v1/devices/me/telemetry";
            await thingsboardClient.publish(thingsboardTopic, payloadString);
            this.debugLog(`Published schedule telemetry to ThingsBoard for ${schedule.name} (${action})`);

            // Publish to EMQX local
            const deviceId = this.globalHelper ? this.globalHelper.getEnvVar("DEVICE_ID", "unknown") : "unknown";
            const emqxTopic = `viis/things/v2/${deviceId}/telemetry`;
            await emqxClient.publish(emqxTopic, payloadString);
            this.debugLog(`Published schedule telemetry to EMQX local for ${schedule.name} (${action})`);

            // Update last published tracking
            this.node?.context().global.set(lastPublishedKey, { hash: currentHash, timestamp: now });
            this.updatePublishedValueCache(
                Object.fromEntries(
                    Object.entries(changedValues).map(([key, value]) => [`telemetry:${key}`, value])
                )
            );

            // Log published keys
            const keyCount = Object.keys(telemetryData).length;
            const modbusKeyCount = commands.holdingCommands.length + commands.coilCommands.length;
            if (this.node) {
                this.node.warn(`📊 SCHEDULE TELEMETRY: ${schedule.name} | Action: ${action} | Keys: ${modbusKeyCount} Modbus + ${Object.keys(configKeyValues || {}).length} Config = ${keyCount} total`);
            }

        } catch (error) {
            // Log error but don't throw - telemetry failure should not break schedule execution
            if (this.node) {
                this.node.warn(`❌ SCHEDULE TELEMETRY ERROR: ${schedule.name} | ${(error as Error).message}`);
            }
            console.error(`Error publishing schedule telemetry for ${schedule.name}: ${(error as Error).message}`);
        }
    }

    /**
     * Publish audit log for schedule execution
     * This logs which function keys were changed and why (schedule start/end)
     */
    async publishAuditLog(
        thingsboardClient: MqttClientCore,
        emqxClient: MqttClientCore,
        schedule: TabiotSchedule,
        action: 'start' | 'end',
        commands: { holdingCommands: ModbusCmd[], coilCommands: ModbusCmd[] },
        success: boolean = true,
        errorMessage?: string,
        extras?: { runId?: string; steps?: ExecutionStep[] }
    ): Promise<void> {
        try {
            const requestId = uuidv4();
            const allCommands = [...commands.holdingCommands, ...commands.coilCommands];
            const steps = extras?.steps ?? [];
            const envelopeSuccess = steps.length > 0 ? failedOutcomes({
                runId: extras?.runId ?? requestId,
                action,
                scheduleId: schedule.name,
                steps,
            }).length === 0 : success;

            // Build human-readable message
            const actionText = action === 'start' ? 'bắt đầu' : 'kết thúc';
            const statusText = envelopeSuccess ? 'thành công' : 'thất bại';
            const changedKeys = allCommands.map(cmd => `${cmd.key}=${cmd.value}`).join(', ');

            let message: string;
            if (envelopeSuccess) {
                message = `Lịch trình "${schedule.label || schedule.name}" ${actionText}: ${changedKeys || 'không có thay đổi'}`;
            } else {
                message = `Lịch trình "${schedule.label || schedule.name}" ${actionText} ${statusText}: ${errorMessage || 'Lỗi không xác định'}`;
            }

            // Build logs object according to audit log format
            const logs = {
                from: "DEVICE_EXE_SCHEDULE",
                requestId: requestId,
                message: message,
                metadata: {
                    status: envelopeSuccess ? "SUCCESS" : "FAIL",
                    schedule_id: schedule.name,
                    schedule_label: schedule.label,
                    action: action,
                    run_id: extras?.runId ?? requestId,
                    changed_keys: allCommands.map(cmd => ({
                        key: cmd.key,
                        value: cmd.value,
                        address: cmd.address,
                        fc: cmd.fc
                    })),
                    steps,
                    timestamp: Date.now(),
                    error: errorMessage || null
                }
            };

            // Build telemetry payload
            const telemetryPayload = {
                logs: logs
            };
            const payloadString = JSON.stringify(telemetryPayload);

            // Publish to ThingsBoard
            const thingsboardTopic = "v1/devices/me/telemetry";
            await thingsboardClient.publish(thingsboardTopic, payloadString);
            this.debugLog(`Published audit log to ThingsBoard for schedule ${schedule.name} (${action})`);

            // Publish to EMQX local
            const deviceId = this.globalHelper ? this.globalHelper.getEnvVar("DEVICE_ID", "unknown") : "unknown";
            const emqxTopic = `viis/things/v2/${deviceId}/telemetry`;
            await emqxClient.publish(emqxTopic, payloadString);
            this.debugLog(`Published audit log to EMQX local for schedule ${schedule.name} (${action})`);

            // Log success
            if (this.node) {
                this.node.warn(`📝 AUDIT LOG PUBLISHED: ${schedule.name} | Action: ${action} | Keys: ${allCommands.length} | Status: ${success ? 'SUCCESS' : 'FAIL'}`);
            }

        } catch (error) {
            // Log error but don't throw - audit log failure should not break schedule execution
            if (this.node) {
                this.node.warn(`❌ AUDIT LOG ERROR: ${schedule.name} | ${(error as Error).message}`);
            }
            console.error(`Error publishing audit log for ${schedule.name}: ${(error as Error).message}`);
        }
    }

    /**
     * Sync schedule log
     */
    async syncScheduleLog(schedule: TabiotSchedule, success: boolean): Promise<void> {
        try {
            this.debugLog(`Sync schedule log for ${schedule.name}: status ${success ? "executed" : "error"}, timestamp ${Date.now()}`);

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
                this.debugLog(`Logged schedule ${schedule.name} successfully`);

                // CRITICAL LOG: Schedule log synced successfully
                if (this.node) {
                    this.node.warn(`📝 SCHEDULE LOG SYNCED: ${schedule.name} | ${success ? 'Success' : 'Failed'}`);
                }
            } else {
                // CRITICAL LOG: Sync service unavailable
                if (this.node) {
                    this.node.warn(`⚠️ SCHEDULE LOG SKIPPED: ${schedule.name} | SyncScheduleService not available`);
                }
                console.warn("SyncScheduleService is not available, skipping log");
            }
        } catch (error) {
            // CRITICAL LOG: Schedule log sync error
            if (this.node) {
                this.node.warn(`❌ SCHEDULE LOG ERROR: ${schedule.name} | ${(error as Error).message}`);
            }
            console.error(`Error syncing log for ${schedule.name}: ${(error as Error).message}`);
        }
    }

    /**
     * Cập nhật trạng thái của schedule
     */
    async updateScheduleStatus(schedule: TabiotSchedule, status: "running" | "finished"): Promise<void> {
        try {
            if (!AppDataSource.isInitialized) {
                this.debugLog("Initializing AppDataSource...");
                await AppDataSource.initialize();
                this.debugLog("AppDataSource initialized successfully");
            }
            const repository = AppDataSource.getRepository(TabiotSchedule);

            const previousStatus = schedule.status;

            // Cập nhật trạng thái
            schedule.status = status;

            // CRITICAL LOG: Status Change
            const statusIcon = status === 'running' ? '▶️' : '⏹️';
            if (this.node) {
                this.node.warn(`${statusIcon} STATUS CHANGE: ${schedule.name} | ${previousStatus || 'none'} → ${status} | Label: ${schedule.label}`);
            }

            // Override giá trị modified, cộng thêm 7 giờ
            const nowPlus7 = moment().utc().add(7, 'hours').toDate();
            schedule.modified = nowPlus7;

            // Lưu entity với giá trị modified đã chỉnh sửa
            await repository.save(schedule);
            this.debugLog(`Updated status of ${schedule.name} to ${status} with modified time ${schedule.modified}`);

            // CRITICAL LOG: Server Sync Status
            if (this.syncScheduleService) {
                try {
                    await this.syncScheduleService.syncScheduleFromLocalToServer([schedule]);
                    if (this.node) {
                        this.node.warn(`✅ SERVER SYNC SUCCESS: ${schedule.name} | Status: ${status}`);
                    }
                    this.debugLog(`Synced ${schedule.name} to server`);
                } catch (syncError) {
                    if (this.node) {
                        this.node.warn(`❌ SERVER SYNC FAILED: ${schedule.name} | Error: ${(syncError as Error).message}`);
                    }
                    throw syncError;
                }
            } else {
                if (this.node) {
                    this.node.warn(`⚠️ SERVER SYNC SKIPPED: ${schedule.name} | SyncScheduleService not available`);
                }
            }
        } catch (error) {
            if (this.node) {
                this.node.warn(`❌ DATABASE ERROR: ${schedule.name} | Failed to update status | ${(error as Error).message}`);
            }
            console.error(`Error updating status for ${schedule.name}: ${(error as Error).message}`);
        }
    }

    /**
     * Auto-detect and recover stuck 'running' schedules
     * Checks if devices are actually OFF and updates status to 'finished' if so
     * This handles cases where reset failed but user manually turned off devices
     */
    async checkAndRecoverStuckSchedules(
        modbusClient: ModbusClientCore,
        schedules: TabiotSchedule[]
    ): Promise<void> {
        const now = moment();

        for (const schedule of schedules) {
            // Only check schedules that are "running" and past their end time
            if (schedule.status !== 'running') continue;

            const endDateTime = moment(`${schedule.end_date} ${schedule.end_time}`, "YYYY-MM-DD HH:mm:ss");
            const minutesPastEnd = now.diff(endDateTime, 'minutes');

            // Only check if at least 2 minutes past end time (grace period)
            if (minutesPastEnd < 2) continue;

            this.debugLog(`🔍 RECOVERY CHECK: Schedule ${schedule.name} is stuck in "running" status ${minutesPastEnd} minutes past end time`);

            // Get the commands that should have been reset
            const activeCommands = this.getActiveCommands(schedule.name);
            if (activeCommands.length === 0) {
                this.debugLog(`No active commands found for ${schedule.name}, setting to finished`);
                this.clearScheduleStatusHistory(schedule.name); // Clear status history for next run
                await this.updateScheduleStatus(schedule, 'finished');
                await this.sendNotificationToBackend(schedule, 'end', true);
                continue;
            }

            // Verify if devices are actually OFF by reading Modbus
            let allDevicesOff = true;
            for (const cmd of activeCommands) {
                try {
                    let readResult: { data: any[] };
                    let currentValue: number | boolean;

                    if (cmd.fc === 5) {
                        readResult = await modbusClient.readCoils(cmd.address, 1);
                        currentValue = Boolean(readResult.data[0]);
                        // Device should be OFF (false)
                        if (currentValue !== false) {
                            allDevicesOff = false;
                            this.debugLog(`⚠️ Device at coil ${cmd.address} is still ON (${currentValue})`);
                        }
                    } else if (cmd.fc === 6) {
                        readResult = await modbusClient.readHoldingRegisters(cmd.address, 1);
                        currentValue = Number(readResult.data[0]);
                        // Device should be 0 or OFF value
                        if (currentValue !== 0 && currentValue !== cmd.value) {
                            allDevicesOff = false;
                            this.debugLog(`⚠️ Register at ${cmd.address} is still ${currentValue} (expected 0)`);
                        }
                    }
                } catch (error) {
                    this.debugLog(`Error reading Modbus for recovery check: ${(error as Error).message}`);
                    allDevicesOff = false;
                    break;
                }
            }

            // If all devices are confirmed OFF, update status to finished
            if (allDevicesOff) {
                if (this.node) {
                    this.node.warn(`✅ RECOVERY SUCCESS: Schedule ${schedule.name} devices confirmed OFF - updating to finished`);
                }

                this.clearActiveCommands(schedule.name);
                this.clearScheduleConfigValues(schedule.name);
                this.clearScheduleStatusHistory(schedule.name); // Clear status history for next run
                await this.updateScheduleStatus(schedule, 'finished');
                await this.sendNotificationToBackend(schedule, 'end', true);

                // Send recovery notification
                if (this.node) {
                    this.node.warn(`📡 RECOVERY NOTIFICATION: ${schedule.name} auto-recovered after manual shutdown`);
                }
            } else {
                // Devices still ON - try to reset again
                if (minutesPastEnd >= 3) {
                    // After 3 minutes, try one more time to reset
                    if (this.node) {
                        this.node.warn(`🔄 RECOVERY RETRY: Attempting to reset ${schedule.name} again (${minutesPastEnd} min past end)`);
                    }

                    const { allSuccessful: resetSuccess } = await this.resetModbusCommands(modbusClient, activeCommands, schedule, true);
                    if (resetSuccess) {
                        this.clearActiveCommands(schedule.name);
                        this.clearScheduleConfigValues(schedule.name);
                        this.clearScheduleStatusHistory(schedule.name); // Clear status history for next run
                        await this.updateScheduleStatus(schedule, 'finished');
                        await this.sendNotificationToBackend(schedule, 'end', true);

                        if (this.node) {
                            this.node.warn(`✅ RECOVERY RETRY SUCCESS: ${schedule.name} reset succeeded on retry`);
                        }
                    } else {
                        if (this.node) {
                            this.node.warn(`❌ RECOVERY RETRY FAILED: ${schedule.name} still cannot reset - manual intervention still required`);
                        }
                    }
                }
            }
        }
    }

    /**
     * Reset lại các lệnh modbus
     */
    async resetModbusCommands(
        modbusClient: ModbusClientCore,
        commands: ModbusCmd[],
        schedule?: TabiotSchedule,
        isFinishing: boolean = false,
        options?: { runId?: string; unusedHoldingReset?: boolean }
    ): Promise<{ report: ExecutionReport; allSuccessful: boolean }> {
        const buffer = new ExecutionStepBuffer(
            options?.runId ?? uuidv4(),
            isFinishing || options?.unusedHoldingReset ? (options?.unusedHoldingReset ? 'start' : 'end') : 'end',
            schedule?.name ?? 'unknown'
        );
        const deps = this.makeKeyWriterDeps(modbusClient);
        const coilCommands = commands.filter(cmd => cmd.fc === 5);
        const { powerCoils, pumpCoils, valveCoils, otherCoils } = classifyCoils(coilCommands);
        const holdingRegisters = commands.filter(cmd => cmd.fc === 6);
        const holdingPhase: SchedulePhase = options?.unusedHoldingReset ? 'reset_unused_holding' : 'reset_holding';

        if (this.node) {
            this.node.warn(`[MODBUS] RESET ${schedule?.name || '?'}: ${holdingRegisters.length} registers + ${coilCommands.length} coils (ordered=${isFinishing})`);
        }

        const resetHoldings = async () => {
            if (holdingRegisters.length === 0) {
                return;
            }
            const offHoldings = holdingRegisters.map(cmd => ({ ...cmd, value: 0 }));
            const keys = await this.writeCommandGroup(offHoldings, deps, holdingPhase, 'RESET');
            buffer.pushPhase({ phase: holdingPhase, keys });
        };

        if (isFinishing) {
            if (valveCoils.length > 0) {
                const keys = await this.writeCommandGroup(valveCoils.map(cmd => ({ ...cmd, value: false })), deps, 'close_valves', 'RESET');
                buffer.pushPhase({ phase: 'close_valves', keys });
                if (this.node) this.node.warn(`[MODBUS] ⏱️ delay after VALVE close...`);
                const t0 = Date.now();
                await this.delay(WATER_HAMMER_DELAY_MS);
                buffer.pushPhase({ phase: 'water_hammer_delay', keys: [], ok: true, duration_ms: Date.now() - t0 });
            }
            if (pumpCoils.length > 0) {
                const keys = await this.writeCommandGroup(pumpCoils.map(cmd => ({ ...cmd, value: false })), deps, 'stop_pumps', 'RESET');
                buffer.pushPhase({ phase: 'stop_pumps', keys });
            }
            if (otherCoils.length > 0) {
                const keys = await this.writeCommandGroup(otherCoils.map(cmd => ({ ...cmd, value: false })), deps, 'other_coils', 'RESET');
                buffer.pushPhase({ phase: 'other_coils', keys });
            }
            if (powerCoils.length > 0) {
                const keys = await this.writeCommandGroup(powerCoils.map(cmd => ({ ...cmd, value: false })), deps, 'system_power', 'RESET');
                buffer.pushPhase({ phase: 'system_power', keys });
            }
            await resetHoldings();
        } else {
            await resetHoldings();
            if (coilCommands.length > 0) {
                const keys = await this.writeCommandGroup(coilCommands.map(cmd => ({ ...cmd, value: false })), deps, 'other_coils', 'RESET');
                buffer.pushPhase({ phase: 'other_coils', keys });
            }
        }

        const report = buffer.toReport();
        return { report, allSuccessful: failedOutcomes(report).length === 0 };
    }



    /**
     * Check if commands can be executed without overlapping with active commands
     * TODO: Re-enable overlap check - temporarily disabled
     */
    async canExecuteCommands(currentScheduleId: string, holdingCommands: ModbusCmd[], coilCommands: ModbusCmd[]): Promise<boolean> {
        return true;
    }


    /**
     * DISABLED: Automatic coil recovery after power loss or external interference
     * This method was previously used to automatically restore coil states when they
     * were changed by external sources. It has been disabled to prevent automatic
     * recovery - if coils are turned off externally, they will remain off.
     *
     * @deprecated This method is no longer called from the main execution loop
     */
    async reExecuteAfterPowerLoss(modbusClient: ModbusClientCore, schedule: TabiotSchedule): Promise<boolean> {
        const activeCommands = this.getActiveCommands(schedule.name);
        if (activeCommands.length === 0) {
            this.debugLog(`No active commands stored for schedule ${schedule.name}, mapping anew`);
            const { holdingCommands, coilCommands, configParameters } = this.mapScheduleToModbus(schedule);
            this.storeActiveCommands(schedule.name, [...holdingCommands, ...coilCommands]);
            await this.executeModbusCommands(modbusClient, { holdingCommands, coilCommands });

            // Note: Config parameters are not re-published during power loss recovery
            // as they are already stored in global context
            if (configParameters && configParameters.length > 0) {
                this.debugLog(`Found ${configParameters.length} config parameters during re-execution, already stored in context`);
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

        // this.debugLog(`Checking commands for schedule ${schedule.name} for non-overridden keys`);

        // Kiểm tra và thực thi holding commands
        const holdingCommandsToExecute: ModbusCmd[] = [];
        for (const cmd of holdingCommandsToCheck) {
            try {
                const readResult = await modbusClient.readHoldingRegisters(cmd.address, 1);
                const rawValue = Number(readResult.data[0]);
                const currentValue = this.scaleValue(cmd.key, rawValue, 'read');

                if (currentValue !== cmd.value) {
                    holdingCommandsToExecute.push(cmd);
                    this.debugLog(`Holding register at ${cmd.address} needs update: current=${currentValue}, expected=${cmd.value}`);
                } else {
                    // this.debugLog(`Holding register at ${cmd.address} already correct: ${currentValue}`);
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
                    this.debugLog(`Coil at ${cmd.address} needs update: current=${currentValue}, expected=${cmd.value}`);
                } else {
                    // this.debugLog(`Coil at ${cmd.address} already correct: ${currentValue}`);
                }
            } catch (error) {
                console.error(`Error reading coil ${cmd.address}: ${(error as Error).message}`);
                coilCommandsToExecute.push(cmd); // Nếu đọc lỗi, thêm vào để thử ghi lại
            }
        }

        // Nếu không có lệnh nào cần thực thi, trả về false ngay lập tức
        if (holdingCommandsToExecute.length === 0 && coilCommandsToExecute.length === 0) {
            // this.debugLog(`All registers and coils for schedule ${schedule.name} are already in correct state. No re-execution needed.`);
            return false;
        }

        // Thực thi các lệnh cần cập nhật
        const report = await this.executeModbusCommands(modbusClient, {
            holdingCommands: holdingCommandsToExecute,
            coilCommands: coilCommandsToExecute
        });

        const writeSuccess = failedOutcomes(report).length === 0;
        if (writeSuccess) {
            this.debugLog(`Successfully re-executed necessary commands for schedule ${schedule.name}`);
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
        this.debugLog(`Stored active commands for schedule ${scheduleId}: ${JSON.stringify(commands)}`);
    }

    applyStartCommandStore(scheduleName: string, commands: ModbusCmd[]): void {
        this.storeActiveCommands(scheduleName, commands);
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
        this.debugLog(`Cleared active commands for schedule ${scheduleId}`);
    }

    /**
     * Clear schedule status history for a schedule (call after successful finish)
     * This ensures the next run will trigger notifications properly
     */
    clearScheduleStatusHistory(scheduleId: string): void {
        if (!this.node) return;

        const statusHistory: Record<string, string> = this.node.context().global.get("scheduleStatusHistory") as Record<string, string> || {};
        if (statusHistory[scheduleId]) {
            this.debugLog(`Clearing status history for ${scheduleId} (was: ${statusHistory[scheduleId]})`);
            delete statusHistory[scheduleId];
            this.node.context().global.set("scheduleStatusHistory", statusHistory);
        }
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
     * Coerce a value to match the declared type from configKeys.
     * Allows flexible cross-type values: 1/0 as boolean, true/false as number.
     */
    private coerceToDeclaredType(value: any, declaredType: string): any {
        if (declaredType === 'boolean') {
            if (value === 1 || value === '1') return true;
            if (value === 0 || value === '0') return false;
            if (typeof value === 'boolean') return value;
            if (typeof value === 'string') {
                const lower = value.toLowerCase().trim();
                if (lower === 'true') return true;
                if (lower === 'false') return false;
            }
        } else if (declaredType === 'number') {
            if (value === true) return 1;
            if (value === false) return 0;
            if (typeof value === 'number') return value;
            if (typeof value === 'string') {
                const num = Number(value);
                if (!isNaN(num)) return num;
            }
        }
        return value;
    }

    /**
     * Get schedule configuration values from global context
     * Note: For RPC control commands, use configKeyValues instead
     */
    private getScheduleConfigValues(): ScheduleConfigValues {
        return this.node?.context().global.get("configKeyValues") as ScheduleConfigValues || {};
    }

    /**
     * Set schedule configuration values in global context
     * Note: For RPC control commands, use configKeyValues instead
     */
    private setScheduleConfigValues(values: ScheduleConfigValues): void {
        this.node?.context().global.set("configKeyValues", values);
        this.markConfigKeyValuesUpdated();
        this.debugLog(`Updated schedule config values: ${JSON.stringify(values)}`);
    }

    /**
     * Get configKeyValues from global context (for RPC control commands)
     */
    private getConfigKeyValues(): Record<string, any> {
        return this.node?.context().global.get("configKeyValues") as Record<string, any> || {};
    }

    /**
     * Set configKeyValues in global context (for RPC control commands)
     */
    private setConfigKeyValues(values: Record<string, any>): void {
        this.node?.context().global.set("configKeyValues", values);
        this.markConfigKeyValuesUpdated();
        this.debugLog(`Updated configKeyValues: ${JSON.stringify(values)}`);
    }

    /**
     * Mark configKeyValues mutation time so dependent modules can invalidate cache.
     */
    private markConfigKeyValuesUpdated(): void {
        this.node?.context().global.set(this.CONFIG_KEY_VALUES_UPDATED_AT, Date.now());
    }

    /**
     * Store configuration parameter (for schedule execution)
     * Also tracks which keys belong to which schedule for cleanup on finish
     */
    private storeConfigParameter(key: string, value: any, scheduleId: string): ConfigParameter | null {
        // Coerce value to declared type from configKeys before validation
        // e.g. 1 for boolean key → true, false for number key → 0
        let coercedValue = value;
        const configKeys = this.node?.context().global.get("configKeys") as Record<string, string> || {};
        const declaredType = configKeys[key];
        if (declaredType) {
            coercedValue = this.coerceToDeclaredType(value, declaredType);
        }

        // Skip all falsy values AFTER type coercion
        if (this.isFalsyValue(coercedValue)) {
            console.warn(`Skipping config parameter storage for ${key}: value is falsy (schedule: ${scheduleId})`);
            return null;
        }

        const validatedValue = this.validateAndConvertValue(key, coercedValue);
        const type = (declaredType as 'number' | 'boolean' | 'string') || this.detectParameterType(validatedValue);

        const configParam: ConfigParameter = {
            key,
            value: validatedValue,
            type,
            timestamp: Date.now(),
            scheduleId
        };

        // Store in global context (configKeyValues for schedule execution)
        const currentConfig = this.getScheduleConfigValues();
        currentConfig[key] = validatedValue;
        this.setScheduleConfigValues(currentConfig);

        // Track which keys belong to this schedule for cleanup on finish
        this.addScheduleConfigKey(scheduleId, key);

        this.debugLog(`Stored config parameter: ${key}=${validatedValue} (type: ${type}) for schedule ${scheduleId}`);
        return configParam;
    }

    /**
     * Track a config key as belonging to a specific schedule
     */
    private addScheduleConfigKey(scheduleId: string, key: string): void {
        const scheduleConfigKeys: Record<string, string[]> = this.getScheduleConfigKeys();
        if (!scheduleConfigKeys[scheduleId]) {
            scheduleConfigKeys[scheduleId] = [];
        }
        if (!scheduleConfigKeys[scheduleId].includes(key)) {
            scheduleConfigKeys[scheduleId].push(key);
            this.debugLog(`Tracked config key ${key} for schedule ${scheduleId}`);
        }
        this.setScheduleConfigKeys(scheduleConfigKeys);
    }

    /**
     * Get tracked config keys for all schedules
     */
    private getScheduleConfigKeys(): Record<string, string[]> {
        return this.node?.context().global.get("scheduleConfigKeys") as Record<string, string[]> || {};
    }

    /**
     * Set tracked config keys for all schedules
     */
    private setScheduleConfigKeys(keys: Record<string, string[]>): void {
        this.node?.context().global.set("scheduleConfigKeys", keys);
    }

    /**
     * Reset configKeyValues to falsy defaults when a schedule finishes.
     * Returns the reset values so they can be published via MQTT telemetry.
     */
    clearScheduleConfigValues(scheduleId: string): Record<string, any> {
        const scheduleConfigKeys = this.getScheduleConfigKeys();
        const keysForThisSchedule = scheduleConfigKeys[scheduleId] || [];
        const resetValues: Record<string, any> = {};

        if (keysForThisSchedule.length === 0) {
            this.debugLog(`No config keys to clear for schedule ${scheduleId}`);
            return resetValues;
        }

        const currentConfig = this.getConfigKeyValues();
        const configKeys = this.node?.context().global.get("configKeys") as Record<string, string> || {};

        for (const key of keysForThisSchedule) {
            if (key in currentConfig) {
                const declaredType = configKeys[key];
                const falsyValue = this.getFalsyDefaultValue(declaredType);
                resetValues[key] = falsyValue;
                currentConfig[key] = falsyValue;
            }
        }

        this.setConfigKeyValues(currentConfig);

        // Clear schedule config key tracking
        delete scheduleConfigKeys[scheduleId];
        this.setScheduleConfigKeys(scheduleConfigKeys);

        if (this.node) {
            this.node.warn(`🧹 RESET ${keysForThisSchedule.length} config values for finished schedule ${scheduleId}: [${keysForThisSchedule.join(', ')}]`);
        }

        this.debugLog(`Reset ${keysForThisSchedule.length} config values for schedule ${scheduleId}`);
        return resetValues;
    }

    /**
     * Get the appropriate falsy default value based on declared type
     */
    private getFalsyDefaultValue(declaredType?: string): any {
        if (declaredType === 'number') return 0;
        if (declaredType === 'boolean') return false;
        if (declaredType === 'string') return '';
        return false;
    }

    /**
     * Process RPC control command - write to configKeyValues if not found in modbus mapping
     */
    public processRpcControlCommand(key: string, value: any): { success: boolean; action: 'modbus' | 'config'; result?: any } {
        try {
            // Skip all falsy values: 0, "0", false, "false", null, undefined, ""
            if (this.isFalsyValue(value)) {
                console.warn(`Skipping RPC control command for ${key}: value is falsy`);
                return {
                    success: false,
                    action: 'config',
                    result: { key, error: 'Falsy value not allowed' }
                };
            }

            // Get modbus mappings
            const modbusCoils: Record<string, number> = this.getAllModbusCoils();
            const modbusHolding: Record<string, number> = this.getAllModbusHoldingRegisters();

            // Check if key exists in modbus mapping
            if (modbusCoils.hasOwnProperty(key) || modbusHolding.hasOwnProperty(key)) {
                // Key found in modbus mapping - should be handled by modbus logic
                this.debugLog(`RPC control key ${key} found in modbus mapping, should be handled by modbus`);

                const isCoil = modbusCoils.hasOwnProperty(key);
                const address = isCoil ? modbusCoils[key] : modbusHolding[key];

                return {
                    success: true,
                    action: 'modbus',
                    result: {
                        address: address,
                        type: isCoil ? 'coil' : 'holding'
                    }
                };
            } else {
                // Key not found in modbus mapping - write to configKeyValues
                console.warn(`RPC control key ${key} not found in modbus mapping, storing in configKeyValues`);

                const validatedValue = this.validateAndConvertValue(key, value);
                const currentConfig = this.getConfigKeyValues();
                currentConfig[key] = validatedValue;
                this.setConfigKeyValues(currentConfig);

                this.debugLog(`Stored RPC control parameter in configKeyValues: ${key}=${validatedValue}`);
                return {
                    success: true,
                    action: 'config',
                    result: { key, value: validatedValue }
                };
            }
        } catch (error) {
            console.error(`Error processing RPC control command ${key}: ${(error as Error).message}`);
            return { success: false, action: 'config' };
        }
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
            const cacheKey = `config:${configParam.key}`;
            if (!this.hasPublishedValueChanged(cacheKey, configParam.value)) {
                this.debugLog(`Skipping unchanged config publish: ${configParam.key}=${configParam.value}`);
                return;
            }

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
            this.debugLog(`Published config update to ThingsBoard: ${configParam.key}=${configParam.value}`);

            // Publish to EMQX local
            const deviceId = this.globalHelper ? this.globalHelper.getEnvVar("DEVICE_ID", "unknown") : "unknown";
            const emqxTopic = `viis/things/v2/${deviceId}/telemetry`;
            await emqxClient.publish(emqxTopic, payloadString);
            this.debugLog(`Published config update to EMQX local: ${configParam.key}=${configParam.value}`);
            this.updatePublishedValueCache({ [cacheKey]: configParam.value });

        } catch (error) {
            console.error(`Error publishing config update for ${configParam.key}: ${(error as Error).message}`);
            if (this.node && typeof this.node.warn === "function") {
                this.node.warn(`⚠️  Continuing local operations despite MQTT publish failure for ${configParam.key}`);
            }
            // Don't throw - let local services continue even if MQTT fails
        }
    }

    // ==================== RESILIENCE METHODS ====================

    /**
     * Execute operation with timeout protection
     */
    async executeWithTimeout<T>(
        operation: () => Promise<T>,
        timeoutMs: number,
        timeoutMessage?: string
    ): Promise<T> {
        return executeWithTimeout(operation, timeoutMs, timeoutMessage);
    }

    /**
     * Execute operation with exponential backoff retry
     */
    async executeWithExponentialBackoff<T>(
        operation: () => Promise<T>,
        maxRetries: number,
        baseDelay: number,
        maxDelay: number = 30000,
        useJitter: boolean = true
    ): Promise<T> {
        return executeWithExponentialBackoff(operation, maxRetries, baseDelay, maxDelay, useJitter);
    }

    /**
     * Get circuit breaker state
     */
    getCircuitBreakerState(key: string) {
        return CircuitBreakerManager.getInstance().getState(key);
    }

    /**
     * Update circuit breaker state
     */
    updateCircuitBreakerState(key: string, state: any) {
        CircuitBreakerManager.getInstance().updateState(key, state);
    }

    /**
     * Execute operation with circuit breaker protection
     */
    async executeWithCircuitBreaker<T>(
        operation: () => Promise<T>,
        circuitKey: string,
        failureThreshold: number,
        resetTimeout: number
    ): Promise<T> {
        return executeWithCircuitBreaker(operation, circuitKey, {
            failureThreshold,
            resetTimeout
        });
    }

    /**
     * Execute operation with combined resilience patterns
     */
    async executeWithResilience<T>(
        operation: () => Promise<T>,
        options: ResilienceOptions
    ): Promise<T> {
        return executeWithResilience(operation, options);
    }

    /**
     * Publish MQTT notification with retry mechanism
     */
    async publishMqttNotificationWithRetry(
        thingsboardClient: MqttClientCore,
        emqxClient: MqttClientCore,
        schedule: TabiotSchedule,
        success: boolean,
        options?: {
            maxRetries?: number;
            baseDelay?: number;
            useExponentialBackoff?: boolean;
            queueOnFailure?: boolean;
            checkConnection?: boolean;
            attemptReconnect?: boolean;
        }
    ): Promise<void> {
        const {
            maxRetries = 3,
            baseDelay = 1000,
            useExponentialBackoff = true,
            queueOnFailure = false,
            checkConnection = false,
            attemptReconnect = false
        } = options || {};

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

        let thingsboardSuccess = false;
        let emqxSuccess = false;

        // Check connections if enabled
        if (checkConnection) {
            if (!thingsboardClient.isConnected()) {
                if (this.node) {
                    this.node.warn(`⚠️ ThingsBoard disconnected, skipping publish for ${schedule.name}`);
                }
                if (attemptReconnect && (thingsboardClient as any).reconnect) {
                    try {
                        await (thingsboardClient as any).reconnect();
                    } catch (error) {
                        this.debugLog(`Failed to reconnect ThingsBoard: ${(error as Error).message}`);
                    }
                }
            }
            if (!emqxClient.isConnected()) {
                if (this.node) {
                    this.node.warn(`⚠️ EMQX disconnected, skipping publish for ${schedule.name}`);
                }
                if (attemptReconnect && (emqxClient as any).reconnect) {
                    try {
                        await (emqxClient as any).reconnect();
                    } catch (error) {
                        this.debugLog(`Failed to reconnect EMQX: ${(error as Error).message}`);
                    }
                }
            }
        }

        // Publish to ThingsBoard with retry
        try {
            const thingsboardTopic = "v1/devices/me/telemetry";
            await this.executeWithExponentialBackoff(
                () => thingsboardClient.publish(thingsboardTopic, payloadString),
                maxRetries,
                baseDelay,
                30000,
                useExponentialBackoff
            );
            thingsboardSuccess = true;
            this.debugLog(`Published MQTT notification to ThingsBoard for ${schedule.name}`);
        } catch (error) {
            if (this.node) {
                this.node.warn(`⚠️ ThingsBoard MQTT failed after ${maxRetries} retries: ${(error as Error).message}`);
            }
        }

        // Publish to EMQX with retry
        try {
            const deviceId = this.globalHelper ? this.globalHelper.getEnvVar("DEVICE_ID", "unknown") : "unknown";
            const emqxTopic = `viis/things/v2/${deviceId}/telemetry`;
            await this.executeWithExponentialBackoff(
                () => emqxClient.publish(emqxTopic, payloadString),
                maxRetries,
                baseDelay,
                30000,
                useExponentialBackoff
            );
            emqxSuccess = true;
            this.debugLog(`Published MQTT notification to EMQX local for ${schedule.name}`);
        } catch (error) {
            if (this.node) {
                this.node.warn(`⚠️ EMQX MQTT failed after ${maxRetries} retries: ${(error as Error).message}`);
            }
        }

        // Log results
        if (thingsboardSuccess && emqxSuccess) {
            if (this.node) {
                this.node.warn(`📡 MQTT PUBLISHED: ${schedule.name} | Status: ${schedule.status} | Topics: ThingsBoard + EMQX`);
            }
        } else if (thingsboardSuccess || emqxSuccess) {
            if (this.node) {
                const successBroker = thingsboardSuccess ? 'ThingsBoard' : 'EMQX';
                this.node.warn(`⚠️ MQTT PARTIAL SUCCESS: ${schedule.name} | ${successBroker} only`);
            }
        } else {
            if (this.node) {
                this.node.warn(`❌ MQTT COMPLETE FAILURE: ${schedule.name} | Both brokers failed`);
            }

            // Queue for later retry if enabled
            if (queueOnFailure) {
                MqttFailedQueue.getInstance().add({
                    schedule,
                    type: 'notification',
                    timestamp: Date.now()
                });
            }
        }
    }

    /**
     * Publish config update with retry mechanism
     */
    async publishConfigUpdateWithRetry(
        thingsboardClient: MqttClientCore,
        emqxClient: MqttClientCore,
        configParam: ConfigParameter,
        options?: {
            maxRetries?: number;
            baseDelay?: number;
        }
    ): Promise<void> {
        const { maxRetries = 2, baseDelay = 500 } = options || {};
        const cacheKey = `config:${configParam.key}`;

        if (!this.hasPublishedValueChanged(cacheKey, configParam.value)) {
            this.debugLog(`Skipping unchanged config publish with retry: ${configParam.key}=${configParam.value}`);
            return;
        }

        const payload = {
            ts: configParam.timestamp,
            [configParam.key]: configParam.value,
            note: `Config parameter updated (no Modbus mapping) for schedule ${configParam.scheduleId}`,
            type: configParam.type,
            source: "schedule-executor"
        };
        const payloadString = JSON.stringify(payload);

        let success = false;

        // Try ThingsBoard
        try {
            const thingsboardTopic = "v1/devices/me/telemetry";
            await this.executeWithExponentialBackoff(
                () => thingsboardClient.publish(thingsboardTopic, payloadString),
                maxRetries,
                baseDelay
            );
            success = true;
        } catch (error) {
            this.debugLog(`ThingsBoard config publish failed: ${(error as Error).message}`);
        }

        // Try EMQX
        try {
            const deviceId = this.globalHelper ? this.globalHelper.getEnvVar("DEVICE_ID", "unknown") : "unknown";
            const emqxTopic = `viis/things/v2/${deviceId}/telemetry`;
            await this.executeWithExponentialBackoff(
                () => emqxClient.publish(emqxTopic, payloadString),
                maxRetries,
                baseDelay
            );
            success = true;
        } catch (error) {
            this.debugLog(`EMQX config publish failed: ${(error as Error).message}`);
        }

        if (!success && this.node) {
            this.node.warn(`⚠️ CONFIG PUBLISH FAILED: ${configParam.key} for schedule ${configParam.scheduleId}`);
        }

        if (success) {
            this.updatePublishedValueCache({ [cacheKey]: configParam.value });
        }
    }

    /**
     * Get failed MQTT queue
     */
    getFailedMqttQueue() {
        return MqttFailedQueue.getInstance().getAll();
    }

    /**
     * Process failed MQTT queue
     */
    async processFailedMqttQueue(
        thingsboardClient: MqttClientCore,
        emqxClient: MqttClientCore
    ): Promise<void> {
        const queue = MqttFailedQueue.getInstance();
        const items = queue.getAll();

        for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];

            try {
                if (item.type === 'notification' && item.schedule) {
                    await this.publishMqttNotificationWithRetry(
                        thingsboardClient,
                        emqxClient,
                        item.schedule,
                        true,
                        { maxRetries: 1, baseDelay: 500 }
                    );
                    queue.remove(i);
                } else if (item.type === 'config' && item.configParam) {
                    await this.publishConfigUpdateWithRetry(
                        thingsboardClient,
                        emqxClient,
                        item.configParam,
                        { maxRetries: 1, baseDelay: 500 }
                    );
                    queue.remove(i);
                }
            } catch (error) {
                queue.incrementAttempts(i);
                // Remove if too many attempts
                if (item.attempts >= 5) {
                    queue.remove(i);
                }
            }
        }
    }

    /**
     * Send notification to backend via HTTP API
     * This bypasses MQTT ThingsBoard and sends directly to backend
     * Note: Error notifications (success=false) are only sent when debugEnable is true
     */
    async sendNotificationToBackend(
        schedule: TabiotSchedule,
        action: 'start' | 'end',
        success: boolean = true,
        options?: {
            maxRetries?: number;
            baseDelay?: number;
            timeout?: number;
        }
    ): Promise<boolean> {
        const {
            maxRetries = 3,
            baseDelay = 1000,
            timeout = 10000
        } = options || {};

        // Skip error notifications when debug is disabled
        if (!success && !this.debugEnable) {
            if (this.node) {
                this.node.warn(`⚠️ Error notification skipped (debug disabled): ${schedule.name} | Action: ${action}`);
            }
            return true; // Return true to indicate "success" (notification intentionally skipped)
        }

        // Get backend URL and device access token from global context
        const backendUrl = this.globalHelper
            ? this.globalHelper.getEnvVar('VIIS_BACKEND', '')
            : '';

        const deviceAccessToken = this.globalHelper
            ? this.globalHelper.getEnvVar('DEVICE_ACCESS_TOKEN', '')
            : '';

        const deviceId = this.globalHelper
            ? this.globalHelper.getEnvVar('DEVICE_ID', 'unknown')
            : 'unknown';

        if (!backendUrl || !deviceAccessToken) {
            if (this.node) {
                this.node.warn('⚠️ HTTP NOTIFICATION SKIPPED: Missing VIIS_BACKEND or DEVICE_ACCESS_TOKEN');
            }
            return false;
        }

        const isStart = action === 'start';
        // Set severity to 'error' for ANY failure (start or end)
        const severity = !success ? 'error' : 'notification';
        const alarmStatus = isStart ? 'Pending' : 'Clear';

        // Build notification message with i18n support
        let message: string;
        let messageKey: string | null = null;
        let messageParams: Record<string, any> | null = null;
        const retryCount = this.globalHelper?.getEnvVar('MODBUS_MAX_RETRIES', 3) || 3;

        if (isStart) {
            if (success) {
                message = `Lịch trình "${schedule.label || schedule.name}" đã bắt đầu chạy thành công`;
                messageKey = 'iot.notification.schedule.started';
                messageParams = { scheduleName: schedule.label || schedule.name };
            } else {
                message = `Lịch trình "${schedule.label || schedule.name}" không thể bắt đầu - Lỗi ghi Modbus sau ${retryCount} lần retry`;
                messageKey = 'iot.notification.schedule.failed';
                messageParams = { scheduleName: schedule.label || schedule.name, retryCount };
            }
        } else {
            if (success) {
                message = `Lịch trình "${schedule.label || schedule.name}" đã hoàn thành`;
                messageKey = 'iot.notification.schedule.completed';
                messageParams = { scheduleName: schedule.label || schedule.name };
            } else {
                message = `Lịch trình "${schedule.label || schedule.name}" đã kết thúc nhưng KHÔNG THỂ TẮT thiết bị - Lỗi ghi Modbus sau retry`;
                messageKey = 'iot.notification.schedule.failed';
                messageParams = { scheduleName: schedule.label || schedule.name };
            }
        }

        // Prepare request payload (ThingsboardAlarm format) with i18n support
        const payload = {
            alarm_name: schedule.label || schedule.name,
            id: deviceId,
            msg: message,
            message_key: messageKey,
            message_params: messageParams,
            message_locale: 'vi-VN',
            severity: severity,
            trigger_time: new Date().toISOString(),
            tb_alarm_id: schedule.name,
            alarm_status: alarmStatus,
            clear_by: isStart ? '' : 'Value',
            clear_by_user_id: '',
            entity: deviceId
        };

        const url = `${backendUrl}/api/v2/alarm/notification-by-token`;

        try {
            await this.executeWithResilience(
                async () => {
                    const response = await axios.post(url, payload, {
                        params: {
                            device_access_token: deviceAccessToken
                        },
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        timeout: timeout
                    });

                    if (response.status !== 200 && response.status !== 201) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }

                    return response.data;
                },
                {
                    maxRetries,
                    baseDelay,
                    maxDelay: 10000,
                    timeout,
                    circuitBreakerKey: 'backend-notification',
                    circuitBreakerThreshold: 5,
                    circuitBreakerTimeout: 30000
                }
            );

            if (this.node) {
                this.node.warn(`📡 HTTP NOTIFICATION SENT: ${schedule.name} | Action: ${action} | Status: ${alarmStatus}`);
            }

            return true;
        } catch (error) {
            const errorMessage = error instanceof AxiosError
                ? `${error.message} (${error.response?.status || 'N/A'})`
                : (error as Error).message;

            if (this.node) {
                this.node.warn(`❌ HTTP NOTIFICATION FAILED: ${schedule.name} | ${errorMessage}`);
            }

            return false;
        }
    }

    async sendKeyVerifyFailNotification(
        schedule: TabiotSchedule,
        action: ScheduleAction,
        outcome: KeyOutcome
    ): Promise<boolean> {
        const backendUrl = this.globalHelper
            ? this.globalHelper.getEnvVar('VIIS_BACKEND', '')
            : '';
        const deviceAccessToken = this.globalHelper
            ? this.globalHelper.getEnvVar('DEVICE_ACCESS_TOKEN', '')
            : '';
        const deviceId = this.globalHelper
            ? this.globalHelper.getEnvVar('DEVICE_ID', 'unknown')
            : 'unknown';

        if (!backendUrl || !deviceAccessToken) {
            if (this.node) {
                this.node.warn('⚠️ HTTP NOTIFICATION SKIPPED: Missing VIIS_BACKEND or DEVICE_ACCESS_TOKEN');
            }
            return false;
        }

        const payload = {
            alarm_name: schedule.label || schedule.name,
            id: deviceId,
            msg: `Lịch trình "${schedule.label || schedule.name}" verify fail: ${outcome.key} expected=${outcome.expected} read=${outcome.read ?? 'n/a'} attempts=${outcome.attempts}`,
            message_key: 'iot.notification.schedule.verify_failed',
            message_params: {
                scheduleName: schedule.label || schedule.name,
                key: outcome.key,
                expected: outcome.expected,
                read: outcome.read ?? null,
                attempts: outcome.attempts,
                action,
                error: outcome.error ?? null,
            },
            message_locale: 'vi-VN',
            severity: 'error',
            trigger_time: new Date().toISOString(),
            tb_alarm_id: `${schedule.name}:verify:${action}:${outcome.key}`,
            alarm_status: 'Pending',
            clear_by: '',
            clear_by_user_id: '',
            entity: deviceId,
        };
        const url = `${backendUrl}/api/v2/alarm/notification-by-token`;

        try {
            await this.executeWithResilience(
                async () => {
                    const response = await axios.post(url, payload, {
                        params: {
                            device_access_token: deviceAccessToken
                        },
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        timeout: 10000
                    });

                    if (response.status !== 200 && response.status !== 201) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }

                    return response.data;
                },
                {
                    maxRetries: 3,
                    baseDelay: 1000,
                    maxDelay: 10000,
                    timeout: 10000,
                    circuitBreakerKey: 'backend-notification',
                    circuitBreakerThreshold: 5,
                    circuitBreakerTimeout: 30000
                }
            );

            if (this.node) {
                this.node.warn(`📡 HTTP VERIFY FAIL: ${schedule.name} | ${outcome.key} | ${action}`);
            }
            return true;
        } catch (error) {
            const errorMessage = error instanceof AxiosError
                ? `${error.message} (${error.response?.status || 'N/A'})`
                : (error as Error).message;
            if (this.node) {
                this.node.warn(`❌ HTTP VERIFY FAIL NOTIFICATION: ${schedule.name} | ${errorMessage}`);
            }
            return false;
        }
    }

    /**
     * Send notification via both MQTT and HTTP (for backward compatibility and reliability)
     * @deprecated Consider using sendNotificationToBackend only for better performance
     */
    async sendNotificationDual(
        thingsboardClient: MqttClientCore,
        emqxClient: MqttClientCore,
        schedule: TabiotSchedule,
        action: 'start' | 'end',
        success: boolean = true,
        options?: {
            preferHttp?: boolean;  // If true, only send HTTP if it succeeds
            maxRetries?: number;
            baseDelay?: number;
        }
    ): Promise<void> {
        const { preferHttp = true } = options || {};

        // Try HTTP notification first (faster and more direct)
        const httpSuccess = await this.sendNotificationToBackend(
            schedule,
            action,
            success,
            options
        );

        // If HTTP succeeded and preferHttp is true, skip MQTT
        if (httpSuccess && preferHttp) {
            if (this.node) {
                this.node.warn(`✅ NOTIFICATION SENT: ${schedule.name} | Via HTTP only`);
            }
            return;
        }

        // Otherwise, also send via MQTT (fallback or dual mode)
        try {
            await this.publishMqttNotificationWithRetry(
                thingsboardClient,
                emqxClient,
                schedule,
                success,
                options
            );

            if (this.node) {
                const mode = httpSuccess ? 'HTTP + MQTT' : 'MQTT only (HTTP failed)';
                this.node.warn(`✅ NOTIFICATION SENT: ${schedule.name} | Via ${mode}`);
            }
        } catch (error) {
            if (!httpSuccess) {
                // Both failed
                if (this.node) {
                    this.node.warn(`❌ NOTIFICATION COMPLETE FAILURE: ${schedule.name} | Both HTTP and MQTT failed`);
                }
            }
        }
    }
}
