"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAutoStartPumpKey = exports.isValveKey = exports.isNumberedValveKey = exports.isPumpKey = exports.isChannelPowerKey = exports.isSystemPowerKey = void 0;
exports.classifyCoils = classifyCoils;
exports.impliedFinishPumpCommands = impliedFinishPumpCommands;
/** `power` or `…_power`, but not `power_1` / `fertigation_control_power_1`. */
const isSystemPowerKey = (key) => /(?:^|_)power$/i.test(key);
exports.isSystemPowerKey = isSystemPowerKey;
const isChannelPowerKey = (key) => /power/i.test(key) && !(0, exports.isSystemPowerKey)(key);
exports.isChannelPowerKey = isChannelPowerKey;
const isPumpKey = (key) => /pump/i.test(key);
exports.isPumpKey = isPumpKey;
/** Numbered valve coil: `valve_0` or `fertigation_control_valve_0`, not `time_valve_0`. */
const isNumberedValveKey = (key) => /(?<!time_)valve_\d+$/i.test(key);
exports.isNumberedValveKey = isNumberedValveKey;
const isValveKey = (key) => (0, exports.isNumberedValveKey)(key)
    || (/valve_/i.test(key) && !/(?:^|_)time_valve_/i.test(key) && !/(?:^|_)valve_program/i.test(key));
exports.isValveKey = isValveKey;
function classifyCoils(commands) {
    const powerCoils = commands.filter(cmd => (0, exports.isSystemPowerKey)(cmd.key));
    const pumpCoils = commands.filter(cmd => (0, exports.isPumpKey)(cmd.key) || (0, exports.isChannelPowerKey)(cmd.key));
    const valveCoils = commands.filter(cmd => (0, exports.isValveKey)(cmd.key));
    const otherCoils = commands.filter(cmd => !(0, exports.isSystemPowerKey)(cmd.key) && !(0, exports.isChannelPowerKey)(cmd.key) && !(0, exports.isPumpKey)(cmd.key) && !(0, exports.isValveKey)(cmd.key));
    return { powerCoils, pumpCoils, valveCoils, otherCoils };
}
/** Fertigation main pumps (`main_pump`, `input_pump`, prefixed or not): the board can start them on power. */
const isAutoStartPumpKey = (key) => /(?:^|_)(main_pump|input_pump)$/i.test(key);
exports.isAutoStartPumpKey = isAutoStartPumpKey;
/**
 * Pumps a finishing schedule must also stop although it never wrote them: the firmware often auto-starts the
 * main pump when the system power turns on, so a schedule that switched the system power stops the mapped
 * main/input pumps. Nothing else: other pumps (sub/water pumps run by their own schedules) and pump status/error
 * coils are left alone. Stopping every coil named "pump" cut a running sub pump at the end of each unrelated
 * irrigation (Fertigation-VIIS-RS485-007, 2026-10-29 and 2026-11-26).
 */
function impliedFinishPumpCommands(commands, coilMap, unitid = 1, 
/** Multi-board: board owning a key. Same address on another board is a different coil. */
boardOf) {
    if (!commands.some(cmd => (0, exports.isSystemPowerKey)(cmd.key)))
        return [];
    const sameTarget = (cmd, key) => { var _a; return !boardOf || ((_a = cmd.boardId) !== null && _a !== void 0 ? _a : undefined) === boardOf(key); };
    return Object.entries(coilMap)
        .filter(([key]) => (0, exports.isAutoStartPumpKey)(key))
        .filter(([key, address]) => !commands.some(cmd => cmd.key === key
        || (cmd.fc === 5 && Number(cmd.address) === Number(address) && sameTarget(cmd, key))))
        .map(([key, address]) => ({
        key,
        value: false,
        fc: 5,
        unitid,
        address: Number(address),
        quantity: 1,
    }));
}
