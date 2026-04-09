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
class ScheduleMapperService {
    constructor(node, debugEnable = false) {
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
    /**
     * Scale a value based on configuration
     * @param key - Parameter key
     * @param value - Value to scale
     * @param direction - 'read' or 'write'
     * @returns Scaled value or original if no config
     */
    scaleValue(key, value, direction) {
        const scaleConfigs = this.node.context().global.get("scaleConfigs") || [];
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
            // Store in global context
            const globalContext = this.node.context().global;
            const configValues = globalContext.get('scheduleConfigValues') || {};
            configValues[key] = configParam;
            globalContext.set('scheduleConfigValues', configValues);
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
            // Load Modbus mappings
            const modbusCoils = this.loadAllModbusCoils();
            const modbusHolding = this.loadAllModbusHoldingRegisters();
            // Process each key in action
            for (const key in actionObj) {
                if (actionObj.hasOwnProperty(key)) {
                    let value = actionObj[key];
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
