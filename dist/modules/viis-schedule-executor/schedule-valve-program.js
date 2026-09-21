"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VALVE_PROGRAM_DEFAULT_ADDRESS = void 0;
exports.isValveOn = isValveOn;
exports.numberedValveIndex = numberedValveIndex;
exports.isValveProgramHoldingKey = isValveProgramHoldingKey;
exports.findValveProgramHoldingKey = findValveProgramHoldingKey;
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
function numberedValveIndex(key) {
    const match = key.match(/(?<!time_)valve_(\d+)$/i);
    if (!match)
        return null;
    return Number(match[1]);
}
function isValveProgramHoldingKey(key) {
    return /(?:^|_)valve_program(_index)?$/i.test(key);
}
function findValveProgramHoldingKey(holdingMap) {
    if (Object.prototype.hasOwnProperty.call(holdingMap, 'valve_program')) {
        return 'valve_program';
    }
    return Object.keys(holdingMap).find((key) => isValveProgramHoldingKey(key));
}
function buildValveProgramBitmask(actionObj) {
    let mask = 0;
    for (const [key, value] of Object.entries(actionObj)) {
        const index = numberedValveIndex(key);
        if (index === null || index < 0 || index > 15)
            continue;
        if (isValveOn(value)) {
            mask |= (1 << index);
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
/** Resolve write address or null if a non-program key already owns the target addr. */
function resolveValveProgramAddress(holdingMap) {
    const programKey = findValveProgramHoldingKey(holdingMap);
    const mapped = programKey !== undefined ? holdingMap[programKey] : undefined;
    const target = mapped !== undefined ? Number(mapped) : exports.VALVE_PROGRAM_DEFAULT_ADDRESS;
    const others = occupyingKeysAtAddress(holdingMap, target).filter(k => k !== programKey);
    if (others.length > 0)
        return null;
    if (mapped === undefined && occupyingKeysAtAddress(holdingMap, exports.VALVE_PROGRAM_DEFAULT_ADDRESS).length > 0) {
        return null;
    }
    if (mapped === undefined)
        return exports.VALVE_PROGRAM_DEFAULT_ADDRESS;
    return target;
}
function valveProgramWriteKey(holdingMap) {
    return findValveProgramHoldingKey(holdingMap) || 'valve_program';
}
function buildValveProgramCommand(actionObj, holdingMap, unitid = 1) {
    const address = resolveValveProgramAddress(holdingMap);
    if (address === null)
        return null;
    return {
        key: valveProgramWriteKey(holdingMap),
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
        key: valveProgramWriteKey(holdingMap),
        value: 0,
        fc: 6,
        unitid,
        address,
        quantity: 1,
    };
}
