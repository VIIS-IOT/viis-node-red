"use strict";
/**
 * Schedule Mapper Service V2
 * Responsibility: Map schedules to Modbus commands
 *
 * This service extracts the schedule-to-Modbus mapping logic
 * It handles:
 * - Parsing schedule actions
 * - Mapping keys to Modbus addresses
 * - Handling unmapped keys as config parameters
 * - Normalizing values
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScheduleMapperService = void 0;
const global_context_helper_1 = require("../../../ultils/global-context-helper");
const schedule_utils_1 = require("../common/schedule-utils");
const viis_telemetry_constants_1 = require("../../viis-telemetry/viis-telemetry-constants");
class ScheduleMapperService {
    constructor(node, debugEnable = false) {
        this.luoiMapping = {
            luoi_1: { thu: "luoi_1_thu", dai: "luoi_1_dai" },
            luoi_2: { thu: "luoi_2_thu", dai: "luoi_2_dai" },
            luoi_3: { thu: "luoi_3_thu", dai: "luoi_3_dai" },
        };
        this.node = node;
        this.debugEnable = debugEnable;
        this.globalHelper = new global_context_helper_1.GlobalContextHelper(node.context());
    }
    /**
     * Debug logging helper
     */
    debugLog(message) {
        if (this.debugEnable) {
            this.node.warn(message);
        }
    }
    // ==================== LUOI MAPPING ====================
    /**
     * Normalize luoi command value to binary mode.
     * Returns:
     * - 0: thu=true, dai=false
     * - 1: thu=false, dai=true
     * - 2: N/A (no action — skip coil entirely)
     * - null: invalid value
     */
    normalizeLuoiValue(value) {
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
    expandLuoiActionParams(actionObj, scheduleName) {
        const expanded = Object.assign({}, actionObj);
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
            this.debugLog(`Expanded ${luoiKey}=${mode} -> ${mapping.thu}=${expanded[mapping.thu]}, ${mapping.dai}=${expanded[mapping.dai]}`);
        }
        return expanded;
    }
    // ==================== CONFIG KEY TRACKING ====================
    /**
     * Get tracked config keys for all schedules
     */
    getScheduleConfigKeys() {
        var _a;
        return ((_a = this.node) === null || _a === void 0 ? void 0 : _a.context().global.get("scheduleConfigKeys")) || {};
    }
    /**
     * Set tracked config keys for all schedules
     */
    setScheduleConfigKeys(keys) {
        var _a;
        (_a = this.node) === null || _a === void 0 ? void 0 : _a.context().global.set("scheduleConfigKeys", keys);
    }
    /**
     * Track a config key as belonging to a specific schedule
     */
    addScheduleConfigKey(scheduleId, key) {
        const scheduleConfigKeys = this.getScheduleConfigKeys();
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
     * Get configKeyValues from global context
     */
    getConfigKeyValues() {
        var _a;
        return ((_a = this.node) === null || _a === void 0 ? void 0 : _a.context().global.get("configKeyValues")) || {};
    }
    /**
     * Set configKeyValues in global context
     */
    setConfigKeyValues(values) {
        var _a, _b;
        (_a = this.node) === null || _a === void 0 ? void 0 : _a.context().global.set("configKeyValues", values);
        (_b = this.node) === null || _b === void 0 ? void 0 : _b.context().global.set("configKeyValuesUpdatedAt", Date.now());
        this.debugLog(`Updated configKeyValues: ${JSON.stringify(values)}`);
    }
    /**
     * Get the appropriate falsy default value based on declared type
     */
    getFalsyDefaultValue(declaredType) {
        if (declaredType === 'number')
            return 0;
        if (declaredType === 'boolean')
            return false;
        if (declaredType === 'string')
            return '';
        return false;
    }
    /**
     * Reset configKeyValues to falsy defaults when a schedule finishes.
     * Returns the reset values so they can be published via MQTT telemetry.
     */
    clearScheduleConfigValues(scheduleId) {
        var _a;
        const scheduleConfigKeys = this.getScheduleConfigKeys();
        const keysForThisSchedule = scheduleConfigKeys[scheduleId] || [];
        const resetValues = {};
        if (keysForThisSchedule.length === 0) {
            this.debugLog(`No config keys to clear for schedule ${scheduleId}`);
            return resetValues;
        }
        const currentConfig = this.getConfigKeyValues();
        const configKeys = ((_a = this.node) === null || _a === void 0 ? void 0 : _a.context().global.get("configKeys")) || {};
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
    // ==================== SCALE ====================
    /**
     * Scale a value based on configuration
     * @param key - Parameter key
     * @param value - Value to scale
     * @param direction - 'read' or 'write'
     * @returns Scaled value or original if no config
     */
    scaleValue(key, value, direction) {
        const scaleConfigs = this.node.context().global.get(viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.SCALE_CONFIGS) || [];
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
     * Load all Modbus coils from environment variables
     * Supports both legacy single-board and multi-board configurations
     */
    loadAllModbusCoils() {
        let allCoils = {};
        // Try to load legacy single-board coils
        const legacyCoils = this.globalHelper.getJsonEnvVar("MODBUS_COILS", {});
        if (Object.keys(legacyCoils).length > 0) {
            this.debugLog(`Loaded ${Object.keys(legacyCoils).length} legacy coil mappings`);
            allCoils = Object.assign(Object.assign({}, allCoils), legacyCoils);
        }
        // Check for multi-board mode
        const boardsConfigStr = this.globalHelper.getEnvVar('MODBUS_BOARDS', null);
        if (boardsConfigStr) {
            try {
                let boards;
                if (Array.isArray(boardsConfigStr)) {
                    boards = boardsConfigStr;
                }
                else if (typeof boardsConfigStr === 'string') {
                    boards = JSON.parse(boardsConfigStr);
                }
                else {
                    this.debugLog(`Invalid MODBUS_BOARDS type: ${typeof boardsConfigStr}`);
                    return allCoils;
                }
                if (Array.isArray(boards) && boards.length > 0) {
                    this.debugLog(`Multi-board mode detected with ${boards.length} boards`);
                    for (const board of boards) {
                        const boardId = board.id.toUpperCase();
                        const boardCoils = this.globalHelper.getJsonEnvVar(`MODBUS_${boardId}_COILS`, {});
                        if (Object.keys(boardCoils).length > 0) {
                            this.debugLog(`Loaded ${Object.keys(boardCoils).length} coil mappings from board ${board.id}`);
                            allCoils = Object.assign(Object.assign({}, allCoils), boardCoils);
                        }
                    }
                }
            }
            catch (e) {
                this.node.error(`Error parsing MODBUS_BOARDS: ${e}`);
            }
        }
        this.debugLog(`Total coil mappings loaded: ${Object.keys(allCoils).length}`);
        return allCoils;
    }
    /**
     * Load all Modbus holding registers from environment variables
     * Supports both legacy single-board and multi-board configurations
     */
    loadAllModbusHoldingRegisters() {
        let allHolding = {};
        // Try to load legacy single-board holding registers
        const legacyHolding = this.globalHelper.getJsonEnvVar("MODBUS_HOLDING_REGISTERS", {});
        if (Object.keys(legacyHolding).length > 0) {
            this.debugLog(`Loaded ${Object.keys(legacyHolding).length} legacy holding register mappings`);
            allHolding = Object.assign(Object.assign({}, allHolding), legacyHolding);
        }
        // Check for multi-board mode
        const boardsConfigStr = this.globalHelper.getEnvVar('MODBUS_BOARDS', null);
        if (boardsConfigStr) {
            try {
                let boards;
                if (Array.isArray(boardsConfigStr)) {
                    boards = boardsConfigStr;
                }
                else if (typeof boardsConfigStr === 'string') {
                    boards = JSON.parse(boardsConfigStr);
                }
                else {
                    this.debugLog(`Invalid MODBUS_BOARDS type: ${typeof boardsConfigStr}`);
                    return allHolding;
                }
                if (Array.isArray(boards) && boards.length > 0) {
                    this.debugLog(`Multi-board mode detected with ${boards.length} boards`);
                    for (const board of boards) {
                        const boardId = board.id.toUpperCase();
                        const boardHolding = this.globalHelper.getJsonEnvVar(`MODBUS_${boardId}_HOLDING_REGISTERS`, {});
                        if (Object.keys(boardHolding).length > 0) {
                            this.debugLog(`Loaded ${Object.keys(boardHolding).length} holding register mappings from board ${board.id}`);
                            allHolding = Object.assign(Object.assign({}, allHolding), boardHolding);
                        }
                    }
                }
            }
            catch (e) {
                this.node.error(`Error parsing MODBUS_BOARDS: ${e}`);
            }
        }
        this.debugLog(`Total holding register mappings loaded: ${Object.keys(allHolding).length}`);
        return allHolding;
    }
    /**
     * Store configuration parameter for unmapped keys
     * Also tracks which keys belong to which schedule for cleanup on finish
     * @param key - Parameter key
     * @param value - Parameter value
     * @param scheduleId - Schedule ID
     * @returns ConfigParameter or null
     */
    storeConfigParameter(key, value, scheduleId) {
        try {
            // Determine type
            let type = 'string';
            if (typeof value === 'boolean') {
                type = 'boolean';
            }
            else if (typeof value === 'number') {
                type = 'number';
            }
            else if (typeof value === 'string') {
                const numValue = Number(value);
                if (!isNaN(numValue)) {
                    type = 'number';
                    value = numValue;
                }
                else if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
                    type = 'boolean';
                    value = value.toLowerCase() === 'true';
                }
            }
            const configParam = {
                key,
                value,
                type,
                timestamp: Date.now(),
                scheduleId
            };
            // Store in global context (configKeyValues — same key as V1 for backward compatibility)
            const currentConfig = this.getConfigKeyValues();
            currentConfig[key] = value;
            this.setConfigKeyValues(currentConfig);
            // Track which keys belong to this schedule for cleanup on finish
            this.addScheduleConfigKey(scheduleId, key);
            return configParam;
        }
        catch (error) {
            this.node.error(`Failed to store config parameter ${key}: ${error.message}`);
            return null;
        }
    }
    /**
     * Get active commands for a schedule
     * @param scheduleName - Schedule name
     * @returns Array of active commands
     */
    getActiveCommands(scheduleName) {
        const globalContext = this.node.context().global;
        const activeCommands = globalContext.get('activeModbusCommands') || {};
        return activeCommands[scheduleName] || [];
    }
    /**
     * Clear active commands for a schedule
     * @param scheduleName - Schedule name
     */
    clearActiveCommands(scheduleName) {
        const globalContext = this.node.context().global;
        const activeCommands = globalContext.get('activeModbusCommands') || {};
        if (activeCommands[scheduleName]) {
            this.debugLog(`Clearing ${activeCommands[scheduleName].length} active commands for ${scheduleName}`);
            delete activeCommands[scheduleName];
            globalContext.set('activeModbusCommands', activeCommands);
        }
    }
    /**
     * Main mapping function - convert schedule to Modbus commands
     * @param schedule - Schedule to map
     * @returns Object with holding commands, coil commands, and config parameters
     */
    mapScheduleToModbus(schedule) {
        const holdingCommands = [];
        const coilCommands = [];
        const configParameters = [];
        if (!schedule.action) {
            this.node.warn(`Schedule ${schedule.name} has no action defined`);
            return { holdingCommands, coilCommands, configParameters };
        }
        try {
            const actionObj = JSON.parse(schedule.action);
            // Add iri_time if not present
            if (!('iri_time' in actionObj)) {
                if (schedule.start_time && schedule.end_time) {
                    const duration = (0, schedule_utils_1.calculateDurationSeconds)(schedule.start_time, schedule.end_time);
                    actionObj.iri_time = duration;
                }
                else {
                    actionObj.iri_time = 0;
                }
            }
            // Normalize numeric values
            for (const key in actionObj) {
                if (actionObj.hasOwnProperty(key)) {
                    actionObj[key] = (0, schedule_utils_1.normalizeNumericValue)(actionObj[key]);
                }
            }
            // Expand abstract luoi keys (luoi_1/2/3 → luoi_X_thu/dai)
            const expandedActionObj = this.expandLuoiActionParams(actionObj, schedule.name);
            // Load Modbus mappings
            const modbusCoils = this.loadAllModbusCoils();
            const modbusHolding = this.loadAllModbusHoldingRegisters();
            // Process each key in expanded action
            for (const key in expandedActionObj) {
                if (expandedActionObj.hasOwnProperty(key)) {
                    let value = expandedActionObj[key];
                    // Convert string booleans to actual booleans
                    if (typeof value === "string") {
                        if (value.toLowerCase() === "true") {
                            value = true;
                        }
                        else if (value.toLowerCase() === "false") {
                            value = false;
                        }
                    }
                    // Skip falsy values
                    if ((0, schedule_utils_1.isFalsyValue)(value)) {
                        this.debugLog(`Skipping falsy value for key "${key}": ${JSON.stringify(value)} in schedule ${schedule.name}`);
                        continue;
                    }
                    // Map to Modbus
                    if (modbusHolding.hasOwnProperty(key)) {
                        holdingCommands.push({
                            key,
                            value: Number(value),
                            fc: 6,
                            unitid: 1,
                            address: modbusHolding[key],
                            quantity: 1
                        });
                        this.debugLog(`Mapped ${key} to holding register at address ${modbusHolding[key]}`);
                    }
                    else if (modbusCoils.hasOwnProperty(key)) {
                        coilCommands.push({
                            key,
                            value: Boolean(value),
                            fc: 5,
                            unitid: 1,
                            address: modbusCoils[key],
                            quantity: 1
                        });
                        this.debugLog(`Mapped ${key} to coil at address ${modbusCoils[key]}`);
                    }
                    else {
                        // Handle as config parameter
                        this.debugLog(`No modbus mapping for ${key}, storing as config parameter`);
                        try {
                            const configParam = this.storeConfigParameter(key, value, schedule.name);
                            if (configParam) {
                                configParameters.push(configParam);
                            }
                        }
                        catch (error) {
                            this.node.error(`Failed to store config parameter ${key}: ${error.message}`);
                        }
                    }
                }
            }
        }
        catch (error) {
            this.node.error(`Error parsing action for schedule ${schedule.name}: ${error.message}`);
        }
        return { holdingCommands, coilCommands, configParameters };
    }
    /**
     * Get all Modbus coils (public wrapper)
     */
    getAllModbusCoils() {
        return this.loadAllModbusCoils();
    }
    /**
     * Get all Modbus holding registers (public wrapper)
     */
    getAllModbusHoldingRegisters() {
        return this.loadAllModbusHoldingRegisters();
    }
}
exports.ScheduleMapperService = ScheduleMapperService;
