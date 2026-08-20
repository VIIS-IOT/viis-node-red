"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WATER_HAMMER_DELAY_MS = void 0;
exports.isFertigationBatch = isFertigationBatch;
exports.planFertigationStartWrites = planFertigationStartWrites;
const schedule_coil_classify_1 = require("../viis-schedule-executor/schedule-coil-classify");
const schedule_valve_program_1 = require("../viis-schedule-executor/schedule-valve-program");
exports.WATER_HAMMER_DELAY_MS = 7000;
const VALVE_COIL_KEY = /^valve_\d+$/i;
const FERTIGATION_TRIGGER_KEYS = new Set(['power', 'main_pump', 'input_pump']);
const UNUSED_HOLDING_KEY = /^(time_valve_|set_flow)/i;
function isFertigationBatch(keys) {
    return keys.some((key) => {
        const lower = key.toLowerCase();
        return VALVE_COIL_KEY.test(key) || FERTIGATION_TRIGGER_KEYS.has(lower);
    });
}
function planFertigationStartWrites(input) {
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
        ops.push({ kind: 'write', key: 'valve_program', value: valveProgram.value });
    }
    for (const [key, value] of Object.entries(provided)) {
        if (key === 'valve_program')
            continue;
        if (unusedResetKeys.has(key))
            continue;
        if (!Object.prototype.hasOwnProperty.call(input.holdings, key))
            continue;
        ops.push({ kind: 'write', key, value });
    }
    const coilEntries = Object.entries(provided)
        .filter(([key, value]) => Object.prototype.hasOwnProperty.call(input.coils, key) && (0, schedule_valve_program_1.isValveOn)(value))
        .filter(([key]) => VALVE_COIL_KEY.test(key) || !/valve_/i.test(key))
        .map(([key, value]) => ({ key, value }));
    const numberedValves = coilEntries.filter((cmd) => VALVE_COIL_KEY.test(cmd.key));
    const remainingCoils = coilEntries.filter((cmd) => !VALVE_COIL_KEY.test(cmd.key));
    const { powerCoils, pumpCoils, otherCoils } = (0, schedule_coil_classify_1.classifyCoils)(remainingCoils);
    for (const cmd of numberedValves) {
        ops.push({ kind: 'write', key: cmd.key, value: cmd.value });
    }
    for (const cmd of otherCoils) {
        ops.push({ kind: 'write', key: cmd.key, value: cmd.value });
    }
    if (pumpCoils.length > 0 || powerCoils.length > 0) {
        ops.push({ kind: 'delay', ms: exports.WATER_HAMMER_DELAY_MS });
    }
    for (const cmd of pumpCoils) {
        ops.push({ kind: 'write', key: cmd.key, value: cmd.value });
    }
    for (const cmd of powerCoils) {
        ops.push({ kind: 'write', key: cmd.key, value: cmd.value });
    }
    return ops;
}
