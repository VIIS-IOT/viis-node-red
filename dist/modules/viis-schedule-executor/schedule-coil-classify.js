"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValveKey = exports.isPumpKey = exports.isChannelPowerKey = exports.isSystemPowerKey = void 0;
exports.classifyCoils = classifyCoils;
const isSystemPowerKey = (key) => key === 'power';
exports.isSystemPowerKey = isSystemPowerKey;
const isChannelPowerKey = (key) => key.includes('power') && key !== 'power';
exports.isChannelPowerKey = isChannelPowerKey;
const isPumpKey = (key) => key.includes('pump');
exports.isPumpKey = isPumpKey;
const isValveKey = (key) => key.includes('valve_');
exports.isValveKey = isValveKey;
function classifyCoils(commands) {
    const powerCoils = commands.filter(cmd => (0, exports.isSystemPowerKey)(cmd.key));
    const pumpCoils = commands.filter(cmd => (0, exports.isPumpKey)(cmd.key) || (0, exports.isChannelPowerKey)(cmd.key));
    const valveCoils = commands.filter(cmd => (0, exports.isValveKey)(cmd.key));
    const otherCoils = commands.filter(cmd => !(0, exports.isSystemPowerKey)(cmd.key) && !(0, exports.isChannelPowerKey)(cmd.key) && !(0, exports.isPumpKey)(cmd.key) && !(0, exports.isValveKey)(cmd.key));
    return { powerCoils, pumpCoils, valveCoils, otherCoils };
}
