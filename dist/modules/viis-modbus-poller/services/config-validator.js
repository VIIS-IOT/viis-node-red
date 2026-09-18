"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateResolvedConfig = validateResolvedConfig;
const constants_1 = require("../constants");
const REGISTER_TYPES = ["coils", "input", "holding"];
function hasOwn(record, key) {
    return Object.prototype.hasOwnProperty.call(record, key);
}
function isReadableAddress(address) {
    return (Number.isInteger(address) &&
        address >= 0 &&
        !constants_1.INVALID_MODBUS_ADDRESSES.includes(address));
}
function addDuplicateAddressWarnings(mappings, warnings, boardId) {
    var _a, _b;
    const prefix = boardId ? `${boardId} ` : "";
    for (const registerType of REGISTER_TYPES) {
        const keysByAddress = new Map();
        for (const [key, address] of Object.entries((_a = mappings[registerType]) !== null && _a !== void 0 ? _a : {})) {
            if (!isReadableAddress(address)) {
                continue;
            }
            const aliases = (_b = keysByAddress.get(address)) !== null && _b !== void 0 ? _b : [];
            aliases.push(key);
            keysByAddress.set(address, aliases);
        }
        for (const [address, keys] of keysByAddress.entries()) {
            if (keys.length > 1) {
                warnings.push(`${prefix}${registerType} address ${address} is used by keys: ${keys.join(", ")}`);
            }
        }
    }
}
function getBoardConfigs(config) {
    if (config.boards && config.boards.length > 0) {
        return config.boards;
    }
    return [
        {
            boardId: config.boardId,
            unitId: 1,
            mappings: config.mappings,
            pollingConfig: config.pollingConfig,
        },
    ];
}
function findKeyOwners(boards, registerType, key) {
    return boards.filter((board) => hasOwn(board.mappings[registerType], key));
}
function validatePollKey(config, boards, groupName, registerType, key, errors) {
    const owners = findKeyOwners(boards, registerType, key);
    const thresholds = config.thresholds;
    if (owners.length === 0) {
        errors.push(`${groupName}.${registerType} references missing key "${key}"`);
    }
    else if (owners.length > 1) {
        errors.push(`${groupName}.${registerType} key "${key}" is mapped on multiple boards: ${owners.map((board) => board.boardId).join(", ")}`);
    }
    else {
        const address = owners[0].mappings[registerType][key];
        if (constants_1.INVALID_MODBUS_ADDRESSES.includes(address)) {
            errors.push(`${groupName}.${registerType} key "${key}" maps to unreadable placeholder address ${address}`);
        }
        else if (!isReadableAddress(address)) {
            errors.push(`${groupName}.${registerType} key "${key}" maps to invalid address ${String(address)}`);
        }
    }
    if (!hasOwn(thresholds, key)) {
        errors.push(`${groupName}.${registerType} missing threshold for key "${key}"`);
    }
}
function validatePollingConfig(config, errors) {
    var _a, _b;
    const groupEntries = Object.entries((_a = config.pollingConfig) !== null && _a !== void 0 ? _a : {});
    const boards = getBoardConfigs(config);
    if (groupEntries.length === 0) {
        errors.push("pollingConfig must define at least one poll group");
        return;
    }
    for (const [groupName, group] of groupEntries) {
        if (!Number.isFinite(group.interval) || group.interval <= 0) {
            errors.push(`${groupName}.interval must be a positive number`);
        }
        for (const registerType of REGISTER_TYPES) {
            const keys = (_b = group[registerType]) !== null && _b !== void 0 ? _b : [];
            for (const key of keys) {
                validatePollKey(config, boards, groupName, registerType, key, errors);
            }
        }
    }
}
function validateScaleConfigs(config, errors) {
    for (const [index, scaleConfig] of config.scaleConfigs.entries()) {
        if (!scaleConfig.key) {
            errors.push(`scaleConfigs[${index}].key must be a non-empty string`);
        }
        if (scaleConfig.operation !== "multiply" && scaleConfig.operation !== "divide") {
            errors.push(`scaleConfigs[${index}].operation must be "multiply" or "divide"`);
        }
        if (!Number.isFinite(scaleConfig.factor) || scaleConfig.factor <= 0) {
            errors.push(`scaleConfigs[${index}].factor must be a positive number`);
        }
        if (scaleConfig.direction !== "read" && scaleConfig.direction !== "write") {
            errors.push(`scaleConfigs[${index}].direction must be "read" or "write"`);
        }
    }
}
function validateResolvedConfig(config) {
    const errors = [];
    const warnings = [];
    validatePollingConfig(config, errors);
    validateScaleConfigs(config, errors);
    const boards = getBoardConfigs(config);
    if (boards.length === 1) {
        addDuplicateAddressWarnings(boards[0].mappings, warnings);
    }
    else {
        for (const board of boards) {
            addDuplicateAddressWarnings(board.mappings, warnings, board.boardId);
        }
    }
    return { errors, warnings };
}
