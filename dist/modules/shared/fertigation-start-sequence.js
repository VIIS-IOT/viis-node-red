"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WATER_HAMMER_DELAY_MS = void 0;
exports.resolveWaterHammerDelayMs = resolveWaterHammerDelayMs;
exports.isFertigationBatch = isFertigationBatch;
exports.planFertigationStartWrites = planFertigationStartWrites;
const schedule_coil_classify_1 = require("../viis-schedule-executor/schedule-coil-classify");
const schedule_valve_program_1 = require("../viis-schedule-executor/schedule-valve-program");
exports.WATER_HAMMER_DELAY_MS = 7000;
function resolveWaterHammerDelayMs(seconds) {
    if (seconds === undefined || seconds === null || seconds === '') {
        return exports.WATER_HAMMER_DELAY_MS;
    }
    const n = typeof seconds === 'number' ? seconds : Number(seconds);
    if (!Number.isFinite(n) || n < 0) {
        return exports.WATER_HAMMER_DELAY_MS;
    }
    return Math.round(n * 1000);
}
const UNUSED_HOLDING_KEY = /(?:^|_)(time_valve_|set_flow)/i;
const FERTIGATION_PUMP_KEY = /(?:^|_)(main_pump|input_pump)$/i;
function isFertigationBatch(keys) {
    return keys.some((key) => (0, schedule_coil_classify_1.isNumberedValveKey)(key) || (0, schedule_coil_classify_1.isSystemPowerKey)(key) || FERTIGATION_PUMP_KEY.test(key));
}
function planFertigationStartWrites(input, options = {}) {
    const provided = {};
    for (const cmd of input.commands) {
        provided[cmd.key] = cmd.value;
    }
    const ops = [];
    const unusedResetKeys = new Set();
    for (const key of Object.keys(input.holdings)) {
        if (!UNUSED_HOLDING_KEY.test(key))
            continue;
        if (Object.prototype.hasOwnProperty.call(provided, key))
            continue;
        unusedResetKeys.add(key);
        ops.push({ kind: 'write', key, value: 0 });
    }
    const valveProgram = (0, schedule_valve_program_1.buildValveProgramCommand)(provided, input.holdings);
    if (valveProgram) {
        ops.push({ kind: 'write', key: valveProgram.key, value: valveProgram.value });
    }
    for (const [key, value] of Object.entries(provided)) {
        if ((0, schedule_valve_program_1.isValveProgramHoldingKey)(key))
            continue;
        if (unusedResetKeys.has(key))
            continue;
        if (!Object.prototype.hasOwnProperty.call(input.holdings, key))
            continue;
        ops.push({ kind: 'write', key, value });
    }
    const coilEntries = Object.entries(provided)
        .filter(([key, value]) => Object.prototype.hasOwnProperty.call(input.coils, key) && (0, schedule_valve_program_1.isValveOn)(value))
        .map(([key, value]) => ({ key, value }));
    const { powerCoils, pumpCoils, valveCoils, otherCoils } = (0, schedule_coil_classify_1.classifyCoils)(coilEntries);
    const hammerMs = Number.isFinite(options.waterHammerDelayMs)
        ? Number(options.waterHammerDelayMs)
        : exports.WATER_HAMMER_DELAY_MS;
    for (const cmd of valveCoils) {
        ops.push({ kind: 'write', key: cmd.key, value: cmd.value });
    }
    for (const cmd of otherCoils) {
        ops.push({ kind: 'write', key: cmd.key, value: cmd.value });
    }
    if (pumpCoils.length > 0 || powerCoils.length > 0) {
        ops.push({ kind: 'delay', ms: hammerMs });
    }
    for (const cmd of pumpCoils) {
        ops.push({ kind: 'write', key: cmd.key, value: cmd.value });
    }
    for (const cmd of powerCoils) {
        ops.push({ kind: 'write', key: cmd.key, value: cmd.value });
    }
    return ops;
}
