"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planAddressRanges = planAddressRanges;
const constants_1 = require("../constants");
function isReadableAddress(address) {
    return (Number.isInteger(address) &&
        address >= 0 &&
        !constants_1.INVALID_MODBUS_ADDRESSES.includes(address));
}
function toAddressRecord(address, keys) {
    return { [address]: keys };
}
function planAddressRanges(input) {
    var _a, _b;
    const keysByAddress = new Map();
    for (const key of input.requestedKeys) {
        const address = input.mapping[key];
        if (!isReadableAddress(address)) {
            continue;
        }
        const aliases = (_a = keysByAddress.get(address)) !== null && _a !== void 0 ? _a : [];
        aliases.push(key);
        keysByAddress.set(address, aliases);
    }
    const addresses = Array.from(keysByAddress.keys()).sort((left, right) => left - right);
    const ranges = [];
    for (const address of addresses) {
        const currentRange = ranges[ranges.length - 1];
        const previousAddress = currentRange === null || currentRange === void 0 ? void 0 : currentRange.addresses[currentRange.addresses.length - 1];
        const gap = previousAddress === undefined ? 0 : address - previousAddress;
        const nextQuantity = currentRange ? address - currentRange.start + 1 : 1;
        const aliases = (_b = keysByAddress.get(address)) !== null && _b !== void 0 ? _b : [];
        if (!currentRange || gap > input.maxGap || nextQuantity > input.maxQuantity) {
            ranges.push({
                registerType: input.registerType,
                functionCode: input.functionCode,
                start: address,
                quantity: 1,
                addresses: [address],
                keysByAddress: toAddressRecord(address, aliases),
            });
            continue;
        }
        currentRange.addresses.push(address);
        currentRange.quantity = nextQuantity;
        currentRange.keysByAddress[address] = aliases;
    }
    return ranges;
}
