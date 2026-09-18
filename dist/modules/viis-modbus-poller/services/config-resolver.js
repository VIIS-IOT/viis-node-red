"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.partitionPollingConfig = partitionPollingConfig;
exports.resolvePollerConfig = resolvePollerConfig;
const viis_telemetry_constants_1 = require("../../viis-telemetry/viis-telemetry-constants");
const scale_config_merger_1 = require("./scale-config-merger");
function readGlobal(globalContext, keys) {
    for (const key of keys) {
        const value = globalContext.get(key);
        if (value !== undefined && value !== null && value !== "") {
            return { key, value };
        }
    }
    return { key: keys[0], value: undefined };
}
function parseJsonString(value, label) {
    try {
        return JSON.parse(value);
    }
    catch (error) {
        throw new Error(`Invalid JSON in ${label}: ${error.message}`);
    }
}
function parseConfigValue(value, label) {
    if (typeof value !== "string") {
        return value;
    }
    return parseJsonString(value, label);
}
function parseOptionalArray(value, label) {
    if (value === undefined || value === null || value === "") {
        return [];
    }
    const parsed = parseConfigValue(value, label);
    if (!Array.isArray(parsed)) {
        throw new Error(`${label} must be an array`);
    }
    return parsed;
}
function readBoardId(nodeConfig, globalContext) {
    var _a;
    if ((_a = nodeConfig.boardId) === null || _a === void 0 ? void 0 : _a.trim()) {
        return nodeConfig.boardId.trim();
    }
    const boardId = readGlobal(globalContext, ["modbusDefaultBoard", "modbus_default_board"]).value;
    return typeof boardId === "string" && boardId.trim() ? boardId.trim() : "board1";
}
function readDeviceId(globalContext) {
    const deviceId = readGlobal(globalContext, ["device_id", "DEVICE_ID"]).value;
    return typeof deviceId === "string" && deviceId.trim() ? deviceId.trim() : "unknown_device";
}
function readConfigObject(globalContext, keys, fallback) {
    const entry = readGlobal(globalContext, keys);
    if (entry.value === undefined) {
        return fallback;
    }
    return parseConfigValue(entry.value, `global context key ${entry.key}`);
}
function readMappingRecord(globalContext, boardMapping, preferredKey, fallbackKey) {
    const preferred = boardMapping === null || boardMapping === void 0 ? void 0 : boardMapping[preferredKey];
    if (preferred !== undefined && preferred !== null) {
        return parseConfigValue(preferred, `modbusMappings board ${preferredKey}`);
    }
    const fallback = globalContext.get(fallbackKey);
    if (fallback === undefined || fallback === null || fallback === "") {
        return {};
    }
    return parseConfigValue(fallback, `global context key ${fallbackKey}`);
}
function readMappings(globalContext, boardId) {
    const allMappings = readConfigObject(globalContext, ["modbusMappings"], undefined);
    const boardMapping = allMappings === null || allMappings === void 0 ? void 0 : allMappings[boardId];
    return {
        coils: readMappingRecord(globalContext, boardMapping, "coils", `modbus_${boardId}_coils`),
        input: readMappingRecord(globalContext, boardMapping, "inputRegisters", `modbus_${boardId}_input_registers`),
        holding: readMappingRecord(globalContext, boardMapping, "holdingRegisters", `modbus_${boardId}_holding_registers`),
    };
}
function readScaleConfigs(nodeConfig, globalContext) {
    const globalScaleConfigs = parseOptionalArray(globalContext.get(viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.SCALE_CONFIGS), `global context key ${viis_telemetry_constants_1.GLOBAL_CONTEXT_KEYS.SCALE_CONFIGS}`);
    const envLoaderScaleConfigs = parseOptionalArray(readGlobal(globalContext, ["scale_configs", "scaleConfigs", "SCALE_CONFIGS"]).value, "global context scale configs");
    const overrides = parseOptionalArray(nodeConfig.scaleConfigOverrides, "node config scaleConfigOverrides");
    const mergedGlobalConfigs = (0, scale_config_merger_1.mergeScaleConfigs)(globalScaleConfigs, envLoaderScaleConfigs);
    return (0, scale_config_merger_1.mergeScaleConfigs)(mergedGlobalConfigs, overrides);
}
function hasMappingKey(mappings, registerType, key) {
    return Object.prototype.hasOwnProperty.call(mappings[registerType], key);
}
function partitionPollingConfig(pollingConfig, mappings) {
    var _a, _b, _c;
    const partitioned = {};
    for (const [groupName, group] of Object.entries(pollingConfig !== null && pollingConfig !== void 0 ? pollingConfig : {})) {
        partitioned[groupName] = {
            interval: group.interval,
            coils: ((_a = group.coils) !== null && _a !== void 0 ? _a : []).filter((key) => hasMappingKey(mappings, "coils", key)),
            input: ((_b = group.input) !== null && _b !== void 0 ? _b : []).filter((key) => hasMappingKey(mappings, "input", key)),
            holding: ((_c = group.holding) !== null && _c !== void 0 ? _c : []).filter((key) => hasMappingKey(mappings, "holding", key)),
        };
    }
    return partitioned;
}
function readConfiguredBoards(globalContext) {
    const entry = readGlobal(globalContext, ["modbusBoards", "modbus_boards"]);
    if (entry.value === undefined) {
        return [];
    }
    const parsed = parseConfigValue(entry.value, `global context key ${entry.key}`);
    if (!Array.isArray(parsed)) {
        return [];
    }
    return parsed
        .filter((board) => board && typeof board.id === "string" && board.id.trim())
        .map((board) => ({
        id: String(board.id).trim(),
        unitId: Number(board.unitId) > 0 ? Number(board.unitId) : 1,
    }));
}
function resolvePollerConfig(nodeConfig, globalContext) {
    var _a, _b;
    const fallbackBoardId = readBoardId(nodeConfig, globalContext);
    const configuredBoards = readConfiguredBoards(globalContext);
    const pollingConfig = readConfigObject(globalContext, ["modbusPollGroups", "modbus_poll_groups", "pollingConfig"], {});
    const boardIds = configuredBoards.length > 0
        ? configuredBoards.map((board) => board.id)
        : [fallbackBoardId];
    const boards = boardIds.map((boardId) => {
        var _a, _b;
        const mappings = readMappings(globalContext, boardId);
        return {
            boardId,
            unitId: (_b = (_a = configuredBoards.find((board) => board.id === boardId)) === null || _a === void 0 ? void 0 : _a.unitId) !== null && _b !== void 0 ? _b : 1,
            mappings,
            pollingConfig: partitionPollingConfig(pollingConfig, mappings),
        };
    });
    const primary = boards[0];
    return {
        deviceId: readDeviceId(globalContext),
        boardId: (_a = primary === null || primary === void 0 ? void 0 : primary.boardId) !== null && _a !== void 0 ? _a : fallbackBoardId,
        pollingConfig,
        mappings: (_b = primary === null || primary === void 0 ? void 0 : primary.mappings) !== null && _b !== void 0 ? _b : { coils: {}, input: {}, holding: {} },
        thresholds: readConfigObject(globalContext, ["modbusPublishThresholds", "modbus_publish_thresholds", "modbusThresholds"], {}),
        scaleConfigs: readScaleConfigs(nodeConfig, globalContext),
        boards,
    };
}
