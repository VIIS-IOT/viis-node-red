"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValveKey = exports.isNumberedValveKey = exports.isPumpKey = exports.isChannelPowerKey = exports.isSystemPowerKey = void 0;
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
/** Firmware often auto-starts main_pump on power. Finish must always stop mapped pumps. */
function impliedFinishPumpCommands(commands, coilMap, unitid = 1) {
    return Object.entries(coilMap)
        .filter(([key]) => (0, exports.isPumpKey)(key))
        .filter(([key, address]) => !commands.some(cmd => cmd.key === key || (cmd.fc === 5 && Number(cmd.address) === Number(address))))
        .map(([key, address]) => ({
        key,
        value: false,
        fc: 5,
        unitid,
        address: Number(address),
        quantity: 1,
    }));
}
