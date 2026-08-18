"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VALVE_PROGRAM_DEFAULT_ADDRESS = void 0;
exports.isValveOn = isValveOn;
exports.buildValveProgramBitmask = buildValveProgramBitmask;
exports.mergeHoldingMaps = mergeHoldingMaps;
exports.occupyingKeysAtAddress = occupyingKeysAtAddress;
exports.resolveValveProgramAddress = resolveValveProgramAddress;
exports.buildValveProgramCommand = buildValveProgramCommand;
exports.buildValveProgramOffCommand = buildValveProgramOffCommand;
exports.VALVE_PROGRAM_DEFAULT_ADDRESS = 20;
function isValveOn(raw) {
    return raw === true || raw === 'true' || raw === 1 || raw === '1';
}
function buildValveProgramBitmask(actionObj) {
    let mask = 0;
    for (let i = 0; i < 16; i++) {
        if (isValveOn(actionObj[`valve_${i}`])) {
            mask |= (1 << i);
        }
    }
    return mask;
}
function mergeHoldingMaps(...maps) {
    return Object.assign({}, ...maps.filter(Boolean));
}
function occupyingKeysAtAddress(holdingMap, address) {
    return Object.entries(holdingMap)
        .filter(([, addr]) => Number(addr) === address)
        .map(([key]) => key);
}
/** Resolve write address or null if a non-valve_program key already owns 20 / the mapped addr. */
function resolveValveProgramAddress(holdingMap) {
    const mapped = holdingMap.valve_program;
    const target = mapped !== undefined ? Number(mapped) : exports.VALVE_PROGRAM_DEFAULT_ADDRESS;
    const others = occupyingKeysAtAddress(holdingMap, target).filter(k => k !== 'valve_program');
    if (others.length > 0)
        return null;
    if (mapped === undefined && occupyingKeysAtAddress(holdingMap, exports.VALVE_PROGRAM_DEFAULT_ADDRESS).length > 0) {
        return null;
    }
    if (mapped === undefined)
        return exports.VALVE_PROGRAM_DEFAULT_ADDRESS;
    return target;
}
function buildValveProgramCommand(actionObj, holdingMap, unitid = 1) {
    const address = resolveValveProgramAddress(holdingMap);
    if (address === null)
        return null;
    return {
        key: 'valve_program',
        value: buildValveProgramBitmask(actionObj),
        fc: 6,
        unitid,
        address,
        quantity: 1,
    };
}
function buildValveProgramOffCommand(holdingMap, unitid = 1) {
    const address = resolveValveProgramAddress(holdingMap);
    if (address === null)
        return null;
    return {
        key: 'valve_program',
        value: 0,
        fc: 6,
        unitid,
        address,
        quantity: 1,
    };
}
