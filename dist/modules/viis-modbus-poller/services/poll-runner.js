"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPollTick = runPollTick;
const viis_telemetry_utils_1 = require("../../viis-telemetry/viis-telemetry-utils");
const change_detector_1 = require("./change-detector");
const diagnostics_1 = require("./diagnostics");
const range_planner_1 = require("./range-planner");
const READ_ORDER = ["coils", "discreteInputs", "input", "holding"];
const FUNCTION_CODES = {
    coils: 1,
    discreteInputs: 2,
    input: 4,
    holding: 3,
};
function collectRequestedKeys(input, registerType) {
    var _a;
    const requestedKeys = new Set();
    for (const groupName of input.dueGroups) {
        const group = input.config.pollingConfig[groupName];
        for (const key of (_a = group === null || group === void 0 ? void 0 : group[registerType]) !== null && _a !== void 0 ? _a : []) {
            requestedKeys.add(key);
        }
    }
    return Array.from(requestedKeys);
}
function getMaxQuantity(input, registerType) {
    // Discrete inputs are bits like coils, so they share the bit read limit.
    return registerType === "coils" || registerType === "discreteInputs"
        ? input.options.maxCoilsPerRead
        : input.options.maxRegistersPerRead;
}
function createRanges(input, registerType) {
    var _a;
    return (0, range_planner_1.planAddressRanges)({
        registerType,
        functionCode: FUNCTION_CODES[registerType],
        requestedKeys: collectRequestedKeys(input, registerType),
        mapping: (_a = input.config.mappings[registerType]) !== null && _a !== void 0 ? _a : {},
        maxGap: input.options.maxGap,
        maxQuantity: getMaxQuantity(input, registerType),
    });
}
function readRange(input, range) {
    if (range.registerType === "coils") {
        return input.modbusClient.readCoils(range.start, range.quantity);
    }
    if (range.registerType === "discreteInputs") {
        // Never fall back to readCoils: FC01 addresses a different table and would return wrong bits.
        if (!input.modbusClient.readDiscreteInputs) {
            return Promise.reject(new Error("Modbus client does not support FC02 (read discrete inputs)"));
        }
        return input.modbusClient.readDiscreteInputs(range.start, range.quantity);
    }
    if (range.registerType === "input") {
        return input.modbusClient.readInputRegisters(range.start, range.quantity);
    }
    return input.modbusClient.readHoldingRegisters(range.start, range.quantity);
}
function formatError(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
function mapValue(key, rawValue, scaleConfigs) {
    if (typeof rawValue === "number") {
        return (0, viis_telemetry_utils_1.applyScaling)(key, rawValue, "read", scaleConfigs);
    }
    return Boolean(rawValue);
}
function mapRangeResult(range, result, scaleConfigs, diagnostics) {
    var _a, _b;
    const mapped = {};
    const resultAddress = (_a = result.address) !== null && _a !== void 0 ? _a : range.start;
    for (const address of range.addresses) {
        const offset = address - resultAddress;
        const rawValue = result.data[offset];
        if (rawValue === undefined) {
            (0, diagnostics_1.addDiagnosticError)(diagnostics, `${range.registerType} missing data at ${address} from read ${resultAddress} qty ${range.quantity}`);
            continue;
        }
        for (const key of (_b = range.keysByAddress[address]) !== null && _b !== void 0 ? _b : []) {
            mapped[key] = mapValue(key, rawValue, scaleConfigs);
        }
    }
    return mapped;
}
function addMissingGroupWarnings(input, diagnostics) {
    for (const groupName of input.dueGroups) {
        if (!input.config.pollingConfig[groupName]) {
            (0, diagnostics_1.addDiagnosticWarning)(diagnostics, `due group "${groupName}" is not configured`);
        }
    }
}
async function runPollTick(input) {
    const diagnostics = (0, diagnostics_1.createPollerDiagnostics)(input.config.boardId, input.dueGroups);
    const latestData = {};
    addMissingGroupWarnings(input, diagnostics);
    for (const registerType of READ_ORDER) {
        for (const range of createRanges(input, registerType)) {
            (0, diagnostics_1.addDiagnosticRequest)(diagnostics, {
                registerType,
                start: range.start,
                quantity: range.quantity,
            });
            try {
                const result = await readRange(input, range);
                Object.assign(latestData, mapRangeResult(range, result, input.config.scaleConfigs, diagnostics));
                (0, diagnostics_1.markDiagnosticRead)(diagnostics);
            }
            catch (error) {
                (0, diagnostics_1.addDiagnosticError)(diagnostics, `${registerType} read failed at ${range.start} qty ${range.quantity}: ${formatError(error)}`);
            }
        }
    }
    return {
        latestData,
        changedData: (0, change_detector_1.detectChangedData)({
            current: latestData,
            previous: input.previousState,
            thresholds: input.config.thresholds,
            publishFullSnapshot: input.options.publishFullSnapshot,
        }),
        diagnostics: (0, diagnostics_1.finalizePollerDiagnostics)(diagnostics),
    };
}
